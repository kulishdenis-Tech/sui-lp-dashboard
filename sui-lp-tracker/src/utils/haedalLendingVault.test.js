import { describe, expect, it } from 'vitest';
import { lendingStakeShareType, pendingLendingFarmRewardRaw, splitMoveTypeArgs, } from './haedalLendingVault';
const SHARE = '0xa80f04830fb8ce7b546f35e7b9b1f471b7be041747a7a5c73c0d8e658fbaedf3::SUIVaultLPT::SUIVAULTLPT';
describe('lendingStakeShareType', () => {
    it('reads the share coin from StakeInfo', () => {
        const type = `0xbddc4ecfd16683d1859500a5db1fb2cf00eeecb6719b76066bdc39c74dd03251::farming::StakeInfo<${SHARE}>`;
        expect(lendingStakeShareType(type)).toBe(SHARE);
    });
});
describe('splitMoveTypeArgs', () => {
    it('splits VaultPool asset and share', () => {
        const type = `0x3777fbddf314316bb4b3618538255b09eff5460de094f5084f21edbeacbec9a8::vault_pool::VaultPool<0x2::sui::SUI, ${SHARE}>`;
        expect(splitMoveTypeArgs(type)).toEqual(['0x2::sui::SUI', SHARE]);
    });
});
describe('pendingLendingFarmRewardRaw', () => {
    const base = {
        shares: 9979914394336n,
        accPerShare: 1516078947979n,
        debt: 15130338115885n,
        rewardPerSecond: 115740740n,
        lastUpdateSec: 1790143220n,
        startSec: 1790078400n,
        endSec: 1790596800n,
        totalShares: 106721034169322n,
        storedPending: 0n,
    };
    it('is zero at the pool last update (debt matches acc)', () => {
        expect(pendingLendingFarmRewardRaw({ ...base, nowSec: base.lastUpdateSec })).toBe(0n);
    });
    it('accrues the user share of emission after last update', () => {
        const pending = pendingLendingFarmRewardRaw({
            ...base,
            nowSec: base.lastUpdateSec + 86400n,
        });
        const human = Number(pending) / 1e9;
        expect(human).toBeGreaterThan(900);
        expect(human).toBeLessThan(970);
    });
});
