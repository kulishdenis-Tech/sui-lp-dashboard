/**
 * Shared multi-RPC provider pool (dashboard + arbitrage).
 *
 * - Hard per-request timeout
 * - Fast failover across healthy providers
 * - Per-provider circuit breaker: CLOSED / OPEN / HALF_OPEN
 * - Quarantine + recovery probe
 */

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { normalizeSuiRpcUrl, resolveServerSuiRpcUrl } from '@/utils/suiRpcUrl'
import { RollingLatency } from '@/rpc/rollingLatency'

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface ProviderStats {
	url: string
	label: string
	requestCount: number
	successCount: number
	failureCount: number
	timeoutCount: number
	count429: number
	count5xx: number
	latency: { p50: number; p90: number; p95: number; count: number }
	lastSuccessAt: number | null
	lastFailureAt: number | null
	consecutiveFailures: number
	healthScore: number
	quarantinedUntil: number | null
	circuit: CircuitState
}

export interface RpcCallMeta {
	providerUrl: string
	providerLabel: string
	latencyMs: number
	failoverUsed: boolean
	providersTried: number
}

export interface RpcProviderPoolOptions {
	urls?: string[]
	timeoutMs?: number
	failuresBeforeQuarantine?: number
	quarantineMs?: number
	/** Extra attempts on the same provider before failing over (browser single-URL retry). */
	retriesPerProvider?: number
}

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_FAILURES_BEFORE_QUARANTINE = 2
/** Short — PublicNode/Suiet flap 502/503 for minutes, not hours (OpenChainBench ~72%). */
const DEFAULT_QUARANTINE_MS = 12_000
const HARD_DOWN_MS = 5 * 60_000
/** Public JSON-RPC nodes (OnFinality is 5 req/s) 429 when loadAll fans out. */
const MAX_IN_FLIGHT = 1
const MIN_GAP_MS = 300
const RATE_LIMIT_COOLDOWN_MS = 2_000
const RATE_LIMIT_PASSES = 4
/** EdgeApp-style: start 2nd provider if the first is still pending. */
const STAGGER_RACE_MS = 180
const HEALTH_PROBE_MS = 20_000

/** Permanently removed APIs — not transient gateway flaps. */
function isHardDownMessage(msg: string): boolean {
	return /no longer available|has been deprecated|Method not found|Unexpected status code: 403/i.test(
		msg,
	)
}

function shortLabel(url: string): string {
	try {
		const h = new URL(url).hostname
		return h.replace(/^www\./, '').slice(0, 28)
	} catch {
		return url.slice(0, 28)
	}
}

function classifyError(msg: string): 'timeout' | '429' | '5xx' | 'other' {
	if (/timeout|aborted|AbortError|ETIMEDOUT/i.test(msg)) return 'timeout'
	if (/429|rate limit|Too Many|too frequent/i.test(msg)) return '429'
	if (/\b5\d\d\b|502|503|504|Bad Gateway|Service Unavailable/i.test(msg)) return '5xx'
	return 'other'
}

function timedFetch(timeoutMs: number): typeof fetch {
	return async (input, init) => {
		const ctrl = new AbortController()
		const parent = init?.signal
		const onParentAbort = () => ctrl.abort()
		if (parent) {
			if (parent.aborted) ctrl.abort()
			else parent.addEventListener('abort', onParentAbort, { once: true })
		}
		const timer = setTimeout(() => ctrl.abort(), timeoutMs)
		try {
			return await fetch(input, { ...init, signal: ctrl.signal })
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			if (/abort/i.test(msg) || (e instanceof Error && e.name === 'AbortError')) {
				throw new Error(`RPC timeout after ${timeoutMs}ms`, { cause: e })
			}
			throw e
		} finally {
			clearTimeout(timer)
			parent?.removeEventListener('abort', onParentAbort)
		}
	}
}

class Provider {
	readonly url: string
	readonly label: string
	readonly client: SuiJsonRpcClient
	requestCount = 0
	successCount = 0
	failureCount = 0
	timeoutCount = 0
	count429 = 0
	count5xx = 0
	consecutiveFailures = 0
	lastSuccessAt: number | null = null
	lastFailureAt: number | null = null
	quarantinedUntil: number | null = null
	/** Skip this URL even in the all-providers fallback (dead gateway / removed API). */
	hardDownUntil: number | null = null
	circuit: CircuitState = 'CLOSED'
	readonly latency = new RollingLatency('rpc')

	constructor(url: string, timeoutMs: number) {
		this.url = url
		this.label = shortLabel(url)
		this.client = new SuiJsonRpcClient({
			url,
			network: 'mainnet',
			// @ts-expect-error mysten client accepts fetch in runtime options
			fetch: timedFetch(timeoutMs),
		})
	}

	healthScore(now = Date.now()): number {
		if (this.circuit === 'OPEN' && this.quarantinedUntil != null && now < this.quarantinedUntil) {
			return 0
		}
		const total = this.requestCount || 1
		const successRate = this.successCount / total
		const lat = this.latency.stats()
		const latPenalty = lat.p95 > 0 ? Math.min(1, lat.p95 / 3000) : 0
		const failPenalty = Math.min(1, this.consecutiveFailures / 5)
		return Math.max(0, Math.min(1, successRate * (1 - 0.4 * latPenalty) * (1 - 0.5 * failPenalty)))
	}

	isHardDown(now = Date.now()): boolean {
		return this.hardDownUntil != null && now < this.hardDownUntil
	}

	isUsable(now = Date.now()): boolean {
		this.maybeAdvanceCircuit(now)
		if (this.isHardDown(now)) return false
		return this.circuit === 'CLOSED' || this.circuit === 'HALF_OPEN'
	}

	maybeAdvanceCircuit(now = Date.now()): void {
		if (this.circuit === 'OPEN' && this.quarantinedUntil != null && now >= this.quarantinedUntil) {
			this.circuit = 'HALF_OPEN'
		}
	}

	recordSuccess(latencyMs: number): void {
		this.requestCount++
		this.successCount++
		this.consecutiveFailures = 0
		this.lastSuccessAt = Date.now()
		this.latency.push(latencyMs)
		this.quarantinedUntil = null
		this.hardDownUntil = null
		this.circuit = 'CLOSED'
	}

	recordFailure(err: unknown, failuresBeforeQuarantine: number, quarantineMs: number): void {
		this.requestCount++
		this.failureCount++
		this.consecutiveFailures++
		this.lastFailureAt = Date.now()
		const msg = err instanceof Error ? err.message : String(err)
		const kind = classifyError(msg)
		if (kind === 'timeout') this.timeoutCount++
		if (kind === '429') this.count429++
		if (kind === '5xx') this.count5xx++

		if (isHardDownMessage(msg)) {
			this.hardDownUntil = Date.now() + HARD_DOWN_MS
			this.openCircuit(HARD_DOWN_MS)
			return
		}
		if (this.circuit === 'HALF_OPEN') {
			this.openCircuit(quarantineMs)
			return
		}
		// 429 / 5xx / "no available nodes": soft quarantine so we retry soon when gateways recover.
		if (kind === '429' || kind === '5xx' || this.consecutiveFailures >= failuresBeforeQuarantine) {
			this.openCircuit(quarantineMs)
		}
	}

	openCircuit(quarantineMs: number): void {
		this.circuit = 'OPEN'
		this.quarantinedUntil = Date.now() + quarantineMs
	}

	snapshot(): ProviderStats {
		const lat = this.latency.stats()
		return {
			url: this.url,
			label: this.label,
			requestCount: this.requestCount,
			successCount: this.successCount,
			failureCount: this.failureCount,
			timeoutCount: this.timeoutCount,
			count429: this.count429,
			count5xx: this.count5xx,
			latency: { p50: lat.p50, p90: lat.p90, p95: lat.p95, count: lat.count },
			lastSuccessAt: this.lastSuccessAt,
			lastFailureAt: this.lastFailureAt,
			consecutiveFailures: this.consecutiveFailures,
			healthScore: this.healthScore(),
			quarantinedUntil: this.quarantinedUntil,
			circuit: this.circuit,
		}
	}
}

export class RpcProviderPool {
	private providers: Provider[]
	private preferredIndex = 0
	private inFlight = 0
	private nextStartAt = 0
	private readonly slotQueue: Array<() => void> = []
	private readonly timeoutMs: number
	private readonly failuresBeforeQuarantine: number
	private readonly quarantineMs: number
	private readonly retriesPerProvider: number
	/** Callbacks when active URL changes (Turbos SDK rebind). */
	private onUrlChange: Array<(url: string) => void> = []
	private healthTimer: ReturnType<typeof setInterval> | null = null

	constructor(opts?: RpcProviderPoolOptions) {
		this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
		this.failuresBeforeQuarantine =
			opts?.failuresBeforeQuarantine ?? DEFAULT_FAILURES_BEFORE_QUARANTINE
		this.quarantineMs = opts?.quarantineMs ?? DEFAULT_QUARANTINE_MS
		this.retriesPerProvider = Math.max(0, opts?.retriesPerProvider ?? 0)
		const urls = opts?.urls?.length ? opts.urls.map(normalizeSuiRpcUrl) : [resolveServerSuiRpcUrl()]
		this.providers = urls.map((u) => new Provider(u, this.timeoutMs))
		if (this.providers.length === 0) {
			this.providers = [new Provider(normalizeSuiRpcUrl(resolveServerSuiRpcUrl()), this.timeoutMs)]
		}
		this.startHealthProbe()
	}

	/** Quiet checkpoint ping — clears soft quarantine when a flapping node recovers. */
	private startHealthProbe(): void {
		if (typeof setInterval === 'undefined') return
		if (this.healthTimer != null) return
		this.healthTimer = setInterval(() => {
			void this.probeUnhealthyProviders()
		}, HEALTH_PROBE_MS)
		// Node / vitest: do not keep the process alive for background probes.
		if (typeof this.healthTimer === 'object' && this.healthTimer && 'unref' in this.healthTimer) {
			;(this.healthTimer as { unref: () => void }).unref()
		}
	}

	private async probeUnhealthyProviders(): Promise<void> {
		const now = Date.now()
		for (const p of this.providers) {
			if (p.isHardDown(now)) continue
			if (p.circuit === 'CLOSED' && p.consecutiveFailures === 0) continue
			try {
				const t0 = Date.now()
				await p.client.getLatestCheckpointSequenceNumber()
				p.recordSuccess(Date.now() - t0)
				const idx = this.providers.indexOf(p)
				if (idx >= 0) {
					this.preferredIndex = idx
					for (const cb of this.onUrlChange) cb(p.url)
				}
			} catch {
				/* stay quarantined */
			}
		}
	}

	onActiveUrlChange(cb: (url: string) => void): void {
		this.onUrlChange.push(cb)
	}

	urls(): string[] {
		return this.providers.map((p) => p.url)
	}

	activeUrl(): string {
		return this.pickOrder()[0]?.url ?? this.providers[0]!.url
	}

	activeClient(): SuiJsonRpcClient {
		const p = this.pickOrder()[0] ?? this.providers[0]!
		return p.client
	}

	getClientForUrl(url: string): SuiJsonRpcClient | null {
		return this.providers.find((p) => p.url === url)?.client ?? null
	}

	stats(): ProviderStats[] {
		return this.providers.map((p) => p.snapshot())
	}

	formatTable(): string {
		const rows = this.stats()
		const lines = [
			'RPC PROVIDERS',
			'provider'.padEnd(28) +
				'success%'.padStart(9) +
				'timeout'.padStart(8) +
				'429'.padStart(5) +
				'5xx'.padStart(5) +
				'p50'.padStart(7) +
				'p95'.padStart(7) +
				'  health  state',
		]
		for (const r of rows) {
			const pct =
				r.requestCount > 0
					? `${((100 * r.successCount) / r.requestCount).toFixed(1)}%`
					: 'n/a'
			lines.push(
				r.label.padEnd(28) +
					pct.padStart(9) +
					String(r.timeoutCount).padStart(8) +
					String(r.count429).padStart(5) +
					String(r.count5xx).padStart(5) +
					`${Math.round(r.latency.p50)}`.padStart(7) +
					`${Math.round(r.latency.p95)}`.padStart(7) +
					`  ${r.healthScore.toFixed(2).padStart(5)}  ${r.circuit}`,
			)
		}
		return lines.join('\n')
	}

	/** Keep public nodes under their request-per-second cap. */
	private acquireSlot(): Promise<void> {
		return new Promise((resolve) => {
			const start = () => {
				this.inFlight++
				const now = Date.now()
				const wait = Math.max(0, this.nextStartAt - now)
				this.nextStartAt = Math.max(this.nextStartAt, now) + MIN_GAP_MS
				if (wait === 0) resolve()
				else setTimeout(resolve, wait)
			}
			if (this.inFlight < MAX_IN_FLIGHT) start()
			else this.slotQueue.push(start)
		})
	}

	private releaseSlot(): void {
		this.inFlight = Math.max(0, this.inFlight - 1)
		const next = this.slotQueue.shift()
		if (next) next()
	}

	private deferAfterRateLimit(): void {
		this.nextStartAt = Math.max(this.nextStartAt, Date.now() + RATE_LIMIT_COOLDOWN_MS)
	}

	/** Ordered usable providers: preferred first, then by healthScore desc. */
	private pickOrder(now = Date.now()): Provider[] {
		for (const p of this.providers) p.maybeAdvanceCircuit(now)
		const alive = this.providers.filter((p) => !p.isHardDown(now))
		const base = alive.length > 0 ? alive : [...this.providers]
		const usable = base.filter((p) => p.isUsable(now))
		const pool = usable.length > 0 ? usable : base
		const preferred = this.providers[this.preferredIndex]
		pool.sort((a, b) => {
			if (preferred && a === preferred) return -1
			if (preferred && b === preferred) return 1
			if (a.circuit === 'HALF_OPEN' && b.circuit !== 'HALF_OPEN') return 1
			if (b.circuit === 'HALF_OPEN' && a.circuit !== 'HALF_OPEN') return -1
			return b.healthScore(now) - a.healthScore(now)
		})
		return pool
	}

	private markPreferred(p: Provider): void {
		const idx = this.providers.indexOf(p)
		if (idx < 0) return
		if (idx !== this.preferredIndex) {
			this.preferredIndex = idx
			for (const cb of this.onUrlChange) cb(p.url)
		} else {
			this.preferredIndex = idx
		}
	}

	/**
	 * Staggered race across up to 2 healthy providers (EdgeApp pattern).
	 * First success wins; losers still record failure/success for scoring.
	 */
	private async raceTwo<T>(
		fn: (client: SuiJsonRpcClient, url: string) => Promise<T>,
		a: Provider,
		b: Provider,
	): Promise<{ result: T; meta: RpcCallMeta } | { error: unknown; tried: number }> {
		type Outcome =
			| { ok: true; provider: Provider; result: T; latencyMs: number }
			| { ok: false; provider: Provider; error: unknown }

		const run = (p: Provider): Promise<Outcome> => {
			const t0 = Date.now()
			return fn(p.client, p.url).then(
				(result) => ({ ok: true as const, provider: p, result, latencyMs: Date.now() - t0 }),
				(error: unknown) => ({ ok: false as const, provider: p, error }),
			)
		}

		const first = run(a)
		const late: { p: Promise<Outcome> | null } = { p: null }
		const timer = setTimeout(() => {
			late.p = run(b)
		}, STAGGER_RACE_MS)

		const settled = await first
		clearTimeout(timer)

		if (settled.ok) {
			settled.provider.recordSuccess(settled.latencyMs)
			this.markPreferred(settled.provider)
			// Let the late starter finish in the background for health stats only.
			if (late.p) {
				void late.p.then((o) => {
					if (o.ok) o.provider.recordSuccess(o.latencyMs)
					else o.provider.recordFailure(o.error, this.failuresBeforeQuarantine, this.quarantineMs)
				})
			}
			return {
				result: settled.result,
				meta: {
					providerUrl: settled.provider.url,
					providerLabel: settled.provider.label,
					latencyMs: settled.latencyMs,
					failoverUsed: false,
					providersTried: late.p ? 2 : 1,
				},
			}
		}

		settled.provider.recordFailure(settled.error, this.failuresBeforeQuarantine, this.quarantineMs)
		if (classifyError(settled.error instanceof Error ? settled.error.message : String(settled.error)) === '429') {
			this.deferAfterRateLimit()
		}

		if (!late.p) late.p = run(b)
		const other = await late.p
		if (other.ok) {
			other.provider.recordSuccess(other.latencyMs)
			this.markPreferred(other.provider)
			return {
				result: other.result,
				meta: {
					providerUrl: other.provider.url,
					providerLabel: other.provider.label,
					latencyMs: other.latencyMs,
					failoverUsed: true,
					providersTried: 2,
				},
			}
		}
		other.provider.recordFailure(other.error, this.failuresBeforeQuarantine, this.quarantineMs)
		if (classifyError(other.error instanceof Error ? other.error.message : String(other.error)) === '429') {
			this.deferAfterRateLimit()
		}
		return { error: other.error ?? settled.error, tried: 2 }
	}

	/**
	 * Run fn against providers with fast failover + staggered race on the first pair.
	 */
	async execute<T>(
		fn: (client: SuiJsonRpcClient, url: string) => Promise<T>,
		opts?: { label?: string; maxProviders?: number },
	): Promise<{ result: T; meta: RpcCallMeta }> {
		await this.acquireSlot()
		try {
			let lastErr: unknown
			for (let pass = 0; pass < RATE_LIMIT_PASSES; pass++) {
				if (pass > 0) {
					await new Promise((r) => setTimeout(r, RATE_LIMIT_COOLDOWN_MS))
				}
				const order = this.pickOrder()
				const max = Math.min(opts?.maxProviders ?? order.length, order.length)
				if (max === 0) break

				let rateLimited = false
				let tried = 0

				if (max >= 2) {
					const raced = await this.raceTwo(fn, order[0]!, order[1]!)
					if ('result' in raced) return raced
					tried += raced.tried
					lastErr = raced.error
					const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
					if (classifyError(msg) === '429') rateLimited = true
					// Continue with remaining providers (3rd+)
					for (let i = 2; i < max; i++) {
						const p = order[i]!
						tried++
						const t0 = Date.now()
						try {
							const result = await fn(p.client, p.url)
							p.recordSuccess(Date.now() - t0)
							this.markPreferred(p)
							return {
								result,
								meta: {
									providerUrl: p.url,
									providerLabel: p.label,
									latencyMs: Date.now() - t0,
									failoverUsed: true,
									providersTried: tried,
								},
							}
						} catch (e) {
							lastErr = e
							p.recordFailure(e, this.failuresBeforeQuarantine, this.quarantineMs)
							if (classifyError(e instanceof Error ? e.message : String(e)) === '429') {
								rateLimited = true
								this.deferAfterRateLimit()
							}
						}
					}
				} else {
					const p = order[0]!
					const attempts = 1 + this.retriesPerProvider
					for (let attempt = 0; attempt < attempts; attempt++) {
						tried++
						const t0 = Date.now()
						try {
							const result = await fn(p.client, p.url)
							p.recordSuccess(Date.now() - t0)
							this.markPreferred(p)
							return {
								result,
								meta: {
									providerUrl: p.url,
									providerLabel: p.label,
									latencyMs: Date.now() - t0,
									failoverUsed: false,
									providersTried: tried,
								},
							}
						} catch (e) {
							lastErr = e
							p.recordFailure(e, this.failuresBeforeQuarantine, this.quarantineMs)
							if (classifyError(e instanceof Error ? e.message : String(e)) === '429') {
								rateLimited = true
								this.deferAfterRateLimit()
							}
							if (p.circuit === 'OPEN') break
						}
					}
				}
				if (!rateLimited) break
			}
			throw lastErr instanceof Error
				? lastErr
				: new Error(String(lastErr ?? 'All RPC providers failed'))
		} finally {
			this.releaseSlot()
		}
	}

	async call<T>(fn: (client: SuiJsonRpcClient, url?: string) => Promise<T>): Promise<T> {
		const { result } = await this.execute((c, url) => fn(c, url))
		return result
	}
}

export function createTestRpcProviderPool(
	urls: string[],
	opts?: Partial<{
		timeoutMs: number
		failuresBeforeQuarantine: number
		quarantineMs: number
		retriesPerProvider: number
	}>,
): RpcProviderPool {
	return new RpcProviderPool({ urls, ...opts })
}

export function createPooledSuiClient(pool: RpcProviderPool): SuiJsonRpcClient {
	const handler: ProxyHandler<SuiJsonRpcClient> = {
		get(_target, prop, receiver) {
			if (prop === 'then') return undefined
			const sample = pool.activeClient()
			const val = Reflect.get(sample, prop, receiver)
			if (typeof val !== 'function') return val
			return (...args: unknown[]) =>
				pool.call((c) => {
					const fn = Reflect.get(c, prop) as (...a: unknown[]) => unknown
					return Promise.resolve(fn.apply(c, args))
				})
		},
	}
	return new Proxy(pool.activeClient(), handler)
}
