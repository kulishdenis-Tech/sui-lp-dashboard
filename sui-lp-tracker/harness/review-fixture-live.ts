/**
 * Live §8 harness: call real dashboard services (gRPC + GraphQL), compare to fixture expects.
 * Invoked via: npm run review:fixture:live → vite-node harness/review-fixture-live.ts
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	walletEntries,
	evaluateWallet,
	summarizeVerdicts,
	printVerdict,
	checkSilentDepositZeros,
	checkSourceStatus,
} from './reviewFixtureCompare.mjs'

/** @typedef {{ status: 'PASS'|'FAIL'|'INCONCLUSIVE', id: string, msg: string }} Verdict */
import { getDashboardGrpcClient } from '@/services/suiData/createGrpcClient'
import {
	MYSTEN_PUBLIC_GRAPHQL_URL,
	MYSTEN_PUBLIC_GRPC_URL,
	resolveSuiGrpcUrl,
} from '@/services/suiData/config'
import { getSuilendPositions } from '@/services/suilendService'
import { getScallopPositions } from '@/services/scallopLendingService'
import { getCetusPositions } from '@/services/cetusService'
import { getCetusDlmmPositions } from '@/services/cetusDlmmLazy'
import { getBluefinSpotPositions } from '@/services/bluefinService'
import { getMomentumPositions } from '@/services/momentumService'
import { getTurbosPositions } from '@/services/turbosService'
import { scanUnsupportedInventory } from '@/services/unsupportedLpService'
import { fetchClosedFromAdapters } from '@/services/positionService'
import { enrichAllBluefinOpenPositions } from '@/services/enrichment'
import { enrichAllCetusOpenPositions } from '@/services/cetusOpenEnrichment'
import { scanTurbosPositionEvents } from '@/services/turbosLpEvents'
import { enrichBluefinOpenPositionWithEvents } from '@/services/bluefinEnrichment'
import type { OpenPosition } from '@/types'
import { DEX_ADAPTERS } from '@/services/adapters'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(__dirname, 'regression_fixture_v2.json')

type SourceSt = { status: 'ok' | 'error' | 'partial'; error?: string; host?: string; method?: string }

type LiveWalletRow = {
	id: string
	address: string
	sources: Record<string, SourceSt>
	incomplete: boolean
	harness_step_error?: boolean
	walletFatal?: string
	suilendSuppliedUsd?: number
	suilendBorrowedUsd?: number
	suilendIncomplete?: boolean
	suilendIncompleteReason?: string
	scallopSupplySui?: number
	scallopBorrowSui?: number
	scallopIncomplete?: boolean
	closed: Record<string, number>
	closedTruncated: Record<string, boolean>
	positions: Array<{
		id: string
		protocol: string
		liquidity: string | number
		depositedUSD: number
		historyPartial?: boolean
	}>
	silentDepositZeros: string[]
}

function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e)
}

async function probeTransport(): Promise<{ ok: true } | { ok: false; detail: string }> {
	const grpcUrl = resolveSuiGrpcUrl()
	const gqlUrl = process.env.SUI_GRAPHQL_URL?.trim() || MYSTEN_PUBLIC_GRAPHQL_URL
	try {
		const res = await fetch(gqlUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ query: '{ chainIdentifier }' }),
		})
		if (!res.ok) {
			return {
				ok: false,
				detail: `GraphQL ${gqlUrl} HTTP ${res.status} (method POST { chainIdentifier })`,
			}
		}
		const json = (await res.json()) as { errors?: unknown[] }
		if (json.errors?.length) {
			return {
				ok: false,
				detail: `GraphQL ${gqlUrl} returned errors for { chainIdentifier }`,
			}
		}
	} catch (e) {
		return {
			ok: false,
			detail: `GraphQL ${gqlUrl} unreachable: ${errMsg(e)}`,
		}
	}

	try {
		// Force shared gRPC client init + one object read via dashboard transport.
		getDashboardGrpcClient()
		const { suiClient } = await import('@/services/suiClient')
		await suiClient.getObject({ id: '0x6', options: { showType: true } })
	} catch (e) {
		return {
			ok: false,
			detail: `gRPC ${grpcUrl} (suiClient.getObject 0x6 via getDashboardGrpcClient) failed: ${errMsg(e)}. JSON-RPC suix_* is not used.`,
		}
	}
	return { ok: true }
}

async function settleSource<T>(
	sources: Record<string, SourceSt>,
	name: string,
	host: string,
	method: string,
	fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
	try {
		const value = await fn()
		sources[name] = { status: 'ok', host, method }
		return { ok: true, value }
	} catch (e) {
		const error = errMsg(e)
		sources[name] = { status: 'error', error, host, method }
		return { ok: false, error }
	}
}

function silentZeros(positions: OpenPosition[]): string[] {
	return positions
		.filter(
			(p) =>
				Number(p.liquidity) > 0 &&
				Number(p.depositedUSD) === 0 &&
				p.historyPartial !== true,
		)
		.map((p) => p.id)
}

function scallopSuiAmounts(snap: Awaited<ReturnType<typeof getScallopPositions>>): {
	supply: number
	borrow: number
} {
	const supply = (snap.supplies ?? [])
		.filter((s) => /sui/i.test(s.asset) || s.coinType?.endsWith('::sui::SUI'))
		.reduce((a, s) => a + (Number.isFinite(s.currentAmount) ? s.currentAmount : 0), 0)
	const borrow = (snap.borrows ?? [])
		.filter((b) => /sui/i.test(b.asset) || b.coinType?.endsWith('::sui::SUI'))
		.reduce((a, b) => a + (Number.isFinite(b.currentDebt) ? b.currentDebt : 0), 0)
	return { supply, borrow }
}

function needsDepositEnrich(p: OpenPosition): boolean {
	return Number(p.liquidity) > 0 && Number(p.depositedUSD) === 0 && p.historyPartial !== true
}

async function enrichOpens(address: string, opens: OpenPosition[]): Promise<OpenPosition[]> {
	const byId = new Map(opens.map((p) => [p.id, { ...p }]))
	// Only enrich rows that would currently trip §8.4 (silent deposit=0).
	const candidates = opens.filter(needsDepositEnrich)
	if (!candidates.length) return opens

	const bfMmt = candidates.filter((p) => p.protocol === 'bluefin' || p.protocol === 'momentum')
	const cetus = candidates.filter((p) => p.protocol === 'cetus')
	const turbos = candidates.filter((p) => p.protocol === 'turbos')

	if (bfMmt.length) {
		try {
			const rows = await enrichAllBluefinOpenPositions(address, bfMmt)
			for (const r of rows) {
				const cur = byId.get(r.id)
				if (cur) byId.set(r.id, { ...cur, ...r.merged })
			}
		} catch {
			/* keep pre-enrich; §8.4 may FAIL — correct signal */
		}
	}
	if (cetus.length) {
		try {
			const rows = await enrichAllCetusOpenPositions(address, cetus)
			for (const r of rows) {
				const cur = byId.get(r.id)
				if (cur) byId.set(r.id, { ...cur, ...r.merged })
			}
		} catch {
			/* */
		}
	}
	if (turbos.length) {
		await Promise.all(
			turbos.map(async (p) => {
				try {
					const scan = await scanTurbosPositionEvents(
						address,
						p.id,
						p.turbosPositionObjectId ?? '',
						p.turbosOriginalDecimalsA ?? p.tokenADecimals,
						p.turbosOriginalDecimalsB ?? p.tokenBDecimals,
					)
					const enriched = await enrichBluefinOpenPositionWithEvents(p, scan.events, scan.partial)
					byId.set(p.id, { ...p, ...enriched.merged })
				} catch {
					/* */
				}
			}),
		)
	}
	return [...byId.values()]
}

async function loadWallet(id: string, address: string): Promise<LiveWalletRow> {
	const grpcHost = resolveSuiGrpcUrl()
	const gqlHost = process.env.SUI_GRAPHQL_URL?.trim() || MYSTEN_PUBLIC_GRAPHQL_URL
	const row: LiveWalletRow = {
		id,
		address,
		sources: {},
		incomplete: false,
		closed: {},
		closedTruncated: {},
		positions: [],
		silentDepositZeros: [],
	}

	const suilendR = await settleSource(row.sources, 'suilend', grpcHost, 'getSuilendPositions', () =>
		getSuilendPositions(address),
	)
	if (suilendR.ok) {
		const s = suilendR.value
		if (s.incomplete || s.error) {
			row.suilendIncomplete = true
			row.suilendIncompleteReason = s.error
			row.sources.suilend = {
				status: 'partial',
				error: s.error ?? 'incomplete',
				host: grpcHost,
				method: 'getSuilendPositions',
			}
			row.incomplete = true
		}
		row.suilendSuppliedUsd = s.totalSuppliedUSD
		row.suilendBorrowedUsd = s.totalBorrowedUSD
	} else {
		row.incomplete = true
		row.harness_step_error = true
	}

	const scallopR = await settleSource(row.sources, 'scallop', grpcHost, 'getScallopPositions', () =>
		getScallopPositions(address),
	)
	if (scallopR.ok) {
		const s = scallopR.value
		if (s.incomplete || s.error) {
			row.scallopIncomplete = true
			row.sources.scallop = {
				status: 'partial',
				error: s.error ?? 'incomplete',
				host: grpcHost,
				method: 'getScallopPositions',
			}
			row.incomplete = true
		}
		const amt = scallopSuiAmounts(s)
		row.scallopSupplySui = amt.supply
		row.scallopBorrowSui = amt.borrow
	} else {
		row.incomplete = true
		row.harness_step_error = true
	}

	const openLoaders: Array<[string, () => Promise<OpenPosition[]>]> = [
		['cetus-clmm', () => getCetusPositions(address)],
		['cetus-dlmm', () => getCetusDlmmPositions(address)],
		['bluefin', () => getBluefinSpotPositions(address)],
		['momentum', () => getMomentumPositions(address)],
		['turbos', () => getTurbosPositions(address)],
	]
	let opens: OpenPosition[] = []
	const openResults = await Promise.all(
		openLoaders.map(async ([name, fn]) => {
			const r = await settleSource(row.sources, name, grpcHost, name, fn)
			return { name, r }
		}),
	)
	for (const { r } of openResults) {
		if (r.ok) opens = opens.concat(r.value)
		else {
			row.incomplete = true
			row.harness_step_error = true
		}
	}

	const enrichHost = `${grpcHost}+${gqlHost}`
	const enrichR = await settleSource(row.sources, 'enrichment', enrichHost, 'enrichOpens', () =>
		enrichOpens(address, opens),
	)
	if (enrichR.ok) opens = enrichR.value
	else {
		row.incomplete = true
		row.harness_step_error = true
	}

	row.positions = opens.map((p) => ({
		id: p.id,
		protocol: p.protocol,
		liquidity: p.liquidity,
		depositedUSD: p.depositedUSD,
		historyPartial: p.historyPartial,
	}))
	row.silentDepositZeros = silentZeros(opens)

	const unsR = await settleSource(
		row.sources,
		'unsupported',
		grpcHost,
		'scanUnsupportedInventory',
		() => scanUnsupportedInventory(address),
	)
	if (unsR.ok) {
		if (unsR.value.incomplete) {
			row.incomplete = true
			row.sources.unsupported = {
				status: 'partial',
				error: unsR.value.reason ?? 'truncated',
				host: grpcHost,
				method: 'scanUnsupportedInventory',
			}
		}
	} else {
		row.incomplete = true
		row.harness_step_error = true
	}

	// Closed: per-adapter so truncation / errors stay attributable.
	for (const adapter of DEX_ADAPTERS) {
		const proto = adapter.protocol
		const r = await settleSource(
			row.sources,
			`closed:${proto}`,
			gqlHost,
			`${proto}.getClosedPositions`,
			() => adapter.getClosedPositions(address),
		)
		if (r.ok) {
			row.closed[proto] = r.value.length
			const truncated = r.value.some((c) => (c as { historyPartial?: boolean }).historyPartial === true)
			if (truncated) {
				row.closedTruncated[proto] = true
				row.incomplete = true
				row.sources[`closed:${proto}`] = {
					status: 'partial',
					error: 'historyPartial on closed rows',
					host: gqlHost,
					method: `${proto}.getClosedPositions`,
				}
			}
		} else {
			row.incomplete = true
			row.harness_step_error = true
		}
	}

	// Also record aggregate fetch for parity logging (does not replace per-adapter counts).
	await settleSource(row.sources, 'closed:all', gqlHost, 'fetchClosedFromAdapters', () =>
		fetchClosedFromAdapters(address),
	)

	return row
}

async function main() {
	if (!existsSync(fixturePath)) {
		console.error(`Missing ${fixturePath}`)
		process.exit(1)
	}
	const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as object
	const entries = walletEntries(fixture)
	const filter = process.env.REVIEW_FIXTURE_WALLET_IDS?.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
	const selected = filter?.length
		? entries.filter(([id]) => filter.includes(id))
		: entries

	console.log(
		`[review:fixture:live] gRPC ${resolveSuiGrpcUrl()} · GraphQL ${process.env.SUI_GRAPHQL_URL?.trim() || MYSTEN_PUBLIC_GRAPHQL_URL}`,
	)
	console.log(
		`[review:fixture:live] wallets ${selected.length}/${entries.length}` +
			(filter?.length ? ` (filter: ${filter.join(',')})` : ''),
	)

	const probe = await probeTransport()
	if (!probe.ok) {
		console.error(`[FAIL] network: ${probe.detail}`)
		console.error(
			`Default hosts: gRPC ${MYSTEN_PUBLIC_GRPC_URL} · GraphQL ${MYSTEN_PUBLIC_GRAPHQL_URL}`,
		)
		process.exit(1)
	}
	console.log('[PASS] network: gRPC + GraphQL reachable')

	const allVerdicts: Array<{ status: string; id: string; msg: string }> = []
	const results: Record<string, LiveWalletRow> = {}

	for (const [id, row] of selected) {
		const address = row.address as string
		if (!address) {
			const v = { status: 'FAIL' as const, id: `${id}/wallet`, msg: 'missing address in fixture' }
			printVerdict(v)
			allVerdicts.push(v)
			continue
		}
		process.stdout.write(`[live] ${id}… `)
		const t0 = Date.now()
		try {
			const live = await loadWallet(id, address)
			results[id] = live
			const verdicts = evaluateWallet(id, row, live)
			allVerdicts.push(...verdicts)
			const fails = verdicts.filter((v) => v.status === 'FAIL').length
			const inc = verdicts.filter((v) => v.status === 'INCONCLUSIVE').length
			console.log(
				`ok ${((Date.now() - t0) / 1000).toFixed(1)}s · verdicts ${verdicts.length} (fail=${fails} inconclusive=${inc})`,
			)
			for (const v of verdicts) printVerdict(v)
		} catch (e) {
			console.log('FAIL')
			const live: LiveWalletRow = {
				id,
				address,
				sources: {
					wallet: {
						status: 'error',
						error: errMsg(e),
						host: resolveSuiGrpcUrl(),
						method: 'loadWallet',
					},
				},
				incomplete: true,
				harness_step_error: true,
				walletFatal: errMsg(e),
				closed: {},
				closedTruncated: {},
				positions: [],
				silentDepositZeros: [],
			}
			results[id] = live
			const verdicts = evaluateWallet(id, row, live)
			allVerdicts.push(...verdicts)
			for (const v of verdicts) printVerdict(v)
		}
	}

	// Global §8.4 / §8.6 across dump (also covered per-wallet)
	const flatPositions = Object.values(results).flatMap((r) => r.positions)
	const globalSilent = checkSilentDepositZeros(
		{
			positions: flatPositions,
			silentDepositZeros: Object.values(results).flatMap((r) => r.silentDepositZeros),
		},
		'§8.4/global',
	)
	allVerdicts.push(...globalSilent)
	for (const v of globalSilent) printVerdict(v)

	const anyHarnessErr = Object.values(results).some((r) => r.harness_step_error)
	const globalSources = Object.fromEntries(
		Object.entries(results).flatMap(([wid, r]) =>
			Object.entries(r.sources).map(([k, st]) => [`${wid}:${k}`, st]),
		),
	)
	const globalSrc = checkSourceStatus(
		{
			sources: globalSources,
			harness_step_error: anyHarnessErr,
			incomplete: Object.values(results).some((r) => r.incomplete) || anyHarnessErr,
		},
		'§8.6/global',
	)
	allVerdicts.push(...globalSrc)
	for (const v of globalSrc) printVerdict(v)

	const dumpPath = process.env.REVIEW_FIXTURE_RESULTS_PATH?.trim()
	if (dumpPath) {
		writeFileSync(
			dumpPath,
			JSON.stringify(
				{ generatedAt: new Date().toISOString(), mode: 'live-dashboard', wallets: results },
				null,
				2,
			),
		)
		console.log(`[review:fixture:live] wrote ${dumpPath}`)
	}

	const sum = summarizeVerdicts(allVerdicts)
	console.log(
		`[review:fixture:live] summary PASS=${sum.pass} FAIL=${sum.fail} INCONCLUSIVE=${sum.inconclusive}`,
	)
	process.exit(sum.exitCode)
}

main().catch((e) => {
	console.error(`[FAIL] harness: ${errMsg(e)}`)
	process.exit(1)
})
