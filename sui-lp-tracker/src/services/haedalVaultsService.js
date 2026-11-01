/**
 * Haedal Liquidity v2 vaults (shown on Cetus Earn as provider “Haedal Protocol”).
 *
 * Official: `haedal-vault-sdk` `VaultsV2.getOwnerVaultsBalanceList` /
 * `getAmountBalanceByLpAmount` — CLMM legs via `liquidity` × TickMath (not stale `amounts` bags).
 * https://www.npmjs.com/package/haedal-vault-sdk
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
import { firstTypeArgument, shareLiquidityByLpAmount, dynamicFieldChildId, vaultLpSharePct, vaultFarmRewardAprPct, } from '@/utils/cetusVault';
import { HAEDAL_VAULTS_V2_POOLS_HANDLE } from '@/utils/haedalVault';
import { getStakedVaultLpByType, mergeLpBalances, getVaultStakeIncentiveSnapshot, } from '@/services/vaultLpStakeService';
import { getCetusVaultFeeAprPct, HAEDAL_VAULT_PERFORMANCE_FEE, } from '@/services/cetusPoolStats';
import { overlayHaedalOracleSpots } from '@/services/haedalOraclePrices';
import { withRpcBackoff } from '@/utils/rpcBackoff';
const MAX_SANE_POSITION_USD = 50_000_000;
const MAX_SANE_HUMAN_TOKENS = 1e18;
/** Vault registry changes rarely — keep warm to avoid DF-scan 429s. */
const VAULT_LIST_TTL_MS = 60 * 60_000;
const VAULT_LIST_STORAGE_KEY = 'haedal-vaults-v2-registry-v2';
let vaultListCache = null;
function vaultToJson(v) {
    return {
        id: v.id,
        lpTokenType: v.lpTokenType,
        totalSupply: v.totalSupply,
        coinTypeA: v.coinTypeA,
        coinTypeB: v.coinTypeB,
        quoteType: v.quoteType,
        lastAum: v.lastAum,
        buffer: [...v.buffer.entries()],
        marketsHandle: v.marketsHandle,
    };
}
function vaultFromJson(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const o = raw;
    if (typeof o.id !== 'string' || typeof o.lpTokenType !== 'string')
        return null;
    if (typeof o.coinTypeA !== 'string' || typeof o.coinTypeB !== 'string')
        return null;
    if (typeof o.totalSupply !== 'string' || typeof o.marketsHandle !== 'string')
        return null;
    const buffer = new Map();
    if (Array.isArray(o.buffer)) {
        for (const row of o.buffer) {
            if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'string') {
                buffer.set(row[0], row[1]);
            }
        }
    }
    return {
        id: o.id,
        lpTokenType: o.lpTokenType,
        totalSupply: o.totalSupply,
        coinTypeA: o.coinTypeA,
        coinTypeB: o.coinTypeB,
        quoteType: typeof o.quoteType === 'string' ? o.quoteType : undefined,
        lastAum: typeof o.lastAum === 'string' ? o.lastAum : '0',
        buffer,
        marketsHandle: o.marketsHandle,
    };
}
function readStoredVaultList() {
    if (typeof localStorage === 'undefined')
        return null;
    try {
        const raw = localStorage.getItem(VAULT_LIST_STORAGE_KEY);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed.at !== 'number' || !Array.isArray(parsed.vaults))
            return null;
        if (Date.now() - parsed.at > VAULT_LIST_TTL_MS * 24)
            return null;
        const vaults = parsed.vaults.map(vaultFromJson).filter((v) => v != null);
        if (!vaults.length)
            return null;
        return { at: parsed.at, vaults };
    }
    catch {
        return null;
    }
}
function writeStoredVaultList(cache) {
    if (typeof localStorage === 'undefined')
        return;
    try {
        localStorage.setItem(VAULT_LIST_STORAGE_KEY, JSON.stringify({ at: cache.at, vaults: cache.vaults.map(vaultToJson) }));
    }
    catch {
        /* quota */
    }
}
function rememberVaultList(vaults) {
    vaultListCache = { at: Date.now(), vaults };
    writeStoredVaultList(vaultListCache);
    return vaults;
}
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
    if (typeof f?.bytes === 'string')
        return f.bytes;
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
    if (typeof f?.pos0 === 'string')
        return parseTypeName(f.pos0);
    return null;
}
/**
 * Haedal `QuoteTypeEnum` is `{ variant: "Base"|"Quote", fields: { pos0: TypeName } }`
 * (or a bare TypeName). AUM / `user_tvl` are denominated in this coin.
 */
function parseQuoteCoinType(val, coinA, coinB) {
    const direct = parseTypeName(val);
    if (direct)
        return direct;
    if (!val || typeof val !== 'object')
        return null;
    const o = val;
    const fields = unwrap(o.fields) ?? unwrap(val);
    const fromPos = fields ? parseTypeName(fields.pos0) : null;
    if (fromPos)
        return fromPos;
    const variant = typeof o.variant === 'string' ? o.variant.toLowerCase() : '';
    if (variant === 'base')
        return coinA;
    if (variant === 'quote')
        return coinB;
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
function addAmt(map, coin, raw) {
    if (!coin || raw === '0' || raw === '')
        return;
    const prev = map.get(coin) ?? '0';
    try {
        map.set(coin, (BigInt(prev) + BigInt(raw)).toString());
    }
    catch {
        /* skip */
    }
}
function readBagAmounts(raw) {
    const out = new Map();
    const f = unwrap(raw);
    if (!f)
        return out;
    const balances = unwrap(f.balances) ?? f;
    const contents = Array.isArray(balances?.contents)
        ? balances.contents
        : Array.isArray(f.contents)
            ? f.contents
            : [];
    for (const item of contents) {
        const row = unwrap(item);
        if (!row)
            continue;
        const key = parseTypeName(row.key);
        if (!key || row.value == null)
            continue;
        addAmt(out, key, String(row.value));
    }
    return out;
}
function parseVaultObject(objectId, typeStr, fields) {
    const f = unwrap(fields);
    if (!f)
        return null;
    const id = parseUid(f.id) ?? objectId;
    const lpFromType = typeStr ? firstTypeArgument(typeStr) : null;
    const lpTokenType = lpFromType ? normType(lpFromType) : null;
    const coinA = parseTypeName(f.coin_type_a);
    const coinB = parseTypeName(f.coin_type_b);
    const treasury = unwrap(f.lp_token_treasury);
    const supplyWrap = unwrap(treasury?.total_supply);
    const totalSupply = supplyWrap?.value != null ? String(supplyWrap.value) : '0';
    const markets = unwrap(f.markets);
    const marketsHandle = parseUid(markets?.id);
    if (!lpTokenType || !coinA || !coinB || !marketsHandle)
        return null;
    try {
        return {
            id: normalizeSuiAddress(id),
            lpTokenType,
            totalSupply,
            coinTypeA: coinA,
            coinTypeB: coinB,
            quoteType: parseQuoteCoinType(f.quote_type, coinA, coinB) ?? undefined,
            lastAum: f.last_aum != null ? String(f.last_aum) : '0',
            buffer: readBagAmounts(f.buffer_assets),
            marketsHandle: normalizeSuiAddress(marketsHandle),
        };
    }
    catch {
        return null;
    }
}
async function listDfObjectIds(parentId) {
    const ids = [];
    let cursor;
    do {
        const page = await withRpcBackoff(() => suiClient.getDynamicFields({
            parentId,
            cursor: cursor ?? undefined,
            limit: 50,
        }), { label: 'haedal-df', retries: 5, baseMs: 900 });
        for (const item of page.data ?? []) {
            const id = dynamicFieldChildId(item);
            if (id)
                ids.push(id);
        }
        cursor = page.hasNextPage ? (page.nextCursor ?? null) : null;
    } while (cursor);
    return [...new Set(ids)];
}
/**
 * ObjectBag / Bag children: always fetch via DF `objectId`.
 * Keys of type `0x2::object::ID` are NOT standalone objects (unlike vault
 * registries) — `dynamicFieldChildId` would return a non-existent id.
 */
async function listDfBagObjectIds(parentId) {
    const ids = [];
    let cursor;
    do {
        const page = await withRpcBackoff(() => suiClient.getDynamicFields({
            parentId,
            cursor: cursor ?? undefined,
            limit: 50,
        }), { label: 'haedal-df-bag', retries: 5, baseMs: 900 });
        for (const item of page.data ?? []) {
            const id = item.objectId;
            if (typeof id === 'string' && id.startsWith('0x'))
                ids.push(id);
        }
        cursor = page.hasNextPage ? (page.nextCursor ?? null) : null;
    } while (cursor);
    return [...new Set(ids)];
}
async function listVaults(forceRefresh) {
    if (!forceRefresh && vaultListCache && Date.now() - vaultListCache.at < VAULT_LIST_TTL_MS) {
        return vaultListCache.vaults;
    }
    if (!forceRefresh && !vaultListCache) {
        const stored = readStoredVaultList();
        if (stored) {
            vaultListCache = stored;
            if (Date.now() - stored.at < VAULT_LIST_TTL_MS)
                return stored.vaults;
        }
    }
    try {
        const ids = await listDfObjectIds(HAEDAL_VAULTS_V2_POOLS_HANDLE);
        const vaults = [];
        for (let i = 0; i < ids.length; i += 50) {
            const chunk = ids.slice(i, i + 50);
            const objs = await withRpcBackoff(() => multiGetObjectsHydrated(asRpcObjectClient(suiClient), chunk, {
                incremental: false,
                showType: true,
            }), { label: 'haedal-vaults-multi', retries: 4, baseMs: 800 });
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
        if (vaults.length)
            return rememberVaultList(vaults);
        // Empty scan is suspicious under rate-limit — keep stale registry if any.
        if (vaultListCache?.vaults.length)
            return vaultListCache.vaults;
        const stored = readStoredVaultList();
        if (stored?.vaults.length) {
            vaultListCache = stored;
            return stored.vaults;
        }
        return [];
    }
    catch (e) {
        console.warn('[haedal-vaults] listVaults', e);
        if (vaultListCache?.vaults.length)
            return vaultListCache.vaults;
        const stored = readStoredVaultList();
        if (stored?.vaults.length) {
            vaultListCache = stored;
            return stored.vaults;
        }
        throw e;
    }
}
function parseMarketOrPosition(raw, typeStr) {
    const f = unwrap(raw);
    if (!f)
        return null;
    if (f.value != null && f.positions == null && f.position == null && f.amounts == null) {
        const inner = unwrap(f.value) ?? f.value;
        const innerType = inner && typeof inner === 'object' && 'type' in inner
            ? String(inner.type ?? '')
            : typeStr;
        return parseMarketOrPosition(inner, innerType);
    }
    const type = typeStr ?? '';
    const posHandle = parseUid(unwrap(f.positions)?.id);
    if (posHandle) {
        return {
            kind: 'market',
            positionsHandle: normalizeSuiAddress(posHandle),
            isClmm: /CLMMMarket/i.test(type),
        };
    }
    const pos = unwrap(f.position) ?? f;
    const amounts = readBagAmounts(f.amounts);
    const pool = typeof pos.pool === 'string'
        ? pos.pool
        : typeof pos.pool_id === 'string'
            ? pos.pool_id
            : undefined;
    const liqRaw = pos.liquidity != null ? String(pos.liquidity) : undefined;
    const tickLower = pos.tick_lower_index != null ? readI32(pos.tick_lower_index) : undefined;
    const tickUpper = pos.tick_upper_index != null ? readI32(pos.tick_upper_index) : undefined;
    const isClmm = (tickLower != null && tickUpper != null && liqRaw != null && /^\d+$/.test(liqRaw) && liqRaw !== '0') ||
        /CLMM/i.test(type);
    return {
        kind: 'position',
        slice: {
            amounts,
            tickLower,
            tickUpper,
            poolId: pool ? normalizeSuiAddress(pool) : undefined,
            liquidity: liqRaw && /^\d+$/.test(liqRaw) ? liqRaw : undefined,
            isClmm,
        },
    };
}
async function collectVaultAmounts(vault) {
    const bufferByCoin = new Map(vault.buffer);
    const bagByCoin = new Map();
    const clmmLegs = [];
    let poolId;
    const poolIds = new Set();
    const marketIds = await listDfBagObjectIds(vault.marketsHandle);
    if (!marketIds.length)
        return { bufferByCoin, bagByCoin, clmmLegs, poolId, poolIds: [] };
    const marketObjs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), marketIds, {
        incremental: false,
        showType: true,
    });
    const posIds = [];
    const ingestPosition = (slice, forceClmm) => {
        const asClmm = slice.isClmm || forceClmm;
        if (asClmm &&
            slice.poolId &&
            slice.liquidity &&
            slice.tickLower != null &&
            slice.tickUpper != null) {
            clmmLegs.push({
                poolId: slice.poolId,
                liquidity: slice.liquidity,
                tickLower: slice.tickLower,
                tickUpper: slice.tickUpper,
            });
            poolIds.add(slice.poolId);
            poolId = slice.poolId;
            return;
        }
        // DLMM / unknown: keep bag amounts (SDK uses bin math; bags are better than nothing).
        for (const [ct, amt] of slice.amounts)
            addAmt(bagByCoin, ct, amt);
        if (slice.poolId) {
            poolIds.add(slice.poolId);
            poolId = slice.poolId;
        }
    };
    for (const item of marketObjs) {
        const content = item?.data?.content;
        if (content?.dataType !== 'moveObject')
            continue;
        const parsed = parseMarketOrPosition(content.fields, content.type ?? item?.data?.type);
        if (!parsed)
            continue;
        if (parsed.kind === 'market') {
            const childIds = await listDfBagObjectIds(parsed.positionsHandle);
            for (const id of childIds)
                posIds.push({ id, isClmm: parsed.isClmm });
            continue;
        }
        ingestPosition(parsed.slice, false);
    }
    if (posIds.length) {
        const unique = [...new Set(posIds.map((p) => p.id))];
        const posObjs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), unique, {
            incremental: false,
            showType: true,
        });
        const clmmHint = new Map(posIds.map((p) => [p.id, p.isClmm]));
        for (const item of posObjs) {
            const content = item?.data?.content;
            if (content?.dataType !== 'moveObject')
                continue;
            const parsed = parseMarketOrPosition(content.fields, content.type ?? item?.data?.type);
            if (parsed?.kind !== 'position')
                continue;
            ingestPosition(parsed.slice, clmmHint.get(item?.data?.objectId ?? '') === true);
        }
    }
    return { bufferByCoin, bagByCoin, clmmLegs, poolId, poolIds: [...poolIds] };
}
/** Haedal SDK V2: `ClmmPoolUtil.getCoinAmountFromLiquidity(..., roundUp=false)`. */
function clmmRawAmounts(liquidity, sqrtPriceStr, tickLower, tickUpper) {
    try {
        const liqBn = /^\d+$/.test(liquidity) ? new BN(liquidity, 10) : new BN(0);
        const curSqrtBn = /^\d+$/.test(sqrtPriceStr) && sqrtPriceStr !== '0' ? new BN(sqrtPriceStr, 10) : new BN(0);
        if (liqBn.isZero() || curSqrtBn.isZero())
            return null;
        const { coinA, coinB } = Utils.getCoinAmountFromLiquidity(liqBn, curSqrtBn, TickMath.tickIndexToSqrtPriceX64(tickLower), TickMath.tickIndexToSqrtPriceX64(tickUpper), false);
        return { rawA: coinA.toString(10), rawB: coinB.toString(10) };
    }
    catch {
        return null;
    }
}
export async function getHaedalVaultPositions(walletAddress, options) {
    // Registry is TTL/localStorage-cached — do not DF-scan on every Refresh (429).
    const vaults = await listVaults(false);
    if (!vaults.length)
        return [];
    const balances = await withRpcBackoff(() => suiClient.getAllBalances({ owner: walletAddress }), { label: 'haedal-balances', retries: 3, baseMs: 600 });
    const freeByType = new Map();
    for (const b of balances) {
        const ct = normType(b.coinType) ?? b.coinType;
        freeByType.set(ct, b.totalBalance);
    }
    let stakedByType = new Map();
    let pendingByLp = new Map();
    let farmByLp = new Map();
    try {
        stakedByType = await withRpcBackoff(() => getStakedVaultLpByType(walletAddress), {
            label: 'haedal-staked',
            retries: 4,
            baseMs: 800,
        });
    }
    catch (e) {
        console.warn('[haedal-vaults] staked lp', e);
    }
    try {
        const snap = await withRpcBackoff(() => getVaultStakeIncentiveSnapshot(walletAddress), {
            label: 'haedal-stake-rewards',
            retries: 3,
            baseMs: 800,
        });
        pendingByLp = snap.byLpPending;
        farmByLp = snap.byLpFarm;
    }
    catch (e) {
        console.warn('[haedal-vaults] stake rewards', e);
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
    // Refresh live supply/AUM/buffer only for held vaults (cheap vs full registry scan).
    try {
        const fresh = await withRpcBackoff(() => multiGetObjectsHydrated(asRpcObjectClient(suiClient), held.map((v) => v.id), { incremental: false, showType: true }), { label: 'haedal-held-meta', retries: 3, baseMs: 700 });
        for (let i = 0; i < held.length; i++) {
            const v = held[i];
            const obj = fresh[i]?.data;
            const content = obj?.content;
            if (!obj?.objectId || content?.dataType !== 'moveObject')
                continue;
            const parsed = parseVaultObject(obj.objectId, content.type ?? obj.type, content.fields);
            if (!parsed)
                continue;
            v.totalSupply = parsed.totalSupply;
            v.lastAum = parsed.lastAum;
            v.buffer = parsed.buffer;
            v.marketsHandle = parsed.marketsHandle;
            v.quoteType = parsed.quoteType;
        }
    }
    catch (e) {
        console.warn('[haedal-vaults] held meta', e);
    }
    const slices = new Map();
    await mapPool(held, Math.min(2, RPC_CONCURRENCY), async (v) => {
        try {
            slices.set(v.id, await collectVaultAmounts(v));
        }
        catch (e) {
            console.warn('[haedal-vaults] markets', v.id, e);
            slices.set(v.id, {
                bufferByCoin: new Map(v.buffer),
                bagByCoin: new Map(),
                clmmLegs: [],
                poolIds: [],
            });
        }
    });
    const allPoolIds = [
        ...new Set(held.flatMap((v) => slices.get(v.id)?.poolIds ?? [])),
    ];
    let poolMap = new Map();
    if (allPoolIds.length) {
        try {
            poolMap = await fetchPools(allPoolIds);
        }
        catch (e) {
            console.warn('[haedal-vaults] fetchPools', e);
        }
    }
    const coinTypes = new Set();
    for (const v of held) {
        coinTypes.add(v.coinTypeA);
        coinTypes.add(v.coinTypeB);
        coinTypes.add(v.lpTokenType);
        if (v.quoteType)
            coinTypes.add(v.quoteType);
        const sl = slices.get(v.id);
        if (sl) {
            for (const ct of sl.bufferByCoin.keys())
                coinTypes.add(ct);
            for (const ct of sl.bagByCoin.keys())
                coinTypes.add(ct);
        }
        for (const r of pendingByLp.get(v.lpTokenType) ?? [])
            coinTypes.add(r.rewardCoinType);
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
    const feeAprByVault = new Map();
    await mapPool(held, Math.min(4, RPC_CONCURRENCY), async (v) => {
        const sl = slices.get(v.id);
        const ids = sl?.poolIds?.length ? sl.poolIds : sl?.poolId ? [sl.poolId] : [];
        if (!ids.length)
            return;
        try {
            const apr = await getCetusVaultFeeAprPct(ids, {
                performanceFeeFrac: HAEDAL_VAULT_PERFORMANCE_FEE,
                asVaultApy: true,
            });
            if (apr != null)
                feeAprByVault.set(v.id, apr);
        }
        catch (e) {
            console.warn('[haedal-vaults] fee apr', v.id.slice(0, 10), e);
        }
    });
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
    // Earn LP breakdown marks ≈ Haedal oracle (VaultsV2.PythPrice / price/now).
    // Do NOT prefer Cetus stats SUI (~$0.72) — that understated holdings vs Earn.
    try {
        await overlayHaedalOracleSpots(spots, [...coinTypes], (ct) => getMeta(ct).symbol);
    }
    catch (e) {
        console.warn('[haedal-vaults] haedal oracle', e);
    }
    const openedAt = Math.floor(Date.now() / 1000);
    const out = [];
    for (const v of held) {
        const stakedRaw = stakedByType.get(v.lpTokenType) ?? '0';
        const lpRaw = balByType.get(v.lpTokenType) ?? '0';
        const sl = slices.get(v.id) ?? {
            bufferByCoin: new Map(v.buffer),
            bagByCoin: new Map(),
            clmmLegs: [],
            poolIds: [],
        };
        // Vault totals: CLMM TickMath (SDK) + buffer + any non-CLMM bags — then × lp/supply.
        const vaultRaw = new Map();
        for (const [ct, amt] of sl.bufferByCoin)
            addAmt(vaultRaw, ct, amt);
        for (const [ct, amt] of sl.bagByCoin)
            addAmt(vaultRaw, ct, amt);
        for (const leg of sl.clmmLegs) {
            const pool = poolMap.get(leg.poolId);
            if (!pool)
                continue;
            const raw = clmmRawAmounts(leg.liquidity, pool.sqrtPriceStr, leg.tickLower, leg.tickUpper);
            if (!raw)
                continue;
            addAmt(vaultRaw, v.coinTypeA, raw.rawA);
            addAmt(vaultRaw, v.coinTypeB, raw.rawB);
        }
        const shareA = shareLiquidityByLpAmount(lpRaw, vaultRaw.get(v.coinTypeA) ?? '0', v.totalSupply);
        const shareB = shareLiquidityByLpAmount(lpRaw, vaultRaw.get(v.coinTypeB) ?? '0', v.totalSupply);
        const metaA = getMeta(v.coinTypeA);
        const metaB = getMeta(v.coinTypeB);
        const lpMeta = getMeta(v.lpTokenType);
        let humA = humanFromRaw(shareA, metaA.decimals);
        let humB = humanFromRaw(shareB, metaB.decimals);
        const pxa = spots.get(v.coinTypeA)?.price;
        const pxb = spots.get(v.coinTypeB)?.price;
        const pxaF = typeof pxa === 'number' && Number.isFinite(pxa) ? pxa : 0;
        const pxbF = typeof pxb === 'number' && Number.isFinite(pxb) ? pxb : 0;
        const bagUsd = clampUsd(humA * pxaF + humB * pxbF);
        const quoteCoin = v.quoteType ?? (metaA.symbol.toUpperCase() === 'USDC' || metaA.symbol.toUpperCase() === 'USDT'
            ? v.coinTypeA
            : v.coinTypeB);
        /** DLMM-only vaults: bags/TickMath under-report — Earn uses last_aum in quote. */
        const dlmmOnly = sl.clmmLegs.length === 0;
        let aumVaultTvlUsd = 0;
        let aumUsd = 0;
        if (v.lastAum !== '0') {
            const qMeta = getMeta(quoteCoin);
            const qPx = spots.get(quoteCoin)?.price;
            const qPxF = typeof qPx === 'number' && Number.isFinite(qPx) ? qPx : 0;
            // Stables: if spot missing, treat as $1 (Earn LP breakdown).
            const qPxUse = qPxF > 0
                ? qPxF
                : /^(USDC|USDT|USDCsui|suiUSDT|AUSD|FDUSD)$/i.test(qMeta.symbol)
                    ? 1
                    : 0;
            aumVaultTvlUsd = clampUsd(humanFromRaw(v.lastAum, qMeta.decimals) * qPxUse);
            const aumShare = shareLiquidityByLpAmount(lpRaw, v.lastAum, v.totalSupply);
            aumUsd = clampUsd(humanFromRaw(aumShare, qMeta.decimals) * qPxUse);
        }
        let vaultTvlUsd;
        {
            const vaultHumA = humanFromRaw(vaultRaw.get(v.coinTypeA) ?? '0', metaA.decimals);
            const vaultHumB = humanFromRaw(vaultRaw.get(v.coinTypeB) ?? '0', metaB.decimals);
            vaultTvlUsd = clampUsd(vaultHumA * pxaF + vaultHumB * pxbF);
        }
        const compositionOk = vaultTvlUsd > 0 && bagUsd > 0;
        // AUM when DLMM / empty bags. Do not prefer higher AUM over healthy CLMM bags
        // (that inflated DEEP/SUI); but DLMM bags are often idle-only dust — must use AUM.
        if (aumVaultTvlUsd > 0 && (dlmmOnly || !compositionOk)) {
            vaultTvlUsd = aumVaultTvlUsd;
        }
        const sharePct = vaultLpSharePct(lpRaw, v.totalSupply) ?? undefined;
        /** Bags under-report vs on-chain AUM (typical DLMM): idle buffer ≪ last_aum. */
        const bagsUnderreportAum = aumUsd > 0 && (dlmmOnly || !(bagUsd > 0) || aumUsd > bagUsd * 1.05);
        let valueUsd = bagUsd;
        if (bagsUnderreportAum) {
            valueUsd = aumUsd;
        }
        else if (!(bagUsd > 0)) {
            if (sharePct != null && sharePct > 0 && vaultTvlUsd > 0) {
                valueUsd = clampUsd(vaultTvlUsd * (sharePct / 100));
            }
        }
        // Inventory: keep real share×bags when healthy. If AUM replaces dust bags,
        // attribute mark to the quote coin (last_aum denomination) — never invent 50/50.
        if (bagsUnderreportAum && valueUsd > 0 && pxaF > 0 && pxbF > 0) {
            if (bagUsd > valueUsd * 0.5) {
                const scale = valueUsd / bagUsd;
                humA *= scale;
                humB *= scale;
            }
            else {
                // Idle/dust bags only (DLMM): last_aum is quote-denominated — show mark there.
                // Full DLMM bin legs need SDK; until then avoid fake 50/50 and $0.01 dust.
                const quoteIsA = quoteCoin === v.coinTypeA;
                if (quoteIsA) {
                    humA = valueUsd / pxaF;
                    humB = 0;
                }
                else {
                    humB = valueUsd / pxbF;
                    humA = 0;
                }
            }
        }
        const tickLower = 0;
        const tickUpper = 0;
        const stakeRewards = pendingByLp.get(v.lpTokenType) ?? [];
        const pendingStakeRewards = stakeRewards.map((r) => {
            const px = spots.get(r.rewardCoinType)?.price;
            const pxF = typeof px === 'number' && Number.isFinite(px) ? px : 0;
            return {
                symbol: r.symbol,
                coinType: r.rewardCoinType,
                amount: r.amount,
                amountUSD: clampUsd(r.amount * pxF),
            };
        });
        const unclaimedRewardUSD = clampUsd(pendingStakeRewards.reduce((s, r) => s + r.amountUSD, 0));
        const farm = farmByLp.get(v.lpTokenType);
        const tvlForFarm = vaultTvlUsd > 0 ? vaultTvlUsd : aumVaultTvlUsd;
        let rewardApr = farm && tvlForFarm > 0
            ? vaultFarmRewardAprPct({
                vaultTvlUsd: tvlForFarm,
                vaultTotalSupply: v.totalSupply,
                // Earn quotes Reward APR on full vault TVL (incentive panel), not staked-only.
                farmLpStakedRaw: v.totalSupply,
                emissions: farm.emissions.map((e) => {
                    const px = spots.get(e.rewardCoinType)?.price;
                    const pxF = typeof px === 'number' && Number.isFinite(px) ? px : 0;
                    return { ratePerSec: e.ratePerSec, decimals: e.decimals, priceUsd: pxF };
                }),
            })
            : null;
        // Guard against dust-TVL -> absurd farm APR (was ~18000% on CETUS-USDC).
        if (rewardApr != null && rewardApr > 500)
            rewardApr = null;
        let vaultFeeApr = feeAprByVault.get(v.id) ?? null;
        if (vaultFeeApr != null && vaultFeeApr > 500)
            vaultFeeApr = null;
        // DLMM-only: pool fee_apr_24h is not the Earn strategy chip — omit rather than mislead.
        if (dlmmOnly && sl.poolIds.length === 0)
            vaultFeeApr = null;
        out.push({
            id: v.id,
            protocol: 'cetus',
            poolId: sl.poolId ?? v.id,
            pair: `${metaA.symbol}/${metaB.symbol} · vault`,
            tokenA: metaA.symbol,
            tokenB: metaB.symbol,
            tokenAAddress: v.coinTypeA,
            tokenBAddress: v.coinTypeB,
            tokenAIconUrl: metaA.iconUrl,
            tokenBIconUrl: metaB.iconUrl,
            tokenADecimals: metaA.decimals,
            tokenBDecimals: metaB.decimals,
            fee: 0,
            // Multi-leg vault: do not expose a single CLMM tick range (was last leg only + currentTick=0).
            tickLower,
            tickUpper,
            currentTick: 0,
            currentSqrtPrice: '0',
            liquidity: lpRaw,
            status: 'in_range',
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
            unclaimedRewardUSD,
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
                feeLabel: 'Earn',
                provider: 'Haedal',
                quoteCoinType: quoteCoin,
                vaultTvlUsd: vaultTvlUsd > 0 ? vaultTvlUsd : undefined,
                sharePct,
                vaultAprPct: vaultFeeApr != null && Number.isFinite(vaultFeeApr) ? vaultFeeApr : undefined,
                rewardAprPct: rewardApr != null && Number.isFinite(rewardApr) ? rewardApr : undefined,
                pendingStakeRewards: pendingStakeRewards.length ? pendingStakeRewards : undefined,
            },
        });
    }
    return out;
}
