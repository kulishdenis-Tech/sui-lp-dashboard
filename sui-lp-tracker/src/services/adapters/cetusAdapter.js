import { getCetusPositions } from '@/services/cetusService';
import { getCetusDlmmPositions } from '@/services/cetusDlmmService';
import { getCetusClosedPositions } from '@/services/cetusClosedPositions';
import { scanCetusPositionEvents, invalidateCetusEventCache } from '@/services/cetusLpEvents';
export const cetusAdapter = {
    protocol: 'cetus',
    async getOpenPositions(wallet) {
        const [clmm, dlmm] = await Promise.all([
            getCetusPositions(wallet).catch((e) => {
                console.error('[cetusAdapter] CLMM getOpenPositions failed', e);
                return [];
            }),
            getCetusDlmmPositions(wallet).catch((e) => {
                console.error('[cetusAdapter] DLMM getOpenPositions failed', e);
                return [];
            }),
        ]);
        return [...clmm, ...dlmm];
    },
    async getClosedPositions(wallet) {
        try {
            return await getCetusClosedPositions(wallet);
        }
        catch (e) {
            console.error('[cetusAdapter] getClosedPositions failed', e);
            return [];
        }
    },
    async scanPositionEvents(wallet, positionId, tokenADecimals, tokenBDecimals) {
        try {
            return await scanCetusPositionEvents(wallet, positionId, tokenADecimals, tokenBDecimals);
        }
        catch {
            return [];
        }
    },
    invalidateCache(wallet) {
        invalidateCetusEventCache(wallet);
    },
};
