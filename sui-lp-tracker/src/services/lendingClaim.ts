/**
 * Claim lending rewards (AlphaLend, Navi) to the wallet.
 *
 * Safety model: the transaction is built, then SIMULATED, and the caller shows the
 * resulting balance changes before the wallet is asked to sign. `assertClaimIsSafe`
 * blocks anything that would spend a non-SUI coin of the owner.
 */
import { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { getAlphaLendClient } from '@/services/lendingService'
import { getDashboardGrpcClient } from '@/services/suiData/createGrpcClient'

export type ClaimProtocol = 'AlphaLend' | 'Navi'

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
	return protocol === 'AlphaLend' || protocol === 'Navi'
}

export async function buildLendingClaimTx(protocol: ClaimProtocol, rawAddress: string): Promise<Transaction> {
	const address = normalizeSuiAddress(rawAddress)
	const tx = new Transaction()
	tx.setSender(address)

	if (protocol === 'AlphaLend') {
		const client = await getAlphaLendClient()
		const caps: Array<{ id: string }> = await client.blockchain.getPositionCapsForUser(address)
		const positionCapId = caps?.[0]?.id
		if (!positionCapId) throw new Error('AlphaLend: позицію (PositionCap) не знайдено')
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
	if (claimable.length === 0) throw new Error('Navi: немає нагород до клейму')
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
				error: (typeof err === 'string' ? err : err?.message) ?? 'Симуляція не пройшла',
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
	if (!sim.ok) return sim.error ?? 'Симуляція не пройшла'
	const spend = sim.changes.find((c) => c.amount < 0n && !isSuiCoin(c.coinType))
	if (spend) return `Транзакція списує ${spend.coinType.split('::').pop()} — заблоковано`
	const gainsNonSui = sim.changes.some((c) => c.amount > 0n && !isSuiCoin(c.coinType))
	const gainsSui = sim.changes.some((c) => c.amount > 0n && isSuiCoin(c.coinType))
	if (!gainsNonSui && !gainsSui) return 'Нічого не надходить на гаманець — клейм не потрібен'
	return null
}
