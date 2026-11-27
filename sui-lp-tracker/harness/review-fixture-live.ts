/**
 * Live §8 harness — dashboard services over gRPC + GraphQL.
 *
 * Modes:
 *   --quick (default)  PR smoke: Suilend/Scallop, closed first-page ≥ min, silent zeros; no full history.
 *   --full             Overnight: enrichment + full closed adapters + unsupported inventory.
 *   --wallets N05,W06  Subset filter.
 *
 * Parallel lanes (default 5), per-wallet timeout, host gate + retries, disk cache, stage timings.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
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
import { hydrateViteServerEnv, hasPythHermesAccessToken } from '../vite-server-env'
// hasPythHermesAccessToken: log-only; Suilend runs without Hermes via DefiLlama/reserve.price
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
import { enrichAllBluefinOpenPositions } from '@/services/enrichment'
import { enrichAllCetusOpenPositions } from '@/services/cetusOpenEnrichment'
import { scanTurbosPositionEvents } from '@/services/turbosLpEvents'
import { enrichBluefinOpenPositionWithEvents } from '@/services/bluefinEnrichment'
import { ensureLpWalletScanSession } from '@/services/lpScanSession'
import { getLastScanTimings, type ScanStepTiming } from '@/services/scanTiming'
import { querySenderAndMoveEventTypes } from '@/services/querySenderMoveEvents'
import { buildCetusTypedEventPaths } from '@/services/cetusLpEvents'
import { MOMENTUM_PUBLISHED_AT, PROTOCOL_PACKAGES } from '@/utils/constants'
import type { OpenPosition } from '@/types'
import { DEX_ADAPTERS } from '@/services/adapters'

hydrateViteServerEnv('production')

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(__dirname, 'regression_fixture_v2.json')
const cacheDir = join(__dirname, '.cache', 'fixture-live')

type SourceSt = {
	status: 'ok' | 'error' | 'partial' | 'skipped'
	error?: string
	host?: string
	method?: string
}

type StageMs = Record<string, number>

type LiveWalletRow = {
	id: string
	address: string
	mode: 'quick' | 'full'
	sources: Record<string, SourceSt>
	incomplete: boolean
	harness_step_error?: boolean
	walletFatal?: string
	walletTimeout?: boolean
	walletTimeoutMs?: number
	/** `[scan] step=…` timings from ensureLpWalletScanSession / enrichment. */
	scanTimings?: ScanStepTiming[]
	suilendSuppliedUsd?: number
	suilendBorrowedUsd?: number
	suilendIncomplete?: boolean
	suilendIncompleteReason?: string
	suilendSkipped?: boolean
	suilendSkipReason?: string
	scallopSupplySui?: number
	scallopBorrowSui?: number
	scallopIncomplete?: boolean
	closed: Record<string, number>
	closedTruncated: Record<string, boolean>
	/** Fresh GraphQL closed floors per protocol (for relative §8.3 mins). */
	closedGraphqlFloor: Record<string, number>
	positions: Array<{
		id: string
		protocol: string
		liquidity: string | number
		depositedUSD: number
		historyPartial?: boolean
	}>
	silentDepositZeros: string[]
	stageMs?: StageMs
	elapsedMs?: number
	fromCache?: boolean
	checkpoint?: string | number
}

type CliOpts = {
	mode: 'quick' | 'full'
	wallets: string[] | null
	lanes: number
	walletTimeoutMs: number
	dumpPath: string
}

function parseArgs(argv: string[]): CliOpts {
	const args = argv.slice(2)
	let mode: 'quick' | 'full' = 'quick'
	let wallets: string[] | null = null
	let lanes = Number(process.env.REVIEW_FIXTURE_LANES ?? 5)
	let walletTimeoutMs = Number(process.env.REVIEW_FIXTURE_WALLET_TIMEOUT_MS ?? 240_000)
	let dumpPath =
		process.env.REVIEW_FIXTURE_RESULTS_PATH?.trim() || join(__dirname, 'last-live-results.json')

	for (let i = 0; i < args.length; i++) {
		const a = args[i]!
		if (a === '--full') mode = 'full'
		else if (a === '--quick') mode = 'quick'
		else if (a === '--wallets' && args[i + 1]) {
			wallets = args[++i]!.split(',').map((s) => s.trim()).filter(Boolean)
		} else if (a.startsWith('--wallets=')) {
			wallets = a.slice('--wallets='.length).split(',').map((s) => s.trim()).filter(Boolean)
		} else if (a === '--lanes' && args[i + 1]) {
			lanes = Math.max(1, Math.min(8, Number(args[++i])))
		} else if (a === '--timeout-ms' && args[i + 1]) {
			walletTimeoutMs = Math.max(30_000, Number(args[++i]))
		} else if (a === '--dump' && args[i + 1]) {
			dumpPath = args[++i]!
		}
	}
	const envIds = process.env.REVIEW_FIXTURE_WALLET_IDS?.split(',').map((s) => s.trim()).filter(Boolean)
	if (!wallets?.length && envIds?.length) wallets = envIds
	if (!Number.isFinite(lanes) || lanes < 1) lanes = 5
	if (!Number.isFinite(walletTimeoutMs)) walletTimeoutMs = 240_000
	return { mode, wallets, lanes, walletTimeoutMs, dumpPath }
}

function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e)
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms))
}

/** Host-level concurrency gate + retries for 429/5xx/401. */
function createHostGate(limit: number) {
	let active = 0
	const waiters: Array<() => void> = []
	async function acquire() {
		if (active < limit) {
			active += 1
			return
		}
		await new Promise<void>((resolve) => waiters.push(resolve))
		active += 1
	}
	function release() {
		active = Math.max(0, active - 1)
		const next = waiters.shift()
		if (next) next()
	}
	const run = async <T>(fn: () => Promise<T>, label: string): Promise<T> => {
		let lastErr: unknown
		for (let attempt = 0; attempt < 4; attempt++) {
			await acquire()
			try {
				const v = await fn()
				release()
				return v
			} catch (e) {
				release()
				lastErr = e
				const msg = errMsg(e)
				const retryable = /429|5\d\d|401|rate|timeout|ECONNRESET|fetch failed/i.test(msg)
				if (!retryable || attempt === 3) throw e
				const backoff = Math.min(8_000, 400 * 2 ** attempt) + Math.floor(Math.random() * 200)
				console.warn(`[gate] retry ${label} attempt=${attempt + 1} in ${backoff}ms: ${msg.slice(0, 120)}`)
				await sleep(backoff)
			}
		}
		throw lastErr
	}
	return { run }
}

const gqlGate = createHostGate(Number(process.env.REVIEW_FIXTURE_GQL_CONCURRENCY ?? 3))
const grpcGate = createHostGate(Number(process.env.REVIEW_FIXTURE_GRPC_CONCURRENCY ?? 4))

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			p,
			new Promise<T>((_, rej) => {
				timer = setTimeout(() => rej(new Error(`TIMEOUT ${label} after ${ms}ms`)), ms)
			}),
		])
	} finally {
		if (timer) clearTimeout(timer)
	}
}

async function gql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
	const url = process.env.SUI_GRAPHQL_URL?.trim() || MYSTEN_PUBLIC_GRAPHQL_URL
	return gqlGate.run(async () => {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ query, variables }),
		})
		if (!res.ok) throw new Error(`GraphQL HTTP ${res.status} ${url}`)
		const json = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> }
		if (json.errors?.length) throw new Error(json.errors[0]?.message ?? 'GraphQL error')
		return json.data as T
	}, 'graphql')
}

async function fetchCheckpoint(): Promise<string> {
	try {
		const data = await gql<{ checkpoint?: { sequenceNumber?: string } }>(
			`{ checkpoint { sequenceNumber } }`,
		)
		return String(data?.checkpoint?.sequenceNumber ?? `day:${new Date().toISOString().slice(0, 10)}`)
	} catch {
		return `day:${new Date().toISOString().slice(0, 10)}`
	}
}

function cachePath(walletId: string, mode: string, checkpoint: string): string {
	const safe = checkpoint.replace(/[^\w.-]+/g, '_')
	return join(cacheDir, `${walletId}_${mode}_${safe}.json`)
}

function readCache(walletId: string, mode: string, checkpoint: string): LiveWalletRow | null {
	const p = cachePath(walletId, mode, checkpoint)
	if (!existsSync(p)) return null
	try {
		return JSON.parse(readFileSync(p, 'utf8')) as LiveWalletRow
	} catch {
		return null
	}
}

function writeCache(row: LiveWalletRow, checkpoint: string): void {
	mkdirSync(cacheDir, { recursive: true })
	writeFileSync(cachePath(row.id, row.mode, checkpoint), JSON.stringify(row))
}

async function probeTransport(): Promise<{ ok: true } | { ok: false; detail: string }> {
	const grpcUrl = resolveSuiGrpcUrl()
	const gqlUrl = process.env.SUI_GRAPHQL_URL?.trim() || MYSTEN_PUBLIC_GRAPHQL_URL
	try {
		await gql('{ chainIdentifier }')
	} catch (e) {
		return { ok: false, detail: `GraphQL ${gqlUrl}: ${errMsg(e)}` }
	}
	try {
		getDashboardGrpcClient()
		const { suiClient } = await import('@/services/suiClient')
		await grpcGate.run(
			() => suiClient.getObject({ id: '0x6', options: { showType: true } }),
			'grpc-probe',
		)
	} catch (e) {
		return {
			ok: false,
			detail: `gRPC ${grpcUrl} (suiClient.getObject 0x6): ${errMsg(e)}`,
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
	gate: 'grpc' | 'gql' | 'none' = 'none',
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
	try {
		const run = gate === 'grpc' ? grpcGate.run : gate === 'gql' ? gqlGate.run : async (f: () => Promise<T>) => f()
		const value = await run(fn, name)
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
			/* */
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

/** Quick closed: first page per typed close Move path (SenderAndMoveEventType). */
function quickClosedTypePaths(): Record<string, string[]> {
	const cetus = buildCetusTypedEventPaths().filter((p) => p.endsWith('::ClosePositionEvent'))
	const bfPkgs = [PROTOCOL_PACKAGES.BLUEFIN_CLMM, PROTOCOL_PACKAGES.BLUEFIN_SPOT]
	const bluefin = bfPkgs.map((pkg) => `${pkg}::events::PositionClosed`)
	const mmtPkgs = [MOMENTUM_PUBLISHED_AT, PROTOCOL_PACKAGES.MOMENTUM_CLMM]
	const momentum = mmtPkgs.map((pkg) => `${pkg}::liquidity::ClosePositionEvent`)
	const turbosStructs = ['BurnEvent', 'ClosePositionEvent', 'BurnNftEvent', 'BurnPositionEvent']
	const turbosPkgs = [PROTOCOL_PACKAGES.TURBOS, PROTOCOL_PACKAGES.TURBOS_PUBLISHED_AT]
	const turbos = turbosPkgs.flatMap((pkg) =>
		turbosStructs.flatMap((s) => [
			`${pkg}::pool::${s}`,
			`${pkg}::position_manager::${s}`,
			`${pkg}::position::${s}`,
		]),
	)
	return { cetus, bluefin, momentum, turbos }
}

async function timed<T>(stages: StageMs, name: string, fn: () => Promise<T>): Promise<T> {
	const t0 = Date.now()
	try {
		return await fn()
	} finally {
		stages[name] = (stages[name] ?? 0) + (Date.now() - t0)
	}
}

async function loadWallet(
	id: string,
	address: string,
	mode: 'quick' | 'full',
	checkpoint: string,
): Promise<LiveWalletRow> {
	const grpcHost = resolveSuiGrpcUrl()
	const gqlHost = process.env.SUI_GRAPHQL_URL?.trim() || MYSTEN_PUBLIC_GRAPHQL_URL
	const stages: StageMs = {}
	const row: LiveWalletRow = {
		id,
		address,
		mode,
		sources: {},
		incomplete: false,
		closed: {},
		closedTruncated: {},
		closedGraphqlFloor: {},
		positions: [],
		silentDepositZeros: [],
		checkpoint,
	}

	const cached = readCache(id, mode, checkpoint)
	if (cached && cached.address === address) {
		return { ...cached, fromCache: true, stageMs: { ...(cached.stageMs ?? {}), cacheHit: 0 } }
	}

	// ── Suilend (Hermes optional — service falls back to DefiLlama / reserve.price) ─
	await timed(stages, 'suilend', async () => {
		const r = await settleSource(
			row.sources,
			'suilend',
			grpcHost,
			'getSuilendPositions',
			() => getSuilendPositions(address),
			'grpc',
		)
		if (r.ok) {
			const s = r.value
			if (s.incomplete || s.error) {
				const err = s.error ?? 'incomplete'
				row.suilendIncomplete = true
				row.suilendIncompleteReason = err
				row.sources.suilend = {
					status: 'error',
					error: err,
					host: grpcHost,
					method: 'getSuilendPositions',
				}
				row.incomplete = true
				row.harness_step_error = true
			}
			row.suilendSuppliedUsd = s.totalSuppliedUSD
			row.suilendBorrowedUsd = s.totalBorrowedUSD
		} else {
			row.incomplete = true
			row.harness_step_error = true
		}
	})

	// ── Scallop ────────────────────────────────────────────────────────────
	await timed(stages, 'scallop', async () => {
		const r = await settleSource(
			row.sources,
			'scallop',
			grpcHost,
			'getScallopPositions',
			() => getScallopPositions(address),
			'grpc',
		)
		if (r.ok) {
			const s = r.value
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
	})

	// ── Open LP (parallel protocols) ───────────────────────────────────────
	let opens: OpenPosition[] = []
	await timed(stages, 'opens', async () => {
		const openLoaders: Array<[string, () => Promise<OpenPosition[]>]> = [
			['cetus-clmm', () => getCetusPositions(address)],
			['cetus-dlmm', () => getCetusDlmmPositions(address)],
			['bluefin', () => getBluefinSpotPositions(address)],
			['momentum', () => getMomentumPositions(address)],
			['turbos', () => getTurbosPositions(address)],
		]
		const openResults = await Promise.all(
			openLoaders.map(async ([name, fn]) => {
				const r = await settleSource(row.sources, name, grpcHost, name, fn, 'grpc')
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
	})

	// ── Enrichment (full only) ─────────────────────────────────────────────
	if (mode === 'full') {
		await timed(stages, 'scanSession', async () => {
			const r = await settleSource(
				row.sources,
				'scanSession',
				`${grpcHost}+${gqlHost}`,
				'ensureLpWalletScanSession',
				() => ensureLpWalletScanSession(address, { forceRefresh: false }),
			)
			if (!r.ok) {
				row.incomplete = true
				row.harness_step_error = true
			} else if (r.value?.timings?.length) {
				row.scanTimings = [...r.value.timings]
			} else {
				row.scanTimings = [...getLastScanTimings()]
			}
		})
		await timed(stages, 'enrichment', async () => {
			const r = await settleSource(
				row.sources,
				'enrichment',
				`${grpcHost}+${gqlHost}`,
				'enrichOpens',
				() => enrichOpens(address, opens),
			)
			if (r.ok) opens = r.value
			else {
				row.incomplete = true
				row.harness_step_error = true
			}
			const after = getLastScanTimings()
			if (after.length) {
				const prev = row.scanTimings ?? []
				const seen = new Set(prev.map((t) => `${t.step}|${t.ms}|${t.source}`))
				row.scanTimings = [
					...prev,
					...after.filter((t) => !seen.has(`${t.step}|${t.ms}|${t.source}`)),
				]
			}
		})
	} else {
		// Without history enrichment, deposit=0 is unknown — not a proven silent zero.
		opens = opens.map((p) => (needsDepositEnrich(p) ? { ...p, historyPartial: true } : p))
		row.sources.scanSession = {
			status: 'skipped',
			error: 'quick mode',
			host: gqlHost,
			method: 'ensureLpWalletScanSession',
		}
		row.sources.enrichment = {
			status: 'skipped',
			error: 'quick mode',
			host: gqlHost,
			method: 'enrichOpens',
		}
	}

	row.positions = opens.map((p) => ({
		id: p.id,
		protocol: p.protocol,
		liquidity: p.liquidity,
		depositedUSD: p.depositedUSD,
		historyPartial: p.historyPartial,
	}))
	row.silentDepositZeros = silentZeros(opens)

	// ── Unsupported (full only; quick skips inventory walk) ────────────────
	if (mode === 'full') {
		await timed(stages, 'unsupported', async () => {
			const r = await settleSource(
				row.sources,
				'unsupported',
				grpcHost,
				'scanUnsupportedInventory',
				() => scanUnsupportedInventory(address),
				'grpc',
			)
			if (r.ok && r.value.incomplete) {
				row.incomplete = true
				row.sources.unsupported = {
					status: 'partial',
					error: r.value.reason ?? 'truncated',
					host: grpcHost,
					method: 'scanUnsupportedInventory',
				}
			} else if (!r.ok) {
				row.incomplete = true
				row.harness_step_error = true
			}
		})
	} else {
		row.sources.unsupported = {
			status: 'skipped',
			error: 'quick mode',
			host: grpcHost,
			method: 'scanUnsupportedInventory',
		}
	}

	// ── Closed ─────────────────────────────────────────────────────────────
	await timed(stages, 'closed', async () => {
		if (mode === 'quick') {
			const pathsByProto = quickClosedTypePaths()
			await Promise.all(
				Object.entries(pathsByProto).map(async ([proto, paths]) => {
					const r = await settleSource(
						row.sources,
						`closed:${proto}`,
						gqlHost,
						'SenderAndMoveEventType(first page)',
						() =>
							querySenderAndMoveEventTypes(address, paths, {
								maxPagesPerType: 1,
								pageSize: 50,
								typeConcurrency: 3,
							}),
						'gql',
					)
					if (!r.ok) {
						row.incomplete = true
						row.harness_step_error = true
						return
					}
					// Prefer unique position id from parsedJson; else event rows.
					const posIds = new Set<string>()
					for (const e of r.value.events) {
						const pj = (e.parsedJson ?? {}) as Record<string, unknown>
						const raw =
							(typeof pj.position === 'string' && pj.position) ||
							(typeof pj.position_id === 'string' && pj.position_id) ||
							(typeof pj.positionId === 'string' && pj.positionId) ||
							(typeof pj.id === 'string' && pj.id) ||
							null
						if (raw) posIds.add(raw)
					}
					row.closed[proto] = posIds.size > 0 ? posIds.size : r.value.events.length
					const truncated = r.value.partial === true
					row.closedTruncated[proto] = truncated
					if (truncated) {
						row.incomplete = true
						row.sources[`closed:${proto}`] = {
							status: 'partial',
							error: 'first page only',
							host: gqlHost,
							method: 'SenderAndMoveEventType(first page)',
						}
					}
				}),
			)
		} else {
			// Sequential closed adapters — parallel BF+MMT+Cetus+Turbos stampede causes
			// gRPC cooldown and N09-class wallet TIMEOUTs under multi-lane full runs.
			for (const adapter of DEX_ADAPTERS) {
				const proto = adapter.protocol
				const r = await settleSource(
					row.sources,
					`closed:${proto}`,
					gqlHost,
					`${proto}.getClosedPositions`,
					() => adapter.getClosedPositions(address),
					'gql',
				)
				if (r.ok) {
					const result = r.value
					row.closed[proto] = result.positions.length
					if (
						typeof result.graphqlClosedFloor === 'number' &&
						Number.isFinite(result.graphqlClosedFloor)
					) {
						row.closedGraphqlFloor[proto] = result.graphqlClosedFloor
					}
					const rowPartial = result.positions.some((c) => c.partialHistory === true)
					const truncated = result.incomplete === true || rowPartial
					if (truncated) {
						row.closedTruncated[proto] = true
						row.incomplete = true
						row.sources[`closed:${proto}`] = {
							status: 'partial',
							error: result.reason ?? 'closed_scan_incomplete',
							host: gqlHost,
							method: `${proto}.getClosedPositions`,
						}
					}
				} else {
					row.incomplete = true
					row.closedTruncated[proto] = true
					row.harness_step_error = true
				}
			}
		}
	})

	row.stageMs = stages
	writeCache(row, checkpoint)
	return row
}

function formatEta(done: number, total: number, elapsedMs: number): string {
	if (done <= 0) return 'ETA ?'
	const per = elapsedMs / done
	const left = Math.max(0, total - done) * per
	const sec = Math.round(left / 1000)
	if (sec < 60) return `ETA ~${sec}s`
	return `ETA ~${Math.round(sec / 60)}m`
}

function writeDump(path: string, payload: unknown): void {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, JSON.stringify(payload, null, 2))
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length)
	let next = 0
	async function worker() {
		for (;;) {
			const i = next++
			if (i >= items.length) return
			out[i] = await fn(items[i]!, i)
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
	return out
}

async function main() {
	const opts = parseArgs(process.argv)
	if (!existsSync(fixturePath)) {
		console.error(`Missing ${fixturePath}`)
		process.exit(1)
	}
	const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as object
	const entries = walletEntries(fixture)
	const selected = opts.wallets?.length
		? entries.filter(([id]) => opts.wallets!.includes(id))
		: entries

	console.log(
		`[review:fixture:live] mode=${opts.mode} lanes=${opts.lanes} timeout=${opts.walletTimeoutMs}ms`,
	)
	console.log(
		`[review:fixture:live] gRPC ${resolveSuiGrpcUrl()} · GraphQL ${process.env.SUI_GRAPHQL_URL?.trim() || MYSTEN_PUBLIC_GRAPHQL_URL}`,
	)
	console.log(
		`[review:fixture:live] hermesKey=${hasPythHermesAccessToken() ? 'yes' : 'no'} · wallets ${selected.length}/${entries.length}` +
			(opts.wallets?.length ? ` (filter: ${opts.wallets.join(',')})` : ''),
	)

	const probe = await probeTransport()
	if (!probe.ok) {
		console.error(`[FAIL] network: ${probe.detail}`)
		console.error(`Default hosts: gRPC ${MYSTEN_PUBLIC_GRPC_URL} · GraphQL ${MYSTEN_PUBLIC_GRAPHQL_URL}`)
		process.exit(1)
	}
	console.log('[PASS] network: gRPC + GraphQL reachable')

	const checkpoint = await fetchCheckpoint()
	console.log(`[review:fixture:live] checkpoint=${checkpoint}`)

	const allVerdicts: Array<{ status: string; id: string; msg: string }> = []
	const results: Record<string, LiveWalletRow> = {}
	const runStarted = Date.now()
	let completed = 0

	await mapPool(selected, opts.lanes, async ([id, row]) => {
		const address = row.address as string
		if (!address) {
			const v = { status: 'FAIL' as const, id: `${id}/wallet`, msg: 'missing address in fixture' }
			printVerdict(v)
			allVerdicts.push(v)
			completed += 1
			return
		}
		const t0 = Date.now()
		console.log(`[live] ${id} start… (${formatEta(completed, selected.length, Date.now() - runStarted)})`)
		try {
			const live = await withTimeout(
				loadWallet(id, address, opts.mode, checkpoint),
				opts.walletTimeoutMs,
				id,
			)
			live.elapsedMs = Date.now() - t0
			results[id] = live
			const verdicts = evaluateWallet(id, row, live)
			allVerdicts.push(...verdicts)
			const fails = verdicts.filter((v) => v.status === 'FAIL').length
			const stages = Object.entries(live.stageMs ?? {})
				.map(([k, v]) => `${k}=${(v / 1000).toFixed(1)}s`)
				.join(' ')
			const topScan = [...(live.scanTimings ?? [])]
				.sort((a, b) => b.ms - a.ms)
				.slice(0, 5)
				.map((t) => `${t.step}=${t.ms}ms/${t.source}`)
				.join(' ')
			console.log(
				`[live] ${id} done ${(live.elapsedMs / 1000).toFixed(1)}s` +
					(live.fromCache ? ' (cache)' : '') +
					` · fail=${fails}` +
					(stages ? ` · ${stages}` : ''),
			)
			if (topScan) console.log(`[live] ${id} top-scan ${topScan}`)
			for (const v of verdicts) printVerdict(v)
		} catch (e) {
			const msg = errMsg(e)
			const isTimeout = /^TIMEOUT/i.test(msg)
			const live: LiveWalletRow = {
				id,
				address,
				mode: opts.mode,
				sources: {
					wallet: {
						status: 'error',
						error: msg,
						host: resolveSuiGrpcUrl(),
						method: 'loadWallet',
					},
				},
				incomplete: true,
				harness_step_error: true,
				walletFatal: isTimeout ? undefined : msg,
				walletTimeout: isTimeout,
				walletTimeoutMs: opts.walletTimeoutMs,
				closed: {},
				closedTruncated: {},
				closedGraphqlFloor: {},
				positions: [],
				silentDepositZeros: [],
				elapsedMs: Date.now() - t0,
				checkpoint,
			}
			results[id] = live
			const verdicts = evaluateWallet(id, row, live)
			allVerdicts.push(...verdicts)
			console.log(`[live] ${id} ${isTimeout ? 'TIMEOUT' : 'FAIL'} after ${((Date.now() - t0) / 1000).toFixed(1)}s`)
			for (const v of verdicts) printVerdict(v)
		}

		completed += 1
		writeDump(opts.dumpPath, {
			generatedAt: new Date().toISOString(),
			mode: opts.mode,
			checkpoint,
			progress: { completed, total: selected.length },
			wallets: results,
		})
		console.log(
			`[progress] ${completed}/${selected.length} · ${formatEta(completed, selected.length, Date.now() - runStarted)} · dump ${opts.dumpPath}`,
		)
	})

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

	writeDump(opts.dumpPath, {
		generatedAt: new Date().toISOString(),
		mode: opts.mode,
		checkpoint,
		progress: { completed: selected.length, total: selected.length },
		wallets: results,
		verdicts: allVerdicts,
	})

	const sum = summarizeVerdicts(allVerdicts)
	const totalSec = ((Date.now() - runStarted) / 1000).toFixed(1)
	console.log(
		`[review:fixture:live] summary PASS=${sum.pass} FAIL=${sum.fail} INCONCLUSIVE=${sum.inconclusive} SKIPPED=${sum.skipped} · ${totalSec}s`,
	)

	const globalTop = Object.values(results)
		.flatMap((r) =>
			(r.scanTimings ?? []).map((t) => ({
				wallet: r.id,
				step: t.step,
				ms: t.ms,
				source: t.source,
			})),
		)
		.sort((a, b) => b.ms - a.ms)
		.slice(0, 5)
	if (globalTop.length) {
		console.log('[review:fixture:live] top-5 slowest scanSession steps:')
		for (const t of globalTop) {
			console.log(`  ${t.wallet} ${t.step} ms=${t.ms} source=${t.source}`)
		}
	}
	process.exit(sum.exitCode)
}

main().catch((e) => {
	console.error(`[FAIL] harness: ${errMsg(e)}`)
	process.exit(1)
})
