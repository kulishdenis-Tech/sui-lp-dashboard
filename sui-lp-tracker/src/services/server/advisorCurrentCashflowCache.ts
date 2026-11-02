import type { BorrowPosition, LendingCashflowUsd, SupplyPosition } from '@/types'
import type { PortfolioReadRpcSource } from '@/services/portfolioReadRpcSource'
import { advisorWalletCacheKey } from '@/services/server/advisorWalletCacheKey'

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

const cacheByWallet = new Map<string, CacheRow>()

export function recordAdvisorCurrentCashflowCache(
	wallet: string,
	payload: AdvisorCurrentCashflowPayload,
	savedAtMs = Date.now(),
): void {
	const key = advisorWalletCacheKey(wallet)
	cacheByWallet.set(key, {
		savedAtMs,
		payload: {
			...payload,
			wallet: key,
			supplies: payload.supplies.map((s) => ({ ...s })),
			borrows: payload.borrows.map((b) => ({ ...b })),
			cashflowUsd: payload.cashflowUsd ? { ...payload.cashflowUsd } : payload.cashflowUsd,
		},
	})
}

export function getAdvisorCurrentCashflowCache(wallet: string): CacheRow | null {
	return cacheByWallet.get(advisorWalletCacheKey(wallet)) ?? null
}

export function getAdvisorCurrentCashflowCacheAgeMs(wallet: string, nowMs = Date.now()): number | null {
	const row = getAdvisorCurrentCashflowCache(wallet)
	if (!row) return null
	return nowMs - row.savedAtMs
}

export function isAdvisorCurrentCashflowCacheFresh(wallet: string, nowMs = Date.now()): boolean {
	const row = getAdvisorCurrentCashflowCache(wallet)
	if (!row) return false
	return nowMs - row.savedAtMs < ADVISOR_CURRENT_CASHFLOW_CACHE_MS
}

export function _resetAdvisorCurrentCashflowCacheForTests(): void {
	cacheByWallet.clear()
}
