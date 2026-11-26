import { describe, expect, it } from 'vitest'
import {
	checkClosedAtLeast,
	evaluateWallet,
	summarizeVerdicts,
} from './reviewFixtureCompare.mjs'

describe('reviewFixtureCompare §8.3 closedAtLeast', () => {
	it('FAIL when W06 closed cetus drops 74 → 0 (not truncated)', () => {
		const fixtureRow = {
			expect: { closedAtLeast: { cetus: 11 } },
		}
		// Regression: previously observed ~74 closed, live dump reports 0 without truncation.
		const liveRow = {
			sources: {
				suilend: { status: 'ok' },
				scallop: { status: 'ok' },
				'closed:cetus': { status: 'ok' },
				enrichment: { status: 'ok' },
			},
			closed: { cetus: 0 },
			closedTruncated: {},
			positions: [],
			silentDepositZeros: [],
			incomplete: false,
		}
		const verdicts = checkClosedAtLeast('W06', fixtureRow.expect, liveRow)
		expect(verdicts.some((v) => v.status === 'FAIL' && v.msg.includes('closed cetus 0 < 11'))).toBe(
			true,
		)
		const all = evaluateWallet('W06', fixtureRow, liveRow)
		expect(summarizeVerdicts(all).fail).toBeGreaterThan(0)
		expect(summarizeVerdicts(all).exitCode).toBe(1)
	})

	it('INCONCLUSIVE when closed below min but scan truncated (never pad to PASS)', () => {
		const verdicts = checkClosedAtLeast(
			'W06',
			{ closedAtLeast: { cetus: 11 } },
			{
				sources: { 'closed:cetus': { status: 'partial' } },
				closed: { cetus: 3 },
				closedTruncated: { cetus: true },
			},
		)
		expect(verdicts).toHaveLength(1)
		expect(verdicts[0]!.status).toBe('INCONCLUSIVE')
		expect(verdicts[0]!.msg).toMatch(/truncated/i)
	})

	it('PASS when closed count meets lower bound', () => {
		const verdicts = checkClosedAtLeast(
			'W06',
			{ closedAtLeast: { cetus: 11 } },
			{
				sources: { 'closed:cetus': { status: 'ok' } },
				closed: { cetus: 74 },
				closedTruncated: {},
			},
		)
		expect(verdicts[0]!.status).toBe('PASS')
	})
})

describe('reviewFixtureCompare §8.1 suilend', () => {
	it('FAIL when suilend source incomplete/error (not silent pass)', async () => {
		const { checkSuilend } = await import('./reviewFixtureCompare.mjs')
		const verdicts = checkSuilend(
			'N05',
			{ suilend: { supply_usd: 1, borrow_usd: 0 } },
			{
				sources: { suilend: { status: 'partial', error: 'obligations: HTTP 401' } },
				suilendIncomplete: true,
				suilendIncompleteReason: 'obligations: HTTP 401',
			},
		)
		expect(verdicts[0]!.status).toBe('FAIL')
		expect(verdicts[0]!.msg).toMatch(/401|error/i)
	})
})
