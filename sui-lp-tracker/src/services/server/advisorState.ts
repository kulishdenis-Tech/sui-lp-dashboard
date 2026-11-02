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
	resetPortfolioReadRpcSource,
} from '@/services/portfolioReadRpcSource'
import { getLastPublicNodeGrpcFailureReason } from '@/services/grpcEndpointHealth'
import { ensurePortfolioReadTransportReady } from '@/services/portfolioSuiReadClient'
import {
	isSuiReadProfilingEnabled,
	logSuiReadProfile,
	resetSuiReadProfile,
	type SuiReadProfileSnapshot,
} from '@/services/suiReadProfiler'

/** Hardcoded advisor wallet (read-only). */
const ADVISOR_WALLET =
	'0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'

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
}

export type AdvisorState = {
	timestamp: string
	wallet: string
	/** Transport that served on-chain reads for this response. */
	rpcSource: import('@/services/portfolioReadRpcSource').PortfolioReadRpcSource
	current: {
		healthFactor: number | null
		usdcDebt: number
		liquidationPrice: number | null
		markets: Record<string, AdvisorMarketVenue>
		totalSuppliedUSD: number
		totalBorrowedUSD: number
		netValueUSD: number
	}
	lpPositions: AdvisorLpPosition[]
	prices: { SUI: number | null; DEEP: number | null }
	/** Present when SUI_LP_ADVISOR_PROFILE=1 */
	readProfile?: SuiReadProfileSnapshot
	errors?: string[]
}

function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e)
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

function mapLpPosition(p: OpenPosition): AdvisorLpPosition {
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

export async function buildAdvisorState(): Promise<AdvisorState> {
	return advisorTimed('total', async () => {
	resetPortfolioReadRpcSource()
	if (isSuiReadProfilingEnabled()) resetSuiReadProfile()
	await ensurePortfolioReadTransportReady()
	const wallet = normalizeSuiAddress(ADVISOR_WALLET).toLowerCase()
	const errors: string[] = []
	const nowSec = Math.floor(Date.now() / 1000)

	const [currentResult, lpResult] = await Promise.allSettled([
		advisorTimed('current', () => getCurrentPositions(wallet, { skipCashflow: true })),
		advisorTimed('lp-load', () => loadAllPortfolioLpSources(wallet)),
	])

	let currentSnap: LendingSnapshot = EMPTY_CURRENT_SNAP
	if (currentResult.status === 'fulfilled') {
		currentSnap = currentResult.value
	} else {
		errors.push(`current: ${errMsg(currentResult.reason)}`)
	}

	let lpPositions: AdvisorLpPosition[] = []
	if (lpResult.status === 'fulfilled') {
		const lp = lpResult.value
		for (const st of lp.statuses) {
			if (!st.ok) errors.push(`lp:${st.id}: ${st.error ?? 'unavailable'}`)
		}
		lpPositions = await advisorTimed('lp-map', () =>
			mapPool(lp.positions, LP_MAP_CONCURRENCY, async (p) => mapLpPosition(p)),
		)
	} else {
		errors.push(`lp: ${errMsg(lpResult.reason)}`)
	}

	const [suiPx, deepPx] = await advisorTimed('prices', () =>
		Promise.all([
			softUsdPrice('SUI', NATIVE_SUI_COIN_TYPE, nowSec, errors),
			softUsdPrice('DEEP', DEEP_COIN_TYPE, nowSec, errors),
		]),
	)

	const state: AdvisorState = {
		timestamp: new Date().toISOString(),
		wallet,
		rpcSource: getPortfolioReadRpcSource(),
		current: {
			healthFactor: currentSnap.healthFactor,
			usdcDebt: usdcDebtFrom(currentSnap),
			liquidationPrice: suiLiquidationPrice(currentSnap),
			markets: groupMarkets(currentSnap),
			totalSuppliedUSD: currentSnap.totalSuppliedUSD,
			totalBorrowedUSD: currentSnap.totalBorrowedUSD,
			netValueUSD: currentSnap.netValueUSD,
		},
		lpPositions,
		prices: { SUI: suiPx, DEEP: deepPx },
	}
	if (errors.length > 0) state.errors = errors
	const pnFail = getLastPublicNodeGrpcFailureReason()
	if (isSuiReadProfilingEnabled()) {
		state.readProfile = logSuiReadProfile('advisor-state')
	}
	console.log(
		`[advisor-state] rpcSource: ${state.rpcSource}${pnFail ? `; publicnode: ${pnFail}` : ''}`,
	)
	return state
	})
}
