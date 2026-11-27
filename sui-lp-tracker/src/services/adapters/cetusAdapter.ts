/**
 * Cetus CLMM + DLMM — DexAdapter обгортка.
 * Делегує до існуючих сервісів без їх переписування.
 */
import type { ClosedPositionsResult, DexAdapter } from './types'
import type { OpenPosition, PositionEvent } from '@/types'
import { getCetusPositions } from '@/services/cetusService'
import { getCetusDlmmPositions } from '@/services/cetusDlmmLazy'
import { getCetusClosedPositions } from '@/services/cetusClosedPositions'
import { scanCetusPositionEvents, invalidateCetusEventCache } from '@/services/cetusLpEvents'

export const cetusAdapter: DexAdapter = {
	protocol: 'cetus',

	async getOpenPositions(wallet: string): Promise<OpenPosition[]> {
		const [clmm, dlmm] = await Promise.all([
			getCetusPositions(wallet).catch((e) => {
				console.error('[cetusAdapter] CLMM getOpenPositions failed', e)
				return [] as OpenPosition[]
			}),
			getCetusDlmmPositions(wallet).catch((e) => {
				console.error('[cetusAdapter] DLMM getOpenPositions failed', e)
				return [] as OpenPosition[]
			}),
		])
		return [...clmm, ...dlmm]
	},

	async getClosedPositions(wallet: string): Promise<ClosedPositionsResult> {
		try {
			return await getCetusClosedPositions(wallet)
		} catch (e) {
			console.error('[cetusAdapter] getClosedPositions failed', e)
			return { positions: [], incomplete: true, reason: 'adapter_error' }
		}
	},

	async scanPositionEvents(
		wallet: string,
		positionId: string,
		tokenADecimals: number,
		tokenBDecimals: number,
	): Promise<PositionEvent[]> {
		try {
			return await scanCetusPositionEvents(wallet, positionId, tokenADecimals, tokenBDecimals)
		} catch {
			return []
		}
	},

	invalidateCache(wallet: string): void {
		invalidateCetusEventCache(wallet)
	},
}
