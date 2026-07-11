/**
 * Turbos Finance CLMM — DexAdapter wrapper.
 */
import type { DexAdapter } from './types'
import type { ClosedPosition, OpenPosition, PositionEvent } from '@/types'
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

	async getClosedPositions(wallet: string): Promise<ClosedPosition[]> {
		try {
			return await getTurbosClosedPositions(wallet)
		} catch (e) {
			console.error('[turbosAdapter] getClosedPositions failed', e)
			return []
		}
	},

	async scanPositionEvents(
		wallet: string,
		positionId: string,  // = nftId for Turbos
		tokenADecimals: number,
		tokenBDecimals: number,
	): Promise<PositionEvent[]> {
		try {
			// positionId here is the NFT ID; positionObjectId not available via generic interface
			// Newer Turbos events (MintEvent, BurnEvent, CollectEventV2) use owner=nftId so they'll be found
			return await scanTurbosPositionEvents(wallet, positionId, '', tokenADecimals, tokenBDecimals)
		} catch {
			return []
		}
	},

	invalidateCache(wallet: string): void {
		invalidateTurbosEventCache(wallet)
	},
}
