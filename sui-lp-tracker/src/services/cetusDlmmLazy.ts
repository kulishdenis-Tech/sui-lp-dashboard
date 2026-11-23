/**
 * Lazy entry for Cetus DLMM: keeps `@cetusprotocol/dlmm-sdk` (~240 kB with common-sdk)
 * out of the main store chunk until a DLMM load actually runs.
 */
import type { CetusDlmmPositionsOptions } from '@/services/cetusDlmmService'

export async function getCetusDlmmPositions(
	...args: Parameters<typeof import('@/services/cetusDlmmService').getCetusDlmmPositions>
): ReturnType<typeof import('@/services/cetusDlmmService').getCetusDlmmPositions> {
	const m = await import('@/services/cetusDlmmService')
	return m.getCetusDlmmPositions(...args)
}

export type { CetusDlmmPositionsOptions }
