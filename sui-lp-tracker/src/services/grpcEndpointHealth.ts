import { PUBLICNODE_PUBLIC_GRPC_URL } from '@/services/suiData/config'
import { grpcUrlToRpcSource } from '@/services/portfolioReadRpcSource'

/** Cheap availability probe (hedge / first endpoint pick) — not used for heavy RPC. */
export const PORTFOLIO_GRPC_PROBE_TIMEOUT_MS = (() => {
	const raw = Number(process.env.PORTFOLIO_GRPC_PROBE_TIMEOUT_MS ?? 4_000)
	return Number.isFinite(raw) && raw >= 500 && raw <= 10_000 ? raw : 4_000
})()

/** Per RPC call on a chosen endpoint (multiGetObjects, devInspect, …). */
export const PORTFOLIO_GRPC_CALL_TIMEOUT_MS = (() => {
	const raw =
		Number(process.env.PORTFOLIO_GRPC_CALL_TIMEOUT_MS ?? process.env.PORTFOLIO_GRPC_ATTEMPT_TIMEOUT_MS ?? 15_000)
	return Number.isFinite(raw) && raw >= 3_000 && raw <= 60_000 ? raw : 15_000
})()

/** @deprecated Use PORTFOLIO_GRPC_PROBE_TIMEOUT_MS — kept for older env/docs. */
export const PORTFOLIO_GRPC_ATTEMPT_TIMEOUT_MS = PORTFOLIO_GRPC_PROBE_TIMEOUT_MS

/** Extra attempts on the same endpoint after a slow/transport failure (0 = one try only). */
export const PORTFOLIO_GRPC_CALL_RETRIES = (() => {
	const raw = Number(process.env.PORTFOLIO_GRPC_CALL_RETRIES ?? 1)
	return Number.isFinite(raw) && raw >= 0 && raw <= 3 ? raw : 1
})()

/** Consecutive soft failures (e.g. call timeout) before endpoint cooldown. */
export const PORTFOLIO_GRPC_COOLDOWN_AFTER_FAILURES = (() => {
	const raw = Number(process.env.PORTFOLIO_GRPC_COOLDOWN_AFTER_FAILURES ?? 3)
	return Number.isFinite(raw) && raw >= 1 && raw <= 10 ? raw : 3
})()

/** Do not retry a failed endpoint until cooldown elapses. */
export const PORTFOLIO_GRPC_ENDPOINT_COOLDOWN_MS = (() => {
	const raw = Number(process.env.PORTFOLIO_GRPC_ENDPOINT_COOLDOWN_MS ?? 5 * 60_000)
	return Number.isFinite(raw) && raw >= 10_000 ? raw : 5 * 60_000
})()

const cooldownUntilByUrl = new Map<string, number>()
const consecutiveFailuresByUrl = new Map<string, number>()
let stickyEndpointIndex = 0
let lastPublicNodeFailureReason: string | null = null

let hasLockedGrpcWinner = false

export function _resetGrpcEndpointHealthForTests(): void {
	cooldownUntilByUrl.clear()
	consecutiveFailuresByUrl.clear()
	stickyEndpointIndex = 0
	lastPublicNodeFailureReason = null
	hasLockedGrpcWinner = false
}

export function hasGrpcEndpointWinner(): boolean {
	return hasLockedGrpcWinner
}

export function getLastPublicNodeGrpcFailureReason(): string | null {
	return lastPublicNodeFailureReason
}

export function getStickyGrpcEndpointIndex(): number {
	return stickyEndpointIndex
}

export function isGrpcEndpointOnCooldown(url: string, nowMs = Date.now()): boolean {
	const until = cooldownUntilByUrl.get(url)
	return until != null && nowMs < until
}

export function getGrpcEndpointFailureStreak(url: string): number {
	return consecutiveFailuresByUrl.get(url) ?? 0
}

export function classifyGrpcFailureReason(err: unknown): string {
	const msg = err instanceof Error ? err.message : String(err)
	const lower = msg.toLowerCase()
	if (lower.includes('grpc probe timeout')) {
		return `probe-timeout:${PORTFOLIO_GRPC_PROBE_TIMEOUT_MS}ms`
	}
	if (lower.includes('grpc call timeout')) {
		return `call-timeout:${PORTFOLIO_GRPC_CALL_TIMEOUT_MS}ms`
	}
	if (lower.includes('grpc attempt timeout')) {
		return `call-timeout:${PORTFOLIO_GRPC_CALL_TIMEOUT_MS}ms`
	}
	if (/enotfound|getaddrinfo|dns|name not resolved/i.test(lower)) return 'dns'
	if (/certificate|cert_|tls|ssl|handshake/i.test(lower)) return 'tls'
	const http = msg.match(/\b(401|403|429|500|502|503|504)\b/)
	if (http) return `http:${http[1]}`
	if (/econnrefused|connection refused/i.test(lower)) return 'conn:refused'
	if (/resource_exhausted|resource exhausted/i.test(lower)) return 'grpc:resource_exhausted'
	if (/unavailable|deadline|econnreset/i.test(lower)) return 'grpc:unavailable'
	if (/fetch failed|network/i.test(lower)) return 'network:fetch-failed'
	if (/invalid grpc request content-type|grpc-web-text/i.test(lower)) return 'grpc:invalid-content-type'
	return `error:${msg.slice(0, 160)}`
}

function shouldCooldownImmediately(reason: string): boolean {
	return /^(dns|tls|conn:refused|network:fetch-failed|grpc:invalid-content-type)/.test(reason)
}

/** Whether to skip same-endpoint retries (hard network / protocol errors). */
export function isImmediateGrpcEndpointFailure(err: unknown): boolean {
	return shouldCooldownImmediately(classifyGrpcFailureReason(err))
}

function logEndpointFailure(url: string, reason: string, enteringCooldown: boolean): void {
	const label = grpcUrlToRpcSource(url)
	const suffix = enteringCooldown ? ' (cooldown)' : ''
	console.warn(`[portfolio-read] grpc skip ${label} (${url}): ${reason}${suffix}`)
	if (url.replace(/\/$/, '') === PUBLICNODE_PUBLIC_GRPC_URL.replace(/\/$/, '')) {
		lastPublicNodeFailureReason = reason
	}
}

export function markGrpcEndpointFailed(url: string, err: unknown, nowMs = Date.now()): string {
	const reason = classifyGrpcFailureReason(err)
	const prev = consecutiveFailuresByUrl.get(url) ?? 0
	const next = prev + 1
	consecutiveFailuresByUrl.set(url, next)

	const enteringCooldown =
		shouldCooldownImmediately(reason) || next >= PORTFOLIO_GRPC_COOLDOWN_AFTER_FAILURES
	if (enteringCooldown) {
		cooldownUntilByUrl.set(url, nowMs + PORTFOLIO_GRPC_ENDPOINT_COOLDOWN_MS)
	}
	logEndpointFailure(url, reason, enteringCooldown)
	return reason
}

export function markGrpcEndpointSuccess(index: number, url?: string): void {
	stickyEndpointIndex = index
	hasLockedGrpcWinner = true
	if (url) consecutiveFailuresByUrl.set(url, 0)
}

/** Order endpoint indices: sticky first if not on cooldown, then others available. */
export function planGrpcEndpointTryOrder(endpointCount: number, urls: string[], nowMs = Date.now()): number[] {
	if (endpointCount <= 0) return []
	const avail: number[] = []
	const pushIf = (i: number) => {
		if (i < 0 || i >= endpointCount) return
		if (avail.includes(i)) return
		if (isGrpcEndpointOnCooldown(urls[i]!, nowMs)) return
		avail.push(i)
	}
	pushIf(stickyEndpointIndex)
	for (let i = 0; i < endpointCount; i++) pushIf(i)
	if (avail.length > 0) return avail
	return [stickyEndpointIndex, ...Array.from({ length: endpointCount }, (_, i) => i).filter((i) => i !== stickyEndpointIndex)]
}

async function withTimeout<T>(fn: () => Promise<T>, ms: number, label: 'probe' | 'call'): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			fn(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`grpc ${label} timeout after ${ms}ms`)),
					ms,
				)
			}),
		])
	} finally {
		if (timer) clearTimeout(timer)
	}
}

export async function withGrpcProbeTimeout<T>(fn: () => Promise<T>): Promise<T> {
	return withTimeout(fn, PORTFOLIO_GRPC_PROBE_TIMEOUT_MS, 'probe')
}

export async function withGrpcCallTimeout<T>(fn: () => Promise<T>): Promise<T> {
	return withTimeout(fn, PORTFOLIO_GRPC_CALL_TIMEOUT_MS, 'call')
}

/** @deprecated Prefer withGrpcProbeTimeout / withGrpcCallTimeout */
export async function withGrpcAttemptTimeout<T>(fn: () => Promise<T>): Promise<T> {
	return withGrpcCallTimeout(fn)
}
