import { describe, expect, it, vi } from 'vitest';
vi.mock('@/services/verifiedTokenList', () => ({
    getVerifiedCoinList: vi.fn(async () => new Map()),
    getSuietBlocklist: vi.fn(async () => new Set()),
    isVerified: vi.fn(() => false),
    blocklistCovers: vi.fn(() => false),
    normalizeCoinType: (c) => c,
}));
import { classifyTokenBalance, MAX_SANE_WALLET_TOKEN_USD, sortClassifiedTokenBalances, } from './tokenClassifier';
function balance(partial) {
    return {
        name: partial.symbol,
        decimals: 9,
        rawBalance: 1n,
        humanBalance: 1,
        priceUSD: null,
        priceUSDC: null,
        valueUSD: null,
        change24h: null,
        coinObjectCount: 1,
        priceSource: undefined,
        iconUrl: null,
        ...partial,
    };
}
describe('tokenClassifier', () => {
    it('marks URL-in-metadata tokens as spam (fake USDT)', () => {
        const t = balance({
            coinType: '0xfake::usdt::USDT',
            symbol: 'USDT',
            name: 'Claim USDT at https://scam.com',
            description: 'visit www.scam.io',
        });
        const c = classifyTokenBalance(t, new Map(), new Set());
        expect(c.status).toBe('spam');
    });
    it('trusted oracle price does not upgrade to verified', () => {
        const t = balance({
            coinType: '0xunknown::foo::FOO',
            symbol: 'FOO',
            priceUSD: 1.5,
            valueUSD: 100,
            priceSource: 'okx',
        });
        const c = classifyTokenBalance(t, new Map(), new Set());
        expect(c.status).toBe('unverified');
        expect(c.reason).toMatch(/^trusted_oracle:/);
    });
    it('rejects insane oracle value for trusted spot', () => {
        const t = balance({
            coinType: '0xunknown::foo::FOO',
            symbol: 'FOO',
            priceUSD: 1,
            valueUSD: MAX_SANE_WALLET_TOKEN_USD + 1,
            priceSource: 'coingecko',
        });
        const c = classifyTokenBalance(t, new Map(), new Set());
        expect(c.reason).not.toMatch(/^trusted_oracle:/);
    });
    it('hides Cetus vault LP coins from the main wallet table', () => {
        const t = balance({
            coinType: '0xb490d6fa9ead588a9d72da07a02914da42f6b5b1339b8118a90011a42b67a44f::lp_token::LP_TOKEN',
            symbol: 'LP_TOKEN',
            name: 'LP Token',
        });
        const c = classifyTokenBalance(t, new Map(), new Set());
        expect(c.status).toBe('spam');
        expect(c.reason).toBe('cetus_vault_lp');
    });
    it('keeps verified tokens without price in mainVerified bucket', () => {
        const row = {
            ...balance({ coinType: '0x2::sui::SUI', symbol: 'SUI' }),
            classification: {
                coinType: '0x2::sui::SUI',
                status: 'verified',
                metadata: { symbol: 'SUI', name: 'Sui', decimals: 9, iconUrl: null, description: '' },
            },
        };
        const bucket = sortClassifiedTokenBalances([row]);
        expect(bucket.mainVerified).toHaveLength(1);
        expect(bucket.hidden).toHaveLength(0);
    });
});
