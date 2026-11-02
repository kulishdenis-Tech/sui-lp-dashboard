/**
 * Optional dev-server warm-up (gRPC hedge + Current market catalog).
 */
import { ensurePortfolioReadTransportReady } from '@/services/portfolioSuiReadClient'
import { fetchAllMarketRows } from '@/services/currentService'

let warmPromise: Promise<void> | null = null

export function warmAdvisorReadCaches(): Promise<void> {
	if (warmPromise) return warmPromise
	warmPromise = (async () => {
		try {
			await ensurePortfolioReadTransportReady()
			await fetchAllMarketRows().catch(() => undefined)
		} catch {
			/* non-blocking */
		}
	})()
	return warmPromise
}

export function _resetAdvisorWarmupForTests(): void {
	warmPromise = null
}
