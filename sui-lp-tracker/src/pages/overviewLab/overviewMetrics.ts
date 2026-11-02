/**
 * Experimental Overview — pure aggregators.
 *
 * Metric map (source → formula → freshness → completeness):
 *
 * | Metric | Source | Formula | Freshness | Completeness |
 * |--------|--------|---------|-----------|--------------|
 * | Net Worth | `computeNetWorth` / store.netWorth | walletVisible + openLp + netLending | last loadAll | Partial* when LP Value incomplete |
 * | LP Value | netWorth.openLpUSD | Σ positionValue ?? liquidity (unclaimed in Value when complete) | loadAll LP | Partial via aggregateOpenMetrics.valueCoverage |
 * | Unclaimed | aggregateOpenMetrics | Σ complete unclaimed fee+reward | live positions | Partial; NOT added again to NW |
 * | Net Lending | merged Alpha+Navi+Current | Σ netValueUSD | loadAll lending | per-protocol errors → stale |
 * | Active LPs | isEmptyLpPosition | count !empty | openPositions | empty counted separately |
 * | In Range | classifyLpBand === in | "N of M active"; Near and Empty are separate | openPositions | empty excluded from the active denominator |
 * | Capital Allocation | netWorth parts | Wallet / LP / Lending (place of capital) | same as NW | % of known sum |
 * | Token Exposure | wallet + LP underlyings + lending supplies | Σ by symbol; debt separate | prices | Unknown bucket; no fake 100% |
 * | Fees Earned | lifetime earnings when history enriched | only if coverage complete enough | positionEvents | else unavailable |
 * | Value change | portfolio snapshots | latest − lookback totalUSD | IDB/server | incomplete snaps filtered |
 *
 * Near-edge threshold: within NEAR_EDGE_PCT of Lower or Upper vs current price
 * (bound/current − 1)×100 absolute ≤ threshold while in_range.
 */
import type {
	LendingSnapshot,
	NetWorthSnapshot,
	OpenPosition,
	TokenBalance,
} from '@/types'
import {
	aggregateOpenMetrics,
	coverageIsPartial,
	type AggregatedOpenMetrics,
	type MetricCoverage,
} from '@/utils/aggregateOpenMetrics'
import { isEmptyLpPosition } from '@/utils/lpLifecycle'
import { protocolExcludesUpperTick, protocolTickInRange } from '@/utils/clmmTickBounds'
import { isCurrentMultiplyVaultPosition } from '@/utils/currentMultiplyVault'
import { isCetusVaultPosition } from '@/utils/cetusVault'
import {
	isLpPositionHistoryEnriched,
	lpProtocolUsesOnChainHistory,
} from '@/utils/lpPositionHistoryUi'
import { finiteUsd } from '@/utils/finiteUsd'
import {
	liquidityUsdOrNull,
	positionValueUsdOrNull,
	unclaimedIncomeUsdOrNull,
} from '@/utils/positionDerivedMetrics'
import { clmmRangeFromOpenPosition, rangeEdgePctVsCurrent } from '@/utils/tickPriceRange'
import {
	isSoftEndpoint,
	snapshotCompleteness,
	type ValueChangeUnavailableReason,
} from '@/utils/snapshotCompleteness'

/** Distance to Lower/Upper ≤ this % of current price → Near Edge. */
export const NEAR_EDGE_PCT = 5

export type OverviewSourceHealth = {
	id: string
	label: string
	/** ok | stale | error | loading | empty */
	status: 'ok' | 'stale' | 'error' | 'loading' | 'empty'
	detail?: string
	/** When the HTTP/RPC response arrived (ms), if known. */
	receivedAtMs?: number | null
}

export type CapitalAllocation = {
	walletUSD: number
	lpUSD: number
	lendingUSD: number
	/** Sum of absolute known positive buckets (for %). */
	knownSumUSD: number
}

export type TokenExposureBucket = {
	symbol: string
	usd: number
	/** wallet | lp | lending — primary origin (informational). */
	origins: Array<'wallet' | 'lp' | 'lending'>
	/** Distinct coinTypes folded into this symbol bucket (informational). */
	coinTypes?: string[]
}

export type TokenExposure = {
	/** Positive asset exposure by symbol (SUI, USDC, …). */
	assets: TokenExposureBucket[]
	/** Debt face value (not mixed into asset donut). */
	debtUSD: number
	/** Known USD that could not be attributed to a named priced asset. */
	unknownUSD: number
	/** Holdings with positive amount but no usable USD price (not inventable). */
	unpricedHoldingCount: number
	/** One label per holding that incremented `unpricedHoldingCount`. */
	unpricedHoldings: string[]
	/** True when any unpriced or unattributed exposure exists. */
	incomplete: boolean
	/** Known asset sum (excludes debt & unknown). */
	knownAssetsUSD: number
}

export type CascadeBand =
	| 'in'
	| 'near'
	| 'above'
	| 'below'
	| 'mixed'
	| 'empty'
	| 'unknown'

/** Classify a single LP for filters / pills — shared with Range Status counters. */
export function classifyLpBand(p: OpenPosition): CascadeBand {
	// Vaults / Current Multiply are not CLMM ranges — exclude from In Range / Empty / OOR.
	if (isCetusVaultPosition(p) || isCurrentMultiplyVaultPosition(p)) return 'unknown'
	if (isEmptyLpPosition(p)) return 'empty'
	const edge = classifyPositionRangeEdge(p)
	if (edge.kind === 'near_edge') return 'near'
	if (edge.kind === 'in_range') return 'in'
	if (edge.kind === 'out_of_range') return edge.side === 'Above' ? 'above' : 'below'
	return 'unknown'
}

/**
 * Aggregate cascade / subset band.
 * Mixed when underlying active LPs disagree on Above/Below/In/Near (Empty ignored).
 */
export function classifyCascadeBand(members: OpenPosition[]): CascadeBand {
	const bands = members.map(classifyLpBand)
	const active = bands.filter((b) => b !== 'empty')
	if (active.length === 0) return members.length > 0 ? 'empty' : 'unknown'
	const unique = new Set(active)
	if (unique.size === 1) return active[0]!
	if (unique.has('unknown') && unique.size === 1) return 'unknown'
	const directional = [...unique].filter((b) => b !== 'unknown')
	if (directional.length <= 1) return directional[0] ?? 'unknown'
	if (directional.every((b) => b === 'in' || b === 'near')) {
		return directional.includes('near') ? 'near' : 'in'
	}
	return 'mixed'
}

export type LpRangeCounts = {
	active: number
	empty: number
	inRange: number
	/** Near Upper or Lower while still in band. */
	nearEdge: number
	/** Out of range · price above upper. */
	above: number
	/** Out of range · price below lower. */
	below: number
	outOfRange: number
	/** Active with unknown / missing range — not counted as OOR. */
	unknownRange: number
	/** Display: "11 of 14 active LPs". */
	inRangeLabel: string
}

export type FeesEarnedSummary = {
	available: boolean
	usd: number | null
	coverage: MetricCoverage
	periodLabel: string
	reasonUnavailable?: string
}

export type OverviewKpis = {
	netWorth: NetWorthSnapshot | null
	lpValueUSD: number | null
	lpValueCoverage: MetricCoverage
	unclaimedUSD: number | null
	unclaimedCoverage: MetricCoverage
	/** True when unclaimed is already inside LP Value for complete rows. */
	unclaimedIncludedInLpValue: boolean
	netLendingUSD: number | null
	range: LpRangeCounts
	capital: CapitalAllocation
	exposure: TokenExposure
	feesEarned: FeesEarnedSummary
	openMetrics: AggregatedOpenMetrics
}

const STABLE_SYMBOLS = new Set(['USDC', 'USDT', 'USDY', 'USDB', 'FDUSD', 'USDSUI', 'USD'])

function addExposure(
	map: Map<string, TokenExposureBucket>,
	symbol: string,
	usd: number,
	origin: 'wallet' | 'lp' | 'lending',
	coinType?: string,
) {
	if (!(usd > 0) || !Number.isFinite(usd)) return
	const key = symbol.trim().toUpperCase() || '?'
	const cur = map.get(key)
	if (cur) {
		cur.usd += usd
		if (!cur.origins.includes(origin)) cur.origins.push(origin)
		if (coinType && !(cur.coinTypes ?? []).includes(coinType)) {
			cur.coinTypes = [...(cur.coinTypes ?? []), coinType]
		}
	} else {
		map.set(key, {
			symbol: key,
			usd,
			origins: [origin],
			coinTypes: coinType ? [coinType] : undefined,
		})
	}
}

function positiveMultiplyQty(amount: number | null | undefined, amountRaw: string | null | undefined): boolean {
	if (amount != null && Number.isFinite(amount) && amount > 0) return true
	if (amountRaw == null || amountRaw === '' || amountRaw === '0') return false
	return /^\d+$/.test(amountRaw) && amountRaw !== '0'
}

/**
 * Token exposure from wallet balances + LP underlyings + lending supplies.
 * Does not invent LP-share tokens as assets. Debt is separate.
 * Unpriced holdings are counted (not coerced to $0).
 */
export function computeTokenExposure(input: {
	walletBalances: TokenBalance[]
	openPositions: OpenPosition[]
	lendingSnaps: Array<LendingSnapshot | null>
}): TokenExposure {
	const map = new Map<string, TokenExposureBucket>()
	let unknownUSD = 0
	let unpricedHoldingCount = 0
	const unpricedHoldings: string[] = []
	let debtUSD = 0
	const noteUnpriced = (label: string) => {
		unpricedHoldingCount += 1
		unpricedHoldings.push(label)
	}

	for (const t of input.walletBalances) {
		const v = finiteUsd(t.valueUSD)
		if (v <= 0) {
			if (t.humanBalance > 0 && !(Number.isFinite(t.priceUSD) && (t.priceUSD as number) > 0)) {
				noteUnpriced(`${t.symbol || 'token'} · wallet`)
			}
			continue
		}
		addExposure(map, t.symbol, v, 'wallet', t.coinType)
	}

	for (const p of input.openPositions) {
		if (isEmptyLpPosition(p)) continue

		// Current Multiply: collateral is long exposure; debt is liability (not a positive LP leg).
		// Equity already sits in openLpUSD / Net Worth — here we attribute collateral and add debtUSD.
		if (isCurrentMultiplyVaultPosition(p)) {
			const m = p.currentMultiply
			const collUsd = m?.collateral.valueUsd
			const debtUsd = m?.debt.valueUsd
			if (collUsd != null && collUsd > 0) {
				addExposure(map, m?.collateral.symbol ?? p.tokenA, collUsd, 'lp', p.tokenAAddress)
			} else if (positiveMultiplyQty(m?.collateral.amount, m?.collateral.amountRaw)) {
				noteUnpriced(`Multiplier ${p.pair} · ${m?.collateral.symbol ?? p.tokenA}`)
			}
			if (debtUsd != null && debtUsd > 0) debtUSD += debtUsd
			else if (positiveMultiplyQty(m?.debt.amount, m?.debt.amountRaw)) {
				noteUnpriced(`Multiplier ${p.pair} · ${m?.debt.symbol ?? p.tokenB}`)
			}
			continue
		}

		const aOk = Number.isFinite(p.tokenAAmount) && Number.isFinite(p.currentPriceA_USD)
		const bOk = Number.isFinite(p.tokenBAmount) && Number.isFinite(p.currentPriceB_USD)
		const aUsd = aOk ? Math.max(0, p.tokenAAmount) * Math.max(0, p.currentPriceA_USD) : null
		const bUsd = bOk ? Math.max(0, p.tokenBAmount) * Math.max(0, p.currentPriceB_USD) : null
		if (aUsd != null) addExposure(map, p.tokenA, aUsd, 'lp', p.tokenAAddress)
		else if (Number.isFinite(p.tokenAAmount) && p.tokenAAmount > 0) {
			noteUnpriced(`${p.pair} · ${p.tokenA}`)
		}
		if (bUsd != null) addExposure(map, p.tokenB, bUsd, 'lp', p.tokenBAddress)
		else if (Number.isFinite(p.tokenBAmount) && p.tokenBAmount > 0) {
			noteUnpriced(`${p.pair} · ${p.tokenB}`)
		}
		const liq = liquidityUsdOrNull(p)
		const knownLegs = (aUsd ?? 0) + (bUsd ?? 0)
		if (liq != null && liq > knownLegs + 0.5) {
			unknownUSD += liq - knownLegs
		} else if (liq == null && (aUsd == null || bUsd == null)) {
			const partial = (aUsd ?? 0) + (bUsd ?? 0)
			if (partial <= 0) {
				const fallback = positionValueUsdOrNull(p)
				if (fallback != null && fallback > 0) unknownUSD += fallback
			}
		}
	}

	for (const snap of input.lendingSnaps) {
		if (!snap) continue
		for (const s of snap.supplies) {
			const usd = finiteUsd(s.currentValueUSD)
			if (usd > 0) addExposure(map, s.asset, usd, 'lending')
			else if (s.currentAmount > 0) noteUnpriced(`${snap.protocol} · ${s.asset}`)
		}
		for (const b of snap.borrows) {
			debtUSD += finiteUsd(b.currentDebtUSD)
		}
	}

	const assets = [...map.values()].sort((a, b) => b.usd - a.usd)
	const knownAssetsUSD = assets.reduce((s, a) => s + a.usd, 0)
	const incomplete = unknownUSD > 0.5 || unpricedHoldingCount > 0
	return {
		assets,
		debtUSD,
		unknownUSD,
		unpricedHoldingCount,
		unpricedHoldings,
		incomplete,
		knownAssetsUSD,
	}
}

/** Lending borrows plus Multiplier vault debt. Both already sit inside exposure `debtUSD`. */
export function overviewDebtParts(
	lendingSnaps: Array<LendingSnapshot | null>,
	positions: readonly OpenPosition[],
): { lendingUSD: number; multiplyUSD: number } {
	let lendingUSD = 0
	for (const snap of lendingSnaps) {
		if (!snap) continue
		lendingUSD += finiteUsd(snap.totalBorrowedUSD)
	}
	let multiplyUSD = 0
	for (const position of positions) {
		if (!isCurrentMultiplyVaultPosition(position)) continue
		const value = position.currentMultiply?.debt.valueUsd
		if (value != null && Number.isFinite(value) && value > 0) multiplyUSD += value
	}
	return { lendingUSD, multiplyUSD }
}

/** Prefer SUI / USDC rows; fold the rest into Other. */
export function collapseExposureForChart(
	exposure: TokenExposure,
	topN = 2,
): {
	rows: Array<{ label: string; usd: number; parts?: Array<{ label: string; usd: number }> }>
	unknownUSD: number
	debtUSD: number
	unpricedHoldingCount: number
	unpricedHoldings: string[]
	incomplete: boolean
} {
	const preferred = ['SUI', 'USDC']
	const rows: Array<{ label: string; usd: number; parts?: Array<{ label: string; usd: number }> }> = []
	const otherParts: Array<{ label: string; usd: number }> = []
	const used = new Set<string>()
	for (const sym of preferred) {
		const hit = exposure.assets.find((a) => a.symbol === sym)
		if (hit && hit.usd > 0) {
			rows.push({ label: sym, usd: hit.usd })
			used.add(sym)
		}
	}
	for (const a of exposure.assets) {
		if (used.has(a.symbol)) continue
		if (rows.length < topN + 1 && STABLE_SYMBOLS.has(a.symbol) && a.symbol !== 'USDC') {
			otherParts.push({ label: a.symbol, usd: a.usd })
			continue
		}
		if (rows.length < topN) {
			rows.push({ label: a.symbol, usd: a.usd })
			used.add(a.symbol)
		} else {
			otherParts.push({ label: a.symbol, usd: a.usd })
		}
	}
	if (otherParts.length > 0) {
		otherParts.sort((a, b) => b.usd - a.usd)
		rows.push({
			label: 'Other',
			usd: otherParts.reduce((sum, part) => sum + part.usd, 0),
			parts: otherParts,
		})
	}
	return {
		rows,
		unknownUSD: exposure.unknownUSD,
		debtUSD: exposure.debtUSD,
		unpricedHoldingCount: exposure.unpricedHoldingCount,
		unpricedHoldings: exposure.unpricedHoldings,
		incomplete: exposure.incomplete,
	}
}

export function computeCapitalAllocation(nw: NetWorthSnapshot | null): CapitalAllocation {
	if (!nw) return { walletUSD: 0, lpUSD: 0, lendingUSD: 0, knownSumUSD: 0 }
	const walletUSD = finiteUsd(nw.walletAssetsUSD)
	const lpUSD = finiteUsd(nw.openLpUSD)
	const lendingUSD = finiteUsd(nw.netLendingUSD)
	const knownSumUSD = Math.max(0, walletUSD) + Math.max(0, lpUSD) + Math.max(0, lendingUSD)
	return { walletUSD, lpUSD, lendingUSD, knownSumUSD }
}

/** LP value by protocol (active positions only) — OrNull sums; partial when any member incomplete. */
export function computeProtocolAllocation(
	positions: OpenPosition[],
): Array<{
	protocol: string
	usd: number | null
	count: number
	partial: boolean
	covered: number
	eligible: number
}> {
	const map = new Map<
		string,
		{ usd: number; count: number; covered: number; eligible: number; anyNull: boolean }
	>()
	for (const p of positions) {
		if (isEmptyLpPosition(p)) continue
		const key = p.protocol || 'unknown'
		const cur = map.get(key) ?? {
			usd: 0,
			count: 0,
			covered: 0,
			eligible: 0,
			anyNull: false,
		}
		cur.count += 1
		cur.eligible += 1
		const val = positionValueUsdOrNull(p) ?? liquidityUsdOrNull(p)
		if (val == null) cur.anyNull = true
		else {
			cur.usd += Math.max(0, val)
			cur.covered += 1
		}
		map.set(key, cur)
	}
	return [...map.entries()]
		.map(([protocol, v]) => ({
			protocol,
			usd: v.covered === 0 && v.anyNull ? null : v.usd,
			count: v.count,
			partial: v.anyNull || v.covered < v.eligible,
			covered: v.covered,
			eligible: v.eligible,
		}))
		.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))
}

export function countNearEdge(positions: OpenPosition[]): number {
	let n = 0
	for (const p of positions) {
		if (classifyPositionRangeEdge(p).kind === 'near_edge') n += 1
	}
	return n
}

/** Share label for capital strip — tiny non-zero buckets show “<1%”, never “0%”. */
export function formatSharePct(usd: number, sum: number): string {
	if (!(sum > 0) || !(usd > 0)) return '0%'
	const pct = (usd / sum) * 100
	if (pct > 0 && pct < 1) return '<1%'
	return `${Math.round(pct)}%`
}

export type HistorySpanInfo = {
	pointCount: number
	spanMs: number
	/** True when observed span is much shorter than the selected range window. */
	limited: boolean
	spanLabel: string
}

export function describeHistorySpan(
	snapshots: Array<{ ts: number; incomplete?: boolean }>,
	rangeId: '24h' | '7d' | '30d' | 'all',
): HistorySpanInfo {
	/** Chartable = verified + legacy; incomplete excluded (same as Analytics). */
	const complete = snapshots.filter((s) => s.incomplete !== true)
	if (complete.length === 0) {
		return { pointCount: 0, spanMs: 0, limited: true, spanLabel: 'No history' }
	}
	const times = complete.map((s) => s.ts)
	const min = Math.min(...times)
	const max = Math.max(...times)
	const spanMs = Math.max(0, max - min)
	const want =
		rangeId === '24h'
			? 24 * 3_600_000
			: rangeId === '7d'
				? 7 * 86_400_000
				: rangeId === '30d'
					? 30 * 86_400_000
					: 0
	const limited = complete.length < 3 || (want > 0 && spanMs < want * 0.35)
	const hours = spanMs / 3_600_000
	const spanLabel =
		complete.length <= 1
			? '1 point'
			: hours < 2
				? `${Math.max(1, Math.round(spanMs / 60_000))}m span · ${complete.length} pts`
				: hours < 48
					? `${hours.toFixed(1)}h span · ${complete.length} pts`
					: `${(hours / 24).toFixed(1)}d span · ${complete.length} pts`
	return { pointCount: complete.length, spanMs, limited, spanLabel }
}

export function computeLpRangeCounts(positions: OpenPosition[]): LpRangeCounts {
	let active = 0
	let empty = 0
	/** Pure in-range (excludes Near Edge — Near is a subset shown separately). */
	let inRange = 0
	let nearEdge = 0
	let above = 0
	let below = 0
	let unknownRange = 0
	for (const p of positions) {
		// UI classifies vaults under Vaults tab — do not fold them into CLMM range KPIs.
		if (isCetusVaultPosition(p) || isCurrentMultiplyVaultPosition(p)) continue
		const band = classifyLpBand(p)
		if (band === 'empty') {
			empty += 1
			continue
		}
		active += 1
		if (band === 'near') nearEdge += 1
		else if (band === 'in') inRange += 1
		else if (band === 'above') above += 1
		else if (band === 'below') below += 1
		else unknownRange += 1
	}
	const outOfRange = above + below
	const nearPart = nearEdge > 0 ? ` · ${nearEdge} near` : ''
	const emptyPart = empty > 0 ? ` · ${empty} empty` : ''
	return {
		active,
		empty,
		inRange,
		nearEdge,
		above,
		below,
		outOfRange,
		unknownRange,
		inRangeLabel:
			active > 0
				? `${inRange} of ${active} active LPs in range${nearPart}${emptyPart}`
				: empty > 0
					? `No active LPs${emptyPart}`
					: 'No active LPs',
	}
}

export type NearEdgeResult =
	| {
			kind: 'near_edge'
			bound: 'Upper' | 'Lower'
			/** Absolute % distance of current price to the bound (bound/current − 1)×100. */
			distancePct: number
			priceLabel: string
			current: number
			boundPrice: number
	  }
	| {
			kind: 'out_of_range'
			side: 'Above' | 'Below'
			distancePct: number
			priceLabel: string
			current: number
			boundPrice: number
	  }
	| { kind: 'in_range' }
	| { kind: 'empty' }
	| { kind: 'unknown' }

/**
 * Range proximity for Attention.
 * Units: percent of current price to the named bound (`(bound/current − 1)×100`).
 */
export function classifyPositionRangeEdge(p: OpenPosition): NearEdgeResult {
	if (isCetusVaultPosition(p) || isCurrentMultiplyVaultPosition(p)) return { kind: 'unknown' }
	if (isEmptyLpPosition(p)) return { kind: 'empty' }
	const range = clmmRangeFromOpenPosition(p)
	if (!range) return { kind: 'unknown' }
	const { pctMinVsCurrent, pctMaxVsCurrent } = rangeEdgePctVsCurrent(range)
	const ticksKnown = [p.tickLower, p.tickUpper, p.currentTick].every((n) => Number.isFinite(n))
	const tickInside =
		ticksKnown &&
		p.priceRangeOverride == null &&
		protocolTickInRange(p.protocol, p.currentTick, p.tickLower, p.tickUpper)
	if (ticksKnown && p.priceRangeOverride == null && !tickInside) {
		const upper = Math.max(p.tickLower, p.tickUpper)
		const above = protocolExcludesUpperTick(p.protocol)
			? p.currentTick >= upper
			: p.currentTick > upper
		const side: 'Above' | 'Below' = above ? 'Above' : 'Below'
		const boundPrice = above ? range.priceMax : range.priceMin
		const distancePct = above ? Math.abs(pctMaxVsCurrent) : Math.abs(pctMinVsCurrent)
		return {
			kind: 'out_of_range',
			side,
			distancePct,
			priceLabel: range.priceLabel,
			current: range.priceCurrent,
			boundPrice,
		}
	}
	const priceOutside = !range.inRange || p.status === 'out_of_range'
	if (!tickInside && priceOutside) {
		const above = range.priceCurrent > range.priceMax
		const side: 'Above' | 'Below' = above ? 'Above' : 'Below'
		const boundPrice = above ? range.priceMax : range.priceMin
		const distancePct = above
			? Math.abs(pctMaxVsCurrent)
			: Math.abs(pctMinVsCurrent)
		return {
			kind: 'out_of_range',
			side,
			distancePct,
			priceLabel: range.priceLabel,
			current: range.priceCurrent,
			boundPrice,
		}
	}

	const distLower = Math.abs(pctMinVsCurrent)
	const distUpper = Math.abs(pctMaxVsCurrent)
	const rangeWidthPct = Math.abs(pctMaxVsCurrent - pctMinVsCurrent)
	// A band narrower than the near threshold is entirely "near" under a spot-% rule,
	// so a tick that is inside it still counts as in range.
	if (
		rangeWidthPct > NEAR_EDGE_PCT * 2 &&
		(distLower <= NEAR_EDGE_PCT || distUpper <= NEAR_EDGE_PCT)
	) {
		const towardUpper = distUpper <= distLower
		return {
			kind: 'near_edge',
			bound: towardUpper ? 'Upper' : 'Lower',
			distancePct: towardUpper ? distUpper : distLower,
			priceLabel: range.priceLabel,
			current: range.priceCurrent,
			boundPrice: towardUpper ? range.priceMax : range.priceMin,
		}
	}
	return { kind: 'in_range' }
}

export function computeFeesEarned(
	positions: OpenPosition[],
	positionEvents?: Parameters<typeof isLpPositionHistoryEnriched>[1],
): FeesEarnedSummary {
	const periodLabel = 'Lifetime (claimed + unclaimed)'
	const eligible = positions.filter((p) => lpProtocolUsesOnChainHistory(p.protocol))
	if (eligible.length === 0) {
		return {
			available: false,
			usd: null,
			coverage: { covered: 0, eligible: 0 },
			periodLabel,
			reasonUnavailable: 'No positions with on-chain fee history.',
		}
	}
	const coverage: MetricCoverage = { covered: 0, eligible: eligible.length }
	let sum = 0
	for (const p of eligible) {
		const historyOk = positionEvents
			? isLpPositionHistoryEnriched(p, positionEvents)
			: Boolean(Number.isFinite(p.lifetimeEarningsUSD))
		if (!historyOk) continue
		const u = unclaimedIncomeUsdOrNull(p)
		const claimed = Number.isFinite(p.lifetimeEarningsUSD) ? Math.max(0, p.lifetimeEarningsUSD) : null
		if (claimed == null || u == null) continue
		sum += claimed + u
		coverage.covered += 1
	}
	if (coverage.covered === 0) {
		return {
			available: false,
			usd: null,
			coverage,
			periodLabel,
			reasonUnavailable: 'Fee history not ready — collect/claim timeline unknown.',
		}
	}
	// Require full coverage before labeling as Fees Earned (not balance delta).
	if (coverageIsPartial(coverage)) {
		return {
			available: false,
			usd: sum,
			coverage,
			periodLabel,
			reasonUnavailable: `Partial history (${coverage.covered}/${coverage.eligible}) — not shown as Fees Earned.`,
		}
	}
	return { available: true, usd: sum, coverage, periodLabel }
}

export function buildOverviewKpis(input: {
	netWorth: NetWorthSnapshot | null
	openPositions: OpenPosition[]
	walletBalances: TokenBalance[]
	lendingSnaps: Array<LendingSnapshot | null>
	positionEvents?: Parameters<typeof isLpPositionHistoryEnriched>[1]
}): OverviewKpis {
	const openMetrics = aggregateOpenMetrics(
		input.openPositions.filter((p) => !isCetusVaultPosition(p)),
		input.positionEvents,
	)
	const capital = computeCapitalAllocation(input.netWorth)
	const exposure = computeTokenExposure({
		walletBalances: input.walletBalances,
		openPositions: input.openPositions,
		lendingSnaps: input.lendingSnaps,
	})
	const range = computeLpRangeCounts(input.openPositions)
	const feesEarned = computeFeesEarned(input.openPositions, input.positionEvents)

	return {
		netWorth: input.netWorth,
		lpValueUSD: input.netWorth ? finiteUsd(input.netWorth.openLpUSD) : openMetrics.totalValueUsd,
		lpValueCoverage: openMetrics.valueCoverage,
		unclaimedUSD: openMetrics.totalUnclaimedUsd,
		unclaimedCoverage: openMetrics.unclaimedCoverage,
		unclaimedIncludedInLpValue: true,
		netLendingUSD: input.netWorth ? finiteUsd(input.netWorth.netLendingUSD) : null,
		range,
		capital,
		exposure,
		feesEarned,
		openMetrics,
	}
}

/**
 * Snapshot cadence ≈ 15 min. Tolerances for finding a reference near the target:
 * 24h → ±90 min; 7d → ±6 h; 30d → ±24 h.
 * Wider misses → unavailable (do not invent a “24h change”).
 */
export function valueChangeToleranceMs(agoMs: number): number {
	if (agoMs <= 86_400_000) return 90 * 60_000
	if (agoMs <= 7 * 86_400_000) return 6 * 3_600_000
	return 24 * 3_600_000
}

export type ValueChangeResult = {
	abs: number
	pct: number
	fromTs: number
	toTs: number
	/** Actual span used (may be shorter than requested for `all`). */
	spanMs: number
	/** True when observed span is much shorter than the selected window. */
	limited: boolean
	/**
	 * True when either endpoint is legacy (`incomplete` unset).
	 * Value is shown but must not be presented as fully verified.
	 */
	unverified: boolean
}

export type ValueChangeAnalysis =
	| { ok: true; change: ValueChangeResult }
	| { ok: false; reason: ValueChangeUnavailableReason }

/** Value change across snapshots — never labeled Return / profit. */
export function computeValueChange(
	snapshots: Array<{ ts: number; totalUSD: number; incomplete?: boolean }>,
	agoMs: number,
	nowMs = Date.now(),
): ValueChangeResult | null {
	const analysis = analyzeValueChange(snapshots, agoMs, nowMs)
	return analysis.ok ? analysis.change : null
}

/** Same math as {@link computeValueChange}, with an explicit unavailable reason. */
export function analyzeValueChange(
	snapshots: Array<{ ts: number; totalUSD: number; incomplete?: boolean }>,
	agoMs: number,
	nowMs = Date.now(),
): ValueChangeAnalysis {
	const soft = snapshots
		.filter((s) => isSoftEndpoint(s))
		.slice()
		.sort((a, b) => a.ts - b.ts)
	if (soft.length === 0) return { ok: false, reason: 'no_data' }
	if (soft.length < 2) return { ok: false, reason: 'insufficient_history' }

	const latest = soft[soft.length - 1]!
	const latestLegacy = snapshotCompleteness(latest) === 'legacy'

	/** `agoMs <= 0` → All: first soft → latest. */
	if (!(agoMs > 0)) {
		const first = soft[0]!
		if (!(first.totalUSD > 0) || first.ts >= latest.ts) {
			return { ok: false, reason: 'insufficient_history' }
		}
		const abs = latest.totalUSD - first.totalUSD
		const pct = (abs / first.totalUSD) * 100
		return {
			ok: true,
			change: {
				abs,
				pct,
				fromTs: first.ts,
				toTs: latest.ts,
				spanMs: latest.ts - first.ts,
				limited: false,
				unverified: latestLegacy || snapshotCompleteness(first) === 'legacy',
			},
		}
	}

	const target = nowMs - agoMs
	const window = valueChangeToleranceMs(agoMs)
	let ref: (typeof soft)[number] | null = null
	for (const s of soft) {
		const delta = Math.abs(s.ts - target)
		if (delta > window) continue
		if (!ref || Math.abs(s.ts - target) < Math.abs(ref.ts - target)) ref = s
		else if (Math.abs(s.ts - target) === Math.abs(ref.ts - target) && s.ts > ref.ts) ref = s
	}
	if (!ref) {
		// Soft points exist but none near the target window.
		const oldest = soft[0]!.ts
		if (nowMs - oldest < agoMs * 0.5) return { ok: false, reason: 'insufficient_history' }
		return { ok: false, reason: 'missing_reference' }
	}
	if (!(ref.totalUSD > 0) || ref.ts >= latest.ts) {
		return { ok: false, reason: 'stale_endpoint' }
	}
	const abs = latest.totalUSD - ref.totalUSD
	const pct = (abs / ref.totalUSD) * 100
	const spanMs = latest.ts - ref.ts
	const limited = spanMs < agoMs * 0.5
	return {
		ok: true,
		change: {
			abs,
			pct,
			fromTs: ref.ts,
			toTs: latest.ts,
			spanMs,
			limited,
			unverified: latestLegacy || snapshotCompleteness(ref) === 'legacy',
		},
	}
}

/** Prefer range id over raw ms so `all` is not coerced to 30d. */
export function computeValueChangeForRange(
	snapshots: Array<{ ts: number; totalUSD: number; incomplete?: boolean }>,
	rangeId: '24h' | '7d' | '30d' | 'all',
	nowMs = Date.now(),
): ValueChangeResult | null {
	const analysis = analyzeValueChangeForRange(snapshots, rangeId, nowMs)
	return analysis.ok ? analysis.change : null
}

export function analyzeValueChangeForRange(
	snapshots: Array<{ ts: number; totalUSD: number; incomplete?: boolean }>,
	rangeId: '24h' | '7d' | '30d' | 'all',
	nowMs = Date.now(),
): ValueChangeAnalysis {
	const ago =
		rangeId === '24h'
			? 86_400_000
			: rangeId === '7d'
				? 7 * 86_400_000
				: rangeId === '30d'
					? 30 * 86_400_000
					: 0
	return analyzeValueChange(snapshots, ago, nowMs)
}

export type { ValueChangeUnavailableReason } from '@/utils/snapshotCompleteness'
