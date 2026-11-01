import { getTurbosPositions } from '@/services/turbosService';
import { getTurbosClosedPositions } from '@/services/turbosClosedPositions';
import { scanTurbosPositionEvents, invalidateTurbosEventCache } from '@/services/turbosLpEvents';
export const turbosAdapter = {
    protocol: 'turbos',
    async getOpenPositions(wallet) {
        try {
            return await getTurbosPositions(wallet);
        }
        catch (e) {
            console.error('[turbosAdapter] getOpenPositions failed', e);
            return [];
        }
    },
    async getClosedPositions(wallet) {
        try {
            return await getTurbosClosedPositions(wallet);
        }
        catch (e) {
            console.error('[turbosAdapter] getClosedPositions failed', e);
            return [];
        }
    },
    async scanPositionEvents(wallet, positionId, // = nftId for Turbos
    tokenADecimals, tokenBDecimals) {
        try {
            // positionId here is the NFT ID; positionObjectId not available via generic interface
            // Newer Turbos events (MintEvent, BurnEvent, CollectEventV2) use owner=nftId so they'll be found
            return await scanTurbosPositionEvents(wallet, positionId, '', tokenADecimals, tokenBDecimals);
        }
        catch {
            return [];
        }
    },
    invalidateCache(wallet) {
        invalidateTurbosEventCache(wallet);
    },
};
