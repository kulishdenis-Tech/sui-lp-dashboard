import type { ClosedPosition, PositionEvent } from '@/types'
import type { BluefinPoolPairMeta } from '@/services/bluefinService'
import { fetchMomentumPoolPairMeta, listMomentumOwnedPositionIds } from '@/services/momentumService'
import {
	hydrateMomentumRewardAmounts,
	parseMomentumEventFromSui,
	readMomentumPoolIdFromEventJson,
} from '@/services/momentumLpEvents'
import {
	type MomentumWalletRawEvt,
	scanMomentumWalletAllPositionEvents,
} from '@/services/eventParser'
import { resolveSpots } from '@/services/spotPrice/resolveSpots'
import { normalizeSuiAddress } from '@mysten/sui/utils'

function structTail(typeStr: string): string {
	const p = typeStr.split('::')
	return p[p.length - 1] ?? ''
}

function rowIsCloseMomentum(r: MomentumWalletRawEvt): boolean {
	return structTail(r.event.type) === 'ClosePositionEvent'
}

function rowIsRemoveMomentumLiquidity(r: MomentumWalletRawEvt): boolean {
	return structTail(r.event.type) === 'RemoveLiquidityEvent'
}

function hasMomentumCloseLikeSignal(rows: MomentumWalletRawEvt[]): boolean {
	return rows.some(rowIsCloseMomentum) || rows.some(rowIsRemoveMomentumLiquidity)
}

function inferPoolIdMomentumRows(rows: MomentumWalletRawEvt[]): string | null {
	for (const r of rows) {
		const id = readMomentumPoolIdFromEventJson(r.event.parsedJson)
		if (id) return id
	}
	return null
}

function poolCacheKey(rawId: string): string {
	try {
		return normalizeSuiAddress(rawId)
	} catch {
		return rawId
	}
}

function feeLabelFromMillionths(feeM: number): string {
	if (!Number.isFinite(feeM) || feeM <= 0) return '—'
	return `${((feeM / 1_000_000) * 100).toFixed(2)}%`
}

export type MomentumClosedPreScan = {
	rawByPositionId: Map<string, MomentumWalletRawEvt[]>
	historyPartial: boolean
}

/**
 * Закриті Momentum LP: NFT нема серед owned.
 * Закриття: ClosePositionEvent або лише RemoveLiquidityEvent без окремого close у тому самому UX (агрегатори тощо).
 */
export async function getMomentumClosedPositions(
	walletAddress: string,
	preScanned?: MomentumClosedPreScan,
): Promise<ClosedPosition[]> {
	const scan =
		preScanned ??
		(await scanMomentumWalletAllPositionEvents(walletAddress))
	const { rawByPositionId, historyPartial: scanPartial } = scan
	const ownedIds = await listMomentumOwnedPositionIds(walletAddress)

	const pending: { pid: string; rows: MomentumWalletRawEvt[]; poolCacheKey: string }[] = []
	const uniqPoolKeys = new Set<string>()

	for (const [pid, rows] of rawByPositionId) {
		if (ownedIds.has(pid)) continue
		if (!hasMomentumCloseLikeSignal(rows)) continue
		const poolGuess = inferPoolIdMomentumRows(rows)
		if (!poolGuess) continue
		const pk = poolCacheKey(poolGuess)
		uniqPoolKeys.add(pk)
		pending.push({ pid, rows, poolCacheKey: pk })
	}

	const metas = await Promise.all([...uniqPoolKeys].map((k) => fetchMomentumPoolPairMeta(k)))
	const uniqMetaNorm = metas.filter((m): m is BluefinPoolPairMeta => m != null)
	const metaByLookup = new Map<string, BluefinPoolPairMeta>()
	for (const m of uniqMetaNorm) {
		metaByLookup.set(poolCacheKey(m.poolIdNorm), m)
	}

	const allCoinTypes = new Set<string>()
	const coinToSymbol = new Map<string, string>()
	for (const m of uniqMetaNorm) {
		allCoinTypes.add(m.coinTypeA)
		allCoinTypes.add(m.coinTypeB)
		coinToSymbol.set(m.coinTypeA, m.symbolA)
		coinToSymbol.set(m.coinTypeB, m.symbolB)
	}

	const spots =
		allCoinTypes.size > 0
			? await resolveSpots([...allCoinTypes], (ct) => coinToSymbol.get(ct) ?? ct)
			: new Map()

	const out: ClosedPosition[] = []

	for (const c of pending) {
		const meta = metaByLookup.get(c.poolCacheKey)
		if (!meta) continue

		const evs: PositionEvent[] = []
		for (const r of c.rows) {
			const pe = parseMomentumEventFromSui(
				r.event,
				r.digest,
				r.tsSec,
				c.pid,
				meta.decimalsA,
				meta.decimalsB,
			)
			if (pe) evs.push(pe)
		}
		const evMap = new Map<string, PositionEvent[]>()
		evMap.set(c.pid, evs)
		await hydrateMomentumRewardAmounts(evMap)
		evs.sort((a, b) => a.timestamp - b.timestamp)

		const openTs = evs.find((e) => e.type === 'open_position')?.timestamp
		const firstTs = evs.length ? evs[0]!.timestamp : 0
		const openedAt = openTs && openTs > 0 ? openTs : firstTs

		const closeTsList = evs.filter((e) => e.type === 'close_position').map((e) => e.timestamp)
		const closedAt =
			closeTsList.length > 0 ? Math.max(...closeTsList) : evs.length ? evs[evs.length - 1]!.timestamp : 0

		const daysOpen =
			openedAt > 0 && closedAt >= openedAt ? Math.max(0, (closedAt - openedAt) / 86400) : 0

		const feeFrac = meta.feeMillionths / 1_000_000
		const pair = `${meta.symbolA}/${meta.symbolB} · ${feeLabelFromMillionths(meta.feeMillionths)}`

		const pa = spots.get(meta.coinTypeA)?.price
		const pb = spots.get(meta.coinTypeB)?.price
		const currentPriceA_USD =
			pa != null && Number.isFinite(pa) && pa > 0 && pa <= 1e8 ? pa : 0
		const currentPriceB_USD =
			pb != null && Number.isFinite(pb) && pb > 0 && pb <= 1e8 ? pb : 0

		out.push({
			id: c.pid,
			protocol: 'momentum',
			pair,
			tokenA: meta.symbolA,
			tokenB: meta.symbolB,
			fee: feeFrac,
			depositedUSD: 0,
			closedValueUSD: 0,
			pnlUSD: 0,
			pnlPct: 0,
			totalFeesCollectedUSD: 0,
			estimatedIL_USD: 0,
			openedAt,
			closedAt,
			daysOpen,
			events: evs,
			partialHistory: scanPartial === true,
			poolId: meta.poolIdNorm,
			tokenAAddress: meta.coinTypeA,
			tokenBAddress: meta.coinTypeB,
			tokenADecimals: meta.decimalsA,
			tokenBDecimals: meta.decimalsB,
			tokenAIconUrl: meta.tokenAIconUrl,
			tokenBIconUrl: meta.tokenBIconUrl,
			currentPriceA_USD,
			currentPriceB_USD,
		})
	}

	out.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
	return out
}
