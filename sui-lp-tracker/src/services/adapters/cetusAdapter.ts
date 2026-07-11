/**
 * Cetus CLMM — DexAdapter обгортка.
 * Делегує до існуючих сервісів без їх переписування.
 */
import type { DexAdapter } from './types'
import type { ClosedPosition, OpenPosition, PositionEvent } from '@/types'
import { getCetusPositions } from '@/services/cetusService'
import { getCetusClosedPositions } from '@/services/cetusClosedPositions'
import { scanCetusPositionEvents, invalidateCetusEventCache } from '@/services/cetusLpEvents'

export const cetusAdapter: DexAdapter = {
	protocol: 'cetus',

	async getOpenPositions(wallet: string): Promise<OpenPosition[]> {
		try {
			return await getCetusPositions(wallet)
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error('[cetusAdapter] getOpenPositions failed', e)
			return []
		}
	},

	async getClosedPositions(wallet: string): Promise<ClosedPosition[]> {
		try {
			return await getCetusClosedPositions(wallet)
		} catch (e) {
			// eslint-disable-next-line no-console
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
