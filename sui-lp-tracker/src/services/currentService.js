import { suiClient } from '@/services/suiClient';
import { getUsdPerTokenAtTimestamp } from '@/services/priceService';
import { extFetchUrl } from '@/utils/externalFetchUrl';
import { enrichSupplyLiquidationPrices, normalizeLiquidationThresholdFactor, } from '@/utils/supplyLiquidationPrice';
import { classifySuiObjectRead } from '@/utils/suiObjectRead';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
const API = 'https://api.current.finance';
const PROTOCOL_PKG = '0x45bae0425e9098ce5cba3d3fa2836220ad24c9f88aa0dffffb5a52b49319fc70';
/** SDK `NetworkConfig.coinDecimalsRegistryId` for `get_asset_market_overview`. */
const COIN_DECIMALS_REGISTRY = '0x53785858526d8ed3826cfc245b0fd53f16179036f38fc024c3851ef07b1538d7';
const DECIMAL_SCALE = 10n ** 18n;
const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
/** Official BuildKit market object ids (mainnet). */
const MARKET_OBJECT_BY_TYPE = {
    'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket': '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
    'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::EmberMarket': '0x8e85c433f791685c65fa66923110b8385e13f955daf8792ef805ce2d47139bbc',
    'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::AltCoinMarket': '0x6f5230c346e27132b8d4d92cb3f4f9c7f4e736d5c32b8f0a2b063c97e67d78f7',
    'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::EthenaMarket': '0xeeef7e9abe201e16c3ca6417b91fa49bec28edcb077eb2fd4a1f126c251e6899',
    'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MatrixGoldMarket': '0xafe28c816d322a56bdab27b90d4b5e882a0a34ee2d9f02c6a07402a2b69be900',
};
/**
 * `/market/getMarketList` without a filter returns MainMarket only.
 * Pass short names (AltCoinMarket, EmberMarket, …) to load each venue’s assets.
 */
const MARKET_LIST_TYPES = [
    'MainMarket',
    'EmberMarket',
    'AltCoinMarket',
    'EthenaMarket',
    'MatrixGoldMarket',
    'Market01',
];
const decimalSchema = bcs.struct('Decimal', { value: bcs.u256() });
const overviewSchema = bcs.struct('ObligationDetail', {
    emode_group_id: bcs.u8(),
    borrows: bcs.vector(bcs.struct('ObligationBorrow', {
        asset: bcs.string(),
        borrow_index: decimalSchema,
        debt: decimalSchema,
    })),
    deposits: bcs.vector(bcs.struct('ObligationDeposit', {
        asset: bcs.string(),
        ctoken_amount: bcs.u64(),
    })),
});
function with0x(t) {
    const s = t.trim();
    return s.startsWith('0x') || s.startsWith('0X') ? s : `0x${s}`;
}
function typeKey(t) {
    return t.trim().replace(/^0x/i, '').toLowerCase();
}
async function getJson(path) {
    const res = await fetch(extFetchUrl(`${API}${path}`), { signal: AbortSignal.timeout(20_000) });
    if (!res.ok)
        throw new Error(`Current API ${res.status} ${path}`);
    const json = (await res.json());
    if (json.code != null && json.code !== 0) {
        throw new Error(`Current API ${json.message ?? json.code} ${path}`);
    }
    return json.data;
}
let marketCache = null;
export function currentMarketListMeta() {
    if (!marketCache)
        return { receivedAtMs: null, ageMs: null, partial: false, failedMarkets: [] };
    return {
        receivedAtMs: marketCache.ts,
        ageMs: Date.now() - marketCache.ts,
        partial: marketCache.partial,
        failedMarkets: marketCache.failed,
    };
}
async function fetchMarketListPage(marketType) {
    const q = marketType
        ? `/market/getMarketList?page=1&size=100&marketType=${encodeURIComponent(marketType)}`
        : '/market/getMarketList?page=1&size=100';
    const data = await getJson(q);
    return data?.content ?? [];
}
export async function fetchAllMarketRows() {
    const now = Date.now();
    if (!marketCache || now - marketCache.ts >= 60_000) {
        const failed = [];
        const pages = await Promise.all(MARKET_LIST_TYPES.map(async (t) => {
            try {
                return await fetchMarketListPage(t);
            }
            catch (err) {
                console.warn('[Current] market list skipped', t, err);
                failed.push(t);
                return [];
            }
        }));
        const merged = [];
        const seen = new Set();
        for (const page of pages) {
            for (const row of page) {
                const key = `${typeKey(row.marketType ?? '')}|${typeKey(row.token ?? '')}`;
                if (seen.has(key))
                    continue;
                seen.add(key);
                merged.push(row);
            }
        }
        // Fallback: unfiltered list (Main) if typed queries all failed.
        if (merged.length === 0) {
            try {
                merged.push(...(await fetchMarketListPage()));
            }
            catch (err) {
                console.warn('[Current] unfiltered market list failed', err);
                failed.push('unfiltered');
            }
        }
        marketCache = {
            ts: now,
            rows: merged,
            partial: failed.length > 0 || merged.length === 0,
            failed,
        };
    }
    return marketCache.rows;
}
/** Rows for this market type only. Other markets are not a stand-in. */
function rowsForMarket(all, marketType) {
    const key = typeKey(marketType);
    return all.filter((r) => typeKey(r.marketType ?? '') === key);
}
function venueName(marketType) {
    const name = marketType.split('::').pop() ?? 'Market';
    if (name === 'MainMarket')
        return 'Main';
    if (name === 'EmberMarket')
        return 'Ember';
    if (name === 'AltCoinMarket')
        return 'AltCoin';
    if (name === 'EthenaMarket')
        return 'Ethena';
    if (name === 'MatrixGoldMarket')
        return 'Matrix Gold';
    return name.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}
function resolveMarketObjectId(marketType, listed) {
    const fromList = listed.find((r) => r.marketID)?.marketID;
    if (typeof fromList === 'string' && fromList.startsWith('0x'))
        return fromList;
    const key = typeKey(marketType);
    for (const [t, id] of Object.entries(MARKET_OBJECT_BY_TYPE)) {
        if (typeKey(t) === key)
            return id;
    }
    return null;
}
/** Obligation field `lending_market_id` when list/SDK map have no object id. */
async function readLendingMarketId(obligationId) {
    const client = suiClient;
    const obj = await client.getObject({ id: obligationId, options: { showContent: true } });
    const id = obj.data?.content?.fields
        ?.lending_market_id;
    return typeof id === 'string' && id.startsWith('0x') ? id : null;
}
function flowKey(marketType, coin) {
    return `${typeKey(marketType)}|${typeKey(coin)}`;
}
function marketByToken(rows, asset) {
    const key = typeKey(asset);
    return rows.find((r) => typeKey(r.token ?? '') === key);
}
async function inspectOverview(marketType, marketId, obligationId, sender) {
    const client = suiClient;
    const tx = new Transaction();
    tx.moveCall({
        target: `${PROTOCOL_PKG}::obligation_query::get_obligation_overview`,
        typeArguments: [with0x(marketType)],
        arguments: [tx.object(marketId), tx.pure.id(obligationId)],
    });
    const res = await client.devInspectTransactionBlock({ sender, transactionBlock: tx });
    if (res.error)
        throw new Error(`Current overview: ${res.error}`);
    const raw = res.results?.[0]?.returnValues?.[0]?.[0];
    if (!raw)
        throw new Error('Current overview: empty return');
    return overviewSchema.parse(Uint8Array.from(raw));
}
async function inspectRates(marketType, marketId, assets, sender) {
    const out = new Map();
    if (assets.length === 0)
        return out;
    const client = suiClient;
    const tx = new Transaction();
    for (const asset of assets) {
        tx.moveCall({
            target: `${PROTOCOL_PKG}::market_query::get_asset_market_rates`,
            typeArguments: [with0x(marketType)],
            arguments: [tx.object(marketId), tx.pure.string(asset.replace(/^0x/i, '')), tx.object('0x6')],
        });
    }
    const res = await client.devInspectTransactionBlock({ sender, transactionBlock: tx });
    if (res.error)
        throw new Error(`Current rates: ${res.error}`);
    const vec = bcs.vector(decimalSchema);
    for (let i = 0; i < assets.length; i++) {
        const raw = res.results?.[i]?.returnValues?.[0]?.[0];
        if (!raw)
            continue;
        const parsed = vec.parse(Uint8Array.from(raw));
        out.set(typeKey(assets[i]), {
            exchange: BigInt(parsed[0]?.value ?? 0),
            borrowIndex: BigInt(parsed[1]?.value ?? 0),
        });
    }
    return out;
}
const overviewDecimal = bcs.struct('OverviewDecimal', { value: bcs.u256() });
const assetOverviewSchema = bcs.struct('AssetConfiguration', {
    coin_type: bcs.string(),
    interest_model: bcs.struct('InterestModel', {
        base_borrow_rate_per_sec: overviewDecimal,
        borrow_rate_on_mid_kink: overviewDecimal,
        mid_kink: overviewDecimal,
        borrow_rate_on_high_kink: overviewDecimal,
        high_kink: overviewDecimal,
        max_borrow_rate: overviewDecimal,
    }),
    utilization_rate: overviewDecimal,
    borrow_paused: bcs.bool(),
    deposit_paused: bcs.bool(),
    withdraw_paused: bcs.bool(),
    liquidation_paused: bcs.bool(),
    flash_loan_paused: bcs.bool(),
    reserve: bcs.u64(),
    asset_setting: bcs.struct('BorrowConfig', {
        min_borrow_amount: bcs.u64(),
        max_borrow_amount: bcs.u64(),
        max_deposit_amount: bcs.u64(),
        repay_fee_rate: overviewDecimal,
        liquidation_fee_rate: overviewDecimal,
    }),
    deposit_usage: bcs.struct('AssetDeposit', {
        is_collateral: bcs.bool(),
        valuation: bcs.struct('AssetValuation', {
            coin_type: bcs.string(),
            amount: bcs.u64(),
            usd: overviewDecimal,
            price: overviewDecimal,
        }),
        ctoken_amount: bcs.u64(),
        exchange_rate: overviewDecimal,
    }),
    borrow_usage: bcs.struct('AssetBorrow', {
        valuation: bcs.struct('BorrowValuation', {
            coin_type: bcs.string(),
            amount: bcs.u64(),
            usd: overviewDecimal,
            price: overviewDecimal,
        }),
        borrow_index: overviewDecimal,
    }),
});
function wadMul(a, b) {
    return (a * b) / DECIMAL_SCALE;
}
function wadDiv(a, b) {
    if (b === 0n)
        return 0n;
    return (a * DECIMAL_SCALE) / b;
}
/** SDK `borrowInterestRate`: kinked per-second borrow rate. */
function borrowRatePerSec(model, utilization) {
    const base = BigInt(model.base_borrow_rate_per_sec.value);
    const mid = BigInt(model.mid_kink.value);
    const high = BigInt(model.high_kink.value);
    const onMid = BigInt(model.borrow_rate_on_mid_kink.value);
    const onHigh = BigInt(model.borrow_rate_on_high_kink.value);
    const max = BigInt(model.max_borrow_rate.value);
    const gap = (a, b) => (a > b ? a - b : 0n);
    if (utilization <= mid)
        return wadMul(wadDiv(utilization, mid), gap(onMid, base)) + base;
    if (utilization <= high)
        return wadMul(wadDiv(gap(utilization, mid), gap(high, mid)), gap(onHigh, onMid)) + onMid;
    return wadMul(wadDiv(gap(utilization, high), gap(DECIMAL_SCALE, high)), gap(max, onHigh)) + onHigh;
}
function aprFromPerSec(perSec) {
    const annual = (perSec * SECONDS_PER_YEAR * 1000000000000n) / DECIMAL_SCALE;
    return Number(annual) / 1_000_000_000_000;
}
/**
 * Base supply/borrow APR for markets missing from `/market/getMarketList`.
 * Official `market_query::get_asset_market_overview` plus SDK `depositInterestRate`:
 * supply per second = borrow per second × (1 − repay fee) × utilization,
 * then × 31_536_000. Matches MainMarket `supplyAPY` exactly.
 */
async function inspectInterestApr(marketType, marketId, assets, sender) {
    const out = new Map();
    if (assets.length === 0)
        return out;
    const client = suiClient;
    const tx = new Transaction();
    for (const asset of assets) {
        tx.moveCall({
            target: `${PROTOCOL_PKG}::market_query::get_asset_market_overview`,
            typeArguments: [with0x(marketType)],
            arguments: [
                tx.object(marketId),
                tx.pure.string(asset.replace(/^0x/i, '')),
                tx.object(COIN_DECIMALS_REGISTRY),
                tx.pure.u64(DECIMAL_SCALE),
                tx.pure.u64(DECIMAL_SCALE),
                tx.object('0x6'),
            ],
        });
    }
    const res = await client.devInspectTransactionBlock({ sender, transactionBlock: tx });
    if (res.error)
        throw new Error(`Current interest overview: ${res.error}`);
    for (let i = 0; i < assets.length; i++) {
        const raw = res.results?.[i]?.returnValues?.[0]?.[0];
        if (!raw)
            continue;
        const asset = assetOverviewSchema.parse(Uint8Array.from(raw));
        const utilization = BigInt(asset.utilization_rate.value);
        const fee = BigInt(asset.asset_setting.repay_fee_rate.value);
        const borrowPerSec = asset.borrow_paused ? 0n : borrowRatePerSec(asset.interest_model, utilization);
        const supplyPerSec = wadMul(wadMul(borrowRatePerSec(asset.interest_model, utilization), DECIMAL_SCALE - fee), utilization);
        out.set(typeKey(assets[i]), { supply: aprFromPerSec(supplyPerSec), borrow: aprFromPerSec(borrowPerSec) });
    }
    return out;
}
function humanFromRaw(raw, decimals) {
    const scale = 10 ** decimals;
    const neg = raw < 0n;
    const v = neg ? -raw : raw;
    const whole = v / BigInt(scale);
    const frac = v % BigInt(scale);
    const n = Number(whole) + Number(frac) / scale;
    return neg ? -n : n;
}
function coinRaw(scaled, scale = DECIMAL_SCALE) {
    if (scale === 0n)
        return 0n;
    return scaled / scale;
}
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
function normTypeName(s) {
    const parts = s.trim().replace(/^0x/i, '').split('::');
    if (parts.length < 3)
        return s.trim().replace(/^0x/i, '');
    return `${parts[0].padStart(64, '0').toLowerCase()}::${parts.slice(1).join('::')}`;
}
function readDecimals(meta) {
    const d = Number(meta?.tokenInfo?.decimals);
    return Number.isFinite(d) && d >= 0 && d <= 18 ? d : null;
}
function readPrice(meta) {
    const p = Number(meta?.tokenInfo?.price);
    return Number.isFinite(p) && p > 0 ? p : null;
}
/** Liquidity-mining APR. Confirmed empty (no pool) is apr 0. RPC/metadata failures stay unavailable. */
export async function readMiningRewardApr(marketId, side, reserveCoin, exchangeOrIndex, reserveDecimals, reservePrice, listed) {
    const readAtMs = Date.now();
    if (!(reservePrice > 0) || exchangeOrIndex <= 0n || !(reserveDecimals >= 0)) {
        return { status: 'unavailable', apr: null, parts: [], reason: 'reserve price or scale missing', readAtMs };
    }
    let market;
    try {
        market = await suiClient.getObject({ id: marketId, options: { showContent: true } });
    }
    catch (err) {
        return { status: 'unavailable', apr: null, parts: [], reason: err instanceof Error ? err.message : String(err), readAtMs };
    }
    const marketClass = classifySuiObjectRead(market);
    if (marketClass.kind !== 'ok') {
        return { status: 'unavailable', apr: null, parts: [], reason: marketClass.reason || 'market object', readAtMs };
    }
    const content = fieldsOf(market.data?.content);
    const miner = fieldsOf(content?.liquidity_miner);
    const tableId = uidOf(miner?.[side]);
    if (!miner) {
        return { status: 'unavailable', apr: null, parts: [], reason: 'malformed liquidity miner', readAtMs };
    }
    if (!tableId) {
        return { status: 'empty', apr: 0, parts: [], reason: 'no mining table', readAtMs };
    }
    let df;
    try {
        df = await suiClient.getDynamicFieldObject({
            parentId: tableId,
            name: { type: '0x1::type_name::TypeName', value: { name: normTypeName(reserveCoin) } },
        });
    }
    catch (err) {
        const classified = classifySuiObjectRead(null, err);
        if (classified.kind === 'not_found')
            return { status: 'empty', apr: 0, parts: [], readAtMs };
        return { status: 'unavailable', apr: null, parts: [], reason: classified.reason, readAtMs };
    }
    const dfClass = classifySuiObjectRead(df);
    if (dfClass.kind === 'not_found')
        return { status: 'empty', apr: 0, parts: [], readAtMs };
    if (dfClass.kind !== 'ok') {
        return { status: 'unavailable', apr: null, parts: [], reason: dfClass.reason, readAtMs };
    }
    const manager = fieldsOf(fieldsOf(df.data?.content)?.value);
    if (!manager) {
        return { status: 'unavailable', apr: null, parts: [], reason: 'malformed reward manager', readAtMs };
    }
    const totalShares = BigInt(String(manager.total_shares ?? '0'));
    if (totalShares <= 0n)
        return { status: 'empty', apr: 0, parts: [], readAtMs };
    const underlyingRaw = coinRaw(totalShares * exchangeOrIndex);
    const tvl = humanFromRaw(underlyingRaw, reserveDecimals) * reservePrice;
    if (!(tvl > 0))
        return { status: 'unavailable', apr: null, parts: [], reason: 'reserve tvl missing', readAtMs };
    const now = Date.now();
    const parts = [];
    let missingMeta = false;
    const rewards = Array.isArray(manager.pool_rewards) ? manager.pool_rewards : [];
    for (const reward of rewards) {
        const f = fieldsOf(reward) ?? {};
        const start = Number(f.start_time_ms ?? 0);
        const end = Number(f.end_time_ms ?? 0);
        if (!(start <= now && now < end) || end <= start)
            continue;
        const coin = typeNameString(f.coin_type);
        if (!coin)
            continue;
        const meta = marketByToken(listed, coin);
        const dec = readDecimals(meta);
        const price = readPrice(meta);
        const raw = String(f.total_rewards ?? '0');
        if (dec == null || price == null) {
            missingMeta = true;
            parts.push({
                symbol: meta?.tokenInfo?.symbol ?? coin.split('::').pop() ?? '?',
                coinType: with0x(coin),
                apr: null,
                amountRaw: raw,
                decimals: dec,
                priceUsd: price,
            });
            continue;
        }
        const total = humanFromRaw(BigInt(raw), dec);
        const annual = total * (YEAR_MS / (end - start));
        const apr = (annual * price) / tvl;
        parts.push({
            symbol: meta?.tokenInfo?.symbol ?? coin.split('::').pop() ?? '?',
            coinType: with0x(coin),
            apr,
            amountRaw: raw,
            decimals: dec,
            priceUsd: price,
        });
    }
    const priced = parts.filter((p) => p.apr != null);
    if (parts.length === 0)
        return { status: 'empty', apr: 0, parts: [], readAtMs };
    if (missingMeta) {
        return {
            status: 'partial',
            apr: priced.reduce((s, p) => s + (p.apr ?? 0), 0),
            parts,
            reason: 'reward metadata incomplete',
            readAtMs,
        };
    }
    return { status: 'complete', apr: priced.reduce((s, p) => s + (p.apr ?? 0), 0), parts, readAtMs };
}
/** Compatibility adapter. Throws when the read is unavailable so callers cannot treat it as zero. */
export async function miningRewardApr(marketId, side, reserveCoin, exchangeOrIndex, reserveDecimals, reservePrice, listed) {
    const read = await readMiningRewardApr(marketId, side, reserveCoin, exchangeOrIndex, reserveDecimals, reservePrice, listed);
    if (read.status === 'unavailable')
        throw new Error(read.reason ?? 'mining apr unavailable');
    return {
        apr: read.apr ?? 0,
        parts: read.parts
            .filter((p) => p.apr != null)
            .map((p) => ({ symbol: p.symbol, coinType: p.coinType, apr: p.apr })),
    };
}
function moveDecimal(v) {
    if (v == null)
        return 0n;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint')
        return BigInt(v);
    const o = v;
    if (o.value != null)
        return BigInt(o.value);
    if (o.fields?.value != null)
        return BigInt(o.fields.value);
    return 0n;
}
/** JSON-RPC nests Move structs under `.fields`; gRPC/GraphQL json is flat. */
function fieldsOf(v) {
    if (!v || typeof v !== 'object')
        return null;
    const o = v;
    if (o.fields && typeof o.fields === 'object')
        return o.fields;
    return o;
}
function uidOf(v) {
    if (typeof v === 'string' && v.startsWith('0x'))
        return v;
    const f = fieldsOf(v);
    const id = f?.id;
    if (typeof id === 'string' && id.startsWith('0x'))
        return id;
    if (id && typeof id === 'object') {
        const inner = id.id;
        if (typeof inner === 'string' && inner.startsWith('0x'))
            return inner;
    }
    return null;
}
function typeNameString(v) {
    if (typeof v === 'string')
        return v;
    const f = fieldsOf(v);
    if (typeof f?.name === 'string')
        return f.name;
    return '';
}
function mulDec(a, b) {
    return (a * b) / DECIMAL_SCALE;
}
function divDec(a, b) {
    if (b === 0n)
        return 0n;
    return (a * DECIMAL_SCALE) / b;
}
/** Raw claimable per reward coin. Matches Current SDK `calculateClaimableRewards`. */
function claimableRows(pool, ob, now) {
    const share = BigInt(String(ob.share ?? '0'));
    const totalShares = BigInt(String(pool.total_shares ?? '0'));
    if (share <= 0n || totalShares <= 0n)
        return [];
    const poolLast = BigInt(String(pool.last_update_time_ms ?? '0'));
    const obLast = BigInt(String(ob.last_update_time_ms ?? '0'));
    const rewards = Array.isArray(pool.pool_rewards) ? pool.pool_rewards : [];
    const slots = Array.isArray(ob.rewards) ? ob.rewards : [];
    const totalSharesDec = totalShares * DECIMAL_SCALE;
    const out = [];
    for (let i = 0; i < rewards.length; i++) {
        const f = fieldsOf(rewards[i]) ?? {};
        const start = BigInt(String(f.start_time_ms ?? '0'));
        const end = BigInt(String(f.end_time_ms ?? '0'));
        const duration = end > start ? end - start : 0n;
        let updated = moveDecimal(f.cumulative_rewards_per_share);
        if (now > poolLast && duration > 0n) {
            const maxStart = start > poolLast ? start : poolLast;
            const minEnd = end < now ? end : now;
            if (minEnd > maxStart) {
                const timePassed = minEnd - maxStart;
                const totalRewards = BigInt(String(f.total_rewards ?? '0'));
                const unlocked = divDec(mulDec(totalRewards * DECIMAL_SCALE, timePassed * DECIMAL_SCALE), duration * DECIMAL_SCALE);
                updated += divDec(unlocked, totalSharesDec);
            }
        }
        const slot = fieldsOf(slots[i]);
        let prev;
        let earned = 0n;
        if (slot && slot.cumulative_rewards_per_share != null && slot.earned_rewards != null) {
            prev = moveDecimal(slot.cumulative_rewards_per_share);
            earned = moveDecimal(slot.earned_rewards);
        }
        else if (obLast <= end) {
            if (obLast <= start)
                earned = updated * share;
            prev = updated;
        }
        else {
            prev = updated;
        }
        const claim = (earned + (updated - prev) * share) / DECIMAL_SCALE;
        if (claim <= 0n)
            continue;
        const coin = typeNameString(f.coin_type);
        if (!coin)
            continue;
        out.push({ coin, raw: claim });
    }
    return out;
}
/** Claimable LM tokens. Confirmed absence is empty; RPC failures are unavailable. */
export async function readClaimableMining(marketId, obligationId, deposits, borrows, listed) {
    const readAtMs = Date.now();
    const bySide = {
        deposit: [...new Set(deposits.map(normTypeName))],
        borrow: [...new Set(borrows.map(normTypeName))],
    };
    if (bySide.deposit.length === 0 && bySide.borrow.length === 0) {
        return { status: 'empty', rows: [], readAtMs };
    }
    let market;
    try {
        market = await suiClient.getObject({ id: marketId, options: { showContent: true } });
    }
    catch (err) {
        return {
            status: 'unavailable',
            rows: [],
            reason: err instanceof Error ? err.message : String(err),
            readAtMs,
        };
    }
    const marketClass = classifySuiObjectRead(market);
    if (marketClass.kind !== 'ok') {
        return { status: 'unavailable', rows: [], reason: marketClass.reason || 'market object', readAtMs };
    }
    const miner = fieldsOf(fieldsOf(market.data?.content)?.liquidity_miner);
    if (!miner)
        return { status: 'unavailable', rows: [], reason: 'malformed liquidity miner', readAtMs };
    const now = BigInt(Date.now());
    const rawByCoin = new Map();
    let sawError = false;
    let errorReason = '';
    let sawPool = false;
    const sides = ['deposit', 'borrow'];
    for (const side of sides) {
        const coins = bySide[side];
        if (coins.length === 0)
            continue;
        const parentId = uidOf(miner[side]);
        if (!parentId)
            continue;
        for (const coin of coins) {
            let poolDf;
            try {
                poolDf = await suiClient.getDynamicFieldObject({
                    parentId,
                    name: { type: '0x1::type_name::TypeName', value: { name: coin } },
                });
            }
            catch (err) {
                const classified = classifySuiObjectRead(null, err);
                if (classified.kind === 'not_found')
                    continue;
                sawError = true;
                errorReason = classified.reason;
                continue;
            }
            const poolClass = classifySuiObjectRead(poolDf);
            if (poolClass.kind === 'not_found')
                continue;
            if (poolClass.kind !== 'ok') {
                sawError = true;
                errorReason = poolClass.reason;
                continue;
            }
            const pool = fieldsOf(fieldsOf(poolDf.data?.content)?.value);
            if (!pool) {
                sawError = true;
                errorReason = 'malformed reward pool';
                continue;
            }
            sawPool = true;
            const obParent = uidOf(pool.obligation_reward_managers);
            if (!obParent)
                continue;
            let obDf;
            try {
                obDf = await suiClient.getDynamicFieldObject({
                    parentId: obParent,
                    name: { type: '0x2::object::ID', value: obligationId },
                });
            }
            catch (err) {
                const classified = classifySuiObjectRead(null, err);
                if (classified.kind === 'not_found')
                    continue;
                sawError = true;
                errorReason = classified.reason;
                continue;
            }
            const obClass = classifySuiObjectRead(obDf);
            if (obClass.kind === 'not_found')
                continue;
            if (obClass.kind !== 'ok') {
                sawError = true;
                errorReason = obClass.reason;
                continue;
            }
            const ob = fieldsOf(fieldsOf(obDf.data?.content)?.value);
            if (!ob) {
                sawError = true;
                errorReason = 'malformed obligation rewards';
                continue;
            }
            for (const row of claimableRows(pool, ob, now)) {
                rawByCoin.set(row.coin, (rawByCoin.get(row.coin) ?? 0n) + row.raw);
            }
        }
    }
    const rows = [];
    let missingMeta = false;
    for (const [coin, raw] of rawByCoin) {
        if (raw <= 0n)
            continue;
        const meta = marketByToken(listed, coin);
        const decimals = readDecimals(meta);
        const price = readPrice(meta);
        const amount = decimals != null ? humanFromRaw(raw, decimals) : null;
        if (decimals == null || price == null || amount == null)
            missingMeta = true;
        rows.push({
            coinType: with0x(coin),
            symbol: meta?.tokenInfo?.symbol ?? coin.split('::').pop() ?? '?',
            amountRaw: raw.toString(),
            decimals,
            amount,
            valueUSD: amount != null && price != null ? amount * price : null,
        });
    }
    if (sawError && rows.length === 0 && !sawPool) {
        return { status: 'unavailable', rows: [], reason: errorReason || 'reward read failed', readAtMs };
    }
    if (rows.length === 0 && !sawError)
        return { status: 'empty', rows: [], readAtMs };
    if (sawError || missingMeta) {
        return { status: 'partial', rows, reason: errorReason || 'reward metadata incomplete', readAtMs };
    }
    return { status: 'complete', rows, readAtMs };
}
/** Adapter for Current Lend. Throws on unavailable so an empty list is not a failed read. */
export async function claimableMining(marketId, obligationId, deposits, borrows, listed) {
    const read = await readClaimableMining(marketId, obligationId, deposits, borrows, listed);
    if (read.status === 'unavailable')
        throw new Error(read.reason ?? 'claimable rewards unavailable');
    const out = [];
    for (const row of read.rows) {
        if (row.amount == null || row.valueUSD == null)
            continue;
        out.push({
            coinType: row.coinType,
            symbol: row.symbol,
            amount: row.amount,
            valueUSD: row.valueUSD,
        });
    }
    return out;
}
function mergeClaimed(rows) {
    const map = new Map();
    for (const r of rows) {
        const prev = map.get(r.coinType);
        if (!prev) {
            map.set(r.coinType, { ...r });
            continue;
        }
        prev.amount += r.amount;
        prev.valueUSD += r.valueUSD;
    }
    return [...map.values()];
}
const TX_DEPOSIT = 1;
const TX_WITHDRAW = 2;
const TX_BORROW = 3;
const TX_REPAY = 4;
const TX_LIQUIDATE = 5;
function num(v) {
    const n = typeof v === 'number' ? v : Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
}
async function usdAt(symbol, coinType, timestampMs, fallback, cache) {
    const sec = Math.floor(timestampMs / 1000);
    const key = `${typeKey(coinType || symbol)}:${sec}`;
    const hit = cache.get(key);
    if (hit)
        return hit;
    const quote = symbol
        ? await getUsdPerTokenAtTimestamp(symbol, with0x(coinType), sec).catch(() => null)
        : null;
    if (quote?.usdPerToken != null && quote.usdPerToken > 0) {
        const row = { px: quote.usdPerToken, spot: quote.approximate };
        cache.set(key, row);
        return row;
    }
    return { px: Number.isFinite(fallback) && fallback > 0 ? fallback : 0, spot: true };
}
async function fetchMarketHistory(address, marketType) {
    const out = [];
    for (let page = 1; page <= 20; page++) {
        const q = new URLSearchParams({
            userAddress: address,
            marketType,
            product: '1',
            page: String(page),
            size: '50',
        });
        const data = await getJson(`/user/getMarketTransactionHistory?${q}`);
        out.push(...(data?.content ?? []));
        if (data?.last !== false)
            break;
    }
    return out;
}
/**
 * Current history API (`/user/getMarketTransactionHistory`, product=Market).
 * Maps are token amounts: deposits minus withdrawals, borrows minus repayments.
 * Repay refund is change returned, so it is not part of the repayment.
 * Claimed rewards are priced at the claim. Interest USD is applied by the caller
 * from the token delta at the current price.
 */
async function loadCashflowTokens(address, marketTypes, listed) {
    const items = [];
    const historyFailed = new Set();
    for (const marketType of marketTypes) {
        try {
            const page = await fetchMarketHistory(address, marketType);
            for (const item of page)
                items.push({ ...item, marketType });
        }
        catch (err) {
            historyFailed.add(typeKey(marketType));
            console.warn('[Current] history skipped', marketType, err);
        }
    }
    items.sort((a, b) => (a.chainTimestampMS ?? 0) - (b.chainTimestampMS ?? 0));
    const cache = new Map();
    const deposited = new Map();
    const borrowed = new Map();
    const borrowedCoins = new Set();
    const add = (map, coin, amount) => {
        map.set(coin, (map.get(coin) ?? 0) + amount);
    };
    for (const item of items) {
        const coin = typeKey(item.token ?? '');
        const market = item.marketType ?? '';
        if (!coin || !market)
            continue;
        const key = flowKey(market, coin);
        const decimals = Number(item.tokenInfo?.decimals ?? 0);
        const scale = 10 ** (Number.isFinite(decimals) ? decimals : 0);
        const human = num(item.amount) / scale;
        const refundHuman = num(item.refund) / scale;
        if (!(human > 0))
            continue;
        const type = item.type;
        if (type === TX_DEPOSIT)
            add(deposited, key, human);
        else if (type === TX_WITHDRAW)
            add(deposited, key, -human);
        else if (type === TX_BORROW) {
            borrowedCoins.add(key);
            add(borrowed, key, human);
        }
        else if (type === TX_REPAY) {
            add(borrowed, key, -Math.max(0, human - refundHuman));
        }
        else if (type === TX_LIQUIDATE) {
            if (borrowedCoins.has(key))
                add(borrowed, key, -human);
            else
                add(deposited, key, -human);
        }
    }
    let claimedRewardsUSD = 0;
    let usedSpotPrice = false;
    const claims = await getJson(`/user/getLiquidityMiningHistory/${address}`).catch(() => []);
    for (const row of claims ?? []) {
        const ts = row.chainTimestampMs ?? 0;
        for (const reward of row.rewards ?? []) {
            const coin = reward.rewardCoinType ?? '';
            const meta = marketByToken(listed, coin);
            const decimals = Number(meta?.tokenInfo?.decimals ?? (coin.endsWith('::sui::SUI') ? 9 : 6));
            const human = num(reward.rewardAmount) / 10 ** (Number.isFinite(decimals) ? decimals : 9);
            if (!(human > 0))
                continue;
            const symbol = meta?.tokenInfo?.symbol ?? coin.split('::').pop() ?? '';
            const fallback = Number(meta?.tokenInfo?.price ?? 0);
            const { px, spot } = await usdAt(symbol, coin, ts, fallback, cache);
            if (spot)
                usedSpotPrice = true;
            if (px > 0)
                claimedRewardsUSD += human * px;
        }
    }
    return { deposited, borrowed, claimedRewardsUSD, usedSpotPrice, historyFailed };
}
export async function getCurrentPositions(walletAddress) {
    const obligations = await getJson(`/user/getObligationList/${walletAddress}`);
    const rows = (obligations ?? []).filter((o) => o.obligationObject && o.marketType);
    if (rows.length === 0)
        return EMPTY_CURRENT_SNAP;
    const supplies = [];
    const borrows = [];
    const claimed = [];
    const marketTypes = [];
    const marketOf = new Map();
    /** Per-borrow API `borrowWeight` (default 1). */
    const borrowWeightOf = new Map();
    /** Per-supply API `maxLTV` for safe borrow limit. */
    const maxLtvOf = new Map();
    const allListed = await fetchAllMarketRows();
    let skippedObligations = 0;
    for (const ob of rows) {
        const marketType = ob.marketType;
        try {
            if (!marketTypes.includes(marketType))
                marketTypes.push(marketType);
            const listed = rowsForMarket(allListed, marketType);
            const priceRows = listed.length > 0 ? listed : allListed;
            const marketObjectId = resolveMarketObjectId(marketType, listed) ??
                (await readLendingMarketId(ob.obligationObject)) ??
                undefined;
            if (!marketObjectId) {
                throw new Error(`Current market object missing for ${marketType}`);
            }
            const overview = await inspectOverview(marketType, marketObjectId, ob.obligationObject, walletAddress);
            const assets = [
                ...overview.deposits.map((d) => d.asset),
                ...overview.borrows.map((b) => b.asset),
            ];
            const rates = await inspectRates(marketType, marketObjectId, assets, walletAddress);
            const chainApr = listed.length > 0
                ? new Map()
                : await inspectInterestApr(marketType, marketObjectId, assets, walletAddress).catch((err) => {
                    console.warn('[Current] interest overview', marketType, err);
                    return new Map();
                });
            for (const dep of overview.deposits) {
                const own = marketByToken(listed, dep.asset);
                const meta = own ?? marketByToken(priceRows, dep.asset);
                const rate = rates.get(typeKey(dep.asset));
                const exchange = rate?.exchange ?? DECIMAL_SCALE;
                const decimals = Number(meta?.tokenInfo?.decimals ?? 9);
                const raw = coinRaw(BigInt(dep.ctoken_amount) * exchange);
                const amount = humanFromRaw(raw, decimals);
                if (amount <= 0)
                    continue;
                const price = Number(meta?.tokenInfo?.price ?? 0);
                const usd = amount * (Number.isFinite(price) ? price : 0);
                const baseApr = Number(own?.supplyAPY ?? chainApr.get(typeKey(dep.asset))?.supply ?? 0);
                const mining = await readMiningRewardApr(marketObjectId, 'deposit', dep.asset, exchange, decimals, price, priceRows).catch((err) => ({
                    status: 'unavailable',
                    apr: null,
                    parts: [],
                    reason: err instanceof Error ? err.message : String(err),
                    readAtMs: Date.now(),
                }));
                const rewardKnown = mining.status === 'complete' || mining.status === 'empty';
                const rewardApr = rewardKnown ? (mining.apr ?? 0) : 0;
                const symbol = meta?.tokenInfo?.symbol ?? dep.asset.split('::').pop() ?? '?';
                const supply = {
                    id: `current-supply-${ob.obligationObject}-${typeKey(dep.asset)}`,
                    asset: symbol,
                    coinType: with0x(dep.asset),
                    sCoinType: '',
                    suppliedAmount: amount,
                    currentAmount: amount,
                    earnedInterest: 0,
                    earnedInterestUSD: 0,
                    supplyAPR: (Number.isFinite(baseApr) ? baseApr : 0) + (rewardKnown ? rewardApr : 0),
                    supplyRewardAPR: rewardKnown ? rewardApr : undefined,
                    aprBreakdown: {
                        baseAPR: Number.isFinite(baseApr) ? baseApr : 0,
                        rewardAPR: rewardKnown ? rewardApr : Number.NaN,
                        rewards: mining.parts
                            .filter((p) => p.apr != null)
                            .map((p) => ({ symbol: p.symbol, coinType: p.coinType, apr: p.apr })),
                        rewardReadStatus: mining.status,
                    },
                    currentValueUSD: usd,
                    liquidationThresholdFactor: normalizeLiquidationThresholdFactor(Number(own?.liqLTV ?? 0)) || undefined,
                    startedAt: 0,
                    daysActive: 0,
                    events: [],
                    protocol: 'Current',
                    venue: venueName(marketType),
                    iconUrl: meta?.tokenInfo?.icon ?? null,
                };
                const maxLtv = normalizeLiquidationThresholdFactor(Number(own?.maxLTV ?? 0));
                if (maxLtv > 0)
                    maxLtvOf.set(supply, maxLtv);
                marketOf.set(supply, marketType);
                supplies.push(supply);
            }
            for (const bor of overview.borrows) {
                const own = marketByToken(listed, bor.asset);
                const meta = own ?? marketByToken(priceRows, bor.asset);
                const rate = rates.get(typeKey(bor.asset));
                const marketIndex = rate?.borrowIndex ?? DECIMAL_SCALE;
                const stored = BigInt(bor.borrow_index.value);
                const debt = BigInt(bor.debt.value);
                const scaled = stored > 0n ? (debt * marketIndex) / stored : debt;
                const decimals = Number(meta?.tokenInfo?.decimals ?? 6);
                const amount = humanFromRaw(coinRaw(scaled), decimals);
                if (amount <= 0)
                    continue;
                const price = Number(meta?.tokenInfo?.price ?? 0);
                const usd = amount * (Number.isFinite(price) ? price : 0);
                const baseApr = Number(own?.borrowAPY ?? chainApr.get(typeKey(bor.asset))?.borrow ?? 0);
                const bwRaw = Number(own?.borrowWeight ?? 1);
                const borrowWeight = Number.isFinite(bwRaw) && bwRaw > 0 ? bwRaw : 1;
                const mining = await readMiningRewardApr(marketObjectId, 'borrow', bor.asset, DECIMAL_SCALE, decimals, price, priceRows).catch((err) => ({
                    status: 'unavailable',
                    apr: null,
                    parts: [],
                    reason: err instanceof Error ? err.message : String(err),
                    readAtMs: Date.now(),
                }));
                const rewardKnown = mining.status === 'complete' || mining.status === 'empty';
                const rewardApr = rewardKnown ? (mining.apr ?? 0) : 0;
                const netCost = (Number.isFinite(baseApr) ? baseApr : 0) - (rewardKnown ? rewardApr : 0);
                const symbol = meta?.tokenInfo?.symbol ?? bor.asset.split('::').pop() ?? '?';
                const borrow = {
                    id: `current-borrow-${ob.obligationObject}-${typeKey(bor.asset)}`,
                    obligationId: ob.obligationObject,
                    asset: symbol,
                    coinType: with0x(bor.asset),
                    borrowedAmount: amount,
                    currentDebt: amount,
                    accruedInterest: 0,
                    accruedInterestUSD: 0,
                    borrowAPR: netCost,
                    borrowRewardAPR: rewardKnown ? rewardApr : undefined,
                    netBorrowCost: netCost,
                    aprBreakdown: {
                        baseAPR: Number.isFinite(baseApr) ? baseApr : 0,
                        rewardAPR: rewardKnown ? rewardApr : Number.NaN,
                        rewards: mining.parts
                            .filter((p) => p.apr != null)
                            .map((p) => ({ symbol: p.symbol, coinType: p.coinType, apr: p.apr })),
                        rewardReadStatus: mining.status,
                    },
                    currentDebtUSD: usd,
                    collateral: [],
                    healthFactor: 0,
                    liquidationThreshold: 0,
                    startedAt: 0,
                    daysActive: 0,
                    events: [],
                    protocol: 'Current',
                    venue: venueName(marketType),
                    iconUrl: meta?.tokenInfo?.icon ?? null,
                };
                borrowWeightOf.set(borrow, borrowWeight);
                marketOf.set(borrow, marketType);
                borrows.push(borrow);
            }
            const mined = await readClaimableMining(marketObjectId, ob.obligationObject, overview.deposits.map((d) => d.asset), overview.borrows.map((b) => b.asset), priceRows).catch((err) => ({
                status: 'unavailable',
                rows: [],
                reason: err instanceof Error ? err.message : String(err),
                readAtMs: Date.now(),
            }));
            if (mined.status === 'unavailable') {
                console.warn('[Current] claimable rewards unavailable', ob.obligationObject, mined.reason);
            }
            else {
                for (const row of mined.rows) {
                    if (row.amount == null || row.valueUSD == null)
                        continue;
                    claimed.push({
                        coinType: row.coinType,
                        symbol: row.symbol,
                        amount: row.amount,
                        valueUSD: row.valueUSD,
                    });
                }
            }
        }
        catch (err) {
            skippedObligations += 1;
            console.warn('[Current] obligation skipped', ob.obligationObject, marketType, err);
        }
    }
    if (skippedObligations > 0) {
        throw new Error(`Current: ${skippedObligations} obligation(s) failed to load (borrows unavailable, not confirmed zero)`);
    }
    const totalSuppliedUSD = supplies.reduce((s, x) => s + x.currentValueUSD, 0);
    const totalBorrowedUSD = borrows.reduce((s, x) => s + x.currentDebtUSD, 0);
    /**
     * Current markets are isolated: HF / liquidation use only that market’s collateral & debt.
     * Cross-market totals must not inflate Main HF when AltCoin/Ember have supplies but no borrow.
     */
    const marketKeys = new Set();
    for (const s of supplies) {
        const m = marketOf.get(s);
        if (m)
            marketKeys.add(m);
    }
    for (const b of borrows) {
        const m = marketOf.get(b);
        if (m)
            marketKeys.add(m);
    }
    let healthFactor = null;
    for (const marketType of marketKeys) {
        const mSupplies = supplies.filter((s) => marketOf.get(s) === marketType);
        const mBorrows = borrows.filter((b) => marketOf.get(b) === marketType);
        /** Docs: risk_adjusted_debt = debt × borrowWeight. */
        const mRiskDebt = mBorrows.reduce((s, x) => s + x.currentDebtUSD * (borrowWeightOf.get(x) ?? 1), 0);
        const mLiq = mSupplies.reduce((s, x) => s + x.currentValueUSD * (x.liquidationThresholdFactor ?? 0), 0);
        const mSafe = mSupplies.reduce((s, x) => s + x.currentValueUSD * (maxLtvOf.get(x) ?? 0), 0);
        /**
         * HF ≡ LiqLTV / CurrentLTV when CurrentLTV = riskDebt / collValue and
         * weighted Liq = Σ(coll×liqLTV)/collValue → HF = mLiq / mRiskDebt (→1 at liq).
         */
        const mHf = mRiskDebt > 0 ? mLiq / mRiskDebt : null;
        for (const b of mBorrows) {
            const bw = borrowWeightOf.get(b) ?? 1;
            b.healthFactor = mHf ?? 0;
            b.liquidationThreshold = mLiq;
            b.safeBorrowLimit = bw > 0 ? mSafe / bw : mSafe;
            b.collateral = mSupplies.map((s) => ({
                asset: s.asset,
                amount: s.currentAmount,
                valueUSD: s.currentValueUSD,
                collateralWeight: s.liquidationThresholdFactor ?? 0,
                effectiveValueUSD: s.currentValueUSD * (s.liquidationThresholdFactor ?? 0),
            }));
        }
        if (mHf != null && mHf > 0) {
            healthFactor = healthFactor == null ? mHf : Math.min(healthFactor, mHf);
        }
        if (mRiskDebt > 0 && mSupplies.length > 0) {
            const priced = enrichSupplyLiquidationPrices(mSupplies, mRiskDebt);
            for (let i = 0; i < mSupplies.length; i++) {
                mSupplies[i].liquidationPriceUSD = priced[i].liquidationPriceUSD ?? null;
            }
        }
        else {
            for (const s of mSupplies)
                s.liquidationPriceUSD = null;
        }
    }
    const supplyYield = supplies.reduce((s, x) => s + x.currentValueUSD * x.supplyAPR, 0);
    const borrowCost = borrows.reduce((s, x) => s + x.currentDebtUSD * x.netBorrowCost, 0);
    const netValueUSD = totalSuppliedUSD - totalBorrowedUSD;
    const netAPR = totalSuppliedUSD > 0 ? (supplyYield - borrowCost) / totalSuppliedUSD : null;
    const rewardsToClaim = mergeClaimed(claimed);
    const unclaimedUSD = rewardsToClaim.reduce((s, r) => s + r.valueUSD, 0);
    const loaded = await loadCashflowTokens(walletAddress, marketTypes, allListed).catch(() => null);
    let cashflowUsd = null;
    if (loaded) {
        const listPrice = (coin) => {
            const p = Number(marketByToken(allListed, coin)?.tokenInfo?.price ?? 0);
            return Number.isFinite(p) && p > 0 ? p : 0;
        };
        const positionKey = (pos, coinType) => {
            const market = marketOf.get(pos) ?? '';
            return market ? flowKey(market, coinType) : '';
        };
        let supplyInterestUSD = 0;
        const seenSupply = new Set();
        for (const s of supplies) {
            const key = positionKey(s, s.coinType);
            if (!key || loaded.historyFailed.has(typeKey(marketOf.get(s) ?? '')))
                continue;
            seenSupply.add(key);
            const net = loaded.deposited.get(key) ?? 0;
            s.netDeposited = net;
            const px = s.currentAmount > 0 ? s.currentValueUSD / s.currentAmount : listPrice(s.coinType);
            supplyInterestUSD += (s.currentAmount - net) * px;
        }
        for (const [key, net] of loaded.deposited) {
            if (seenSupply.has(key))
                continue;
            const coin = key.split('|')[1] ?? '';
            supplyInterestUSD += -net * listPrice(coin);
        }
        let borrowInterestUSD = 0;
        const seenBorrow = new Set();
        for (const b of borrows) {
            const key = positionKey(b, b.coinType);
            if (!key || loaded.historyFailed.has(typeKey(marketOf.get(b) ?? '')))
                continue;
            seenBorrow.add(key);
            const net = loaded.borrowed.get(key) ?? 0;
            b.netBorrowed = net;
            const px = b.currentDebt > 0 ? b.currentDebtUSD / b.currentDebt : listPrice(b.coinType);
            borrowInterestUSD += (b.currentDebt - net) * px;
        }
        for (const [key, net] of loaded.borrowed) {
            if (seenBorrow.has(key))
                continue;
            const coin = key.split('|')[1] ?? '';
            borrowInterestUSD += -net * listPrice(coin);
        }
        cashflowUsd = {
            supplyInterestUSD,
            borrowInterestUSD,
            claimedRewardsUSD: loaded.claimedRewardsUSD,
            resultUSD: supplyInterestUSD - borrowInterestUSD + loaded.claimedRewardsUSD + unclaimedUSD,
            usedSpotPrice: loaded.usedSpotPrice,
        };
    }
    return {
        supplies,
        borrows,
        totalSuppliedUSD,
        totalBorrowedUSD,
        netValueUSD,
        healthFactor,
        netAPR,
        dailyEarningsUSD: totalSuppliedUSD > 0 ? (supplyYield - borrowCost) / 365 : null,
        rewardsToClaim,
        cashflowUsd,
        protocol: 'Current',
    };
}
export const EMPTY_CURRENT_SNAP = {
    supplies: [],
    borrows: [],
    totalSuppliedUSD: 0,
    totalBorrowedUSD: 0,
    netValueUSD: 0,
    healthFactor: null,
    rewardsToClaim: [],
    protocol: 'Current',
};
