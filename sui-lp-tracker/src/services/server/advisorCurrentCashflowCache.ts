import type { BorrowPosition, LendingCashflowUsd, SupplyPosition } from '@/types'
import type { PortfolioReadRpcSource } from '@/services/portfolioReadRpcSource'

export const ADVISOR_CURRENT_CASHFLOW_CACHE_MS = 15 * 60 * 1000

export type AdvisorCurrentCashflowPayload = {
	timestamp: string
	wallet: string
	rpcSource: PortfolioReadRpcSource
	rpcSourceReason?: string | null
	cashflowUsd: LendingCashflowUsd | null | undefined
	supplies: SupplyPosition[]
	borrows: BorrowPosition[]
}

type CacheRow = {
	savedAtMs: number
	payload: AdvisorCurrentCashflowPayload
}

let cache: CacheRow | null = null

export function recordAdvisorCurrentCashflowCache(
	payload: AdvisorCurrentCashflowPayload,
	savedAtMs = Date.now(),
): void {
	cache = {
		savedAtMs,
		payload: {
			...payload,
			supplies: payload.supplies.map((s) => ({ ...s })),
			borrows: payload.borrows.map((b) => ({ ...b })),
			cashflowUsd: payload.cashflowUsd ? { ...payload.cashflowUsd } : payload.cashflowUsd,
		},
	}
}

export function getAdvisorCurrentCashflowCache(): CacheRow | null {
	return cache
}

export function getAdvisorCurrentCashflowCacheAgeMs(nowMs = Date.now()): number | null {
	if (!cache) return null
	return nowMs - cache.savedAtMs
}

export function isAdvisorCurrentCashflowCacheFresh(nowMs = Date.now()): boolean {
	if (!cache) return false
	return nowMs - cache.savedAtMs < ADVISOR_CURRENT_CASHFLOW_CACHE_MS
}

export function _resetAdvisorCurrentCashflowCacheForTests(): void {
	cache = null
}
