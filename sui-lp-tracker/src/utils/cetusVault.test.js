import { describe, expect, it } from 'vitest';
import { dynamicFieldChildId, firstTypeArgument, isCetusVaultLpCoinType, shareLiquidityByLpAmount, typeArguments, vaultFarmRewardAprPct, vaultLpSharePct, } from '@/utils/cetusVault';
describe('cetusVault math', () => {
    it('shares liquidity proportional to LP supply', () => {
        expect(shareLiquidityByLpAmount('25', '1000', '100')).toBe('250');
        expect(shareLiquidityByLpAmount('1', '10', '3')).toBe('3');
        expect(shareLiquidityByLpAmount('10', '100', '0')).toBe('0');
    });
    it('computes vault LP share percent', () => {
        expect(vaultLpSharePct('468755', '22928178')).toBeCloseTo(2.044, 2);
        expect(vaultLpSharePct('1', '0')).toBeNull();
    });
    it('computes farm reward APR from emission rate', () => {
        // 2000 tokens/day @ ~$0.0186 → ~9.15% on $148,556 farm TVL
        const ratePerSec = String(Math.round((2000 * 1e9) / 86_400));
        const apr = vaultFarmRewardAprPct({
            vaultTvlUsd: 148_556.35,
            vaultTotalSupply: '1000',
            farmLpStakedRaw: '1000',
            emissions: [{ ratePerSec, decimals: 9, priceUsd: 0.01862 }],
        });
        expect(apr).not.toBeNull();
        expect(apr).toBeCloseTo(9.15, 0);
    });
    it('uses LP-staked raw (not share×1000) for farm TVL', () => {
        const ratePerSec = String(Math.round((2000 * 1e9) / 86_400));
        const wrong = vaultFarmRewardAprPct({
            vaultTvlUsd: 157_892,
            vaultTotalSupply: '229781780000000',
            farmLpStakedRaw: '214148369651595000', // raw total_share without ÷1000
            emissions: [{ ratePerSec, decimals: 9, priceUsd: 0.0184 }],
        });
        const ok = vaultFarmRewardAprPct({
            vaultTvlUsd: 157_892,
            vaultTotalSupply: '229781780000000',
            farmLpStakedRaw: '214148369651595',
            emissions: [{ ratePerSec, decimals: 9, priceUsd: 0.0184 }],
        });
        expect(wrong).toBeLessThan(0.05);
        expect(ok).toBeGreaterThan(8);
        expect(ok).toBeLessThan(11);
    });
    it('extracts Vault<LP> type argument', () => {
        const t = '0xd345::vaults::Vault<0xb490d6fa9ead588a9d72da07a02914da42f6b5b1339b8118a90011a42b67a44f::lp_token::LP_TOKEN>';
        expect(firstTypeArgument(t)).toContain('::lp_token::LP_TOKEN');
    });
    it('splits VaultStatus<A, B> coin types', () => {
        const t = '0xe1a1::vaults::VaultStatus<0xf325::afsui::AFSUI, 0x2::sui::SUI>';
        expect(typeArguments(t)).toEqual(['0xf325::afsui::AFSUI', '0x2::sui::SUI']);
    });
    it('detects Cetus vault LP coin types', () => {
        expect(isCetusVaultLpCoinType('0xb490d6fa9ead588a9d72da07a02914da42f6b5b1339b8118a90011a42b67a44f::lp_token::LP_TOKEN')).toBe(true);
        expect(isCetusVaultLpCoinType('0x72de3403e484cf7f60b46a79617b9e6f326ec8b9eeecb206f6adbc2bb284b7ef::lpcoin::LPCOIN')).toBe(true);
        expect(isCetusVaultLpCoinType('0x2::sui::SUI')).toBe(false);
    });
    it('reads vault id from object::ID dynamic field name', () => {
        expect(dynamicFieldChildId({
            objectId: '0x56cfcf62e75c08af24cd715dde200542586204d2351912d2ec1642726083ae23',
            name: {
                type: '0x2::object::ID',
                value: '0x73e3ae25107adb4bda2a286773fd6998087c5c7978f0b5d0ceebea06e7d3e7b7',
            },
        })).toBe('0x73e3ae25107adb4bda2a286773fd6998087c5c7978f0b5d0ceebea06e7d3e7b7');
    });
});
