/**
 * Read-only advisor bot portfolio facts for local Vite GET /api/advisor/state.
 * Never signs txs; never touches wallet keys; never logs secrets.
 */
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { getCurrentPositions, EMPTY_CURRENT_SNAP } from '@/services/currentService'
import { loadAllPortfolioLpSources } from '@/services/portfolioLpSources'
import { getUsdPerTokenAtTimestamp } from '@/services/priceService'
import { coingeckoIdForSymbol, coingeckoSimpleBatch } from '@/services/spotPrice/coingecko24hBatch'
import { clmmRangeFromOpenPosition } from '@/utils/tickPriceRange'
import { NATIVE_SUI_COIN_TYPE, normalizeCoinTypeForMatch } from '@/utils/suiCoinType'
import { mapPool } from '@/utils/concurrency'
import type { BorrowPosition, LendingSnapshot, OpenPosition, SupplyPosition } from '@/types'
import {
	getPortfolioReadRpcSource,
	getPortfolioReadRpcSourceReason,
	resetPortfolioReadRpcSource,
} from '@/services/portfolioReadRpcSource'
import { getLastPublicNodeGrpcFailureReason } from '@/services/grpcEndpointHealth'
import { ensurePortfolioReadTransportReady } from '@/services/portfolioSuiReadClient'
import { inferPortfolioLpSourceId } from '@/utils/portfolioPositionKeys'
import {
	resolveAdvisorStateDeadlineMs,
	splitVerifiedUnverifiedUsd,
} from '@/utils/advisorStalePolicy'
import {
	getAdvisorCacheSavedAtMs,
	getCachedAdvisorCurrent,
	getCachedAdvisorLpPositions,
	recordAdvisorSnapshotSuccess,
} from '@/services/server/advisorSnapshotCache'
import {
	getAdvisorCurrentCashflowCache,
	isAdvisorCurrentCashflowCacheFresh,
	recordAdvisorCurrentCashflowCache,
	type AdvisorCurrentCashflowPayload,
} from '@/services/server/advisorCurrentCashflowCache'
import {
	isSuiReadProfilingEnabled,
	logSuiReadProfile,
	resetSuiReadProfile,
	type SuiReadProfileSnapshot,
} from '@/services/suiReadProfiler'
import { ADVISOR_DEFAULT_WALLET } from '@/services/server/advisorAllowedWallets'
import { splitOpenLpActiveEmpty } from '@/utils/openLpActiveEmpty'

function delay(ms: number): Promise<{ kind: 'timeout' }> {
	return new Promise((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), ms))
}

/** Normalized wallet key used in advisor state / cache (tests). */
export const ADVISOR_STATE_WALLET = normalizeSuiAddress(ADVISOR_DEFAULT_WALLET).toLowerCase()

/** DeepBook DEEP mainnet coin type (see `hardcodedVerifiedCoins` / tokenDecimalsAudit). */
const DEEP_COIN_TYPE =
	'0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP'

/** Concurrency limit for parallel LP position mapping (balance heavy network load). */
const LP_MAP_CONCURRENCY = 5

function advisorDevTimingEnabled(): boolean {
	return process.env.VITEST !== 'true' && process.env.SUI_LP_ADVISOR_DEV_TIMING === '1'
}

async function advisorTimed<T>(label: string, fn: () => Promise<T>): Promise<T> {
	if (!advisorDevTimingEnabled()) return fn()
	const t0 = performance.now()
	try {
		return await fn()
	} finally {
		console.log(`[advisor-state] ${label}: ${(performance.now() - t0).toFixed(0)}ms`)
	}
}

export type AdvisorMarketSupply = {
	asset: string
	coinType: string
	currentAmount: number
	currentValueUSD: number
	supplyAPR: number
	supplyRewardAPR?: number
}

export type AdvisorMarketBorrow = {
	asset: string
	coinType: string
	currentDebt: number
	currentDebtUSD: number
	borrowAPR: number
	borrowRewardAPR?: number
	healthFactor?: number
}

export type AdvisorMarketVenue = {
	supplies: AdvisorMarketSupply[]
	borrows: AdvisorMarketBorrow[]
}

export type AdvisorLpPosition = {
	protocol: string
	poolId: string
	pair: string
	rangeLower: number
	rangeUpper: number
	inRange: boolean
	tokenAAmount: number
	tokenBAmount: number
	tokenA: string
	tokenB: string
	currentValueUSD: number
	/** Last good row after partial RPC failure for this source. */
	readStale?: boolean
	lastSuccessAtMs?: number
}

export type AdvisorNetTotals = {
	verifiedUSD: number
	unverifiedUSD: number
}

export type AdvisorState = {
	timestamp: string
	wallet: string
	/** Transport that served on-chain reads for this response. */
	rpcSource: import('@/services/portfolioReadRpcSource').PortfolioReadRpcSource
	/** Set when rpcSource is jsonrpc after gRPC failure (e.g. timeout:6000ms). */
	rpcSourceReason?: string | null
	current: {
		healthFactor: number | null
		usdcDebt: number
		liquidationPrice: number | null
		markets: Record<string, AdvisorMarketVenue>
		totalSuppliedUSD: number
		totalBorrowedUSD: number
		netValueUSD: number
		readStale?: boolean
		lastSuccessAtMs?: number
		/** When false, HF / liquidation price are STALE (no P0 from cache). */
		metricsLive?: boolean
	}
	lpPositions: AdvisorLpPosition[]
	/** Zero-liquidity NFT positions (excluded from `net`). */
	lpEmpty: AdvisorLpPosition[]
	net: AdvisorNetTotals
	prices: { SUI: number | null; DEEP: number | null }
	/** Present when SUI_LP_ADVISOR_PROFILE=1 */
	readProfile?: SuiReadProfileSnapshot
	errors?: string[]
}

function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e)
}

function advisorCacheSavedAtOrUndefined(wallet: string): number | undefined {
	const t = getAdvisorCacheSavedAtMs(wallet)
	return t != null ? t : undefined
}

function isSuiAsset(s: SupplyPosition): boolean {
	if (s.asset.toUpperCase() === 'SUI') return true
	try {
		return normalizeCoinTypeForMatch(s.coinType) === NATIVE_SUI_COIN_TYPE
	} catch {
		return false
	}
}

function isUsdcBorrow(b: BorrowPosition): boolean {
	return b.asset.toUpperCase() === 'USDC' || /::usdc::/i.test(b.coinType)
}

function mapSupply(s: SupplyPosition): AdvisorMarketSupply {
	const row: AdvisorMarketSupply = {
		asset: s.asset,
		coinType: s.coinType,
		currentAmount: s.currentAmount,
		currentValueUSD: s.currentValueUSD,
		supplyAPR: s.supplyAPR,
	}
	if (s.supplyRewardAPR != null) row.supplyRewardAPR = s.supplyRewardAPR
	return row
}

function mapBorrow(b: BorrowPosition): AdvisorMarketBorrow {
	const row: AdvisorMarketBorrow = {
		asset: b.asset,
		coinType: b.coinType,
		currentDebt: b.currentDebt,
		currentDebtUSD: b.currentDebtUSD,
		borrowAPR: b.borrowAPR,
	}
	if (b.borrowRewardAPR != null) row.borrowRewardAPR = b.borrowRewardAPR
	if (Number.isFinite(b.healthFactor)) row.healthFactor = b.healthFactor
	return row
}

function groupMarkets(snap: LendingSnapshot): Record<string, AdvisorMarketVenue> {
	const markets: Record<string, AdvisorMarketVenue> = {}
	const venueOf = (v: string | undefined) => (v && v.trim() ? v.trim() : 'Unknown')
	for (const s of snap.supplies) {
		const key = venueOf(s.venue)
		if (!markets[key]) markets[key] = { supplies: [], borrows: [] }
		markets[key].supplies.push(mapSupply(s))
	}
	for (const b of snap.borrows) {
		const key = venueOf(b.venue)
		if (!markets[key]) markets[key] = { supplies: [], borrows: [] }
		markets[key].borrows.push(mapBorrow(b))
	}
	return markets
}

function usdcDebtFrom(snap: LendingSnapshot): number {
	const usdc = snap.borrows.filter(isUsdcBorrow)
	const rows = usdc.length > 0 ? usdc : snap.borrows
	return rows.reduce((sum, b) => sum + (Number.isFinite(b.currentDebtUSD) ? b.currentDebtUSD : 0), 0)
}

function suiLiquidationPrice(snap: LendingSnapshot): number | null {
	const prices = snap.supplies
		.filter(isSuiAsset)
		.map((s) => s.liquidationPriceUSD)
		.filter((p): p is number => p != null && Number.isFinite(p) && p > 0)
	if (prices.length === 0) return null
	return Math.min(...prices)
}

function mapLpPosition(
	p: OpenPosition,
	staleSourceIds: ReadonlySet<string>,
	wallet: string,
): AdvisorLpPosition {
	const sourceId = inferPortfolioLpSourceId(p)
	const readStale =
		p.readStale === true ||
		p.currentMultiply?.readStale === true ||
		(sourceId != null && staleSourceIds.has(sourceId))
	const resolvedLastSuccessAtMs = readStale
		? p.lastSuccessAtMs ?? advisorCacheSavedAtOrUndefined(wallet)
		: undefined
	const range = clmmRangeFromOpenPosition({
		tickLower: p.tickLower,
		tickUpper: p.tickUpper,
		currentTick: p.currentTick,
		currentSqrtPrice: p.currentSqrtPrice,
		tokenA: p.tokenA,
		tokenB: p.tokenB,
		tokenADecimals: p.tokenADecimals,
		tokenBDecimals: p.tokenBDecimals,
		status: p.status,
		priceCurrentOverride: p.priceCurrentOverride,
		priceRangeOverride: p.priceRangeOverride,
	})
	return {
		protocol: p.protocol,
		poolId: p.poolId,
		pair: p.pair,
		rangeLower: range ? range.priceMin : p.tickLower,
		rangeUpper: range ? range.priceMax : p.tickUpper,
		inRange: p.status === 'in_range',
		tokenAAmount: p.tokenAAmount,
		tokenBAmount: p.tokenBAmount,
		tokenA: p.tokenA,
		tokenB: p.tokenB,
		currentValueUSD: p.currentValueUSD,
		...(readStale
			? {
					readStale: true,
					...(resolvedLastSuccessAtMs != null ? { lastSuccessAtMs: resolvedLastSuccessAtMs } : {}),
				}
			: {}),
	}
}

function stampOpenPositionsStale(positions: OpenPosition[], savedAtMs?: number): OpenPosition[] {
	return positions.map((p) => ({
		...p,
		readStale: true,
		...(p.lastSuccessAtMs != null || savedAtMs != null
			? { lastSuccessAtMs: p.lastSuccessAtMs ?? savedAtMs }
			: {}),
		currentMultiply: p.currentMultiply
			? { ...p.currentMultiply, readStale: true }
			: p.currentMultiply,
	}))
}

function attachCurrentMetricsMeta(
	snap: LendingSnapshot,
	stale: boolean,
	lastSuccessAtMs: number | undefined,
	wallet: string,
): LendingSnapshot {
	if (!stale) {
		return { ...snap, metricsLive: true, readStale: false }
	}
	const at = lastSuccessAtMs ?? advisorCacheSavedAtOrUndefined(wallet)
	return {
		...snap,
		readStale: true,
		metricsLive: false,
		...(at != null ? { lastSuccessAtMs: at } : {}),
	}
}

function computeAdvisorNetTotals(
	lpPositions: AdvisorLpPosition[],
	currentSnap: LendingSnapshot,
	nowMs: number,
): AdvisorNetTotals {
	const lpSplit = splitVerifiedUnverifiedUsd(
		lpPositions.map((p) => ({
			usd: p.currentValueUSD,
			readStale: p.readStale,
			lastSuccessAtMs: p.lastSuccessAtMs,
		})),
		nowMs,
	)
	const currentSplit = splitVerifiedUnverifiedUsd(
		[
			{
				usd: currentSnap.netValueUSD,
				readStale: currentSnap.readStale,
				lastSuccessAtMs: currentSnap.lastSuccessAtMs,
			},
		],
		nowMs,
	)
	return {
		verifiedUSD: lpSplit.verifiedUSD + currentSplit.verifiedUSD,
		unverifiedUSD: lpSplit.unverifiedUSD + currentSplit.unverifiedUSD,
	}
}

function collectLpStaleSourceIds(
	errors: string[],
	positions: OpenPosition[],
): Set<string> {
	const stale = new Set<string>()
	for (const e of errors) {
		const m = /^lp:([^:]+):/.exec(e)
		if (m) stale.add(m[1]!)
	}
	for (const p of positions) {
		if (p.readStale || p.currentMultiply?.readStale) {
			const id = inferPortfolioLpSourceId(p)
			if (id) stale.add(id)
		}
	}
	return stale
}

function appendStaleCachedErrors(
	errors: string[],
	positions: OpenPosition[],
): void {
	for (const p of positions) {
		if (!p.readStale && !p.currentMultiply?.readStale) continue
		const id = inferPortfolioLpSourceId(p)
		if (!id) continue
		const tag = `lp:${id}:`
		if (!errors.some((e) => e.startsWith(tag))) {
			errors.push(`${tag} stale cached read`)
		}
	}
}

async function softUsdPriceCgFallback(symbol: 'SUI' | 'DEEP'): Promise<number | null> {
	const id = coingeckoIdForSymbol(symbol)
	if (!id) return null
	const batch = await coingeckoSimpleBatch([id])
	const usd = batch[id]?.usd
	return usd != null && Number.isFinite(usd) && usd > 0 ? usd : null
}

async function softUsdPrice(
	symbol: 'SUI' | 'DEEP',
	coinType: string,
	timestampSec: number,
	errors: string[],
): Promise<number | null> {
	try {
		const q = await getUsdPerTokenAtTimestamp(symbol, coinType, timestampSec)
		const px = q.usdPerToken
		if (px != null && Number.isFinite(px) && px > 0) return px
	} catch {
		/* fall through to CoinGecko spot */
	}
	try {
		const cg = await softUsdPriceCgFallback(symbol)
		if (cg != null) return cg
	} catch (e) {
		errors.push(`price:${symbol}: ${errMsg(e)}`)
		return null
	}
	errors.push(`price:${symbol}: unavailable`)
	return null
}

export async function buildAdvisorState(options?: { wallet?: string }): Promise<AdvisorState> {
	return advisorTimed('total', async () => {
	resetPortfolioReadRpcSource()
	if (isSuiReadProfilingEnabled()) resetSuiReadProfile()
	await ensurePortfolioReadTransportReady()
	const wallet = normalizeSuiAddress(options?.wallet ?? ADVISOR_DEFAULT_WALLET).toLowerCase()
	const errors: string[] = []
	const nowMs = Date.now()
	const nowSec = Math.floor(nowMs / 1000)
	const deadlineMs = resolveAdvisorStateDeadlineMs()
	const deadlineAt = nowMs + deadlineMs

	const pricesPromise = Promise.all([
		softUsdPrice('SUI', NATIVE_SUI_COIN_TYPE, nowSec, errors),
		softUsdPrice('DEEP', DEEP_COIN_TYPE, nowSec, errors),
	])

	const loadWork = Promise.allSettled([
		advisorTimed('current', () => getCurrentPositions(wallet, { skipCashflow: true })),
		advisorTimed('lp-load', () => loadAllPortfolioLpSources(wallet)),
	])

	const raced = await Promise.race([loadWork.then((r) => ({ kind: 'done' as const, r })), delay(deadlineMs)])

	let currentSnap: LendingSnapshot = EMPTY_CURRENT_SNAP
	let openLpRows: OpenPosition[] = []
	let currentLive = false
	let lpLive = false

	if (raced.kind === 'timeout') {
		errors.push(`advisor: deadline ${deadlineMs}ms exceeded`)
		const cacheAt = advisorCacheSavedAtOrUndefined(wallet)
		openLpRows = stampOpenPositionsStale(getCachedAdvisorLpPositions(wallet), cacheAt)
		currentSnap = attachCurrentMetricsMeta(getCachedAdvisorCurrent(wallet), true, cacheAt, wallet)
	} else {
		const [currentResult, lpResult] = raced.r
		if (currentResult.status === 'fulfilled') {
			currentSnap = currentResult.value
			currentLive = true
		} else {
			errors.push(`current: ${errMsg(currentResult.reason)}`)
			const cacheAt = advisorCacheSavedAtOrUndefined(wallet)
			currentSnap = attachCurrentMetricsMeta(getCachedAdvisorCurrent(wallet), true, cacheAt, wallet)
		}

		if (lpResult.status === 'fulfilled') {
			lpLive = true
			const lp = lpResult.value
			for (const st of lp.statuses) {
				if (!st.ok) errors.push(`lp:${st.id}: ${st.error ?? 'unavailable'}`)
			}
			appendStaleCachedErrors(errors, lp.positions)
			if (lp.positions.length > 0) {
				openLpRows = lp.positions
			} else if (lp.incomplete || lp.statuses.some((s) => !s.ok)) {
				const cacheAt = advisorCacheSavedAtOrUndefined(wallet)
				openLpRows = stampOpenPositionsStale(getCachedAdvisorLpPositions(wallet), cacheAt)
			} else {
				openLpRows = lp.positions
			}
		} else {
			errors.push(`lp: ${errMsg(lpResult.reason)}`)
			const cacheAt = advisorCacheSavedAtOrUndefined(wallet)
			openLpRows = stampOpenPositionsStale(getCachedAdvisorLpPositions(wallet), cacheAt)
		}
	}

	if (currentLive && !currentSnap.readStale) {
		currentSnap = attachCurrentMetricsMeta(currentSnap, false, undefined, wallet)
	} else if (errors.some((e) => e.startsWith('current:'))) {
		const cacheAt = advisorCacheSavedAtOrUndefined(wallet)
		currentSnap = attachCurrentMetricsMeta(currentSnap, true, cacheAt, wallet)
	}

	if (
		raced.kind === 'done' &&
		!errors.some((e) => e.startsWith('advisor:')) &&
		currentLive &&
		lpLive &&
		!errors.some((e) => e.startsWith('lp:') || e.startsWith('current:'))
	) {
		recordAdvisorSnapshotSuccess(wallet, openLpRows, currentSnap, nowMs)
	}

	const staleSourceIds = collectLpStaleSourceIds(errors, openLpRows)
	const { active: openLpActive, empty: openLpEmpty } = splitOpenLpActiveEmpty(openLpRows)
	const mapAdvisorLp = (rows: OpenPosition[]) =>
		mapPool(rows, LP_MAP_CONCURRENCY, async (p) => mapLpPosition(p, staleSourceIds, wallet))

	let lpPositions: AdvisorLpPosition[] = await advisorTimed('lp-map', () => mapAdvisorLp(openLpActive))
	const lpEmpty: AdvisorLpPosition[] = await advisorTimed('lp-empty-map', () => mapAdvisorLp(openLpEmpty))

	const priceBudgetMs = deadlineAt - Date.now()
	let suiPx: number | null = null
	let deepPx: number | null = null
	if (priceBudgetMs > 50) {
		const priced = await Promise.race([
			pricesPromise,
			delay(priceBudgetMs).then(() => null),
		])
		if (priced) {
			;[suiPx, deepPx] = priced
		} else {
			errors.push(`advisor: price fetch exceeded ${deadlineMs}ms budget`)
		}
	} else {
		errors.push('advisor: skipped price fetch (deadline budget exhausted)')
	}

	const net = computeAdvisorNetTotals(lpPositions, currentSnap, nowMs)
	const rpcReason = getPortfolioReadRpcSourceReason()
	const state: AdvisorState = {
		timestamp: new Date().toISOString(),
		wallet,
		rpcSource: getPortfolioReadRpcSource(),
		...(rpcReason ? { rpcSourceReason: rpcReason } : {}),
		current: {
			healthFactor: currentSnap.healthFactor,
			usdcDebt: usdcDebtFrom(currentSnap),
			liquidationPrice: suiLiquidationPrice(currentSnap),
			markets: groupMarkets(currentSnap),
			totalSuppliedUSD: currentSnap.totalSuppliedUSD,
			totalBorrowedUSD: currentSnap.totalBorrowedUSD,
			netValueUSD: currentSnap.netValueUSD,
			...(currentSnap.readStale
				? {
						readStale: true,
						metricsLive: false,
						...(() => {
							const at =
								currentSnap.lastSuccessAtMs ?? advisorCacheSavedAtOrUndefined(wallet)
							return at != null ? { lastSuccessAtMs: at } : {}
						})(),
					}
				: { metricsLive: true }),
		},
		lpPositions,
		lpEmpty,
		net,
		prices: { SUI: suiPx, DEEP: deepPx },
	}
	if (errors.length > 0) state.errors = errors
	const pnFail = getLastPublicNodeGrpcFailureReason()
	if (isSuiReadProfilingEnabled()) {
		state.readProfile = logSuiReadProfile('advisor-state')
	}
	const extraLog = [
		pnFail ? `publicnode: ${pnFail}` : '',
		rpcReason ? `jsonrpc: ${rpcReason}` : '',
	]
		.filter(Boolean)
		.join('; ')
	console.log(
		`[advisor-state] rpcSource: ${state.rpcSource}${extraLog ? `; ${extraLog}` : ''}`,
	)
	return state
	})
}

export async function buildAdvisorCurrentCashflow(options?: {
	forceRefresh?: boolean
	/** Override wallet (normalized); default advisor read wallet. */
	wallet?: string
}): Promise<
	AdvisorCurrentCashflowPayload & {
		readStale?: boolean
		lastSuccessAtMs?: number
		metricsLive?: boolean
		loadError?: string
	}
> {
	const wallet = normalizeSuiAddress(options?.wallet ?? ADVISOR_DEFAULT_WALLET).toLowerCase()
	const cached = getAdvisorCurrentCashflowCache(wallet)
	if (cached && !options?.forceRefresh && isAdvisorCurrentCashflowCacheFresh(wallet)) {
		return {
			...cached.payload,
			lastSuccessAtMs: cached.savedAtMs,
			readStale: false,
			metricsLive: true,
		}
	}

	resetPortfolioReadRpcSource()
	await ensurePortfolioReadTransportReady()

	try {
		const snap = await getCurrentPositions(wallet, { skipCashflow: false })
		const rpcReason = getPortfolioReadRpcSourceReason()
		const savedAtMs = Date.now()
		const payload: AdvisorCurrentCashflowPayload = {
			timestamp: new Date(savedAtMs).toISOString(),
			wallet,
			rpcSource: getPortfolioReadRpcSource(),
			...(rpcReason ? { rpcSourceReason: rpcReason } : {}),
			cashflowUsd: snap.cashflowUsd ?? null,
			supplies: snap.supplies,
			borrows: snap.borrows,
		}
		recordAdvisorCurrentCashflowCache(wallet, payload, savedAtMs)
		return {
			...payload,
			lastSuccessAtMs: savedAtMs,
			readStale: false,
			metricsLive: true,
		}
	} catch (e) {
		const msg = errMsg(e)
		const staleRow = getAdvisorCurrentCashflowCache(wallet)
		if (staleRow) {
			return {
				...staleRow.payload,
				lastSuccessAtMs: staleRow.savedAtMs,
				readStale: true,
				metricsLive: false,
				loadError: msg,
			}
		}
		throw e
	}
}
