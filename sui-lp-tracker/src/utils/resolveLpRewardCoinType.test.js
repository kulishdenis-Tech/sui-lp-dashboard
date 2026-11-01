import { describe, expect, it } from 'vitest';
import { HARDCODED_VERIFIED } from '@/config/hardcodedVerifiedCoins';
import { resolveLpRewardCoinType } from '@/utils/resolveLpRewardCoinType';
const xBtcPool = {
    tokenA: 'xBTC',
    tokenB: 'wBTC',
    tokenAAddress: '0xaaa::xbtc::XBTC',
    tokenBAddress: '0xbbb::wbtc::WBTC',
};
describe('resolveLpRewardCoinType', () => {
    it('resolves BLUE via hardcoded allowlist (not pool BTC legs)', () => {
        const blue = HARDCODED_VERIFIED.find((c) => c.symbol === 'BLUE');
        const ct = resolveLpRewardCoinType({ rewardToken: 'BLUE' }, xBtcPool);
        expect(ct).toBe(blue.type);
    });
    it('prefers rewardCoinType from event', () => {
        const ct = resolveLpRewardCoinType({
            rewardToken: 'BLUE',
            rewardCoinType: '0xe1b45a0e641b9955a20aa0ad1c1f4ad86aad8afb07296d4085e349a50e90bdca::blue::BLUE',
        }, xBtcPool);
        expect(ct).toContain('::blue::BLUE');
    });
    it('maps pool leg symbols to pool coin types', () => {
        expect(resolveLpRewardCoinType({ rewardToken: 'xBTC' }, xBtcPool)).toBe(xBtcPool.tokenAAddress);
        expect(resolveLpRewardCoinType({ rewardToken: 'wBTC' }, xBtcPool)).toBe(xBtcPool.tokenBAddress);
    });
});
