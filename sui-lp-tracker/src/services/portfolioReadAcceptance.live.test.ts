/**
 * v1.2.0 acceptance vs v1.1.1 reference (live).
 * Run: SUI_LP_LIVE_RPC=1 npx vitest run src/services/portfolioReadAcceptance.live.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getClientWatchWallets } from '@/config/watchWallets'
import { _resetDashboardRpcPoolForTests } from '@/rpc/dashboardPool'
import { buildAdvisorState } from '@/services/server/advisorState'
import { getCurrentPositions } from '@/services/currentService'
import { loadAllPortfolioLpSources } from '@/services/portfolioLpSources'
import { _resetPortfolioReadSuiClientForTests } from '@/services/portfolioSuiReadClient'
import { clmmRangeFromOpenPosition } from '@/utils/tickPriceRange'
import { isCurrentMultiplyVaultPosition } from '@/utils/currentMultiplyVault'

const runLive = process.env.SUI_LP_LIVE_RPC === '1'

const ADVISOR =
	'0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'

/** Spot-check from v1.1.1 advisor wallet (Nov 2026). */
const V111_REFERENCE = {
	currentNetUsd: 125_419,
	healthFactor: 1.398,
	liquidationPriceUsd: 0.646,
}

const AMOUNT_TOL = 0.01
const HF_TOL = 0.01

function relDiff(a: number, b: number): number {
	const base = Math.max(Math.abs(a), Math.abs(b), 1)
	return Math.abs(a - b) / base
}

describe.skipIf(!runLive)('portfolio read acceptance (live, gRPC default)', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		_resetPortfolioReadSuiClientForTests()
		_resetDashboardRpcPoolForTests()
	})

	it('advisor Current net / HF / liq price within v1.1.1 tolerance', async () => {
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

	it('expected LP protocols present on watch wallets', async () => {
		let wideBluefin = false
		let tightNearPar = false
		let hasCetus = false
		let hasNsSui = false
		let hasMultiply = false

		for (const wallet of getClientWatchWallets()) {
			const lp = await loadAllPortfolioLpSources(wallet)
			if (lp.positions.some((p) => p.protocol === 'cetus')) hasCetus = true
			for (const p of lp.positions) {
				const r = clmmRangeFromOpenPosition(p)
				if (p.protocol === 'bluefin' && r.priceCurrent >= 0.85 && r.priceCurrent <= 1.75) {
					wideBluefin = true
				}
				if (r.priceCurrent >= 0.982 && r.priceCurrent <= 1.016) {
					tightNearPar = true
				}
				const label = `${p.tokenA}/${p.tokenB} ${p.pair} ${p.tokenAAddress} ${p.tokenBAddress}`
				if (/NS/i.test(label) && /SUI/i.test(label)) hasNsSui = true
				if (/USDSUI/i.test(label) || isCurrentMultiplyVaultPosition(p)) hasMultiply = true
			}
		}

		expect(hasCetus).toBe(true)
		expect(wideBluefin).toBe(true)
		expect(tightNearPar).toBe(true)
		expect(hasNsSui).toBe(true)
		expect(hasMultiply).toBe(true)
	}, 240_000)
})
