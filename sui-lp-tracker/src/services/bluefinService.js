import { TickMath, Utils } from '@mmt-finance/clmm-sdk';
import { suiClient } from '@/services/suiClient';
import { listOwnedMoveObjects, multiGetObjectsHydrated, asRpcObjectClient, } from '@/services/objectVersionCache';
import { resolveSpots } from '@/services/spotPrice/resolveSpots';
import { fetchBluefinAccruedRaws } from '@/services/bluefinAccruedInspect';
import { readMoveUIntString } from '@/services/bluefinMoveRead';
import { logBluefinUnclaimedDebug } from '@/services/bluefinUnclaimedDebug';
import { getBluefinAccruedFeesAndRewards } from '@/services/bluefinAccruedSdk';
import { isBluefinLazyUnclaimedEnabled } from '@/services/lpFeatureFlags';
import { PROTOCOL_PACKAGES } from '@/utils/constants';
import { normalizeSuiAddress, normalizeStructTag } from '@mysten/sui/utils';
import Decimal from 'decimal.js';
import BN from 'bn.js';
import { HARDCODED_VERIFIED } from '@/config/hardcodedVerifiedCoins';
/** Overrides RPC/on-chain symbol with curated display name (e.g. X_SUI → xSUI). */
const _hardcodedSymbol = new Map(HARDCODED_VERIFIED.map((c) => [c.type.toLowerCase(), c.symbol]));
const PKG = PROTOCOL_PACKAGES.BLUEFIN_CLMM;
const POS_STRUCT = `${PKG}::position::Position`;
/** Відома позиція з прикладу Bluefin UI (дисплей ~51 DEEP / ~1.54 SUI / ~25.44 DEEP); дебаг: `VITE_DEBUG_BLUEFIN=1`. */
const BLUEFIN_UNCLAIMED_VALIDATION_POS = '0x3197153a08f2429bbb9f3343efc5a495539c7b1065343fd0fe5e011df02e423c';
function i32ToSigned(n) {
    if (n > 0x7fffffff)
        return n - 0x1_0000_0000;
    return n;
}
function httpsIconUrlFromCoinMetadata(m) {
    const u = m?.iconUrl?.trim();
    return typeof u === 'string' && u.startsWith('https://') ? u : null;
}
function readI32(field) {
    if (field == null)
        return 0;
    // gRPC / GraphQL json: `{ bits: u32 }` (no nested `fields`)
    if (typeof field === 'object' && field !== null && 'bits' in field) {
        const b = field.bits;
        if (b !== undefined)
            return i32ToSigned(typeof b === 'string' ? parseInt(b, 10) : Number(b));
    }
    // Legacy JSON-RPC: `{ fields: { bits } }`
    if (typeof field === 'object' && 'fields' in field) {
        const b = field.fields?.bits;
        if (b !== undefined)
            return i32ToSigned(typeof b === 'string' ? parseInt(b, 10) : b);
    }
    if (typeof field === 'number')
        return i32ToSigned(field);
    return 0;
}
function asMoveFields(data) {
    const d = data;
    if (!d?.content || d.content.dataType !== 'moveObject')
        return null;
    const f = d.content.fields;
    return f && typeof f === 'object' ? f : null;
}
function readString(f, k) {
    if (!f)
        return '';
    const v = f[k];
    if (typeof v === 'string')
        return v;
    if (v && typeof v === 'object' && 'fields' in v) {
        const id = v.fields?.id;
        if (typeof id === 'string')
            return id;
    }
    return '';
}
/** 0x1::string::String у JSON RPC: рядок або { fields: { bytes: number[] } } */
function readSuiUtf8String(v) {
    if (typeof v === 'string')
        return v;
    if (v && typeof v === 'object' && 'fields' in v) {
        const bytes = v.fields?.bytes;
        if (Array.isArray(bytes) && bytes.length) {
            try {
                return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
            }
            catch {
                return '';
            }
        }
    }
    return '';
}
/**
 * `coin_type_a` / `coin_type_b` у Position: інколи `string`, інколи `0x1::string::String` (bytes).
 * Без цього tA/tB = '' → нема spot → unclaimed fee USD = 0.
 */
function readPositionCoinType(fields, key) {
    try {
        const v = fields[key];
        if (typeof v === 'string' && v.trim()) {
            return normCoinType(v.trim());
        }
        const s = readSuiUtf8String(v).trim();
        if (!s)
            return '';
        return normCoinType(s);
    }
    catch {
        return '';
    }
}
function readStructFields(el) {
    if (el == null)
        return null;
    if (typeof el === 'object' && 'fields' in el && el.fields) {
        const ff = el.fields;
        return ff && typeof ff === 'object' ? ff : null;
    }
    if (typeof el === 'object')
        return el;
    return null;
}
/** `pool.reward_infos[]` → coin type + decimals (індекс = індекс у `position.reward_infos`). */
function poolRewardSpecList(poolF) {
    if (!poolF)
        return [];
    const v = poolF['reward_infos'];
    if (!Array.isArray(v) || v.length === 0)
        return [];
    return v.map((el) => {
        const r = readStructFields(el);
        if (!r)
            return { coinType: '', dec: 0 };
        const rawType = r['reward_coin_type'];
        const ct = readSuiUtf8String(rawType).trim();
        const n = ct ? normCoinType(ct) : '';
        const d = r['reward_coin_decimals'];
        const dec = typeof d === 'number'
            ? d
            : typeof d === 'string'
                ? parseInt(d, 10)
                : 0;
        return { coinType: n, dec: Number.isFinite(dec) ? dec : 0 };
    });
}
/** Під мільярди USD на одну позицію — зазвичай баг сирих/нульового sqrt, не кит. */
const MAX_SANE_POSITION_USD = 50_000_000;
const MAX_SANE_HUMAN_TOKENS = 1e18;
function safeHumanFromRaw(raw, decimals) {
    if (!/^\d+$/.test(raw) || !Number.isFinite(decimals) || decimals < 0)
        return 0;
    try {
        const d = new Decimal(raw).div(new Decimal(10).pow(decimals));
        const n = d.toNumber();
        if (!Number.isFinite(n) || n < 0 || n > MAX_SANE_HUMAN_TOKENS)
            return 0;
        return n;
    }
    catch {
        return 0;
    }
}
function normCoinType(raw) {
    if (!raw)
        return raw;
    return normalizeStructTag(raw);
}
/**
 * Split a comma-separated generic parameter list at the top level only.
 * e.g. "0x2::coin::Coin<A>, 0x2::coin::Coin<B, C>" → ["0x2::coin::Coin<A>", "0x2::coin::Coin<B, C>"]
 */
function splitTopLevelGenerics(inner) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of inner) {
        if (ch === '<') {
            depth++;
            current += ch;
        }
        else if (ch === '>') {
            depth--;
            current += ch;
        }
        else if (ch === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
        }
        else {
            current += ch;
        }
    }
    if (current.trim())
        parts.push(current.trim());
    return parts;
}
function symbolFromType(coinType) {
    const parts = coinType.split('::');
    return parts[2] ?? (parts[1] ?? '—');
}
function priceSourceLabel(spots, coinType) {
    const r = spots.get(coinType);
    if (!r || r.price == null)
        return 'unavailable';
    return r.priceSource;
}
/** Bluefin: fee_rate як у Uniswap v3 (напр. 3000 = 0.3%, 1750 = 0.175%). */
function parseFeeMillionthsToPctLabel(fee) {
    if (!Number.isFinite(fee) || fee <= 0)
        return '—';
    return `${((fee / 1_000_000) * 100).toFixed(2)}%`;
}
export async function getBluefinSpotPositions(walletAddress, options) {
    const fetchUnclaimed = options?.includeUnclaimed === true ||
        (options?.includeUnclaimed !== false && !isBluefinLazyUnclaimedEnabled());
    const owner = walletAddress;
    const incremental = options?.incremental === true;
    const owned = await listOwnedMoveObjects(asRpcObjectClient(suiClient), {
        owner,
        filter: { StructType: POS_STRUCT },
        incremental,
    });
    const posIds = [];
    for (const it of owned) {
        const d = it.data;
        if (!d?.objectId)
            continue;
        const f = asMoveFields(d);
        if (f)
            posIds.push({ id: d.objectId, fields: f });
    }
    if (posIds.length === 0)
        return [];
    const poolIdSet = new Set();
    for (const p of posIds) {
        const pid = readString(p.fields, 'pool_id');
        if (pid) {
            try {
                poolIdSet.add(normalizeSuiAddress(pid));
            }
            catch {
                poolIdSet.add(pid);
            }
        }
    }
    const poolMap = new Map();
    const poolIds = [...poolIdSet];
    const poolRes = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), poolIds, {
        incremental,
        showType: true,
    });
    for (const r of poolRes) {
        if (r.data?.objectId) {
            const f = asMoveFields(r.data);
            if (f)
                poolMap.set(normalizeSuiAddress(r.data.objectId), f);
        }
    }
    const meta = new Map();
    const allCoinTypes = new Set();
    /* Ті самі coin types, що readPositionCoinType (byte-String у RPC інакше пропускались → decimals=0 → $0 LP і “трильйони” PnL). */
    for (const p of posIds) {
        const f = p.fields;
        for (const k of ['coin_type_a', 'coin_type_b']) {
            const t = readPositionCoinType(f, k);
            if (t)
                allCoinTypes.add(t);
        }
    }
    for (const poolF of poolMap.values()) {
        for (const { coinType } of poolRewardSpecList(poolF)) {
            if (coinType)
                allCoinTypes.add(coinType);
        }
    }
    for (const c of allCoinTypes) {
        try {
            const m = await suiClient.getCoinMetadata({ coinType: c });
            meta.set(c, {
                symbol: _hardcodedSymbol.get(c.toLowerCase()) ?? m?.symbol ?? symbolFromType(c),
                decimals: m?.decimals ?? 0,
                iconUrl: httpsIconUrlFromCoinMetadata(m),
            });
        }
        catch {
            meta.set(c, {
                symbol: _hardcodedSymbol.get(c.toLowerCase()) ?? symbolFromType(c),
                decimals: 0,
                iconUrl: null,
            });
        }
    }
    const typesList = [...allCoinTypes];
    const rs = options?.forceRefreshPrices
        ? { forceRefresh: true }
        : undefined;
    const spots = await resolveSpots(typesList, (ct) => meta.get(ct)?.symbol ?? symbolFromType(ct), rs);
    const getUsd = (ct, rawInt) => {
        const dec = meta.get(ct)?.decimals ?? 0;
        const human = safeHumanFromRaw(rawInt, dec);
        const px = spots.get(ct)?.price;
        if (px == null || !Number.isFinite(px) || px > 1e8)
            return 0;
        const v = human * px;
        return v > 0 && v <= MAX_SANE_POSITION_USD ? v : 0;
    };
    const out = [];
    for (const p of posIds) {
        const f = p.fields;
        const poolIdRaw = readString(f, 'pool_id');
        let poolKey = poolIdRaw;
        try {
            if (poolIdRaw)
                poolKey = normalizeSuiAddress(poolIdRaw);
        }
        catch {
            /* */
        }
        const tA = readPositionCoinType(f, 'coin_type_a');
        const tB = readPositionCoinType(f, 'coin_type_b');
        const symA = meta.get(tA)?.symbol ?? 'A';
        const symB = meta.get(tB)?.symbol ?? 'B';
        const liqStr = readMoveUIntString(f.liquidity);
        const lowerT = readI32(f.lower_tick);
        const upperT = readI32(f.upper_tick);
        const feeBps = typeof f.fee_rate === 'string' ? parseInt(f.fee_rate, 10) : Number(f.fee_rate ?? 0);
        const poolF = poolKey ? (poolMap.get(poolKey) ?? null) : null;
        const sqrtField = (poolF && poolF['current_sqrt_price']) ?? null;
        const curSqrtStr = readMoveUIntString(sqrtField);
        const currentTickI32 = readI32(poolF?.current_tick_index);
        const lowerSqrt = TickMath.tickIndexToSqrtPriceX64(lowerT);
        const upperSqrt = TickMath.tickIndexToSqrtPriceX64(upperT);
        let rawA = '0';
        let rawB = '0';
        const hasPool = poolF != null && curSqrtStr !== '0' && /^\d+$/.test(curSqrtStr) && /^\d+$/.test(liqStr);
        const liqBn = new BN(liqStr, 10);
        const curSqrt = new BN(curSqrtStr, 10);
        if (hasPool && !liqBn.isZero() && !curSqrt.isZero()) {
            try {
                const { coinA, coinB } = Utils.getCoinAmountFromLiquidity(liqBn, curSqrt, lowerSqrt, upperSqrt, false);
                rawA = coinA.toString(10);
                rawB = coinB.toString(10);
            }
            catch {
                /* */
            }
        }
        const decA = meta.get(tA)?.decimals ?? 0;
        const decB = meta.get(tB)?.decimals ?? 0;
        const humA = safeHumanFromRaw(rawA, decA);
        const humB = safeHumanFromRaw(rawB, decB);
        const pxa = spots.get(tA)?.price;
        const pxb = spots.get(tB)?.price;
        const pxaF = pxa != null && Number.isFinite(pxa) && pxa > 0 && pxa <= 1e8 ? pxa : null;
        const pxbF = pxb != null && Number.isFinite(pxb) && pxb > 0 && pxb <= 1e8 ? pxb : null;
        const vA = pxaF != null ? humA * pxaF : 0;
        const vB = pxbF != null ? humB * pxbF : 0;
        let valueUsd = vA + vB;
        if (!Number.isFinite(valueUsd) || valueUsd < 0 || valueUsd > MAX_SANE_POSITION_USD) {
            valueUsd = 0;
        }
        const inRange = currentTickI32 >= lowerT && currentTickI32 < upperT;
        const rewSpec = poolRewardSpecList(poolF);
        const rewardCoinTypes = rewSpec.map((r) => r.coinType).filter((c) => c.length > 0);
        let unclaimedSource = 'bluefin_sdk';
        let rawFeeA = '0';
        let rawFeeB = '0';
        let rewRaws = [];
        const poolOk = Boolean(poolKey && poolF) && tA && tB;
        if (fetchUnclaimed && poolOk) {
            const accrued = await fetchBluefinAccruedRaws(suiClient, {
                positionId: p.id,
                poolId: poolKey,
                coinTypeA: tA,
                coinTypeB: tB,
                rewardCoinTypes,
                inspectSender: walletAddress,
            });
            if (accrued.ok) {
                rawFeeA = accrued.rawFeeA;
                rawFeeB = accrued.rawFeeB;
                rewRaws = accrued.rewardRaws;
            }
            else {
                unclaimedSource = 'unavailable';
                console.warn('Bluefin accrued fees/rewards unavailable: devInspect / pool view failed —', accrued.error);
                if (import.meta.env.VITE_DEBUG_BLUEFIN === '1') {
                    console.warn('[bluefin] detail', p.id, accrued.error);
                }
            }
        }
        else if (!fetchUnclaimed) {
            unclaimedSource = 'unavailable';
        }
        else {
            unclaimedSource = 'unavailable';
            console.warn('Bluefin accrued fees/rewards unavailable: missing pool or coin types for position', p.id);
        }
        const feeHumA = safeHumanFromRaw(rawFeeA, decA);
        const feeHumB = safeHumanFromRaw(rawFeeB, decB);
        /* Fee USD: той самий курс, що для оцінки позиції (pxaF/pxbF); інакше getUsd. */
        let unclaimedFeeUsd = 0;
        let feeUsdA = 0;
        let feeUsdB = 0;
        if (pxaF != null) {
            feeUsdA = feeHumA * pxaF;
            unclaimedFeeUsd += feeUsdA;
        }
        else if (feeHumA > 0) {
            feeUsdA = getUsd(tA, rawFeeA);
            unclaimedFeeUsd += feeUsdA;
        }
        if (pxbF != null) {
            feeUsdB = feeHumB * pxbF;
            unclaimedFeeUsd += feeUsdB;
        }
        else if (feeHumB > 0) {
            feeUsdB = getUsd(tB, rawFeeB);
            unclaimedFeeUsd += feeUsdB;
        }
        if (!Number.isFinite(unclaimedFeeUsd) || unclaimedFeeUsd < 0)
            unclaimedFeeUsd = 0;
        if (unclaimedFeeUsd > MAX_SANE_POSITION_USD)
            unclaimedFeeUsd = 0;
        if (!Number.isFinite(feeUsdA))
            feeUsdA = 0;
        if (!Number.isFinite(feeUsdB))
            feeUsdB = 0;
        const unclaimed_fees = [];
        if (feeHumA > 0 || feeUsdA > 0) {
            unclaimed_fees.push({
                token: symA,
                coinType: tA,
                amount: feeHumA,
                amount_usd: feeUsdA,
                price_source: priceSourceLabel(spots, tA),
            });
        }
        if (feeHumB > 0 || feeUsdB > 0) {
            unclaimed_fees.push({
                token: symB,
                coinType: tB,
                amount: feeHumB,
                amount_usd: feeUsdB,
                price_source: priceSourceLabel(spots, tB),
            });
        }
        let unclaimedRewardUsd = 0;
        const unclaimed_rewards = [];
        const specWithTypes = rewSpec.filter((r) => r.coinType);
        const nRew = Math.min(rewRaws.length, specWithTypes.length);
        for (let i = 0; i < nRew; i++) {
            const { coinType, dec: poolDec } = specWithTypes[i];
            if (!coinType)
                continue;
            const rawO = rewRaws[i] ?? '0';
            const dec = meta.get(coinType)?.decimals ?? poolDec;
            const hum = safeHumanFromRaw(rawO, dec);
            if (hum <= 0)
                continue;
            const pR = spots.get(coinType)?.price;
            const pRf = pR != null && Number.isFinite(pR) && pR > 0 && pR <= 1e8 ? pR : null;
            let leg;
            if (pRf != null)
                leg = hum * pRf;
            else
                leg = getUsd(coinType, rawO);
            if (leg > 0 && leg <= MAX_SANE_POSITION_USD) {
                unclaimedRewardUsd += leg;
                unclaimed_rewards.push({
                    token: meta.get(coinType)?.symbol ?? symbolFromType(coinType),
                    coinType,
                    amount: hum,
                    amount_usd: leg,
                    price_source: priceSourceLabel(spots, coinType),
                });
            }
        }
        if (!Number.isFinite(unclaimedRewardUsd) || unclaimedRewardUsd < 0)
            unclaimedRewardUsd = 0;
        const openedAt = Date.now() / 1000;
        const feeLabel = parseFeeMillionthsToPctLabel(feeBps);
        const rangeLabel = inRange ? '' : ' · OUT';
        const poolIdOut = poolIdRaw || poolKey;
        const bluefinUnclaimed = {
            position_id: p.id,
            pool_id: poolIdOut,
            dex: 'Bluefin',
            unclaimed_fees: unclaimedSource === 'unavailable' ? [] : unclaimed_fees,
            unclaimed_rewards: unclaimedSource === 'unavailable' ? [] : unclaimed_rewards,
            unclaimed_fees_usd: unclaimedSource === 'unavailable' ? Number.NaN : unclaimedFeeUsd,
            unclaimed_rewards_usd: unclaimedSource === 'unavailable' ? Number.NaN : unclaimedRewardUsd,
            unclaimed_total_usd: unclaimedSource === 'unavailable' ? Number.NaN : unclaimedFeeUsd + unclaimedRewardUsd,
            fetched_at: Date.now() / 1000,
            source: unclaimedSource,
            ...(unclaimedSource === 'unavailable' && rewardCoinTypes.length > 0
                ? { poolRewardCoinTypes: rewardCoinTypes }
                : {}),
            ...(unclaimedSource === 'bluefin_sdk' ? { sdkReferenceMethod: 'OnChainCalls.getAccruedFeeAndRewards' } : {}),
        };
        logBluefinUnclaimedDebug(bluefinUnclaimed);
        if (import.meta.env.VITE_DEBUG_BLUEFIN === '1' && p.id === BLUEFIN_UNCLAIMED_VALIDATION_POS) {
            console.log('[bluefin validate] pool view raw', {
                position: p.id,
                pool: poolIdOut,
                rawFeeA: unclaimedSource === 'bluefin_sdk' ? rawFeeA : 'n/a',
                rawFeeB: unclaimedSource === 'bluefin_sdk' ? rawFeeB : 'n/a',
                rewardRaws: unclaimedSource === 'bluefin_sdk' ? rewRaws : [],
                compareUiHint: { deepFee: '~51.25', suiFee: '~1.54', deepRew: '~25.44', usd: '~3.71' },
            });
        }
        const row = {
            id: p.id,
            protocol: 'bluefin',
            poolId: poolIdOut,
            pair: `${symA}+${symB} · ${feeLabel === '—' ? '—' : feeLabel}${rangeLabel}`,
            tokenA: symA,
            tokenB: symB,
            tokenAAddress: tA,
            tokenBAddress: tB,
            tokenAIconUrl: meta.get(tA)?.iconUrl ?? null,
            tokenBIconUrl: meta.get(tB)?.iconUrl ?? null,
            tokenADecimals: decA,
            tokenBDecimals: decB,
            fee: feeBps / 1_000_000,
            tickLower: lowerT,
            tickUpper: upperT,
            currentTick: currentTickI32,
            currentSqrtPrice: curSqrt.isZero() ? curSqrtStr : curSqrt.toString(10),
            liquidity: liqStr,
            status: inRange ? 'in_range' : 'out_of_range',
            tokenAAmount: humA,
            tokenBAmount: humB,
            currentPriceA_USD: pxaF ?? 0,
            currentPriceB_USD: pxbF ?? 0,
            currentValueUSD: valueUsd,
            depositedUSD: 0,
            pnlUSD: 0,
            pnlPct: 0,
            unclaimedFeeA: unclaimedSource === 'unavailable' ? 0 : feeHumA,
            unclaimedFeeB: unclaimedSource === 'unavailable' ? 0 : feeHumB,
            unclaimedFeeUSD: unclaimedSource === 'unavailable' ? Number.NaN : unclaimedFeeUsd,
            unclaimedRewardUSD: unclaimedSource === 'unavailable' ? Number.NaN : unclaimedRewardUsd,
            openedAt,
            daysOpen: 0,
            lifetimeEarningsUSD: 0,
            vsHodlDeltaUSD: 0,
            aprEstimatePct: 0,
            bluefinUnclaimed,
        };
        out.push(row);
    }
    return out;
}
/**
 * Одноразові метадані пулу для парсингу подій або закритих позицій (coin types + decimals + fee).
 */
export async function fetchBluefinPoolPairMeta(poolIdRaw) {
    if (!poolIdRaw)
        return null;
    let poolKey;
    try {
        poolKey = normalizeSuiAddress(poolIdRaw);
    }
    catch {
        poolKey = poolIdRaw;
    }
    const res = await suiClient.multiGetObjects({
        ids: [poolKey],
        options: { showContent: true, showType: true },
    });
    const raw0 = res[0];
    const hit = raw0?.data?.objectId;
    if (!hit)
        return null;
    const f = asMoveFields(raw0?.data ?? null);
    if (!f)
        return null;
    let tA = readPositionCoinType(f, 'coin_type_a');
    let tB = readPositionCoinType(f, 'coin_type_b');
    // Bluefin pool objects store coin types as generic type params, not fields.
    // Fall back to parsing them from the Move object type string:
    // e.g. 0x3492...::pool::Pool<0x2::sui::SUI, 0xce7ff...::usdc::USDC>
    if (!tA || !tB) {
        const objType = raw0.data?.type ?? '';
        const m = objType.match(/<(.+)>$/);
        if (m?.[1]) {
            // Split on the comma between top-level generics (not nested ones)
            const inner = m[1];
            const parts = splitTopLevelGenerics(inner);
            if (parts.length >= 2) {
                tA = tA || normCoinType(parts[0].trim());
                tB = tB || normCoinType(parts[1].trim());
            }
        }
    }
    if (!tA || !tB)
        return null;
    const meta = new Map();
    for (const c of [tA, tB]) {
        try {
            const m = await suiClient.getCoinMetadata({ coinType: c });
            meta.set(c, {
                symbol: m?.symbol ?? symbolFromType(c),
                decimals: m?.decimals ?? 0,
                iconUrl: httpsIconUrlFromCoinMetadata(m),
            });
        }
        catch {
            meta.set(c, { symbol: symbolFromType(c), decimals: 0, iconUrl: null });
        }
    }
    const feeRaw = typeof f.fee_rate === 'string' ? parseInt(f.fee_rate, 10) : Number(f.fee_rate ?? 0);
    const feeMillionths = Number.isFinite(feeRaw) ? feeRaw : 0;
    return {
        poolIdNorm: normalizeSuiAddress(hit),
        coinTypeA: tA,
        coinTypeB: tB,
        symbolA: meta.get(tA)?.symbol ?? symbolFromType(tA),
        symbolB: meta.get(tB)?.symbol ?? symbolFromType(tB),
        decimalsA: meta.get(tA)?.decimals ?? 0,
        decimalsB: meta.get(tB)?.decimals ?? 0,
        tokenAIconUrl: meta.get(tA)?.iconUrl ?? null,
        tokenBIconUrl: meta.get(tB)?.iconUrl ?? null,
        feeMillionths,
    };
}
/** Нормалізовані NFT id відкритих Bluefin-позицій гаманця (для порівняння з закритими з подій). */
export async function listBluefinOwnedPositionIds(walletAddress) {
    const out = new Set();
    let cursor;
    for (;;) {
        const page = await suiClient.getOwnedObjects({
            owner: walletAddress,
            filter: { StructType: POS_STRUCT },
            options: { showContent: false },
            cursor: cursor ?? null,
        });
        for (const it of page.data) {
            const id = it.data?.objectId;
            if (id) {
                try {
                    out.add(normalizeSuiAddress(id));
                }
                catch {
                    out.add(id);
                }
            }
        }
        if (!page.hasNextPage)
            break;
        cursor = page.nextCursor ?? null;
    }
    return out;
}
/** Догрузка unclaimed для детальної картки (коли список зібрано з lazy unclaimed). */
export async function hydrateBluefinUnclaimedForPosition(position, walletAddress, options) {
    if (position.protocol !== 'bluefin' || !position.poolId)
        return {};
    const rewardCoinTypes = (position.bluefinUnclaimed?.poolRewardCoinTypes ??
        position.bluefinUnclaimed?.unclaimed_rewards?.map((r) => r.coinType) ??
        []).filter((c) => typeof c === 'string' && c.length > 0);
    const accrued = await getBluefinAccruedFeesAndRewards({
        positionId: position.id,
        poolId: position.poolId,
        coinTypeA: position.tokenAAddress,
        coinTypeB: position.tokenBAddress,
        rewardCoinTypes,
        inspectSender: walletAddress,
    }, { forceRefreshPrices: options?.forceRefreshPrices });
    if (!accrued)
        return {};
    const feeA = accrued.fees.find((f) => f.tokenType === position.tokenAAddress);
    const feeB = accrued.fees.find((f) => f.tokenType === position.tokenBAddress);
    const unclaimed_fees = accrued.fees.map((f) => ({
        token: f.symbol,
        coinType: f.tokenType,
        amount: f.amount,
        amount_usd: f.amountUsd,
        price_source: f.usdPrice != null ? 'spot' : 'unavailable',
    }));
    const unclaimed_rewards = accrued.rewards.map((r) => ({
        token: r.symbol,
        coinType: r.tokenType,
        amount: r.amount,
        amount_usd: r.amountUsd,
        price_source: r.usdPrice != null ? 'spot' : 'unavailable',
    }));
    const bluefinUnclaimed = {
        position_id: position.id,
        pool_id: position.poolId,
        dex: 'Bluefin',
        unclaimed_fees,
        unclaimed_rewards,
        unclaimed_fees_usd: accrued.unclaimedFeesUsd,
        unclaimed_rewards_usd: accrued.unclaimedRewardsUsd,
        unclaimed_total_usd: accrued.unclaimedTotalUsd,
        fetched_at: accrued.fetchedAt,
        source: 'bluefin_sdk',
        sdkReferenceMethod: accrued.sdkReferenceMethod,
    };
    return {
        unclaimedFeeA: feeA?.amount ?? 0,
        unclaimedFeeB: feeB?.amount ?? 0,
        unclaimedFeeUSD: accrued.unclaimedFeesUsd,
        unclaimedRewardUSD: accrued.unclaimedRewardsUsd,
        bluefinUnclaimed,
    };
}
/**
 * Після швидкого списку (lazy unclaimed): devInspect по позиціях з обмеженою паралельністю.
 */
export async function hydrateBluefinUnclaimedBatch(walletAddress, positions, options) {
    const targets = positions.filter((p) => p.protocol === 'bluefin' && p.bluefinUnclaimed?.source === 'unavailable');
    if (targets.length === 0)
        return [];
    const conc = Math.max(1, Math.min(options?.concurrency ?? 3, targets.length));
    const out = [];
    let idx = 0;
    async function worker() {
        for (;;) {
            const i = idx++;
            if (i >= targets.length)
                break;
            const p = targets[i];
            try {
                const merged = await hydrateBluefinUnclaimedForPosition(p, walletAddress, {
                    forceRefreshPrices: options?.forceRefreshPrices,
                });
                if (Object.keys(merged).length > 0)
                    out.push({ id: p.id, merged });
            }
            catch {
                /* skip */
            }
        }
    }
    await Promise.all(Array.from({ length: conc }, () => worker()));
    return out;
}
