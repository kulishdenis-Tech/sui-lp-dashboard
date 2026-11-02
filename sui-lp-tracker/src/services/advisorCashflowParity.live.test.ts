/**
 * Live: /api/advisor/current-cashflow matches getCurrentPositions cashflow (v1.1.1 parity).
 * Run: SUI_LP_LIVE_RPC=1 npx vitest run src/services/advisorCashflowParity.live.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAdvisorCurrentCashflow } from '@/services/server/advisorState'
import { getCurrentPositions } from '@/services/currentService'
import { _resetPortfolioReadSuiClientForTests } from '@/services/portfolioSuiReadClient'

const runLive = process.env.SUI_LP_LIVE_RPC === '1'
const ADVISOR =
	'0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'

const TOL = 0.00001

function relOk(a: number, b: number): boolean {
	const base = Math.max(Math.abs(a), Math.abs(b), 1)
	return Math.abs(a - b) / base <= TOL
}

describe.skipIf(!runLive)('advisor current-cashflow parity (live)', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		_resetPortfolioReadSuiClientForTests()
	})

	it('cashflowUsd matches full getCurrentPositions within 0.001%', async () => {
		const [direct, endpoint] = await Promise.all([
			getCurrentPositions(ADVISOR, { skipCashflow: false }),
			buildAdvisorCurrentCashflow(),
		])
		expect(endpoint.cashflowUsd).toBeDefined()
		expect(direct.cashflowUsd).toBeDefined()
		const d = direct.cashflowUsd!
		const e = endpoint.cashflowUsd!
		expect(relOk(e.resultUSD, d.resultUSD)).toBe(true)
		expect(relOk(e.supplyInterestUSD, d.supplyInterestUSD)).toBe(true)
		expect(relOk(e.borrowInterestUSD, d.borrowInterestUSD)).toBe(true)
		expect(relOk(e.claimedRewardsUSD, d.claimedRewardsUSD)).toBe(true)
	}, 180_000)
})
