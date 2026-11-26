/**
 * Shared scan-step timings for scanSession / enrichment / closed scanners.
 * Log format (TZ): `[scan] step=… ms=… source=graphql|grpc`
 */
export type ScanSource = 'graphql' | 'grpc' | 'cache' | 'mixed' | 'idb'

export type ScanStepTiming = {
	step: string
	ms: number
	source: ScanSource
}

/** Last wallet scan timings (for harness / diagnostics). */
let lastTimings: ScanStepTiming[] = []

export function getLastScanTimings(): readonly ScanStepTiming[] {
	return lastTimings
}

export function resetScanTimings(): void {
	lastTimings = []
}

export function recordScanStep(step: string, ms: number, source: ScanSource): void {
	lastTimings.push({ step, ms, source })
	console.log(`[scan] step=${step} ms=${ms} source=${source}`)
}

export async function timedScanStep<T>(
	step: string,
	source: ScanSource,
	fn: () => Promise<T>,
): Promise<T> {
	const t0 = Date.now()
	let used: ScanSource = source
	try {
		return await fn()
	} catch (e) {
		used = source
		throw e
	} finally {
		recordScanStep(step, Date.now() - t0, used)
	}
}
