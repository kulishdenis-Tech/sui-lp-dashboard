/**
 * Momentum CLMM — DexAdapter обгортка.
 * Делегує до існуючих сервісів без їх переписування.
 */
import type { DexAdapter } from './types'
import type { ClosedPosition, OpenPosition, PositionEvent } from '@/types'
import { getMomentumPositions } from '@/services/momentumService'
import { getMomentumClosedPositions } from '@/services/momentumClosedPositions'
import { getPositionEvents, invalidateBluefinMomentumScanCache } from '@/services/eventParser'
import { getLpWalletScanSession } from '@/services/lpScanSession'

export const momentumAdapter: DexAdapter = {
	protocol: 'momentum',

	async getOpenPositions(wallet: string): Promise<OpenPosition[]> {
		try {
			return await getMomentumPositions(wallet)
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error('[momentumAdapter] getOpenPositions failed', e)
			return []
		}
	},

	async getClosedPositions(wallet: string): Promise<ClosedPosition[]> {
		try {
			const session = getLpWalletScanSession()
			const preScanned = session?.walletNorm
				? { rawByPositionId: session.momentum.rawByPositionId, historyPartial: session.momentum.historyPartial }
				: undefined
			return await getMomentumClosedPositions(wallet, preScanned)
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error('[momentumAdapter] getClosedPositions failed', e)
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
			const { events } = await getPositionEvents(wallet, positionId, 'momentum', {
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
