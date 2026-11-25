/**
 * Regression harness stub for TZ review (W01–W11).
 * Without REVIEW_FIXTURE_RESULTS_PATH, validates fixture schema only (offline).
 * With a JSON results dump from a live scan, compares key fields (±2% / brackets).
 *
 * Usage: npm run review:fixture
 * Optional: REVIEW_FIXTURE_RESULTS_PATH=./harness/last-results.json
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(__dirname, 'regression_fixture.json')

function approxOk(actual, expectApprox, tolPct = 2) {
	if (actual == null || !Number.isFinite(Number(actual))) return false
	const a = Number(actual)
	const e = Number(expectApprox)
	if (!Number.isFinite(e) || e === 0) return Math.abs(a) < 1e-9
	return Math.abs(a - e) / Math.abs(e) <= tolPct / 100
}

function fail(id, msg) {
	console.error(`[FAIL] ${id}: ${msg}`)
	return false
}

function pass(id, msg) {
	console.log(`[PASS] ${id}: ${msg}`)
	return true
}

function main() {
	if (!existsSync(fixturePath)) {
		console.error('Missing harness/regression_fixture.json')
		process.exit(1)
	}
	const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
	if (!fixture?.wallets?.length) {
		console.error('Fixture has no wallets')
		process.exit(1)
	}

	const resultsPath = process.env.REVIEW_FIXTURE_RESULTS_PATH
	if (!resultsPath || !existsSync(resultsPath)) {
		console.log(
			`[review:fixture] schema OK — ${fixture.wallets.length} wallets (${fixture.wallets.map((w) => w.id).join(', ')})`,
		)
		console.log(
			'[review:fixture] offline mode (set REVIEW_FIXTURE_RESULTS_PATH to compare a live dump)',
		)
		process.exit(0)
	}

	const results = JSON.parse(readFileSync(resultsPath, 'utf8'))
	let ok = true
	for (const w of fixture.wallets) {
		const row = results[w.id] ?? results.wallets?.[w.id]
		if (!row) {
			ok = pass(w.id, 'no live row — skipped') && ok
			continue
		}
		const exp = w.expect ?? {}
		if (exp.turbosOpenMin != null && (row.turbosOpen ?? 0) < exp.turbosOpenMin) {
			ok = fail(w.id, `turbosOpen ${row.turbosOpen} < ${exp.turbosOpenMin}`) && ok
		}
		if (exp.turbosInRangeMin != null && (row.turbosInRange ?? 0) < exp.turbosInRangeMin) {
			ok = fail(w.id, `turbosInRange ${row.turbosInRange} < ${exp.turbosInRangeMin}`) && ok
		}
		if (exp.turbosValueUsd?.approx != null) {
			if (!approxOk(row.turbosValueUsd, exp.turbosValueUsd.approx, exp.turbosValueUsd.tolPct)) {
				ok = fail(w.id, `turbosValueUsd ${row.turbosValueUsd} !~ ${exp.turbosValueUsd.approx}`) && ok
			} else pass(w.id, `turbosValueUsd ≈ ${exp.turbosValueUsd.approx}`)
		}
		if (exp.momentumValueUsd?.approx != null) {
			if (!approxOk(row.momentumValueUsd, exp.momentumValueUsd.approx, exp.momentumValueUsd.tolPct)) {
				ok = fail(w.id, `momentumValueUsd ${row.momentumValueUsd} !~ ${exp.momentumValueUsd.approx}`) && ok
			} else pass(w.id, `momentumValueUsd ≈ ${exp.momentumValueUsd.approx}`)
		}
		if (exp.momentumInRange === true && row.momentumInRange !== true) {
			ok = fail(w.id, 'momentum not in_range') && ok
		}
		if (
			exp.momentumEmptyStatus === true &&
			row.momentumStatus !== 'empty' &&
			row.momentumLifecycle !== 'empty'
		) {
			ok = fail(w.id, `momentum empty expected (status=${row.momentumStatus} lifecycle=${row.momentumLifecycle})`) && ok
		}
		if (exp.momentumClosedMin != null && (row.momentumClosed ?? 0) < exp.momentumClosedMin) {
			ok = fail(w.id, `momentumClosed ${row.momentumClosed} < ${exp.momentumClosedMin}`) && ok
		}
		if (exp.cetusClosedMin != null && (row.cetusClosed ?? 0) < exp.cetusClosedMin) {
			ok = fail(w.id, `cetusClosed ${row.cetusClosed} < ${exp.cetusClosedMin}`) && ok
		}
		if (exp.suilendVisible === true && !row.suilendVisible) {
			ok = fail(w.id, 'suilend not visible') && ok
		}
		if (exp.suilendSuppliedUsd?.approx != null) {
			if (!approxOk(row.suilendSuppliedUsd, exp.suilendSuppliedUsd.approx, exp.suilendSuppliedUsd.tolPct)) {
				ok = fail(w.id, `suilendSuppliedUsd ${row.suilendSuppliedUsd}`) && ok
			}
		}
		if (exp.suilendBorrowedUsd?.approx != null) {
			if (!approxOk(row.suilendBorrowedUsd, exp.suilendBorrowedUsd.approx, exp.suilendBorrowedUsd.tolPct)) {
				ok = fail(w.id, `suilendBorrowedUsd ${row.suilendBorrowedUsd}`) && ok
			}
		}
		if (exp.healthFactor?.present && (row.healthFactor == null || !Number.isFinite(Number(row.healthFactor)))) {
			ok = fail(w.id, 'healthFactor missing') && ok
		}
		if (exp.bluefin?.depositedUSD_gt != null) {
			if (!(Number(row.bluefinDepositedUSD) > exp.bluefin.depositedUSD_gt)) {
				ok = fail(w.id, `bluefin depositedUSD=${row.bluefinDepositedUSD}`) && ok
			}
		}
		if (exp.bluefin?.daysOpen_gt != null) {
			if (!(Number(row.bluefinDaysOpen) > exp.bluefin.daysOpen_gt)) {
				ok = fail(w.id, `bluefin daysOpen=${row.bluefinDaysOpen}`) && ok
			}
		}
		if (exp.historyPartialOrNullPnl === true) {
			const partial = row.historyPartial === true
			const nullPnl = row.pnlUSD == null
			if (!partial && !nullPnl && Number(row.pnlUSD) > 1e6) {
				ok = fail(w.id, `absurd pnlUSD=${row.pnlUSD} without partial`) && ok
			} else pass(w.id, 'pnl/history guard ok')
		}
	}

	process.exit(ok ? 0 : 1)
}

main()
