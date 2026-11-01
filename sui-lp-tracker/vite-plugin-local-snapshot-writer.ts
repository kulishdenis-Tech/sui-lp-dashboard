import type { Plugin, ViteDevServer } from 'vite'
import { hydrateViteServerEnv } from './vite-server-env.ts'

/** Same cadence replacement for Vercel cron while `vite` is up. */
const INTERVAL_MS = 2 * 60 * 60 * 1000
/** Avoid blocking/competing with startup; first run ~45s after listen. */
const FIRST_DELAY_MS = 45_000
const PRUNE_MS = 90 * 24 * 60 * 60 * 1000
/** Skip a wallet when a snapshot exists within this window (overlap with Edge/GHA). */
const DEDUPE_MS = 90 * 60 * 1000
const ENDPOINT = '/api/dev/portfolio-snapshot'

type SnapshotResult = { wallet: string; ok: boolean; totalUSD?: number; error?: string }

type RunPayload = {
	ok: boolean
	wallets: number
	results: SnapshotResult[]
	pruned: number
	error?: string
}

type ConnectReq = {
	url?: string
	originalUrl?: string
	method?: string
	headers: Record<string, string | string[] | undefined>
}

type ConnectRes = {
	statusCode: number
	setHeader: (k: string, v: string) => void
	end: (s: string) => void
}

function pathnameOf(url: string): string {
	return url.split('?')[0] ?? url
}

function parseQuery(url: string): Record<string, string | string[] | undefined> {
	const qIndex = url.indexOf('?')
	if (qIndex < 0) return {}
	const params = new URLSearchParams(url.slice(qIndex + 1))
	const query: Record<string, string | string[] | undefined> = {}
	for (const key of new Set(params.keys())) {
		const all = params.getAll(key)
		query[key] = all.length <= 1 ? (all[0] ?? undefined) : all
	}
	return query
}

function authorizeLocalCron(req: ConnectReq): boolean {
	const secret = process.env.CRON_SECRET
	if (!secret) return process.env.NODE_ENV !== 'production'

	const auth = req.headers.authorization
	if (typeof auth === 'string' && auth === `Bearer ${secret}`) return true

	const raw = req.originalUrl ?? req.url ?? ''
	const q = parseQuery(raw).secret
	const fromQuery = Array.isArray(q) ? q[0] : q
	return fromQuery === secret
}

function isEndpoint(req: { url?: string; originalUrl?: string }): boolean {
	const raw = req.originalUrl ?? req.url ?? ''
	return pathnameOf(raw) === ENDPOINT
}

function json(res: ConnectRes, status: number, body: unknown) {
	res.statusCode = status
	res.setHeader('Content-Type', 'application/json')
	res.end(JSON.stringify(body))
}

/** Supabase PostgrestError is a plain object â€” `String(e)` â†’ `[object Object]`. */
function errMsg(e: unknown): string {
	if (e instanceof Error) return e.message
	if (e && typeof e === 'object') {
		const o = e as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown }
		if (
			'message' in o ||
			'code' in o ||
			'details' in o ||
			'hint' in o
		) {
			return JSON.stringify({
				message: o.message,
				code: o.code,
				details: o.details,
				hint: o.hint,
			})
		}
	}
	return String(e)
}

/**
 * Local portfolio snapshot writer for Vite dev.
 * - Interval: every 2h after a ~45s post-listen delay (no immediate heavy run).
 * - On-demand: POST /api/dev/portfolio-snapshot (Bearer CRON_SECRET or ?secret=).
 * Uses ssrLoadModule so Vite aliases match snapshot:once / advisor plugin.
 */
export function localSnapshotWriterPlugin(): Plugin {
	let intervalId: ReturnType<typeof setInterval> | null = null
	let firstTimeout: ReturnType<typeof setTimeout> | null = null
	let running = false
	let cleaned = false

	const clearTimers = () => {
		if (cleaned) return
		cleaned = true
		if (firstTimeout != null) {
			clearTimeout(firstTimeout)
			firstTimeout = null
		}
		if (intervalId != null) {
			clearInterval(intervalId)
			intervalId = null
		}
		console.log('[local-snapshot] timers cleared')
	}

	async function runSnapshots(server: ViteDevServer, reason: string, force = false): Promise<RunPayload> {
		if (running) {
			console.log(`[local-snapshot] skip (${reason}): already running`)
			return { ok: false, wallets: 0, results: [], pruned: 0, error: 'already running' }
		}
		running = true
		const started = Date.now()
		console.log(`[local-snapshot] start (${reason})`)
		try {
			hydrateViteServerEnv(server.config.mode)

			if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
				console.warn('[local-snapshot] skip: Supabase not configured')
				return { ok: false, wallets: 0, results: [], pruned: 0, error: 'Supabase not configured' }
			}

			const snapMod = await server.ssrLoadModule('/api/_lib/supabaseSnapshots.ts')
			const loadMod = await server.ssrLoadModule('/src/services/server/loadPortfolioSnapshot.ts')

			const listWatchedWalletsReadOnly = snapMod.listWatchedWalletsReadOnly as () => Promise<
				string[]
			>
			const upsertSnapshot = snapMod.upsertSnapshot as (
				snap: {
					id: string
					walletAddr: string
					hourBucket: number
					ts: number
					lpUSD: number
					aftermathUSD: number
					lendingNetUSD: number
					walletUSD: number
					totalUSD: number
					incomplete?: boolean
				},
				opts?: { touchWatchedWallets?: boolean },
			) => Promise<void>
			const getNewestSnapshotTsForWallet = snapMod.getNewestSnapshotTsForWallet as (
				wallet: string,
			) => Promise<number | null>
			const pruneSnapshotsOlderThan = snapMod.pruneSnapshotsOlderThan as (
				cutoffMs: number,
			) => Promise<number>
			const loadPortfolioSnapshotDetailed = loadMod.loadPortfolioSnapshotDetailed as (
				wallet: string,
			) => Promise<{
				incomplete: boolean
				snapshot: {
					id: string
					walletAddr: string
					hourBucket: number
					ts: number
					lpUSD: number
					aftermathUSD: number
					lendingNetUSD: number
					walletUSD: number
					totalUSD: number
					incomplete?: boolean
				} | null
			}>

			const wallets = await listWatchedWalletsReadOnly()
			const results: SnapshotResult[] = []

			// Sequential â€” parallel wallets hammer public RPC (429).
			for (const wallet of wallets) {
				try {
				if (!force) {
					const newest = await getNewestSnapshotTsForWallet(wallet)
					if (newest != null) {
						const ageMs = Date.now() - newest
						if (ageMs >= 0 && ageMs < DEDUPE_MS) {
							results.push({
								wallet,
								ok: true,
								error: `skipped_fresh ageMs=${ageMs}`,
							})
							console.log(
								`[local-snapshot] skip ${wallet.slice(0, 10)}… fresh ageMs=${ageMs}`,
							)
							continue
						}
					}
				}
					const full = await loadPortfolioSnapshotDetailed(wallet)
					if (full.incomplete || !full.snapshot || full.snapshot.incomplete) {
						results.push({
							wallet,
							ok: false,
							error: full.incomplete ? 'incomplete; complete bucket kept' : 'empty snapshot',
						})
						console.warn(
							`[local-snapshot] skip ${wallet.slice(0, 10)}â€¦ incomplete=${full.incomplete}`,
						)
					} else {
						const snap = full.snapshot
						// Explicit ClientPortfolioSnapshot fields â€” do not rely on spread extras (lpSources).
						await upsertSnapshot(
							{
								id: snap.id,
								walletAddr: snap.walletAddr,
								hourBucket: snap.hourBucket,
								ts: snap.ts,
								lpUSD: snap.lpUSD,
								aftermathUSD: snap.aftermathUSD,
								lendingNetUSD: snap.lendingNetUSD,
								walletUSD: snap.walletUSD,
								totalUSD: snap.totalUSD,
								incomplete: false,
							},
							{ touchWatchedWallets: false },
						)
						results.push({ wallet, ok: true, totalUSD: snap.totalUSD })
						console.log(
							`[local-snapshot] ${wallet.slice(0, 10)}â€¦ total=$${snap.totalUSD.toFixed(2)}`,
						)
					}
				} catch (e) {
					const msg = errMsg(e)
					results.push({ wallet, ok: false, error: msg })
					console.warn(`[local-snapshot] fail ${wallet.slice(0, 10)}â€¦: ${msg}`)
				}
			}

			const pruned = await pruneSnapshotsOlderThan(Date.now() - PRUNE_MS)
			const okCount = results.filter((r) => r.ok).length
			console.log(
				`[local-snapshot] done (${reason}) wallets=${results.length} ok=${okCount} pruned=${pruned} ${Date.now() - started}ms`,
			)
			return { ok: true, wallets: results.length, results, pruned }
		} catch (e) {
			const msg = errMsg(e)
			console.error(`[local-snapshot] error (${reason}): ${msg}`)
			return { ok: false, wallets: 0, results: [], pruned: 0, error: msg }
		} finally {
			running = false
		}
	}

	return {
		name: 'local-snapshot-writer',
		enforce: 'pre',
		configureServer(server) {
			hydrateViteServerEnv(server.config.mode)
			cleaned = false

			const handle = (req: ConnectReq, res: ConnectRes, next: () => void) => {
				if (!isEndpoint(req)) {
					next()
					return
				}
				const method = (req.method ?? 'GET').toUpperCase()
				if (method !== 'POST' && method !== 'GET') {
					json(res, 405, { error: 'method not allowed' })
					return
				}
				hydrateViteServerEnv(server.config.mode)
				if (!authorizeLocalCron(req)) {
					json(res, 401, { error: 'unauthorized' })
					return
				}
				const rawUrl = req.originalUrl ?? req.url ?? ''
				const force = parseQuery(rawUrl).force === '1'
				void runSnapshots(server, 'on-demand', force).then((payload) => {
					if (payload.error === 'Supabase not configured') {
						json(res, 503, { error: payload.error })
						return
					}
					if (payload.error && !payload.ok && payload.results.length === 0) {
						json(res, payload.error === 'already running' ? 409 : 500, payload)
						return
					}
					json(res, 200, payload)
				})
			}

			return () => {
				;(server.middlewares.stack as Array<{ route: string; handle: typeof handle }>).unshift({
					route: '',
					handle,
				})

				const http = server.httpServer
				if (http) {
					http.once('listening', () => {
						console.log(
							`[local-snapshot] armed: first run in ${FIRST_DELAY_MS / 1000}s, then every ${INTERVAL_MS / 3_600_000}h; POST ${ENDPOINT}`,
						)
						firstTimeout = setTimeout(() => {
							void runSnapshots(server, 'interval-first')
							intervalId = setInterval(() => {
								void runSnapshots(server, 'interval')
							}, INTERVAL_MS)
						}, FIRST_DELAY_MS)
					})
					http.once('close', clearTimers)
				}
			}
		},
	}
}

