import { suiClient } from '@/services/suiClient';
import { fetchTurbosClosedNfts, parsePoolObject } from '@/services/turbosService';
import { scanTurbosPositionEvents } from '@/services/turbosLpEvents';
import { resolveSpots } from '@/services/spotPrice/resolveSpots';
const STABLECOIN_SYMS = new Set([
    'USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'PYUSD',
    'USDD', 'FRAX', 'LUSD', 'SUSD', 'GUSD',
]);
function symbolFromCoinType(ct) {
    const p = ct.split('::');
    return p[2] ?? p[1] ?? '—';
}
function spotPriceSafe(raw) {
    if (raw == null || !Number.isFinite(raw) || raw <= 0 || raw > 1e8)
        return 0;
    return raw;
}
function feeLabelFromFrac(frac) {
    if (!Number.isFinite(frac) || frac <= 0)
        return '—';
    return `${(frac * 100).toFixed(3)}%`;
}
function swapEventAB(ev) {
    return {
        ...ev,
        tokenAAmount: ev.tokenBAmount,
        tokenBAmount: ev.tokenAAmount,
        feeAmountA: ev.feeAmountB,
        feeAmountB: ev.feeAmountA,
        priceA_USD: ev.priceB_USD,
        priceB_USD: ev.priceA_USD,
        valueUsdA: ev.valueUsdB,
        valueUsdB: ev.valueUsdA,
        quoteAsOfUnixSecA: ev.quoteAsOfUnixSecB,
        quoteAsOfUnixSecB: ev.quoteAsOfUnixSecA,
    };
}
async function fetchCoinMetas(coinTypes) {
    const mm = new Map();
    await Promise.allSettled(coinTypes.map(async (ct) => {
        try {
            const m = await suiClient.getCoinMetadata({ coinType: ct });
            mm.set(ct, {
                symbol: m?.symbol ?? symbolFromCoinType(ct),
                decimals: m?.decimals ?? 9,
                iconUrl: typeof m?.iconUrl === 'string' && m.iconUrl.startsWith('https://') ? m.iconUrl : null,
            });
        }
        catch {
            mm.set(ct, { symbol: symbolFromCoinType(ct), decimals: 9, iconUrl: null });
        }
    }));
    return mm;
}
export async function getTurbosClosedPositions(walletAddress) {
    // 1. Zero-liquidity NFTs
    let closedNfts;
    try {
        closedNfts = await fetchTurbosClosedNfts(walletAddress);
    }
    catch (e) {
        console.warn('[turbos-closed] fetchTurbosClosedNfts failed', e);
        return [];
    }
    if (closedNfts.length === 0)
        return [];
    // 2. Pool metadata
    const uniquePoolIds = [...new Set(closedNfts.map((n) => n.poolId))];
    const poolObjs = await suiClient.multiGetObjects({
        ids: uniquePoolIds,
        options: { showContent: true },
    }).catch(() => []);
    const poolMap = new Map();
    for (let i = 0; i < uniquePoolIds.length; i++) {
        const parsed = parsePoolObject(poolObjs[i]);
        if (parsed)
            poolMap.set(uniquePoolIds[i], parsed);
    }
    // 3. Coin metadata — types come from NFT TypeName fields, not pool balance fields
    const allCoinTypes = new Set();
    for (const n of closedNfts) {
        const pool = poolMap.get(n.poolId);
        if (!pool)
            continue;
        if (n.coinTypeA)
            allCoinTypes.add(n.coinTypeA);
        if (n.coinTypeB)
            allCoinTypes.add(n.coinTypeB);
        for (const ct of pool.rewardCoinTypes)
            allCoinTypes.add(ct);
    }
    const metaMap = await fetchCoinMetas([...allCoinTypes]);
    const getMeta = (ct) => metaMap.get(ct) ?? { symbol: symbolFromCoinType(ct), decimals: 9, iconUrl: null };
    // 4. Spot prices
    let spotsMap = new Map();
    try {
        spotsMap = await resolveSpots([...allCoinTypes], (ct) => getMeta(ct).symbol);
    }
    catch { /* leave empty */ }
    // 5. Scan events + build ClosedPosition for each NFT
    const out = [];
    await Promise.allSettled(closedNfts.map(async (nft) => {
        const pool = poolMap.get(nft.poolId);
        if (!pool)
            return;
        // Coin types come from the NFT TypeName fields
        const rawCtA = nft.coinTypeA ?? '';
        const rawCtB = nft.coinTypeB ?? '';
        if (!rawCtA || !rawCtB)
            return;
        const metaA = getMeta(rawCtA);
        const metaB = getMeta(rawCtB);
        let events = [];
        try {
            events = await scanTurbosPositionEvents(walletAddress, nft.nftId, nft.positionId, metaA.decimals, metaB.decimals);
        }
        catch { /* leave empty */ }
        events.sort((a, b) => a.timestamp - b.timestamp);
        // Timestamps from events
        const openEvt = events.find((e) => e.type === 'add_liquidity');
        const openedAt = openEvt ? openEvt.timestamp : events[0]?.timestamp ?? 0;
        const removeEvts = events.filter((e) => e.type === 'remove_liquidity');
        const closedAt = removeEvts.length > 0
            ? Math.max(...removeEvts.map((e) => e.timestamp))
            : events[events.length - 1]?.timestamp ?? 0;
        const daysOpen = openedAt > 0 && closedAt >= openedAt
            ? Math.max(0, (closedAt - openedAt) / 86400)
            : 0;
        // Accumulate flows
        let depositedA = 0, depositedB = 0;
        let withdrawnA = 0, withdrawnB = 0;
        let feesA = 0, feesB = 0;
        for (const ev of events) {
            if (ev.type === 'add_liquidity') {
                depositedA += ev.tokenAAmount;
                depositedB += ev.tokenBAmount;
            }
            else if (ev.type === 'remove_liquidity') {
                withdrawnA += ev.tokenAAmount;
                withdrawnB += ev.tokenBAmount;
            }
            else if (ev.type === 'collect_fee') {
                feesA += ev.feeAmountA;
                feesB += ev.feeAmountB;
            }
        }
        const pxA = spotPriceSafe(spotsMap.get(rawCtA)?.price);
        const pxB = spotPriceSafe(spotsMap.get(rawCtB)?.price);
        const depositedUSD = (pxA > 0 ? depositedA * pxA : 0) + (pxB > 0 ? depositedB * pxB : 0);
        const closedValueUSD = (pxA > 0 ? withdrawnA * pxA : 0) + (pxB > 0 ? withdrawnB * pxB : 0);
        const totalFeesUSD = (pxA > 0 ? feesA * pxA : 0) + (pxB > 0 ? feesB * pxB : 0);
        const pnlUSD = closedValueUSD + totalFeesUSD - depositedUSD;
        const pnlPct = depositedUSD > 0 ? (pnlUSD / depositedUSD) * 100 : 0;
        // Normalise token order: stablecoin always tokenB
        const aIsStable = STABLECOIN_SYMS.has(metaA.symbol.toUpperCase());
        const bIsStable = STABLECOIN_SYMS.has(metaB.symbol.toUpperCase());
        const swap = aIsStable && !bIsStable;
        const dMetaA = swap ? metaB : metaA;
        const dMetaB = swap ? metaA : metaB;
        const dCtA = swap ? rawCtB : rawCtA;
        const dCtB = swap ? rawCtA : rawCtB;
        const dPxA = swap ? pxB : pxA;
        const dPxB = swap ? pxA : pxB;
        const dEvents = swap ? events.map(swapEventAB) : events;
        const feeLbl = feeLabelFromFrac(pool.feeRate);
        const pair = `${dMetaA.symbol}/${dMetaB.symbol} · ${feeLbl}`;
        out.push({
            id: nft.nftId,
            protocol: 'turbos',
            pair,
            tokenA: dMetaA.symbol,
            tokenB: dMetaB.symbol,
            fee: pool.feeRate,
            depositedUSD,
            closedValueUSD,
            pnlUSD,
            pnlPct,
            totalFeesCollectedUSD: totalFeesUSD,
            estimatedIL_USD: 0,
            openedAt,
            closedAt,
            daysOpen,
            events: dEvents,
            partialHistory: events.length === 0,
            poolId: nft.poolId,
            tokenAAddress: dCtA,
            tokenBAddress: dCtB,
            tokenADecimals: dMetaA.decimals,
            tokenBDecimals: dMetaB.decimals,
            tokenAIconUrl: dMetaA.iconUrl,
            tokenBIconUrl: dMetaB.iconUrl,
            currentPriceA_USD: dPxA,
            currentPriceB_USD: dPxB,
            tickLower: 0, // position burned, ticks not needed
            tickUpper: 0,
        });
    }));
    out.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
    return out;
}
