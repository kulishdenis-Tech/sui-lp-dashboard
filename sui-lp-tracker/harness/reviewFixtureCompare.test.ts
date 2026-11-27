import { describe, expect, it } from 'vitest'
import {
	checkClosedAtLeast,
	checkSuilend,
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

	it('N10 relative GraphQL floor: PASS when live ≥ fresh floor', () => {
		const verdicts = checkClosedAtLeast(
			'N10',
			{ closedAtLeast: { bluefin: { relativeGraphqlClosed: true } } },
			{
				sources: { 'closed:bluefin': { status: 'ok' } },
				closed: { bluefin: 177 },
				closedGraphqlFloor: { bluefin: 175 },
				closedTruncated: {},
			},
		)
		expect(verdicts[0]!.status).toBe('PASS')
		expect(verdicts[0]!.msg).toMatch(/graphql floor/)
	})
})

describe('reviewFixtureCompare §8.1 suilend', () => {
	it('FAIL on Hermes/Pyth 401 (service must fall back — not SKIPPED)', () => {
		const verdicts = checkSuilend(
			'N05',
			{ suilend: { supply_usd: 1, borrow_usd: 0 } },
			{
				sources: { suilend: { status: 'error', error: 'obligations: HTTP error! status: 401' } },
				suilendIncomplete: true,
				suilendIncompleteReason: 'obligations: HTTP error! status: 401',
			},
		)
		expect(verdicts[0]!.status).toBe('FAIL')
		expect(verdicts[0]!.msg).toMatch(/401|source error/i)
	})

	it('FAIL when suilendSkipped flag set (must not skip)', () => {
		const verdicts = checkSuilend(
			'N01',
			{ suilend: { supply_usd: 1, borrow_usd: 0 } },
			{
				suilendSkipped: true,
				suilendSkipReason: 'no PYTH_HERMES_ACCESS_TOKEN in .env',
				sources: { suilend: { status: 'skipped' } },
			},
		)
		expect(verdicts[0]!.status).toBe('FAIL')
		expect(verdicts[0]!.msg).toMatch(/must not SKIPPED/i)
	})

	it('PASS N10 / N05 expect ±5%', () => {
		const n10 = checkSuilend(
			'N10',
			{ suilend: { supply_usd: 966281.25, borrow_usd: 816843.76 } },
			{
				sources: { suilend: { status: 'ok' } },
				suilendSuppliedUsd: 970_000,
				suilendBorrowedUsd: 820_000,
			},
		)
		expect(n10.every((v) => v.status === 'PASS')).toBe(true)
		const n05 = checkSuilend(
			'N05',
			{ suilend: { supply_usd: 55142.17, borrow_usd: 23799.92 } },
			{
				sources: { suilend: { status: 'ok' } },
				suilendSuppliedUsd: 55_100,
				suilendBorrowedUsd: 23_800,
			},
		)
		expect(n05.every((v) => v.status === 'PASS')).toBe(true)
	})
})

describe('reviewFixtureCompare wallet timeout', () => {
	it('INCONCLUSIVE on walletTimeout (not FAIL)', () => {
		const all = evaluateWallet(
			'W06',
			{ expect: { closedAtLeast: { cetus: 11 } } },
			{ walletTimeout: true, walletTimeoutMs: 240_000 },
		)
		expect(all).toHaveLength(1)
		expect(all[0]!.status).toBe('INCONCLUSIVE')
		expect(all[0]!.msg).toMatch(/TIMEOUT/i)
		expect(summarizeVerdicts(all).exitCode).toBe(0)
	})
})
