/**
 * v1.2.0 acceptance vs v1.1.1 reference (live).
 * Run: SUI_LP_LIVE_RPC=1 npx vitest run src/services/portfolioReadAcceptance.live.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getClientWatchWallets } from '@/config/watchWallets'
import { _resetDashboardRpcPoolForTests } from '@/rpc/dashboardPool'
import { buildAdvisorState } from '@/services/server/advisorState'
import { getCurrentPositions } from '@/services/currentService'
import { getBluefinSpotPositions } from '@/services/bluefinService'
import { loadAllPortfolioLpSources } from '@/services/portfolioLpSources'
import { _resetPortfolioReadSuiClientForTests } from '@/services/portfolioSuiReadClient'
import { clmmRangeFromOpenPosition } from '@/utils/tickPriceRange'
import { isCurrentMultiplyVaultPosition } from '@/utils/currentMultiplyVault'
import type { OpenPosition } from '@/types'

const runLive = process.env.SUI_LP_LIVE_RPC === '1'

const ADVISOR =
	'0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'

const V111_REFERENCE = {
	currentNetUsd: 125_419,
	healthFactor: 1.398,
	liquidationPriceUsd: 0.646,
}

const AMOUNT_TOL = 0.01
const HF_TOL = 0.01
/** ±0.5% on displayed CLMM price bounds. */
const BOUND_TOL = 0.005

function relDiff(a: number, b: number): number {
	const base = Math.max(Math.abs(a), Math.abs(b), 1)
	return Math.abs(a - b) / base
}

function bandOk(value: number, low: number, high: number): boolean {
	if (!Number.isFinite(value)) return false
	return value >= low * (1 - BOUND_TOL) && value <= high * (1 + BOUND_TOL)
}

function pairHay(p: OpenPosition): string {
	return `${p.tokenA}/${p.tokenB} ${p.pair} ${p.tokenAAddress} ${p.tokenBAddress}`.toUpperCase()
}

function isSuiUsdc(p: OpenPosition): boolean {
	const h = pairHay(p)
	return h.includes('SUI') && h.includes('USDC')
}

function isDeepSui(p: OpenPosition): boolean {
	const h = pairHay(p)
	return h.includes('DEEP') && h.includes('SUI')
}

function suiAmount(p: OpenPosition): number {
	if (/^SUI$/i.test(p.tokenA.trim())) return p.tokenAAmount
	if (/^SUI$/i.test(p.tokenB.trim())) return p.tokenBAmount
	return 0
}

function nsAmount(p: OpenPosition): number {
	if (/^NS$/i.test(p.tokenA.trim())) return p.tokenAAmount
	if (/^NS$/i.test(p.tokenB.trim())) return p.tokenBAmount
	if (pairHay(p).includes('::NS::')) {
		return /NS/i.test(p.tokenA) ? p.tokenAAmount : p.tokenBAmount
	}
	return 0
}

describe.skipIf(!runLive)('portfolio read acceptance (live, gRPC default)', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		_resetPortfolioReadSuiClientForTests()
		_resetDashboardRpcPoolForTests()
	})

	it('advisor Current net / HF / liq price + rpcSource', async () => {
		const state = await buildAdvisorState()
		expect(relDiff(state.current.netValueUSD, V111_REFERENCE.currentNetUsd)).toBeLessThanOrEqual(
			AMOUNT_TOL,
		)
		expect(state.current.healthFactor).not.toBeNull()
		expect(
			Math.abs((state.current.healthFactor ?? 0) - V111_REFERENCE.healthFactor),
		).toBeLessThanOrEqual(HF_TOL)
		expect(state.current.liquidationPrice).not.toBeNull()
		expect(
			Math.abs((state.current.liquidationPrice ?? 0) - V111_REFERENCE.liquidationPriceUsd),
		).toBeLessThanOrEqual(0.02)
		expect(['publicnode-grpc', 'mysten-grpc', 'blockvision-grpc', 'custom-grpc', 'jsonrpc']).toContain(
			state.rpcSource,
		)
	}, 120_000)

	it('Current venues across watch wallets', async () => {
		const venues = new Set<string>()
		for (const wallet of getClientWatchWallets()) {
			const snap = await getCurrentPositions(wallet)
			for (const row of [...snap.supplies, ...snap.borrows]) {
				if (row.venue) venues.add(row.venue)
			}
			expect(Number.isFinite(snap.netValueUSD)).toBe(true)
		}
		for (const label of ['Main', 'Ember', 'sUSN Market', 'AltCoin']) {
			expect(venues.has(label)).toBe(true)
		}
	}, 180_000)

	it('Bluefin SUI/USDC + DEEP/SUI tick bounds (gRPC)', async () => {
		const bluefin = await getBluefinSpotPositions(ADVISOR)
		expect(bluefin.length).toBeGreaterThan(0)

		const wide = bluefin.filter(isSuiUsdc).find((p) => {
			const r = clmmRangeFromOpenPosition(p)
			return bandOk(r.priceMin, 0.95, 1.7) && bandOk(r.priceMax, 0.95, 1.7)
		})
		expect(wide).toBeDefined()
		expect(suiAmount(wide!)).toBeGreaterThan(15_000)
		expect(wide!.currentValueUSD).toBeGreaterThan(0)

		const tight = bluefin.filter(isSuiUsdc).find((p) => {
			const r = clmmRangeFromOpenPosition(p)
			return bandOk(r.priceMin, 0.982, 1.016) && bandOk(r.priceMax, 0.982, 1.016)
		})
		expect(tight).toBeDefined()
		expect(tight!.currentValueUSD).toBeGreaterThan(0)

		const deep = bluefin.find(isDeepSui)
		expect(deep).toBeDefined()
		const dr = clmmRangeFromOpenPosition(deep!)
		expect(bandOk(dr.priceMin, 0.0185, 0.0359)).toBe(true)
		expect(bandOk(dr.priceMax, 0.0185, 0.0359)).toBe(true)
	}, 120_000)

	it('NS/SUI value and NS amount (regression v1.1.1)', async () => {
		const lp = await loadAllPortfolioLpSources(ADVISOR)
		const nsPos = lp.positions.find((p) => {
			const h = pairHay(p)
			return h.includes('NS') && h.includes('SUI')
		})
		expect(nsPos).toBeDefined()
		expect(nsPos!.currentValueUSD).toBeGreaterThan(900)
		expect(nsPos!.currentValueUSD).toBeLessThan(1_050)
		const ns = nsAmount(nsPos!)
		expect(ns).toBeGreaterThan(93_000)
		expect(ns).toBeLessThan(95_500)
	}, 180_000)

	it('Cetus cascades + USDSUI multiply present', async () => {
		const lp = await loadAllPortfolioLpSources(ADVISOR)
		expect(lp.positions.some((p) => p.protocol === 'cetus')).toBe(true)
		expect(lp.positions.filter((p) => p.protocol === 'cetus').length).toBeGreaterThanOrEqual(3)
		expect(
			lp.positions.some(
				(p) => /USDSUI/i.test(pairHay(p)) || isCurrentMultiplyVaultPosition(p),
			),
		).toBe(true)
	}, 180_000)
})
