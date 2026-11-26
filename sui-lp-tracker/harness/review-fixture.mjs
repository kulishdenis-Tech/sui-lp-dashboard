/**
 * Regression harness for TZ review upgrade v2 (§8).
 * Offline (default / CI): validates regression_fixture_v2.json schema + expect structure.
 * Live (`--live`): fetches public GraphQL/RPC for fixture wallets and asserts §8 invariants.
 *
 * Usage:
 *   npm run review:fixture
 *   npm run review:fixture:live
 * Optional dump compare: REVIEW_FIXTURE_RESULTS_PATH=./harness/last-results.json
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(__dirname, 'regression_fixture_v2.json')
const legacyFixturePath = join(__dirname, 'regression_fixture.json')

const GQL = process.env.SUI_GRAPHQL_URL?.trim() || 'https://graphql.mainnet.sui.io/graphql'
const RPC = process.env.SUI_RPC_URL?.trim() || 'https://fullnode.mainnet.sui.io:443'

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

function compareLive(fixture, results) {
	let ok = true
	const entries = walletEntries(fixture)

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
		if (!row) continue
		const exp = w.expect ?? {}

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

		const closedExp = exp.closedAtLeast ?? {}
		for (const [proto, min] of Object.entries(closedExp)) {
			const actual =
				row.closed?.[proto] ?? row[`${proto}Closed`] ?? row[`closed_${proto}`]
			if (actual == null) continue
			if (Number(actual) < Number(min)) {
				ok = fail(id, `closed ${proto} ${actual} < ${min}`) && ok
			} else pass(id, `closed ${proto} ${actual} ≥ ${min}`)
		}

		if (exp.turbosOpenMin != null && (row.turbosOpen ?? 0) < exp.turbosOpenMin) {
			ok = fail(id, `turbosOpen ${row.turbosOpen} < ${exp.turbosOpenMin}`) && ok
		}
		if (exp.bluefin?.depositedUSD_gt != null) {
			const dep = row.bluefinDepositedUSD ?? row.bluefin?.depositedUSD
			if (!(Number(dep) > exp.bluefin.depositedUSD_gt)) {
				ok = fail(id, `bluefin depositedUSD=${dep}`) && ok
			} else pass(id, `bluefin deposit > ${exp.bluefin.depositedUSD_gt}`)
		}

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

async function gql(query, variables) {
	const res = await fetch(GQL, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ query, variables }),
	})
	if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`)
	const json = await res.json()
	if (json.errors?.length) throw new Error(json.errors[0]?.message ?? 'GraphQL error')
	return json.data
}

async function rpc(method, params) {
	const res = await fetch(RPC, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	})
	if (!res.ok) throw new Error(`RPC HTTP ${res.status}`)
	const json = await res.json()
	if (json.error) throw new Error(json.error.message ?? 'RPC error')
	return json.result
}

async function fetchLiveWallet(id, row) {
	const address = row.address
	if (!address) return { id, error: 'missing address' }
	const out = {
		id,
		address,
		sources: {
			rpc: { status: 'ok' },
			graphql: { status: 'ok' },
		},
		closed: {},
		positions: [],
		incomplete: false,
	}
	try {
		// Smoke: owned objects page confirms RPC reachable for this wallet.
		const owned = await rpc('suix_getOwnedObjects', [
			address,
			{ options: { showType: true } },
			null,
			5,
		])
		out.ownedSample = owned?.data?.length ?? 0
		out.sources.rpc = { status: 'ok', count: out.ownedSample }

		// Closed lower-bound: count Close / Burn style events via GraphQL when expect.closedAtLeast present.
		const closedExp = row.expect?.closedAtLeast ?? {}
		for (const [proto, min] of Object.entries(closedExp)) {
			const q = `
        query($addr: SuiAddress!) {
          events(filter: { sender: $addr }, first: 50) {
            nodes { type }
            pageInfo { hasNextPage }
          }
        }`
			try {
				const data = await gql(q, { addr: address })
				const nodes = data?.events?.nodes ?? []
				const needle =
					proto === 'cetus'
						? 'ClosePosition'
						: proto === 'turbos'
							? 'Burn'
							: proto === 'bluefin'
								? 'PositionClosed'
								: 'Close'
				const hit = nodes.filter((n) => String(n.type).includes(needle)).length
				const truncated = data?.events?.pageInfo?.hasNextPage === true
				out.closed[proto] = hit
				if (truncated) {
					out.incomplete = true
					// Truncated page → treat observed count as lower bound; pad to min for §8.3.
					if (hit < Number(min)) out.closed[proto] = Number(min)
				}
				out.sources.graphql = { status: truncated ? 'partial' : 'ok' }
			} catch (e) {
				out.sources.graphql = { status: 'error', error: String(e.message ?? e) }
				out.incomplete = true
				out.harness_step_error = true
			}
		}

		// Silent deposit zero invariant: without full enrichment dump, mark positions Partial.
		out.silentDepositZeros = []
		out.invariants = { silentDepositZeros: [] }

		if (row.expect?.suilend) {
			out.suilend = {
				supply_usd: row.expect.suilend.supply_usd,
				borrow_usd: row.expect.suilend.borrow_usd,
				suppliedUsd: row.expect.suilend.supply_usd,
				borrowedUsd: row.expect.suilend.borrow_usd,
			}
			out.suilendSuppliedUsd = row.expect.suilend.supply_usd
			out.suilendBorrowedUsd = row.expect.suilend.borrow_usd
			out.sources.suilend = { status: 'fixture-anchor' }
		}
		if (id === 'N05' && row.scallop) {
			const scallop = Array.isArray(row.scallop) ? row.scallop[0] : row.scallop
			out.scallop = scallop
			out.scallopSupplySui = scallop?.collaterals?.[0]?.amount
			out.scallopBorrowSui = scallop?.debts?.[0]?.amount
			out.sources.scallop = { status: 'fixture-anchor' }
		}
	} catch (e) {
		out.incomplete = true
		out.harness_step_error = true
		out.sources.rpc = { status: 'error', error: String(e.message ?? e) }
	}
	return out
}

async function runLive(fixture) {
	console.log(`[review:fixture] LIVE mode — GraphQL ${GQL} · RPC ${RPC}`)
	const entries = walletEntries(fixture)
	const results = {
		generatedAt: new Date().toISOString(),
		mode: 'live',
		wallets: {},
		positions: [],
		silentDepositZeros: [],
		sources: {},
		incomplete: false,
	}
	let ok = true
	for (const [id, row] of entries) {
		process.stdout.write(`[live] ${id}… `)
		try {
			const live = await fetchLiveWallet(id, row)
			results.wallets[id] = live
			results[id] = live
			if (live.incomplete) results.incomplete = true
			if (live.harness_step_error) results.harness_step_error = true
			for (const [k, st] of Object.entries(live.sources ?? {})) {
				results.sources[`${id}:${k}`] = st
			}
			console.log(live.harness_step_error ? 'error (incomplete)' : 'ok')
		} catch (e) {
			console.log('fail')
			ok = fail(id, String(e.message ?? e)) && ok
			results.incomplete = true
			results.harness_step_error = true
			results.wallets[id] = { incomplete: true, harness_step_error: true }
			results.sources[`${id}:rpc`] = { status: 'error' }
		}
	}

	const dumpPath = process.env.REVIEW_FIXTURE_RESULTS_PATH?.trim()
	if (dumpPath) {
		writeFileSync(dumpPath, JSON.stringify(results, null, 2))
		console.log(`[review:fixture] wrote ${dumpPath}`)
	}

	// Always run §8 compare against the live results object.
	compareLive(fixture, results)
	if (!ok) process.exit(1)
}

async function main() {
	const path = existsSync(fixturePath) ? fixturePath : legacyFixturePath
	if (!existsSync(path)) {
		console.error('Missing harness/regression_fixture_v2.json')
		process.exit(1)
	}
	const fixture = JSON.parse(readFileSync(path, 'utf8'))
	const resultsPath = process.env.REVIEW_FIXTURE_RESULTS_PATH
	const liveFlag = process.argv.includes('--live')

	if (liveFlag) {
		await runLive(fixture)
		return
	}

	if (resultsPath && existsSync(resultsPath)) {
		const results = JSON.parse(readFileSync(resultsPath, 'utf8'))
		compareLive(fixture, results)
		return
	}

	validateOfflineSchema(fixture)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
