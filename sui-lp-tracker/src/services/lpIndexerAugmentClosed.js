import { harvestLpTransactionsByDigest } from '@/services/lpTxRawHarvest';
import { lpTxRawStorePutBatch } from '@/services/lpTxRawStore';
import { mistNetGasPaidFromEffects } from '@/services/lpLifecycleGas';
import { getUsdPerTokenAtTimestamp } from '@/services/priceService';
import { resolveSpots } from '@/services/spotPrice/resolveSpots';
const SUI_COIN_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
function collectDigestsFromClosed(closed) {
    const s = new Set();
    for (const c of closed) {
        for (const e of c.events ?? []) {
            const d = e.txDigest?.trim();
            if (d)
                s.add(d);
        }
    }
    return [...s];
}
async function suiUsdSpot(tsSec) {
    try {
        const spots = await resolveSpots([SUI_COIN_TYPE], () => 'SUI', { forceRefresh: false });
        const p = spots.get(SUI_COIN_TYPE)?.price;
        if (typeof p === 'number' && Number.isFinite(p) && p > 0 && p <= 1e6)
            return p;
    }
    catch {
        /* */
    }
    const bucket = typeof tsSec === 'number' && tsSec > 0 ? tsSec : Math.floor(Date.now() / 1000);
    try {
        const q = await getUsdPerTokenAtTimestamp('SUI', SUI_COIN_TYPE, bucket);
        if (typeof q.usdPerToken === 'number' && Number.isFinite(q.usdPerToken) && q.usdPerToken > 0)
            return q.usdPerToken;
    }
    catch {
        /* */
    }
    return 0;
}
/**
 * IndexedDB persist + колонки withdrawn/fees/rewards/gas/heuristic pure IL над enriched ClosedPosition[].
 */
export async function augmentClosedPositionsIndexerFields(wallet, closed) {
    if (closed.length === 0)
        return closed;
    const digests = collectDigestsFromClosed(closed);
    let rawMap;
    try {
        rawMap = await harvestLpTransactionsByDigest(digests);
    }
    catch {
        rawMap = new Map();
    }
    const records = [...rawMap.values()];
    if (records.length > 0) {
        await lpTxRawStorePutBatch(wallet, records);
    }
    const anyMissingHarvest = digests.some((d) => !rawMap.has(d));
    const roughSuiPrice = await suiUsdSpot();
    return closed.map((c) => {
        let withdrawn = 0;
        let feesUsd = 0;
        let rewardsUsd = 0;
        const txsSeenForGas = new Set();
        let gasMistAgg = 0n;
        for (const e of c.events ?? []) {
            const t = typeof e.totalValueUSD === 'number' && Number.isFinite(e.totalValueUSD) ? e.totalValueUSD : 0;
            if (e.type === 'remove_liquidity' && t > 0)
                withdrawn += t;
            else if (e.type === 'collect_fee' && t > 0)
                feesUsd += t;
            else if (e.type === 'collect_reward' && t > 0)
                rewardsUsd += t;
            const d = e.txDigest?.trim();
            if (!d || txsSeenForGas.has(d))
                continue;
            txsSeenForGas.add(d);
            const blk = rawMap.get(d);
            if (blk?.effectsJson == null)
                continue;
            gasMistAgg += mistNetGasPaidFromEffects(blk.effectsJson);
        }
        const gasUsd = roughSuiPrice > 0 && gasMistAgg > 0n ? Number(gasMistAgg) / 1e9 * roughSuiPrice : null;
        const vs = typeof c.vsHodlDeltaUSD === 'number' && Number.isFinite(c.vsHodlDeltaUSD) ? c.vsHodlDeltaUSD : null;
        const feeR = Number.isFinite(feesUsd) ? feesUsd : 0;
        const rewR = Number.isFinite(rewardsUsd) ? rewardsUsd : 0;
        const pureIlUsd = vs != null ? vs - (feeR + rewR) : null;
        return {
            ...c,
            withdrawnLiquidityUsd: withdrawn > 0 ? withdrawn : null,
            claimedFeesUsd: feesUsd > 0 ? feesUsd : null,
            claimedRewardsUsd: rewardsUsd > 0 ? rewardsUsd : null,
            gasUsd,
            netVsHodlUsdIndexed: vs,
            pureIlUsd: pureIlUsd != null && Number.isFinite(pureIlUsd) ? pureIlUsd : null,
            partialIndexer: Boolean(anyMissingHarvest || c.partialHistory),
        };
    });
}
