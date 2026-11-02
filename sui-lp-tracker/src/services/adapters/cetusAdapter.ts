/**
 * Cetus CLMM + DLMM — DexAdapter обгортка.
 * Делегує до існуючих сервісів без їх переписування.
 */
import type { DexAdapter } from './types'
import type { ClosedPosition, OpenPosition, PositionEvent } from '@/types'
import { getCetusPositions } from '@/services/cetusService'
import { getCetusDlmmPositions } from '@/services/cetusDlmmService'
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

	async getClosedPositions(wallet: string): Promise<ClosedPosition[]> {
		try {
			return await getCetusClosedPositions(wallet)
		} catch (e) {
			 
			console.error('[cetusAdapter] getClosedPositions failed', e)
			return []
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
