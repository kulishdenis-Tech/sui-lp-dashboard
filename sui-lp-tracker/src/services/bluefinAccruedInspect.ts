import { bcs } from '@mysten/sui/bcs'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeStructTag, normalizeSuiAddress, SUI_CLOCK_OBJECT_ID } from '@mysten/sui/utils'
import { PROTOCOL_PACKAGES } from '@/utils/constants'

const PKG = PROTOCOL_PACKAGES.BLUEFIN_CLMM
const BLUEFIN_POOL = `${PKG}::pool`

/**
 * Аналог `OnChainCalls.getAccruedFeeAndRewards` у `@firefly-exchange/library-sui` (v2.13+):
 * devInspect `pool::get_accrued_rewards` (по кожному reward) і `pool::get_accrued_fee` (останній виклик),
 * з `0x2::clock::Clock`, `&Pool`, `&Position` і type args.
 *
 * `position::get_accrued_fee` / `position::coins_owed_reward` без pool дають 0 / не ті числа; це **не** те саме, що в Bluefin UI.
 */
const DEVINSPECT_SENDER = '0x0000000000000000000000000000000000000000000000000000000000000000' as const

/** If the RPC doesn't respond within this limit, reject instead of hanging forever. */
const DEVINSPECT_TIMEOUT_MS = 20_000

function u64BytesToString(bytes: number[] | undefined): string {
	if (!bytes?.length) return '0'
	try {
		const n = bcs.u64().parse(Uint8Array.from(bytes)) as string | number | bigint
		if (typeof n === 'bigint') return n.toString()
		if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return String(Math.trunc(n))
		if (typeof n === 'string' && /^\d+$/.test(n)) return n
		return '0'
	} catch {
		return '0'
	}
}

function normType(ct: string): string {
	if (!ct) return ''
	try {
		return normalizeStructTag(ct)
	} catch {
		return ct
	}
}

export type BluefinAccruedInspectResult =
	| { ok: true; rawFeeA: string; rawFeeB: string; rewardRaws: string[] }
	| { ok: false; error: string }

export type BluefinPoolAccruedInput = {
	positionId: string
	poolId: string
	/** `coin_type_a` / b з position (нормалізовані) */
	coinTypeA: string
	coinTypeB: string
	/** Type args для `get_accrued_rewards` (3-й generic) — по одному з `pool.reward_infos` */
	rewardCoinTypes: string[]
	/**
	 * Краще передати адресу власника NFT; окремі RPC/`devInspect` інакше повертають помилку
	 * із нульовим sender замість результату view-викликів.
	 */
	inspectSender?: string
}

type InspectCore = {
	positionId: string
	poolId: string
	coinTypeA: string
	coinTypeB: string
}

function normalizeRewardArgTypes(rewardCoinTypes: string[]): string[] {
	const validRewards: string[] = []
	for (const x of rewardCoinTypes) {
		const t = normType(x)
		if (t) validRewards.push(t)
		if (validRewards.length >= 32) break
	}
	return validRewards
}

/**
 * Один devInspect: спочатку N× `get_accrued_rewards`, потім `get_accrued_fee`.
 */
async function devInspectBluefinOnce(
	client: SuiJsonRpcClient,
	core: InspectCore,
	validRewards: string[],
	sender: string,
): Promise<BluefinAccruedInspectResult> {
	const tx = new Transaction()
	const poolRef = tx.object(core.poolId)
	const posRef = tx.object(core.positionId)
	const clock = tx.object(SUI_CLOCK_OBJECT_ID)
	const tA = core.coinTypeA
	const tB = core.coinTypeB
	for (const tR of validRewards) {
		tx.moveCall({
			target: `${BLUEFIN_POOL}::get_accrued_rewards`,
			typeArguments: [tA, tB, tR],
			arguments: [clock, poolRef, posRef],
		})
	}
	tx.moveCall({
		target: `${BLUEFIN_POOL}::get_accrued_fee`,
		typeArguments: [tA, tB],
		arguments: [clock, poolRef, posRef],
	})

	let res
	try {
		const timeoutPromise = new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new Error(`devInspect timeout after ${DEVINSPECT_TIMEOUT_MS}ms`)),
				DEVINSPECT_TIMEOUT_MS,
			),
		)
		res = await Promise.race([
			client.devInspectTransactionBlock({ transactionBlock: tx, sender }),
			timeoutPromise,
		])
	} catch (e) {
		const err = e instanceof Error ? e.message : String(e)
		return { ok: false, error: err }
	}

	if (res.error) return { ok: false, error: res.error }

	const results = res.results
	const rewardCmdCount = validRewards.length
	const expected = rewardCmdCount + 1
	if (!results || results.length !== expected) {
		return {
			ok: false,
			error: `devInspect: expected ${expected} command result(s) (rewards+fee), got ${results?.length ?? 0}`,
		}
	}

	const feeIdx = rewardCmdCount
	const feeRet = results[feeIdx]?.returnValues
	if (!feeRet || feeRet.length < 2) {
		return { ok: false, error: 'pool::get_accrued_fee: expected 2 u64 return values' }
	}

	const rawFeeA = u64BytesToString(feeRet[0]?.[0])
	const rawFeeB = u64BytesToString(feeRet[1]?.[0])
	const rewardRaws: string[] = []
	for (let i = 0; i < rewardCmdCount; i += 1) {
		const r = results[i]?.returnValues
		rewardRaws.push(u64BytesToString(r?.[0]?.[0]))
	}
	return { ok: true, rawFeeA, rawFeeB, rewardRaws }
}

/**
 * Сирий u64 після Move view `pool::get_accrued_*`.
 * Fallback: лише fees (без rewards), потім інший sender — щоб RPC/Move помилки на reward-виклику не блокували fee.
 */
export async function fetchBluefinAccruedRaws(
	client: SuiJsonRpcClient,
	input: BluefinPoolAccruedInput,
): Promise<BluefinAccruedInspectResult> {
	const tA = normType(input.coinTypeA)
	const tB = normType(input.coinTypeB)
	if (!tA || !tB) {
		return { ok: false, error: 'Bluefin accrued: missing coin_type_a or coin_type_b' }
	}

	const fullRewards = normalizeRewardArgTypes(input.rewardCoinTypes)
	const senderOpt = input.inspectSender?.trim()
	let walletSender: string = DEVINSPECT_SENDER
	if (senderOpt) {
		try {
			walletSender = normalizeSuiAddress(senderOpt)
		} catch {
			walletSender = senderOpt.startsWith('0x') ? senderOpt : DEVINSPECT_SENDER
		}
	}

	const core: InspectCore = {
		positionId: input.positionId,
		poolId: input.poolId,
		coinTypeA: tA,
		coinTypeB: tB,
	}

	let lastErr = 'Bluefin accrued: all devInspect attempts failed'

	const walletNotZero = walletSender !== DEVINSPECT_SENDER

	const tryRuns: Array<{ rewards: string[]; sender: string }> = [
		{ rewards: fullRewards, sender: walletSender },
	]
	if (fullRewards.length > 0) {
		tryRuns.push({ rewards: [], sender: walletSender })
	}
	if (walletNotZero) {
		tryRuns.push({ rewards: fullRewards, sender: DEVINSPECT_SENDER })
		if (fullRewards.length > 0) {
			tryRuns.push({ rewards: [], sender: DEVINSPECT_SENDER })
		}
	}

	for (const { rewards, sender } of tryRuns) {
		const r = await devInspectBluefinOnce(client, core, rewards, sender)
		if (!r.ok) {
			lastErr = r.error
			continue
		}
		if (fullRewards.length > 0 && rewards.length === 0) {
			return { ok: true, rawFeeA: r.rawFeeA, rawFeeB: r.rawFeeB, rewardRaws: [] }
		}
		return r
	}

	return { ok: false, error: lastErr }
}
