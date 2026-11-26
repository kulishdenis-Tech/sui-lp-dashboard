/**
 * Regression harness for TZ review upgrade v2 (§8).
 * Offline (default / CI): validates regression_fixture_v2.json schema + expect structure.
 * Live (`--live`): runs dashboard services via vite-node (gRPC + GraphQL) — see review-fixture-live.ts.
 *
 * Usage:
 *   npm run review:fixture
 *   npm run review:fixture:live
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { walletEntries } from './reviewFixtureCompare.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(__dirname, 'regression_fixture_v2.json')
const legacyFixturePath = join(__dirname, 'regression_fixture.json')

function fail(id, msg) {
	console.error(`[FAIL] ${id}: ${msg}`)
	return false
}

function pass(id, msg) {
	console.log(`[PASS] ${id}: ${msg}`)
	return true
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
	console.log('[review:fixture] offline mode (CI default)')
	process.exit(ok ? 0 : 1)
}

function runLive() {
	const script = join(__dirname, 'review-fixture-live.ts')
	const r = spawnSync(
		process.platform === 'win32' ? 'npx.cmd' : 'npx',
		['vite-node', '--mode', 'production', script],
		{
			cwd: join(__dirname, '..'),
			stdio: 'inherit',
			env: process.env,
			shell: process.platform === 'win32',
		},
	)
	process.exit(r.status == null ? 1 : r.status)
}

function main() {
	const path = existsSync(fixturePath) ? fixturePath : legacyFixturePath
	if (!existsSync(path)) {
		console.error('Missing harness/regression_fixture_v2.json')
		process.exit(1)
	}
	const liveFlag = process.argv.includes('--live')
	if (liveFlag) {
		runLive()
		return
	}
	const fixture = JSON.parse(readFileSync(path, 'utf8'))
	validateOfflineSchema(fixture)
}

main()
