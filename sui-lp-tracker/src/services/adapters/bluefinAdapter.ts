/**
 * Bluefin CLMM — DexAdapter обгортка.
 * Делегує до існуючих сервісів без їх переписування.
 */
import type { DexAdapter } from './types'
import type { ClosedPosition, OpenPosition, PositionEvent } from '@/types'
import { getBluefinSpotPositions } from '@/services/bluefinService'
import { getBluefinClosedPositions } from '@/services/bluefinClosedPositions'
import { getPositionEvents, invalidateBluefinMomentumScanCache } from '@/services/eventParser'
import { getLpWalletScanSession } from '@/services/lpScanSession'

export const bluefinAdapter: DexAdapter = {
	protocol: 'bluefin',

	async getOpenPositions(wallet: string): Promise<OpenPosition[]> {
		try {
			return await getBluefinSpotPositions(wallet)
		} catch (e) {
			 
			console.error('[bluefinAdapter] getOpenPositions failed', e)
			return []
		}
	},

	async getClosedPositions(wallet: string): Promise<ClosedPosition[]> {
		try {
			const session = getLpWalletScanSession()
			const preScanned = session?.walletNorm
				? { rawByPositionId: session.bluefin.rawByPositionId, historyPartial: session.bluefin.historyPartial }
				: undefined
			return await getBluefinClosedPositions(wallet, preScanned)
		} catch (e) {
			 
			console.error('[bluefinAdapter] getClosedPositions failed', e)
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
			const { events } = await getPositionEvents(wallet, positionId, 'bluefin', {
				tokenADecimals,
				tokenBDecimals,
			})
			return events
		} catch {
			return []
		}
	},

	invalidateCache(wallet: string): void {
		invalidateBluefinMomentumScanCache(wallet)
	},
}
