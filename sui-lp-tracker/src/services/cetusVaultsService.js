/**
 * Cetus Vaults (Earn) — fungible LP shares of automated CLMM positions.
 *
 * Official: `CetusVaultsSDK.Vaults.getOwnerVaultsBalance(owner)`
 * https://cetus-1.gitbook.io/cetus-developer-docs/developer/via-sdk-v2/sdk-modules/cetusprotocol-vaults-sdk/gets-vaults-by-owner-address
 *
 * Implemented with JSON-RPC only (same formula as SDK `VaultsUtils.buildVaultBalance`):
 * list vaults from `vaults_pool_handle` DFs, match `getAllBalances` to `lp_token_type`,
 * share liquidity = lp * vault.liquidity / total_supply, then TickMath amounts.
 *
 * Current mainnet vaults have `positions: []` after `migrate_position_to_df`; the farms
 * `WrappedPositionNFT` is a vault dynamic field (`::vaults::PositionKey`).
 */
import BN from 'bn.js';
import Decimal from 'decimal.js';
import { TickMath, Utils } from '@mmt-finance/clmm-sdk';
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import { suiClient } from '@/services/suiClient';
import { asRpcObjectClient, multiGetObjectsHydrated } from '@/services/objectVersionCache';
import { fetchPools } from '@/services/cetusService';
import { resolveSpots } from '@/services/spotPrice/resolveSpots';
import { RPC_CONCURRENCY } from '@/utils/constants';
import { mapPool } from '@/utils/concurrency';
import { CETUS_VAULTS_POOL_HANDLE, dynamicFieldChildId, firstTypeArgument, shareLiquidityByLpAmount, typeArguments, vaultLpSharePct, vaultFarmRewardAprPct, } from '@/utils/cetusVault';
import { getStakedVaultLpByType, getVaultStakeIncentiveSnapshot, mergeLpBalances, } from '@/services/vaultLpStakeService';
import { getCetusPoolFeeAprPct, overlayCetusStatsSpots } from '@/services/cetusPoolStats';
import { withRpcBackoff } from '@/utils/rpcBackoff';
const MAX_SANE_POSITION_USD = 50_000_000;
const MAX_SANE_HUMAN_TOKENS = 1e18;
const VAULT_LIST_TTL_MS = 60 * 60_000;
let vaultListCache = null;
function unwrap(val) {
    if (!val || typeof val !== 'object')
        return null;
    const o = val;
    if (o.fields && typeof o.fields === 'object')
        return o.fields;
    return o;
}
function parseUid(val) {
    if (typeof val === 'string' && val.startsWith('0x'))
        return val;
    const f = unwrap(val);
    if (typeof f?.id === 'string')
        return f.id;
    return null;
}
function readI32(val) {
    let bits;
    if (val != null && typeof val === 'object') {
        const fields = unwrap(val) ?? val;
        bits = Number(fields.bits ?? 0);
    }
    else {
        bits = Number(val ?? 0);
    }
    if (!Number.isFinite(bits))
        return 0;
    return bits > 0x7fff_ffff ? bits - 0x1_0000_0000 : bits;
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
function parseTypeName(val) {
    if (typeof val === 'string')
        return normType(val);
    const f = unwrap(val);
    if (typeof f?.name === 'string')
        return normType(f.name);
    return null;
}
function symbolFromCoinType(ct) {
    const parts = ct.split('::');
    return parts[2] ?? parts[1] ?? '—';
}
function clampUsd(v) {
    if (!Number.isFinite(v) || v < 0)
        return 0;
    return v <= MAX_SANE_POSITION_USD ? v : 0;
}
function humanFromRaw(raw, decimals) {
    try {
        if (!/^\d+$/.test(raw) || !Number.isFinite(decimals) || decimals < 0)
            return 0;
        const n = new Decimal(raw).div(new Decimal(10).pow(decimals)).toNumber();
        if (!Number.isFinite(n) || n < 0 || n > MAX_SANE_HUMAN_TOKENS)
            return 0;
        return n;
    }
    catch {
        return 0;
    }
}
/**
 * Farms `WrappedPositionNFT` (SDK `buildFarmsPositionNFT`).
 * Nested CLMM NFT field is officially misspelled `clmm_postion`.
 */
function parseFarmsNft(raw) {
    const f = unwrap(raw);
    if (!f)
        return null;
    if (f.value != null && f.clmm_postion == null && f.clmm_position == null) {
        return parseFarmsNft(f.value);
    }
    const clmm = unwrap(f.clmm_postion) ?? unwrap(f.clmm_position);
    if (!clmm)
        return null;
    const coinA = parseTypeName(clmm.coin_type_a);
    const coinB = parseTypeName(clmm.coin_type_b);
    if (!coinA || !coinB)
        return null;
    return {
        tickLower: readI32(clmm.tick_lower_index),
        tickUpper: readI32(clmm.tick_upper_index),
        coinTypeA: coinA,
        coinTypeB: coinB,
    };
}
function parseVaultObject(objectId, typeStr, fields) {
    const f = unwrap(fields);
    if (!f)
        return null;
    const id = parseUid(f.id) ?? objectId;
    const poolId = typeof f.pool === 'string' ? f.pool : null;
    const liquidity = f.liquidity != null ? String(f.liquidity) : '0';
    const treasury = unwrap(f.lp_token_treasury);
    const supplyWrap = unwrap(treasury?.total_supply);
    const totalSupply = supplyWrap?.value != null ? String(supplyWrap.value) : '0';
    const lpFromType = typeStr ? firstTypeArgument(typeStr) : null;
    const lpTokenType = lpFromType ? normType(lpFromType) : null;
    if (!poolId || !lpTokenType)
        return null;
    const positions = Array.isArray(f.positions) ? f.positions : [];
    const fromVec = positions.length > 0 ? parseFarmsNft(positions[0]) : null;
    try {
        return {
            id: normalizeSuiAddress(id),
            poolId: normalizeSuiAddress(poolId),
            lpTokenType,
            liquidity,
            totalSupply,
            tickLower: fromVec?.tickLower,
            tickUpper: fromVec?.tickUpper,
            coinTypeA: fromVec?.coinTypeA,
            coinTypeB: fromVec?.coinTypeB,
        };
    }
    catch {
        return null;
    }
}
function vaultHasClmm(v) {
    return (v.coinTypeA != null &&
        v.coinTypeB != null &&
        v.tickLower != null &&
        v.tickUpper != null);
}
function isWrappedPositionDf(item) {
    const ot = item.objectType ?? '';
    const name = item.name;
    const nt = name && typeof name === 'object' && 'type' in name && typeof name.type === 'string'
        ? name.type
        : '';
    return /::pool::WrappedPositionNFT/.test(ot) || /::vaults::PositionKey/.test(nt);
}
function coinsFromVaultStatusType(objectType) {
    if (!/::vaults::VaultStatus</.test(objectType))
        return null;
    const args = typeArguments(objectType);
    if (args.length < 2)
        return null;
    const coinTypeA = normType(args[0]);
    const coinTypeB = normType(args[1]);
    if (!coinTypeA || !coinTypeB)
        return null;
    return { coinTypeA, coinTypeB };
}
/**
 * After `migrate_position_to_df` the farms NFT left `positions: []` and lives
 * on a vault DF (`PositionKey` → `WrappedPositionNFT`). Official interface:
 * https://github.com/CetusProtocol/cetus-clmm-interface/blob/main/sui/vaults/sources/vaults.move
 */
async function hydrateVaultClmm(vault) {
    if (vaultHasClmm(vault))
        return;
    let cursor;
    const nftIds = [];
    let statusCoins = null;
    do {
        const page = await suiClient.getDynamicFields({
            parentId: vault.id,
            cursor: cursor ?? undefined,
            limit: 50,
        });
        for (const item of page.data ?? []) {
            const ot = typeof item.objectType === 'string' ? item.objectType : '';
            if (!statusCoins)
                statusCoins = coinsFromVaultStatusType(ot);
            if (isWrappedPositionDf(item) && typeof item.objectId === 'string') {
                nftIds.push(item.objectId);
            }
        }
        cursor = page.hasNextPage ? (page.nextCursor ?? null) : null;
    } while (cursor);
    if (statusCoins) {
        vault.coinTypeA ??= statusCoins.coinTypeA;
        vault.coinTypeB ??= statusCoins.coinTypeB;
    }
    if (nftIds.length) {
        const objs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), nftIds, {
            incremental: false,
            showType: true,
        });
        for (const item of objs) {
            const content = item?.data?.content;
            if (content?.dataType !== 'moveObject')
                continue;
            const parsed = parseFarmsNft(content.fields);
            if (!parsed)
                continue;
            vault.tickLower = parsed.tickLower;
            vault.tickUpper = parsed.tickUpper;
            vault.coinTypeA = parsed.coinTypeA;
            vault.coinTypeB = parsed.coinTypeB;
            return;
        }
    }
}
async function listVaults(forceRefresh) {
    if (!forceRefresh && vaultListCache && Date.now() - vaultListCache.at < VAULT_LIST_TTL_MS) {
        return vaultListCache.vaults;
    }
    const ids = [];
    let cursor;
    try {
        do {
            const page = await withRpcBackoff(() => suiClient.getDynamicFields({
                parentId: CETUS_VAULTS_POOL_HANDLE,
                cursor: cursor ?? undefined,
                limit: 50,
            }), { label: 'cetus-vault-df', retries: 4, baseMs: 800 });
            for (const item of page.data ?? []) {
                const id = dynamicFieldChildId(item);
                if (id)
                    ids.push(id);
            }
            cursor = page.hasNextPage ? (page.nextCursor ?? null) : null;
        } while (cursor);
        const unique = [...new Set(ids)];
        const vaults = [];
        for (let i = 0; i < unique.length; i += 50) {
            const chunk = unique.slice(i, i + 50);
            const objs = await withRpcBackoff(() => multiGetObjectsHydrated(asRpcObjectClient(suiClient), chunk, {
                incremental: false,
                showType: true,
            }), { label: 'cetus-vaults-multi', retries: 3, baseMs: 700 });
            for (const item of objs) {
                const obj = item?.data;
                const content = obj?.content;
                if (!obj?.objectId || content?.dataType !== 'moveObject')
                    continue;
                const parsed = parseVaultObject(obj.objectId, content.type ?? obj.type, content.fields);
                if (parsed)
                    vaults.push(parsed);
            }
        }
        if (vaults.length) {
            vaultListCache = { at: Date.now(), vaults };
            return vaults;
        }
        if (vaultListCache?.vaults.length)
            return vaultListCache.vaults;
        return [];
    }
    catch (e) {
        console.warn('[cetus-vaults] listVaults', e);
        if (vaultListCache?.vaults.length)
            return vaultListCache.vaults;
        throw e;
    }
}
export async function getCetusVaultPositions(walletAddress, options) {
    const vaults = await listVaults(false);
    if (!vaults.length)
        return [];
    const balances = await withRpcBackoff(() => suiClient.getAllBalances({ owner: walletAddress }), { label: 'cetus-vault-balances', retries: 3, baseMs: 600 });
    const freeByType = new Map();
    for (const b of balances) {
        const ct = normType(b.coinType) ?? b.coinType;
        freeByType.set(ct, b.totalBalance);
    }
    let stakedByType = new Map();
    let farmByLp = new Map();
    try {
        stakedByType = await withRpcBackoff(() => getStakedVaultLpByType(walletAddress), {
            label: 'cetus-vault-staked',
            retries: 3,
            baseMs: 700,
        });
    }
    catch (e) {
        console.warn('[cetus-vaults] staked lp', e);
    }
    try {
        const snap = await withRpcBackoff(() => getVaultStakeIncentiveSnapshot(walletAddress), {
            label: 'cetus-vault-stake-farm',
            retries: 3,
            baseMs: 700,
        });
        farmByLp = snap.byLpFarm;
    }
    catch (e) {
        console.warn('[cetus-vaults] stake farm', e);
    }
    const balByType = mergeLpBalances(freeByType, stakedByType);
    const held = vaults.filter((v) => {
        const raw = balByType.get(v.lpTokenType) ?? '0';
        try {
            return BigInt(raw) > 0n;
        }
        catch {
            return false;
        }
    });
    if (!held.length)
        return [];
    await mapPool(held, RPC_CONCURRENCY, async (v) => {
        try {
            await hydrateVaultClmm(v);
        }
        catch (e) {
            console.warn('[cetus-vaults] hydrate', v.id, e);
        }
    });
    const ready = held.filter(vaultHasClmm);
    if (!ready.length)
        return [];
    const poolMap = await fetchPools([...new Set(ready.map((v) => v.poolId))], options?.incremental === true);
    const coinTypes = new Set();
    for (const v of ready) {
        coinTypes.add(v.coinTypeA);
        coinTypes.add(v.coinTypeB);
        coinTypes.add(v.lpTokenType);
        const farm = farmByLp.get(v.lpTokenType);
        if (farm)
            for (const e of farm.emissions)
                coinTypes.add(e.rewardCoinType);
    }
    const metaMap = new Map();
    await mapPool([...coinTypes], RPC_CONCURRENCY, async (ct) => {
        try {
            const m = await suiClient.getCoinMetadata({ coinType: ct });
            metaMap.set(ct, {
                symbol: m?.symbol ?? symbolFromCoinType(ct),
                decimals: m?.decimals ?? 0,
                iconUrl: typeof m?.iconUrl === 'string' && m.iconUrl.startsWith('https://') ? m.iconUrl : null,
            });
        }
        catch {
            metaMap.set(ct, { symbol: symbolFromCoinType(ct), decimals: 0, iconUrl: null });
        }
    });
    const getMeta = (ct) => metaMap.get(ct) ?? { symbol: symbolFromCoinType(ct), decimals: 0, iconUrl: null };
    const spotOpts = options?.forceRefreshPrices
        ? { forceRefresh: true }
        : undefined;
    let spots;
    try {
        spots = await resolveSpots([...coinTypes], (ct) => getMeta(ct).symbol, spotOpts);
    }
    catch {
        spots = new Map();
    }
    try {
        await overlayCetusStatsSpots(spots, [...coinTypes]);
    }
    catch (e) {
        console.warn('[cetus-vaults] cetus spots', e);
    }
    const openedAt = Math.floor(Date.now() / 1000);
    const out = [];
    for (const v of ready) {
        const pool = poolMap.get(v.poolId);
        if (!pool)
            continue;
        const stakedRaw = stakedByType.get(v.lpTokenType) ?? '0';
        const lpRaw = balByType.get(v.lpTokenType) ?? '0';
        const shareLiq = shareLiquidityByLpAmount(lpRaw, v.liquidity, v.totalSupply);
        const metaA = getMeta(v.coinTypeA);
        const metaB = getMeta(v.coinTypeB);
        const lpMeta = getMeta(v.lpTokenType);
        let humA = 0;
        let humB = 0;
        const liqBn = /^\d+$/.test(shareLiq) ? new BN(shareLiq, 10) : new BN(0);
        const curSqrtBn = /^\d+$/.test(pool.sqrtPriceStr) && pool.sqrtPriceStr !== '0'
            ? new BN(pool.sqrtPriceStr, 10)
            : new BN(0);
        if (!liqBn.isZero() && !curSqrtBn.isZero()) {
            try {
                const { coinA, coinB } = Utils.getCoinAmountFromLiquidity(liqBn, curSqrtBn, TickMath.tickIndexToSqrtPriceX64(v.tickLower), TickMath.tickIndexToSqrtPriceX64(v.tickUpper), true);
                humA = humanFromRaw(coinA.toString(10), metaA.decimals);
                humB = humanFromRaw(coinB.toString(10), metaB.decimals);
            }
            catch {
                /* leave 0 */
            }
        }
        const pxa = spots.get(v.coinTypeA)?.price;
        const pxb = spots.get(v.coinTypeB)?.price;
        const pxaF = typeof pxa === 'number' && Number.isFinite(pxa) ? pxa : 0;
        const pxbF = typeof pxb === 'number' && Number.isFinite(pxb) ? pxb : 0;
        const valueUsd = clampUsd(humA * pxaF + humB * pxbF);
        const inRange = pool.currentTick >= v.tickLower && pool.currentTick <= v.tickUpper;
        const feeLabelPct = `${(pool.feeRate * 100).toFixed(3)}%`;
        const sharePct = vaultLpSharePct(lpRaw, v.totalSupply) ?? undefined;
        let vaultTvlUsd;
        if (sharePct != null && sharePct > 0 && valueUsd > 0) {
            vaultTvlUsd = clampUsd(valueUsd / (sharePct / 100));
        }
        const farm = farmByLp.get(v.lpTokenType);
        const rewardApr = farm && vaultTvlUsd != null && vaultTvlUsd > 0
            ? vaultFarmRewardAprPct({
                vaultTvlUsd,
                vaultTotalSupply: v.totalSupply,
                farmLpStakedRaw: farm.lpStakedRaw,
                emissions: farm.emissions.map((e) => {
                    const px = spots.get(e.rewardCoinType)?.price;
                    const pxF = typeof px === 'number' && Number.isFinite(px) ? px : 0;
                    return { ratePerSec: e.ratePerSec, decimals: e.decimals, priceUsd: pxF };
                }),
            })
            : null;
        let vaultFeeApr;
        try {
            // Header-style: pool fee APR as % (no continuous compound).
            vaultFeeApr = await getCetusPoolFeeAprPct(v.poolId);
            if (vaultFeeApr != null && !Number.isFinite(vaultFeeApr))
                vaultFeeApr = null;
        }
        catch {
            vaultFeeApr = null;
        }
        out.push({
            id: v.id,
            protocol: 'cetus',
            poolId: v.poolId,
            pair: `${metaA.symbol}/${metaB.symbol} · vault`,
            tokenA: metaA.symbol,
            tokenB: metaB.symbol,
            tokenAAddress: v.coinTypeA,
            tokenBAddress: v.coinTypeB,
            tokenAIconUrl: metaA.iconUrl,
            tokenBIconUrl: metaB.iconUrl,
            tokenADecimals: metaA.decimals,
            tokenBDecimals: metaB.decimals,
            fee: pool.feeRate,
            tickLower: v.tickLower,
            tickUpper: v.tickUpper,
            currentTick: pool.currentTick,
            currentSqrtPrice: pool.sqrtPriceStr,
            liquidity: shareLiq,
            status: inRange ? 'in_range' : 'out_of_range',
            tokenAAmount: humA,
            tokenBAmount: humB,
            currentPriceA_USD: pxaF,
            currentPriceB_USD: pxbF,
            currentValueUSD: valueUsd,
            depositedUSD: 0,
            pnlUSD: 0,
            pnlPct: 0,
            unclaimedFeeA: 0,
            unclaimedFeeB: 0,
            unclaimedFeeUSD: 0,
            unclaimedRewardUSD: 0,
            openedAt,
            daysOpen: 0,
            lifetimeEarningsUSD: 0,
            vsHodlDeltaUSD: 0,
            aprEstimatePct: vaultFeeApr != null && Number.isFinite(vaultFeeApr) ? vaultFeeApr : 0,
            cetusVault: {
                vaultId: v.id,
                lpTokenType: v.lpTokenType,
                lpTokenRaw: lpRaw,
                lpTokenAmount: humanFromRaw(lpRaw, lpMeta.decimals || 9),
                stakedLpTokenRaw: stakedRaw !== '0' ? stakedRaw : undefined,
                feeLabel: feeLabelPct,
                vaultTvlUsd,
                sharePct,
                vaultAprPct: vaultFeeApr != null && Number.isFinite(vaultFeeApr) ? vaultFeeApr : undefined,
                rewardAprPct: rewardApr != null && Number.isFinite(rewardApr) ? rewardApr : undefined,
            },
        });
    }
    return out;
}
