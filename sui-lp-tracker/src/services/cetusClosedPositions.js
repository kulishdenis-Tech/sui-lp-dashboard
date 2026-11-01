import { suiClient } from '@/services/suiClient';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { fetchPools } from '@/services/cetusService';
import { cetusBurnedSeedsFromWalletMap, cetusPoolCoinsFromEventType, loadCetusWalletRawEvents, scanCetusPositionEvents, scanCetusPositionEventsByWalletTxs, } from '@/services/cetusLpEvents';
import { resolveSpots } from '@/services/spotPrice/resolveSpots';
import { loadClosedPosTxEntries, saveClosedPosTxEntry, } from '@/services/lpEventIdbCache';
/**
 * Stablecoins whose price is effectively $1 and that should always appear as
 * the QUOTE token (tokenB) in a pair display (e.g. "SUI/USDC" not "USDC/SUI").
 *
 * Cetus orders pool tokens by coin-type address, which may put a stablecoin
 * in the tokenA slot. Normalising here prevents the range bar from showing
 * prices in the inverted direction (e.g. 0.28 SUI-per-USDC instead of 3.5 USDC-per-SUI).
 */
const STABLECOIN_SYMS = new Set([
    'USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'PYUSD',
    'USDD', 'FRAX', 'LUSD', 'SUSD', 'GUSD',
]);
/**
 * Swap all A/B-indexed fields in a PositionEvent so that the event's token
 * A/B slots match the normalised (post-swap) position token ordering.
 */
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
function symbolFromCoinType(ct) {
    const parts = ct.split('::');
    return parts[2] ?? parts[1] ?? '—';
}
function feeLabelFromFrac(frac) {
    if (!Number.isFinite(frac) || frac <= 0)
        return '—';
    return `${(frac * 100).toFixed(3)}%`;
}
function spotPriceSafe(raw) {
    if (raw == null || !Number.isFinite(raw) || raw <= 0 || raw > 1e8)
        return 0;
    return raw;
}
async function fetchCoinMetas(coinTypes) {
    const mm = new Map();
    await Promise.allSettled(coinTypes.map(async (ct) => {
        try {
            const m = await suiClient.getCoinMetadata({ coinType: ct });
            mm.set(ct, {
                symbol: m?.symbol ?? symbolFromCoinType(ct),
                decimals: m?.decimals ?? 9,
                iconUrl: typeof m?.iconUrl === 'string' && m.iconUrl.startsWith('https://')
                    ? m.iconUrl
                    : null,
            });
        }
        catch {
            mm.set(ct, { symbol: symbolFromCoinType(ct), decimals: 9, iconUrl: null });
        }
    }));
    return mm;
}
/**
 * Returns Cetus CLMM closed positions for `walletAddress`.
 * Burned NFTs only (ClosePositionEvent). Owned empty NFTs are not Closed.
 */
export async function getCetusClosedPositions(walletAddress) {
    let walletNorm;
    try {
        walletNorm = normalizeSuiAddress(walletAddress);
    }
    catch {
        walletNorm = walletAddress;
    }
    // 1. Burned closes from wallet events only (never owned liquidity===0 NFTs).
    const closed = [];
    let burnedSeeds = [];
    try {
        burnedSeeds = cetusBurnedSeedsFromWalletMap(await loadCetusWalletRawEvents(walletAddress));
    }
    catch (e) {
        console.warn('[cetus-closed] burned-position scan failed', e);
    }
    const needPoolCoins = burnedSeeds.filter((s) => !s.coinTypeA || !s.coinTypeB);
    if (needPoolCoins.length > 0) {
        const ids = [...new Set(needPoolCoins.map((s) => s.poolId))];
        const objs = await suiClient.multiGetObjects({
            ids,
            options: { showType: true },
        }).catch(() => []);
        const coinsByPool = new Map();
        for (let i = 0; i < ids.length; i++) {
            const type = objs[i]?.data?.type;
            if (!type)
                continue;
            const pair = cetusPoolCoinsFromEventType(type);
            if (pair)
                coinsByPool.set(ids[i], pair);
        }
        for (const seed of needPoolCoins) {
            const pair = coinsByPool.get(seed.poolId);
            if (!pair)
                continue;
            seed.coinTypeA = pair.coinTypeA;
            seed.coinTypeB = pair.coinTypeB;
        }
    }
    const seen = new Set();
    for (const seed of burnedSeeds) {
        if (!seed.coinTypeA || !seed.coinTypeB)
            continue;
        if (seen.has(seed.objectId))
            continue;
        seen.add(seed.objectId);
        closed.push({
            objectId: seed.objectId,
            poolId: seed.poolId,
            coinTypeA: seed.coinTypeA,
            coinTypeB: seed.coinTypeB,
            liquidity: '0',
            lowerTick: seed.lowerTick,
            upperTick: seed.upperTick,
        });
    }
    if (closed.length === 0)
        return [];
    // 2. Fetch pool metadata (fee rate, rewarder coin types)
    const uniquePoolIds = [...new Set(closed.map((p) => p.poolId))];
    let poolMap;
    try {
        poolMap = await fetchPools(uniquePoolIds);
    }
    catch (e) {
        console.warn('[cetus-closed] fetchPools failed', e);
        poolMap = new Map();
    }
    // 3. Collect all coin types for metadata + spot price lookup
    const allCoinTypes = new Set();
    for (const pos of closed) {
        allCoinTypes.add(pos.coinTypeA);
        allCoinTypes.add(pos.coinTypeB);
    }
    for (const pool of poolMap.values()) {
        for (const ct of pool.rewarderCoinTypes) {
            if (ct)
                allCoinTypes.add(ct);
        }
    }
    // 4. Fetch coin metadata first (need symbols for resolveSpots), then spot prices
    const metaMap = await fetchCoinMetas([...allCoinTypes]);
    let finalSpotsMap;
    try {
        finalSpotsMap = await resolveSpots([...allCoinTypes], (ct) => metaMap.get(ct)?.symbol ?? symbolFromCoinType(ct));
    }
    catch {
        finalSpotsMap = new Map();
    }
    const getMeta = (ct) => metaMap.get(ct) ?? { symbol: symbolFromCoinType(ct), decimals: 9, iconUrl: null };
    // 5. Pre-load IDB TX event cache for all closed positions (one batch read)
    const posNorms = closed.map((p) => {
        try {
            return normalizeSuiAddress(p.objectId);
        }
        catch {
            return p.objectId;
        }
    });
    const idbTxCache = await loadClosedPosTxEntries(walletNorm, posNorms).catch(() => new Map());
    // 6. Scan events + build ClosedPosition for each position
    const out = [];
    await Promise.allSettled(closed.map(async (pos) => {
        const pool = poolMap.get(pos.poolId);
        const metaA = getMeta(pos.coinTypeA);
        const metaB = getMeta(pos.coinTypeB);
        // Scan on-chain events for this position.
        // Pass 1: wallet-wide Sender scan (IDB warm-start, ~5 pages on repeat loads).
        let events = await scanCetusPositionEvents(walletAddress, pos.objectId, metaA.decimals, metaB.decimals).catch(() => []);
        // Pass 2: deep wallet TX scan — fires when the Sender scan window doesn't reach
        // back far enough (position's events predate the last ~2500 Sender events).
        // Closed positions are immutable → check IDB before hitting the chain.
        if (!events.some((e) => e.type === 'add_liquidity')) {
            let posNorm;
            try {
                posNorm = normalizeSuiAddress(pos.objectId);
            }
            catch {
                posNorm = pos.objectId;
            }
            const idbHit = idbTxCache.get(posNorm);
            if (idbHit && idbHit.events.length > 0) {
                // IDB hit — use cached events, no RPC call needed
                const seen = new Set(idbHit.events.map((e) => e.id));
                events = [...idbHit.events, ...events.filter((e) => !seen.has(e.id))];
                events.sort((a, b) => a.timestamp - b.timestamp);
            }
            else {
                try {
                    const targeted = await scanCetusPositionEventsByWalletTxs(walletAddress, pos.objectId, metaA.decimals, metaB.decimals);
                    if (targeted.length > 0) {
                        // Merge: targeted events take priority, keep any extras from sender scan
                        const seen = new Set(targeted.map((e) => e.id));
                        events = [...targeted, ...events.filter((e) => !seen.has(e.id))];
                        events.sort((a, b) => a.timestamp - b.timestamp);
                        // Persist for future sessions (closed = immutable)
                        void saveClosedPosTxEntry({
                            id: `${walletNorm}|${posNorm}`,
                            walletNorm,
                            posNorm,
                            events: targeted,
                            scanPartial: false,
                            cachedAt: Date.now(),
                        });
                    }
                    else {
                        console.warn('[cetus-closed] no events found for position', pos.objectId.slice(0, 16), '— both Sender and deep TX scans returned empty');
                    }
                }
                catch (err) {
                    console.warn('[cetus-closed] targeted scan failed for', pos.objectId.slice(0, 16), err);
                }
            }
        }
        events.sort((a, b) => a.timestamp - b.timestamp);
        // Derive open/close timestamps from events
        const firstTs = events.length > 0 ? events[0].timestamp : 0;
        const lastTs = events.length > 0 ? events[events.length - 1].timestamp : 0;
        // "Open" = first add_liquidity event (or first event overall)
        const openEvt = events.find((e) => e.type === 'add_liquidity');
        const openedAt = openEvt ? openEvt.timestamp : firstTs;
        // "Closed" = last remove_liquidity event (or last event overall)
        const removeEvts = events.filter((e) => e.type === 'remove_liquidity' || e.type === 'close_position');
        const closedAt = removeEvts.length > 0
            ? Math.max(...removeEvts.map((e) => e.timestamp))
            : lastTs;
        const daysOpen = openedAt > 0 && closedAt >= openedAt
            ? Math.max(0, (closedAt - openedAt) / 86400)
            : 0;
        const feeRate = pool?.feeRate ?? 0;
        const feeLbl = feeLabelFromFrac(feeRate);
        const pxA = spotPriceSafe(finalSpotsMap.get(pos.coinTypeA)?.price);
        const pxB = spotPriceSafe(finalSpotsMap.get(pos.coinTypeB)?.price);
        // Accumulate deposited / withdrawn for rough PnL
        let depositedA = 0;
        let depositedB = 0;
        let withdrawnA = 0;
        let withdrawnB = 0;
        let feesA = 0;
        let feesB = 0;
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
        const depositedUSD = (pxA > 0 ? depositedA * pxA : 0) + (pxB > 0 ? depositedB * pxB : 0);
        const closedValueUSD = (pxA > 0 ? withdrawnA * pxA : 0) + (pxB > 0 ? withdrawnB * pxB : 0);
        const totalFeesUSD = (pxA > 0 ? feesA * pxA : 0) + (pxB > 0 ? feesB * pxB : 0);
        const pnlUSD = closedValueUSD + totalFeesUSD - depositedUSD;
        const pnlPct = depositedUSD > 0 ? (pnlUSD / depositedUSD) * 100 : 0;
        // Normalise token order: Cetus orders pool tokens by coin-type address, so a
        // stablecoin may end up as tokenA. Swap to canonical "crypto/stablecoin" order
        // (e.g. SUI/USDC instead of USDC/SUI) so the range bar shows USDC-per-SUI prices.
        // Tick inversion: swapping A↔B requires negating ticks and swapping lower↔upper
        // because the direction of the price axis flips.
        const aIsStable = STABLECOIN_SYMS.has(metaA.symbol.toUpperCase());
        const bIsStable = STABLECOIN_SYMS.has(metaB.symbol.toUpperCase());
        const swap = aIsStable && !bIsStable;
        const dMetaA = swap ? metaB : metaA;
        const dMetaB = swap ? metaA : metaB;
        const dCoinTypeA = swap ? pos.coinTypeB : pos.coinTypeA;
        const dCoinTypeB = swap ? pos.coinTypeA : pos.coinTypeB;
        const dPxA = swap ? pxB : pxA;
        const dPxB = swap ? pxA : pxB;
        // When A and B are swapped the tick axis inverts: new lower = −(old upper)
        const dTickLower = swap ? -pos.upperTick : pos.lowerTick;
        const dTickUpper = swap ? -pos.lowerTick : pos.upperTick;
        const dEvents = swap ? events.map(swapEventAB) : events;
        const pair = `${dMetaA.symbol}/${dMetaB.symbol} · ${feeLbl}`;
        out.push({
            id: pos.objectId,
            protocol: 'cetus',
            pair,
            tokenA: dMetaA.symbol,
            tokenB: dMetaB.symbol,
            fee: feeRate,
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
            partialHistory: false,
            poolId: pos.poolId,
            tokenAAddress: dCoinTypeA,
            tokenBAddress: dCoinTypeB,
            tokenADecimals: dMetaA.decimals,
            tokenBDecimals: dMetaB.decimals,
            tokenAIconUrl: dMetaA.iconUrl,
            tokenBIconUrl: dMetaB.iconUrl,
            currentPriceA_USD: dPxA,
            currentPriceB_USD: dPxB,
            tickLower: dTickLower,
            tickUpper: dTickUpper,
        });
    }));
    out.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
    return out;
}
