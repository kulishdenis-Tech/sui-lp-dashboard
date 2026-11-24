/**
 * Claim lending rewards (AlphaLend, Navi) to the wallet.
 *
 * Safety model: the transaction is built, then SIMULATED, and the caller shows the
 * resulting balance changes before the wallet is asked to sign. `assertClaimIsSafe`
 * blocks anything that would spend a non-SUI coin of the owner.
 */
import { Transaction } from '@mysten/sui/transactions'
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import { getAlphaLendClient } from '@/services/lendingService'
import {
	CURRENT_PROTOCOL_APP_ID,
	CURRENT_PROTOCOL_PKG,
	getCurrentClaimGroups,
	readClaimableMining,
	type ClaimTarget,
} from '@/services/currentService'
import { suiClient } from '@/services/suiClient'
import { getDashboardGrpcClient } from '@/services/suiData/createGrpcClient'

export type ClaimProtocol = 'AlphaLend' | 'Navi' | 'Current'

export interface ClaimBalanceChange {
	coinType: string
	/** Raw smallest-unit amount, signed. */
	amount: bigint
}

export interface ClaimSimulation {
	ok: boolean
	error?: string
	/** Changes for the owner address only. */
	changes: ClaimBalanceChange[]
}

const SUI_TYPE = '0x2::sui::SUI'

function normType(t: string): string {
	const s = t.trim()
	const m = /^(0x)?([0-9a-fA-F]+)::(.+)$/.exec(s)
	if (!m) return s
	const id = m[2]!.toLowerCase().replace(/^0+/, '') || '0'
	return `0x${id}::${m[3]}`
}

export function isSuiCoin(t: string): boolean {
	return normType(t) === SUI_TYPE
}

export function supportsClaim(protocol: string): protocol is ClaimProtocol {
	return protocol === 'AlphaLend' || protocol === 'Navi' || protocol === 'Current'
}

export async function buildLendingClaimTx(protocol: ClaimProtocol, rawAddress: string): Promise<Transaction> {
	const address = normalizeSuiAddress(rawAddress)
	const tx = new Transaction()
	tx.setSender(address)

	if (protocol === 'Current') {
		await addCurrentClaims(tx, address)
		return tx
	}

	if (protocol === 'AlphaLend') {
		const client = await getAlphaLendClient()
		const caps: Array<{ id: string }> = await client.blockchain.getPositionCapsForUser(address)
		const positionCapId = caps?.[0]?.id
		if (!positionCapId) throw new Error('AlphaLend: position (PositionCap) not found')
		// Both flags false: rewards go to the wallet, nothing is re-deposited into the position.
		await client.claimRewards({
			tx,
			positionCapId,
			address,
			claimAndDepositAlpha: false,
			claimAndDepositAll: false,
		})
		return tx
	}

	const { getUserAvailableLendingRewards, claimLendingRewardsPTB } = await import('@naviprotocol/lending')
	const client = getDashboardGrpcClient()
	const rewards = await getUserAvailableLendingRewards(address, { client, env: 'prod' })
	const claimable = (rewards ?? []).filter((r) => Number(r.userClaimableReward) > 0)
	if (claimable.length === 0) throw new Error('Navi: no rewards to claim')
	// Navi resolves @mysten/sui via the root pin (bot 2.31); tracker uses 2.36 — same runtime shape.
	// claimLendingRewardsPTB options are Env/AccountCap/Market (+ customCoinReceive); client is only for reads.
	await claimLendingRewardsPTB(tx as never, claimable, {
		env: 'prod',
		customCoinReceive: { type: 'transfer', transfer: address },
	})
	return tx
}

export async function simulateClaim(tx: Transaction, rawAddress: string): Promise<ClaimSimulation> {
	const address = normalizeSuiAddress(rawAddress)
	const grpc = getDashboardGrpcClient()
	try {
		const res = await grpc.simulateTransaction({
			transaction: tx,
			include: { balanceChanges: true, effects: true },
		})
		const body = res.Transaction ?? res.FailedTransaction
		const failed = res.$kind === 'FailedTransaction' || body?.status?.success === false
		if (failed) {
			const err = body?.status?.error as { message?: string } | string | null | undefined
			return {
				ok: false,
				error: (typeof err === 'string' ? err : err?.message) ?? 'Simulation failed',
				changes: [],
			}
		}
		const changes = (body?.balanceChanges ?? [])
			.filter((c) => normalizeSuiAddress(c.address) === address)
			.map((c) => ({ coinType: normType(c.coinType), amount: BigInt(c.amount) }))
			.filter((c) => c.amount !== 0n)
		return { ok: true, changes }
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e), changes: [] }
	}
}

/** A claim may only add coins (and pay SUI gas). Returns an error message, or null when safe. */
export function assertClaimIsSafe(sim: ClaimSimulation): string | null {
	if (!sim.ok) return sim.error ?? 'Simulation failed'
	const spend = sim.changes.find((c) => c.amount < 0n && !isSuiCoin(c.coinType))
	if (spend) return `Transaction spends ${spend.coinType.split('::').pop()} — blocked`
	const gainsNonSui = sim.changes.some((c) => c.amount > 0n && !isSuiCoin(c.coinType))
	const gainsSui = sim.changes.some((c) => c.amount > 0n && isSuiCoin(c.coinType))
	if (!gainsNonSui && !gainsSui) return 'Nothing arrives in the wallet — no claim needed'
	return null
}


// ── Current Finance ──────────────────────────────────────────────────────────

function with0x(t: string): string {
	const s = t.trim()
	return s.startsWith('0x') || s.startsWith('0X') ? s : `0x${s}`
}

type OwnedLike = {
	data?: {
		objectId?: string
		type?: string | null
		content?: { fields?: Record<string, unknown> } | null
	} | null
}

/** Owner cap of one obligation: an owned `ObligationOwnerCap` whose `obligation_id` matches. */
export async function findObligationOwnerCap(owner: string, obligationId: string): Promise<string | null> {
	const want = normalizeSuiAddress(obligationId)
	let cursor: string | null | undefined = undefined
	const unread: string[] = []
	for (let page = 0; page < 20; page++) {
		const res = (await suiClient.getOwnedObjects({
			owner,
			options: { showType: true, showContent: true },
			cursor,
			limit: 50,
		})) as { data: OwnedLike[]; hasNextPage?: boolean; nextCursor?: string | null }
		for (const row of res.data ?? []) {
			const d = row.data
			if (!d?.objectId || !d.type || !/ObligationOwnerCap/.test(d.type)) continue
			const id = d.content?.fields?.obligation_id
			if (typeof id === 'string') {
				if (normalizeSuiAddress(id) === want) return d.objectId
			} else {
				unread.push(d.objectId)
			}
		}
		if (!res.hasNextPage || !res.nextCursor) break
		cursor = res.nextCursor
	}
	for (const capId of unread) {
		const obj = (await suiClient.getObject({ id: capId, options: { showContent: true } })) as OwnedLike
		const id = obj.data?.content?.fields?.obligation_id
		if (typeof id === 'string' && normalizeSuiAddress(id) === want) return capId
	}
	return null
}

/** Same call the official SDK makes (`liquidity_mining::claim_reward_as_coin`), coin goes to the owner. */
export function pushCurrentClaimCall(
	tx: Transaction,
	args: { marketObjectId: string; marketType: string; ownerCapId: string; recipient: string; target: ClaimTarget },
): void {
	const coin = tx.moveCall({
		target: `${CURRENT_PROTOCOL_PKG}::liquidity_mining::claim_reward_as_coin`,
		arguments: [
			tx.object(CURRENT_PROTOCOL_APP_ID),
			tx.object(args.marketObjectId),
			tx.object(args.ownerCapId),
			tx.pure.u8(args.target.rewardType),
			tx.pure.u64(args.target.rewardIndex),
			tx.object('0x6'),
		],
		typeArguments: [
			normalizeStructTag(with0x(args.marketType)),
			normalizeStructTag(with0x(args.target.reserveCoin)),
			normalizeStructTag(with0x(args.target.rewardCoin)),
		],
	})
	tx.transferObjects([coin], tx.pure.address(args.recipient))
}

async function addCurrentClaims(tx: Transaction, address: string): Promise<void> {
	const groups = getCurrentClaimGroups(address)
	if (groups.length === 0) throw new Error('Current: no positions found (refresh data)')
	let calls = 0
	for (const g of groups) {
		// Fresh read right before building: claim only what is claimable now.
		const read = await readClaimableMining(g.marketObjectId, g.obligationId, g.deposits, g.borrows, [])
		if (read.status === 'unavailable') throw new Error(read.reason ?? 'Current: rewards unavailable')
		const targets = (read.targets ?? []).filter((t) => BigInt(t.raw) > 0n)
		if (targets.length === 0) continue
		const ownerCapId = await findObligationOwnerCap(address, g.obligationId)
		if (!ownerCapId) throw new Error('Current: ObligationOwnerCap not found on this wallet')
		for (const target of targets) {
			pushCurrentClaimCall(tx, {
				marketObjectId: g.marketObjectId,
				marketType: g.marketType,
				ownerCapId,
				recipient: address,
				target,
			})
			calls++
		}
	}
	if (calls === 0) throw new Error('Current: no rewards to claim')
}
