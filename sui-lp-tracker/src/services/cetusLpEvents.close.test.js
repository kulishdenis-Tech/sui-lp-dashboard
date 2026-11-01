import { describe, expect, it } from 'vitest';
import { cetusBurnedSeedsFromWalletMap, cetusPoolCoinsFromEventType, parseCetusEvent, } from './cetusLpEvents';
const POS = '0xbde0125a06f9401d8d876bad4c9a28ae23dc7cc9a6b0f43d0dcd8ddf9010554e';
const POOL = '0x72f5c6eef73d77de271886219a2543e7c29a33de19a6c69c5cf1899f729c3f17';
describe('Cetus ClosePositionEvent', () => {
    it('maps ClosePositionEvent to close_position', () => {
        const ev = parseCetusEvent({
            type: '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb::pool::ClosePositionEvent',
            parsedJson: { pool: POOL, position: POS },
            id: { eventSeq: '0', txDigest: 'wsMK3F98pxyM' },
        }, 'wsMK3F98pxyM', 1_760_000_000, POS, 9, 9);
        expect(ev?.type).toBe('close_position');
        expect(ev?.positionId).toBe(POS);
    });
    it('reads pool coins from Pool<A, B> and ticks from the remove event', () => {
        const pair = cetusPoolCoinsFromEventType('0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb::pool::Pool<0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL, 0x2::sui::SUI>');
        expect(pair?.coinTypeA).toContain('::wal::WAL');
        expect(pair?.coinTypeB).toContain('::sui::SUI');
        const seeds = cetusBurnedSeedsFromWalletMap(new Map([
            [POS, [
                    {
                        type: '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb::pool::ClosePositionEvent',
                        parsedJson: { pool: POOL, position: POS },
                    },
                    {
                        type: '0xdb5cd62a06c79695bfc9982eb08534706d3752fe123b48e0144f480209b3117f::pool::RemoveLiquidityV2Event',
                        parsedJson: {
                            pool: POOL,
                            position: POS,
                            tick_lower: { bits: 4294931356 },
                            tick_upper: { bits: 4294934176 },
                        },
                    },
                ]],
        ]));
        expect(seeds).toHaveLength(1);
        expect(seeds[0]?.poolId).toBe(POOL);
        expect(seeds[0]?.lowerTick).toBeLessThan(0);
        expect(seeds[0]?.upperTick).toBeLessThan(0);
        expect(seeds[0]?.lowerTick).toBeLessThan(seeds[0].upperTick);
    });
});
