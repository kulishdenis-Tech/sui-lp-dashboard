import { PUBLICNODE_PUBLIC_GRPC_URL } from '@/services/suiData/config'
import { grpcUrlToRpcSource } from '@/services/portfolioReadRpcSource'

/** Per-attempt timeout when probing a gRPC endpoint (ms). */
export const PORTFOLIO_GRPC_ATTEMPT_TIMEOUT_MS = (() => {
	const raw = Number(process.env.PORTFOLIO_GRPC_ATTEMPT_TIMEOUT_MS ?? 4_000)
	return Number.isFinite(raw) && raw >= 1_000 && raw <= 15_000 ? raw : 4_000
})()

/** Do not retry a failed endpoint until cooldown elapses. */
export const PORTFOLIO_GRPC_ENDPOINT_COOLDOWN_MS = (() => {
	const raw = Number(process.env.PORTFOLIO_GRPC_ENDPOINT_COOLDOWN_MS ?? 5 * 60_000)
	return Number.isFinite(raw) && raw >= 10_000 ? raw : 5 * 60_000
})()

const cooldownUntilByUrl = new Map<string, number>()
let stickyEndpointIndex = 0
let lastPublicNodeFailureReason: string | null = null

let hasLockedGrpcWinner = false

export function _resetGrpcEndpointHealthForTests(): void {
	cooldownUntilByUrl.clear()
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

export function classifyGrpcFailureReason(err: unknown): string {
	const msg = err instanceof Error ? err.message : String(err)
	const lower = msg.toLowerCase()
	if (lower.includes('grpc attempt timeout')) {
		return `timeout:${PORTFOLIO_GRPC_ATTEMPT_TIMEOUT_MS}ms`
	}
	if (/enotfound|getaddrinfo|dns|name not resolved/i.test(lower)) return 'dns'
	if (/certificate|cert_|tls|ssl|handshake/i.test(lower)) return 'tls'
	const http = msg.match(/\b(401|403|429|500|502|503|504)\b/)
	if (http) return `http:${http[1]}`
	if (/econnrefused|connection refused/i.test(lower)) return 'conn:refused'
	if (/unavailable|deadline|econnreset/i.test(lower)) return 'grpc:unavailable'
	if (/fetch failed|network/i.test(lower)) return 'network:fetch-failed'
	return `error:${msg.slice(0, 160)}`
}

function logEndpointFailure(url: string, reason: string): void {
	const label = grpcUrlToRpcSource(url)
	console.warn(`[portfolio-read] grpc skip ${label} (${url}): ${reason}`)
	if (url.replace(/\/$/, '') === PUBLICNODE_PUBLIC_GRPC_URL.replace(/\/$/, '')) {
		lastPublicNodeFailureReason = reason
	}
}

export function markGrpcEndpointFailed(url: string, err: unknown, nowMs = Date.now()): string {
	const reason = classifyGrpcFailureReason(err)
	cooldownUntilByUrl.set(url, nowMs + PORTFOLIO_GRPC_ENDPOINT_COOLDOWN_MS)
	logEndpointFailure(url, reason)
	return reason
}

export function markGrpcEndpointSuccess(index: number): void {
	stickyEndpointIndex = index
	hasLockedGrpcWinner = true
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
	// All cooling down — one quick attempt on sticky then fall through in caller.
	return [stickyEndpointIndex, ...Array.from({ length: endpointCount }, (_, i) => i).filter((i) => i !== stickyEndpointIndex)]
}

export async function withGrpcAttemptTimeout<T>(fn: () => Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			fn(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`grpc attempt timeout after ${PORTFOLIO_GRPC_ATTEMPT_TIMEOUT_MS}ms`)),
					PORTFOLIO_GRPC_ATTEMPT_TIMEOUT_MS,
				)
			}),
		])
	} finally {
		if (timer) clearTimeout(timer)
	}
}
