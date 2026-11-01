/**
 * Vault LP incentive staking (Cetus Earn auto-stake).
 *
 * On-chain package `0xd5b301…::core`: wallet owns `DepositInfo<LP>`, which
 * points at a shared `Deposit<LP>` with `amount` = staked LP raw units.
 * Pending farm rewards use MasterChef-style Q64 math:
 *   pending = share * updated_per_share / 2^64 − debt
 */
import { normalizeStructTag } from '@mysten/sui/utils';
import { suiClient } from '@/services/suiClient';
import { asRpcObjectClient, multiGetObjectsHydrated } from '@/services/objectVersionCache';
import { firstTypeArgument } from '@/utils/cetusVault';
import { VAULT_LP_INCENTIVE_ACC, VAULT_LP_INCENTIVE_DEPOSIT_INFO, } from '@/utils/haedalVault';
import { withRpcBackoff } from '@/utils/rpcBackoff';
const STAKE_CACHE_TTL_MS = 45_000;
let stakeCache = null;
function currentRewardRate(cfg, nowSec) {
    const changeAt = readU64(cfg.rate_change_at);
    return nowSec < changeAt ? readU64(cfg.reward_rate_before) : readU64(cfg.reward_rate_after);
}
function unwrap(val) {
    if (!val || typeof val !== 'object')
        return null;
    const o = val;
    if (o.fields && typeof o.fields === 'object')
        return o.fields;
    return o;
}
function normType(raw) {
    try {
        const s = raw.trim();
        const with0x = s.startsWith('0x') ? s : `0x${s}`;
        return normalizeStructTag(with0x);
    }
    catch {
        return null;
    }
}
function addRaw(a, b) {
    try {
        return (BigInt(a || '0') + BigInt(b || '0')).toString();
    }
    catch {
        return a || '0';
    }
}
function readU64(v) {
    if (typeof v === 'string' && /^\d+$/.test(v))
        return BigInt(v);
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0)
        return BigInt(Math.floor(v));
    return 0n;
}
function readTypeName(v) {
    if (typeof v === 'string')
        return normType(v);
    const f = unwrap(v);
    if (typeof f?.name === 'string')
        return normType(f.name);
    return null;
}
function symbolFromCoinType(ct) {
    const parts = ct.split('::');
    return parts[2] ?? parts[1] ?? 'REWARD';
}
function vecMapEntries(raw) {
    const f = unwrap(raw);
    const contents = f?.contents;
    if (!Array.isArray(contents))
        return [];
    const out = [];
    for (const item of contents) {
        const row = unwrap(item);
        if (!row)
            continue;
        out.push({ key: row.key, value: row.value });
    }
    return out;
}
function emittedBetween(fromSec, toSec, rateChangeAt, rateBefore, rateAfter) {
    if (toSec <= fromSec)
        return 0n;
    const rateAt = (t) => (t < rateChangeAt ? rateBefore : rateAfter);
    // Piecewise-constant rate on [from, to).
    if (fromSec >= rateChangeAt || toSec <= rateChangeAt) {
        return rateAt(fromSec) * (toSec - fromSec);
    }
    return rateBefore * (rateChangeAt - fromSec) + rateAfter * (toSec - rateChangeAt);
}
function updatedPerShare(cfg, totalShare, nowSec) {
    const ps = readU64(cfg.per_share);
    if (totalShare <= 0n)
        return ps;
    const last = readU64(cfg.last_update_time);
    const changeAt = readU64(cfg.rate_change_at);
    const rateBefore = readU64(cfg.reward_rate_before);
    const rateAfter = readU64(cfg.reward_rate_after);
    const emitted = emittedBetween(last, nowSec, changeAt, rateBefore, rateAfter);
    if (emitted <= 0n)
        return ps;
    return ps + (emitted * VAULT_LP_INCENTIVE_ACC) / totalShare;
}
/**
 * Sum staked vault-LP amounts by LP coin type for `owner`.
 * Keys are normalized struct tags; values are raw u64 strings.
 */
export async function getStakedVaultLpByType(owner) {
    const ownerKey = owner.toLowerCase();
    if (stakeCache &&
        stakeCache.owner === ownerKey &&
        Date.now() - stakeCache.at < STAKE_CACHE_TTL_MS) {
        return new Map(stakeCache.map);
    }
    const out = new Map();
    const depositIds = [];
    let cursor;
    do {
        const page = await withRpcBackoff(() => suiClient.getOwnedObjects({
            owner,
            cursor: cursor ?? undefined,
            limit: 50,
            filter: { StructType: VAULT_LP_INCENTIVE_DEPOSIT_INFO },
            options: { showType: true, showContent: true },
        }), { label: 'vault-stake-owned', retries: 3, baseMs: 700 });
        for (const item of page.data ?? []) {
            const type = item.data?.type ?? '';
            const lpType = firstTypeArgument(type);
            const fields = unwrap(item.data?.content?.fields);
            const depositRaw = fields?.deposit;
            const depositId = typeof depositRaw === 'string'
                ? depositRaw
                : typeof depositRaw === 'object' &&
                    depositRaw &&
                    typeof depositRaw.id === 'string'
                    ? depositRaw.id
                    : null;
            const normLp = lpType ? normType(lpType) : null;
            if (!normLp || !depositId || !/^0x[0-9a-fA-F]+$/.test(depositId))
                continue;
            depositIds.push({ lpType: normLp, depositId });
        }
        cursor = page.hasNextPage ? page.nextCursor : null;
    } while (cursor);
    if (!depositIds.length) {
        stakeCache = { at: Date.now(), owner: ownerKey, map: out };
        return out;
    }
    const uniqueIds = [...new Set(depositIds.map((d) => d.depositId))];
    const objs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), uniqueIds);
    const amountByDeposit = new Map();
    for (const item of objs) {
        const id = item?.data?.objectId;
        const content = item?.data?.content;
        if (!id || content?.dataType !== 'moveObject')
            continue;
        const f = unwrap(content.fields);
        const amount = typeof f?.amount === 'string' ? f.amount : null;
        if (!amount || !/^\d+$/.test(amount))
            continue;
        amountByDeposit.set(id, amount);
    }
    for (const meta of depositIds) {
        const amount = amountByDeposit.get(meta.depositId);
        if (!amount)
            continue;
        out.set(meta.lpType, addRaw(out.get(meta.lpType) ?? '0', amount));
    }
    stakeCache = { at: Date.now(), owner: ownerKey, map: out };
    return new Map(out);
}
export function mergeLpBalances(freeByType, stakedByType) {
    const out = new Map(freeByType);
    for (const [ct, raw] of stakedByType) {
        out.set(ct, addRaw(out.get(ct) ?? '0', raw));
    }
    return out;
}
/**
 * Pending Earn auto-stake rewards + farm emission rates, keyed by vault LP coin type.
 * One RPC pass over DepositInfo → Deposit + incentive Pool.
 */
export async function getVaultStakeIncentiveSnapshot(owner) {
    const byLpPending = new Map();
    const byLpFarm = new Map();
    const infos = [];
    let cursor;
    do {
        const page = await withRpcBackoff(() => suiClient.getOwnedObjects({
            owner,
            cursor: cursor ?? undefined,
            limit: 50,
            filter: { StructType: VAULT_LP_INCENTIVE_DEPOSIT_INFO },
            options: { showType: true, showContent: true },
        }), { label: 'vault-stake-rewards-owned', retries: 3, baseMs: 700 });
        for (const item of page.data ?? []) {
            const type = item.data?.type ?? '';
            const lpType = firstTypeArgument(type);
            const fields = unwrap(item.data?.content?.fields);
            const depositRaw = fields?.deposit;
            const depositId = typeof depositRaw === 'string'
                ? depositRaw
                : typeof depositRaw === 'object' &&
                    depositRaw &&
                    typeof depositRaw.id === 'string'
                    ? depositRaw.id
                    : null;
            const poolRaw = fields?.pool;
            const poolId = typeof poolRaw === 'string'
                ? poolRaw
                : typeof poolRaw === 'object' &&
                    poolRaw &&
                    typeof poolRaw.id === 'string'
                    ? poolRaw.id
                    : null;
            const normLp = lpType ? normType(lpType) : null;
            if (!normLp || !depositId || !poolId)
                continue;
            infos.push({ lpType: normLp, depositId, poolId });
        }
        cursor = page.hasNextPage ? page.nextCursor : null;
    } while (cursor);
    if (!infos.length)
        return { byLpPending, byLpFarm };
    const objIds = [...new Set(infos.flatMap((i) => [i.depositId, i.poolId]))];
    const objs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), objIds, {
        incremental: false,
        showType: true,
    });
    const byId = new Map();
    for (const item of objs) {
        const id = item?.data?.objectId;
        const content = item?.data?.content;
        if (!id || content?.dataType !== 'moveObject')
            continue;
        const f = unwrap(content.fields);
        if (f)
            byId.set(id, f);
    }
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const metaCache = new Map();
    async function rewardMeta(coinType) {
        const hit = metaCache.get(coinType);
        if (hit)
            return hit;
        try {
            const m = await suiClient.getCoinMetadata({ coinType });
            const row = {
                symbol: m?.symbol ?? symbolFromCoinType(coinType),
                decimals: typeof m?.decimals === 'number' ? m.decimals : 9,
            };
            metaCache.set(coinType, row);
            return row;
        }
        catch {
            const row = { symbol: symbolFromCoinType(coinType), decimals: 9 };
            metaCache.set(coinType, row);
            return row;
        }
    }
    for (const info of infos) {
        const deposit = byId.get(info.depositId);
        const pool = byId.get(info.poolId);
        if (!deposit || !pool)
            continue;
        const share = readU64(deposit.share);
        const depositLpAmount = readU64(deposit.amount);
        const totalShare = readU64(pool.total_share);
        const sharePerLp = depositLpAmount > 0n && share >= depositLpAmount ? share / depositLpAmount : 1000n;
        const lpStakedRaw = sharePerLp > 0n ? totalShare / sharePerLp : 0n;
        const debts = new Map();
        for (const e of vecMapEntries(deposit.debts)) {
            const ct = readTypeName(e.key);
            if (!ct)
                continue;
            debts.set(ct, readU64(e.value));
        }
        const pendingRows = [];
        const emissions = [];
        for (const e of vecMapEntries(pool.reward_configs)) {
            const rewardType = readTypeName(e.key);
            const cfg = unwrap(e.value);
            if (!rewardType || !cfg)
                continue;
            const meta = await rewardMeta(rewardType);
            const rate = currentRewardRate({
                rate_change_at: cfg.rate_change_at,
                reward_rate_before: cfg.reward_rate_before,
                reward_rate_after: cfg.reward_rate_after,
            }, nowSec);
            if (rate > 0n) {
                emissions.push({
                    rewardCoinType: rewardType,
                    symbol: meta.symbol,
                    decimals: meta.decimals,
                    ratePerSec: rate.toString(),
                });
            }
            if (share <= 0n)
                continue;
            const ps = updatedPerShare({
                per_share: cfg.per_share,
                last_update_time: cfg.last_update_time,
                rate_change_at: cfg.rate_change_at,
                reward_rate_before: cfg.reward_rate_before,
                reward_rate_after: cfg.reward_rate_after,
            }, totalShare, nowSec);
            if (ps <= 0n)
                continue;
            const accrued = (share * ps) / VAULT_LP_INCENTIVE_ACC;
            const debt = debts.get(rewardType) ?? 0n;
            const pending = accrued > debt ? accrued - debt : 0n;
            if (pending <= 0n)
                continue;
            const amount = Number(pending) / 10 ** meta.decimals;
            if (!Number.isFinite(amount) || amount <= 0)
                continue;
            pendingRows.push({
                lpCoinType: info.lpType,
                rewardCoinType: rewardType,
                symbol: meta.symbol,
                amountRaw: pending.toString(),
                amount,
            });
        }
        if (!byLpFarm.has(info.lpType)) {
            byLpFarm.set(info.lpType, {
                lpCoinType: info.lpType,
                totalShare: totalShare.toString(),
                lpStakedRaw: lpStakedRaw.toString(),
                sharePerLp: sharePerLp.toString(),
                emissions,
            });
        }
        if (!pendingRows.length)
            continue;
        const prev = byLpPending.get(info.lpType) ?? [];
        byLpPending.set(info.lpType, [...prev, ...pendingRows]);
    }
    return { byLpPending, byLpFarm };
}
/**
 * Pending Earn auto-stake rewards (HAEDAL etc.) keyed by vault LP coin type.
 */
export async function getPendingVaultStakeRewards(owner) {
    const snap = await getVaultStakeIncentiveSnapshot(owner);
    return snap.byLpPending;
}
