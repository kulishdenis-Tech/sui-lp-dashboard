/** Step timing for server diagnostics. Enabled with SUI_LP_ADVISOR_DEV_TIMING=1 (never in tests/browser). */
function enabled(): boolean {
	return typeof process !== 'undefined' && process.env?.VITEST !== 'true' && process.env?.SUI_LP_ADVISOR_DEV_TIMING === '1'
}

export async function devTime<T>(label: string, fn: () => Promise<T>): Promise<T> {
	if (!enabled()) return fn()
	const t0 = Date.now()
	try {
		return await fn()
	} finally {
		console.log(`[step] ${label}: ${Date.now() - t0}ms`)
	}
}
