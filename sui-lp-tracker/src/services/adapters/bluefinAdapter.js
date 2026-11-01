import { getBluefinSpotPositions } from '@/services/bluefinService';
import { getBluefinClosedPositions } from '@/services/bluefinClosedPositions';
import { getPositionEvents, invalidateBluefinMomentumScanCache } from '@/services/eventParser';
import { getLpWalletScanSession } from '@/services/lpScanSession';
export const bluefinAdapter = {
    protocol: 'bluefin',
    async getOpenPositions(wallet) {
        try {
            return await getBluefinSpotPositions(wallet);
        }
        catch (e) {
            console.error('[bluefinAdapter] getOpenPositions failed', e);
            return [];
        }
    },
    async getClosedPositions(wallet) {
        try {
            const session = getLpWalletScanSession();
            const preScanned = session?.walletNorm
                ? { rawByPositionId: session.bluefin.rawByPositionId, historyPartial: session.bluefin.historyPartial }
                : undefined;
            return await getBluefinClosedPositions(wallet, preScanned);
        }
        catch (e) {
            console.error('[bluefinAdapter] getClosedPositions failed', e);
            return [];
        }
    },
    async scanPositionEvents(wallet, positionId, tokenADecimals, tokenBDecimals) {
        try {
            const { events } = await getPositionEvents(wallet, positionId, 'bluefin', {
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
