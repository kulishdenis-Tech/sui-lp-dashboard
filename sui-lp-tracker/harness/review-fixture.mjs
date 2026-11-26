/**
 * Regression harness for TZ review upgrade v2 (§8).
 * Offline: validates regression_fixture_v2.json schema + expect structure.
 * Live: set REVIEW_FIXTURE_RESULTS_PATH (or pass --live with that env) to compare
 *       dump against §8 invariants 1–7.
 *
 * Usage: npm run review:fixture
 * Optional: REVIEW_FIXTURE_RESULTS_PATH=./harness/last-results.json
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(__dirname, 'regression_fixture_v2.json')
const legacyFixturePath = join(__dirname, 'regression_fixture.json')

function approxOk(actual, expectApprox, tolPct = 5) {
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

function walletEntries(fixture) {
	const w = fixture.wallets
	if (Array.isArray(w)) {
		return w.map((row) => [row.id, row])
	}
	return Object.entries(w ?? {})
}

function validateOfflineSchema(fixture) {
	const entries = walletEntries(fixture)
	if (!entries.length) {
		console.error('Fixture has no wallets')
		process.exit(1)
	}
	let ok = true
	for (const [id, row] of entries) {
		if (!row?.address && !row?.id) {
			ok = fail(id, 'missing address') && ok
			continue
		}
		const exp = row.expect ?? {}
		if (exp.closedAtLeast && typeof exp.closedAtLeast !== 'object') {
			ok = fail(id, 'expect.closedAtLeast must be object') && ok
		}
		if (exp.suilend) {
			if (exp.suilend.supply_usd == null && exp.suilend.borrow_usd == null) {
				ok = fail(id, 'expect.suilend missing supply/borrow') && ok
			}
		}
	}
	// §8 structural invariants (offline): fixture must encode anchors
	const byId = Object.fromEntries(entries)
	const n05 = byId.N05
	if (n05) {
		const scallop = Array.isArray(n05.scallop) ? n05.scallop[0] : n05.scallop
		const coll = scallop?.collaterals?.[0]?.amount
		const debt = scallop?.debts?.[0]?.amount
		if (!(coll > 160 && coll < 180)) {
			ok = fail('N05', `fixture scallop supply ${coll} not ≈170`) && ok
		} else pass('N05', `fixture scallop supply ≈ ${coll}`)
		if (!(debt > 95 && debt < 105)) {
			ok = fail('N05', `fixture scallop borrow ${debt} not ≈100.1`) && ok
		} else pass('N05', `fixture scallop borrow ≈ ${debt}`)
	} else {
		ok = fail('N05', 'missing wallet in fixture') && ok
	}
	const w06 = byId.W06
	if (w06?.expect?.closedAtLeast?.cetus == null) {
		ok = fail('W06', 'expect.closedAtLeast.cetus required') && ok
	} else pass('W06', `closedAtLeast.cetus ≥ ${w06.expect.closedAtLeast.cetus}`)

	console.log(
		`[review:fixture] schema OK — ${entries.length} wallets (${entries.map(([id]) => id).join(', ')})`,
	)
	console.log(
		'[review:fixture] offline mode (set REVIEW_FIXTURE_RESULTS_PATH to compare a live dump)',
	)
	process.exit(ok ? 0 : 1)
}

function compareLive(fixture, results) {
	let ok = true
	const entries = walletEntries(fixture)

	// §8.4 — no silent deposit=0
	const silentZeroPositions = results.silentDepositZeros ?? results.invariants?.silentDepositZeros
	if (Array.isArray(silentZeroPositions)) {
		if (silentZeroPositions.length > 0) {
			ok = fail('§8.4', `${silentZeroPositions.length} positions with liq>0 && deposit==0 && !historyPartial`) && ok
		} else pass('§8.4', 'no silent deposit zeros')
	} else if (Array.isArray(results.positions)) {
		const bad = results.positions.filter(
			(p) =>
				Number(p.liquidity) > 0 &&
				Number(p.depositedUSD) === 0 &&
				p.historyPartial !== true,
		)
		if (bad.length > 0) {
			ok = fail('§8.4', `${bad.length} silent deposit zeros`) && ok
		} else pass('§8.4', 'no silent deposit zeros')
	}

	// §8.6 — sources have status; harness_step_error → incomplete
	if (results.sources || results.sourceStatus) {
		const sources = results.sources ?? results.sourceStatus
		for (const [name, st] of Object.entries(sources)) {
			const status = typeof st === 'string' ? st : st?.status
			if (!status) {
				ok = fail('§8.6', `source ${name} missing status`) && ok
			}
		}
	}
	if (results.harness_step_error || results.harnessStepError) {
		if (results.incomplete !== true && results.snapshotIncomplete !== true) {
			ok = fail('§8.6', 'harness_step_error without incomplete=true') && ok
		} else pass('§8.6', 'incomplete set on harness error')
	}

	for (const [id, w] of entries) {
		const row = results[id] ?? results.wallets?.[id]
		if (!row) {
			continue
		}
		const exp = w.expect ?? {}

		// §8.1 Suilend ±5%
		const suilendExp = exp.suilend
		if (suilendExp) {
			const supply = row.suilendSuppliedUsd ?? row.suilend?.suppliedUsd ?? row.suilend?.supply_usd
			const borrow = row.suilendBorrowedUsd ?? row.suilend?.borrowedUsd ?? row.suilend?.borrow_usd
			if (suilendExp.supply_usd != null) {
				if (!approxOk(supply, suilendExp.supply_usd, 5)) {
					ok = fail(id, `suilend supply ${supply} !~ ${suilendExp.supply_usd} (±5%)`) && ok
				} else pass(id, `suilend supply ≈ ${suilendExp.supply_usd}`)
			}
			if (suilendExp.borrow_usd != null) {
				if (!approxOk(borrow, suilendExp.borrow_usd, 5)) {
					ok = fail(id, `suilend borrow ${borrow} !~ ${suilendExp.borrow_usd} (±5%)`) && ok
				} else pass(id, `suilend borrow ≈ ${suilendExp.borrow_usd}`)
			}
		}

		// §8.2 Scallop N05
		if (id === 'N05' && (row.scallop || exp.scallop)) {
			const supply = row.scallopSupplySui ?? row.scallop?.supplySui ?? row.scallop?.collaterals?.[0]?.amount
			const borrow = row.scallopBorrowSui ?? row.scallop?.borrowSui ?? row.scallop?.debts?.[0]?.amount
			if (supply != null && !approxOk(supply, 170, 5)) {
				ok = fail(id, `scallop supply ${supply} !~ 170`) && ok
			} else if (supply != null) pass(id, `scallop supply ≈ ${supply}`)
			if (borrow != null && !approxOk(borrow, 100.1, 5)) {
				ok = fail(id, `scallop borrow ${borrow} !~ 100.1`) && ok
			} else if (borrow != null) pass(id, `scallop borrow ≈ ${borrow}`)
		}

		// §8.3 closed ≥ lower bounds
		const closedExp = exp.closedAtLeast ?? {}
		for (const [proto, min] of Object.entries(closedExp)) {
			const actual =
				row.closed?.[proto] ??
				row[`${proto}Closed`] ??
				row[`closed_${proto}`]
			if (actual == null) continue
			if (Number(actual) < Number(min)) {
				ok = fail(id, `closed ${proto} ${actual} < ${min}`) && ok
			} else pass(id, `closed ${proto} ${actual} ≥ ${min}`)
		}

		// legacy v1 fields still supported
		if (exp.turbosOpenMin != null && (row.turbosOpen ?? 0) < exp.turbosOpenMin) {
			ok = fail(id, `turbosOpen ${row.turbosOpen} < ${exp.turbosOpenMin}`) && ok
		}
		if (exp.bluefin?.depositedUSD_gt != null) {
			const dep = row.bluefinDepositedUSD ?? row.bluefin?.depositedUSD
			if (!(Number(dep) > exp.bluefin.depositedUSD_gt)) {
				ok = fail(id, `bluefin depositedUSD=${dep}`) && ok
			} else pass(id, `bluefin deposit > ${exp.bluefin.depositedUSD_gt}`)
		}

		// §8.7 N01 Cetus remove attribution
		if (id === 'N01' && (row.cetusN01Remove || row.n01Cetus)) {
			const info = row.cetusN01Remove ?? row.n01Cetus
			const hasRemove = info.hasRemoveLiquidityV2 === true || info.removeAttributed === true
			const partial = info.historyPartial === true
			if (!hasRemove && !partial) {
				ok = fail(id, 'Cetus 0x45420e1a missing RemoveLiquidityV2 and historyPartial') && ok
			} else pass(id, hasRemove ? 'RemoveLiquidityV2 attributed' : 'historyPartial on N01 Cetus')
		}
	}

	process.exit(ok ? 0 : 1)
}

function main() {
	const path = existsSync(fixturePath) ? fixturePath : legacyFixturePath
	if (!existsSync(path)) {
		console.error('Missing harness/regression_fixture_v2.json')
		process.exit(1)
	}
	const fixture = JSON.parse(readFileSync(path, 'utf8'))
	const resultsPath = process.env.REVIEW_FIXTURE_RESULTS_PATH
	const liveFlag = process.argv.includes('--live')

	if (!resultsPath || !existsSync(resultsPath)) {
		if (liveFlag) {
			console.error('--live requires REVIEW_FIXTURE_RESULTS_PATH pointing to a results dump')
			process.exit(1)
		}
		validateOfflineSchema(fixture)
		return
	}

	const results = JSON.parse(readFileSync(resultsPath, 'utf8'))
	compareLive(fixture, results)
}

main()
