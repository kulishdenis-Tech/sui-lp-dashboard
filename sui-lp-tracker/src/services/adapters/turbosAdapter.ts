/**
 * Turbos Finance CLMM — DexAdapter wrapper.
 */
import type { ClosedPositionsResult, DexAdapter } from './types'
import type { OpenPosition, PositionEvent } from '@/types'
import { getTurbosPositions } from '@/services/turbosService'
import { getTurbosClosedPositions } from '@/services/turbosClosedPositions'
import { scanTurbosPositionEvents, invalidateTurbosEventCache } from '@/services/turbosLpEvents'

export const turbosAdapter: DexAdapter = {
	protocol: 'turbos',

	async getOpenPositions(wallet: string): Promise<OpenPosition[]> {
		try {
			return await getTurbosPositions(wallet)
		} catch (e) {
			console.error('[turbosAdapter] getOpenPositions failed', e)
			return []
		}
	},

	async getClosedPositions(wallet: string): Promise<ClosedPositionsResult> {
		try {
			return await getTurbosClosedPositions(wallet)
		} catch (e) {
			console.error('[turbosAdapter] getClosedPositions failed', e)
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
			const scan = await scanTurbosPositionEvents(wallet, positionId, '', tokenADecimals, tokenBDecimals)
			return scan.events
		} catch {
			return []
		}
	},

	invalidateCache(wallet: string): void {
		invalidateTurbosEventCache(wallet)
	},
}
