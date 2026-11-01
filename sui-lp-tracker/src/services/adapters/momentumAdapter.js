import { getMomentumPositions } from '@/services/momentumService';
import { getMomentumClosedPositions } from '@/services/momentumClosedPositions';
import { getPositionEvents, invalidateBluefinMomentumScanCache } from '@/services/eventParser';
import { getLpWalletScanSession } from '@/services/lpScanSession';
export const momentumAdapter = {
    protocol: 'momentum',
    async getOpenPositions(wallet) {
        try {
            return await getMomentumPositions(wallet);
        }
        catch (e) {
            console.error('[momentumAdapter] getOpenPositions failed', e);
            return [];
        }
    },
    async getClosedPositions(wallet) {
        try {
            const session = getLpWalletScanSession();
            const preScanned = session?.walletNorm
                ? { rawByPositionId: session.momentum.rawByPositionId, historyPartial: session.momentum.historyPartial }
                : undefined;
            return await getMomentumClosedPositions(wallet, preScanned);
        }
        catch (e) {
            console.error('[momentumAdapter] getClosedPositions failed', e);
            return [];
        }
    },
    async scanPositionEvents(wallet, positionId, tokenADecimals, tokenBDecimals) {
        try {
            const { events } = await getPositionEvents(wallet, positionId, 'momentum', {
                tokenADecimals,
                tokenBDecimals,
            });
            return events;
        }
        catch {
            return [];
        }
    },
    invalidateCache(wallet) {
        invalidateBluefinMomentumScanCache(wallet);
    },
};
