/**
 * Haedal Lending Vault (single-asset, receipt `*VaultLPT`).
 *
 * On-chain (mainnet, haedal.xyz contract generation 3):
 * - Vault: `0x3777…::vault_pool::VaultPool<Asset, Share>`
 * - Farm: `0xbddc…::farming::Pool<Share>` with `source_addr` = vault id
 * - User stake: owned `farming::StakeInfo<Share>` + table position `shares`
 * - Share price: `last_total_assets / treasury.total_supply`
 * - Incentive pending: masterchef `acc_reward_per_share` scaled by 1e12
 */
export const HAEDAL_LENDING_VAULT_PACKAGE = '0x3777fbddf314316bb4b3618538255b09eff5460de094f5084f21edbeacbec9a8';
export const HAEDAL_LENDING_FARMING_PACKAGE = '0xbddc4ecfd16683d1859500a5db1fb2cf00eeecb6719b76066bdc39c74dd03251';
/** Farm `acc_reward_per_share` fixed-point (matches on-chain debt at last update). */
export const HAEDAL_LENDING_FARM_ACC_SCALE = 10n ** 12n;
const STAKE_PREFIX = `${HAEDAL_LENDING_FARMING_PACKAGE}::farming::StakeInfo<`;
export function lendingStakeShareType(objectType) {
    if (!objectType.startsWith(STAKE_PREFIX) || !objectType.endsWith('>'))
        return null;
    const inner = objectType.slice(STAKE_PREFIX.length, -1).trim();
    return inner || null;
}
export function isHaedalLendingVaultPosition(p) {
    return p.cetusVault?.feeLabel === 'Lending';
}
/** Split a Move struct's top-level type arguments. */
export function splitMoveTypeArgs(objectType) {
    const lt = objectType.indexOf('<');
    const gt = objectType.lastIndexOf('>');
    if (lt < 0 || gt <= lt)
        return [];
    const inner = objectType.slice(lt + 1, gt);
    const out = [];
    let depth = 0;
    let cur = '';
    for (const ch of inner) {
        if (ch === '<')
            depth++;
        if (ch === '>')
            depth--;
        if (ch === ',' && depth === 0) {
            const t = cur.trim();
            if (t)
                out.push(t);
            cur = '';
            continue;
        }
        cur += ch;
    }
    const tail = cur.trim();
    if (tail)
        out.push(tail);
    return out;
}
export function normalizeTypeName(name) {
    const t = name.trim();
    if (!t)
        return t;
    return t.startsWith('0x') ? t : `0x${t}`;
}
/**
 * Pending farm reward raw units.
 * At `lastUpdateSec`, `shares * acc / scale` equals `debt` (live pending 0).
 */
export function pendingLendingFarmRewardRaw(opts) {
    let acc = opts.accPerShare;
    if (!opts.paused && opts.totalShares > 0n && opts.rewardPerSecond > 0n) {
        const horizon = opts.nowSec < opts.endSec ? opts.nowSec : opts.endSec;
        const from = opts.lastUpdateSec > opts.startSec ? opts.lastUpdateSec : opts.startSec;
        if (horizon > from) {
            acc +=
                (opts.rewardPerSecond * (horizon - from) * HAEDAL_LENDING_FARM_ACC_SCALE) /
                    opts.totalShares;
        }
    }
    const gross = (opts.shares * acc) / HAEDAL_LENDING_FARM_ACC_SCALE;
    const live = gross > opts.debt ? gross - opts.debt : 0n;
    return live + (opts.storedPending > 0n ? opts.storedPending : 0n);
}
