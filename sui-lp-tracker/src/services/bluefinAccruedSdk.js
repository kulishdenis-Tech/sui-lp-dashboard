import Decimal from 'decimal.js';
import { fetchBluefinAccruedRaws } from '@/services/bluefinAccruedInspect';
import { resolveSpots } from '@/services/spotPrice/resolveSpots';
import { suiClient } from '@/services/suiClient';
const MAX_SANE = 50_000_000;
function symbolFromType(coinType) {
    const p = coinType.split('::');
    return p[2] ?? p[1] ?? '—';
}
/**
 * Сирі u64 + spot → нормалізований пакет, еквівалент
 * `OnChainCalls.getAccruedFeeAndRewards` у `@firefly-exchange/library-sui` (виклик `pool::get_accrued_*` + devInspect).
 * Повертає `null`, якщо on-chain view недоступні.
 */
export async function getBluefinAccruedFeesAndRewards(input, options) {
    const client = options?.client ?? suiClient;
    const raw = await fetchBluefinAccruedRaws(client, input);
    if (!raw.ok) {
        console.warn('Bluefin accrued fees/rewards unavailable: devInspect failed —', raw.error);
        return null;
    }
    const tA = input.coinTypeA;
    const tB = input.coinTypeB;
    const rewardTypes = input.rewardCoinTypes
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
        .slice(0, 32);
    const allTypes = new Set([tA, tB, ...rewardTypes]);
    const meta = new Map();
    for (const ct of allTypes) {
        try {
            const m = await client.getCoinMetadata({ coinType: ct });
            meta.set(ct, { symbol: m?.symbol ?? symbolFromType(ct), decimals: m?.decimals ?? 0 });
        }
        catch {
            meta.set(ct, { symbol: symbolFromType(ct), decimals: 0 });
        }
    }
    const resolveOpts = options?.forceRefreshPrices
        ? { forceRefresh: true }
        : undefined;
    const spots = await resolveSpots([...allTypes], (ct) => meta.get(ct)?.symbol ?? symbolFromType(ct), resolveOpts);
    const toHuman = (rawStr, dec) => {
        if (!/^\d+$/.test(rawStr) || !Number.isFinite(dec) || dec < 0)
            return 0;
        try {
            return new Decimal(rawStr)
                .div(new Decimal(10).pow(dec))
                .toNumber();
        }
        catch {
            return 0;
        }
    };
    const lineUsd = (ct, amount) => {
        const px = spots.get(ct)?.price;
        const p = px != null && Number.isFinite(px) && px > 0 && px <= 1e8 ? px : null;
        if (p != null) {
            const v = amount * p;
            return { usd: v > 0 && v <= MAX_SANE ? v : 0, usdPrice: p };
        }
        return { usd: 0, usdPrice: null };
    };
    const fees = [];
    const hA = toHuman(raw.rawFeeA, meta.get(tA)?.decimals ?? 0);
    const hB = toHuman(raw.rawFeeB, meta.get(tB)?.decimals ?? 0);
    if (hA > 0) {
        const { usd, usdPrice } = lineUsd(tA, hA);
        fees.push({
            tokenType: tA,
            symbol: meta.get(tA)?.symbol ?? symbolFromType(tA),
            rawAmount: raw.rawFeeA,
            amount: hA,
            usdPrice,
            amountUsd: usd,
        });
    }
    if (hB > 0) {
        const { usd, usdPrice } = lineUsd(tB, hB);
        fees.push({
            tokenType: tB,
            symbol: meta.get(tB)?.symbol ?? symbolFromType(tB),
            rawAmount: raw.rawFeeB,
            amount: hB,
            usdPrice,
            amountUsd: usd,
        });
    }
    const rewards = [];
    let uFee = 0;
    let uRew = 0;
    for (const f of fees)
        uFee += f.amountUsd;
    for (let i = 0; i < Math.min(raw.rewardRaws.length, rewardTypes.length); i += 1) {
        const ct = rewardTypes[i];
        const rStr = raw.rewardRaws[i] ?? '0';
        const dec = meta.get(ct)?.decimals ?? 0;
        const hum = toHuman(rStr, dec);
        if (hum <= 0)
            continue;
        const { usd, usdPrice } = lineUsd(ct, hum);
        if (usd > 0)
            uRew += usd;
        rewards.push({
            tokenType: ct,
            symbol: meta.get(ct)?.symbol ?? symbolFromType(ct),
            rawAmount: rStr,
            amount: hum,
            usdPrice,
            amountUsd: usd,
        });
    }
    const fetchedAt = Date.now() / 1000;
    return {
        positionId: input.positionId,
        poolId: input.poolId,
        dex: 'Bluefin',
        fees,
        rewards,
        unclaimedFeesUsd: uFee,
        unclaimedRewardsUsd: uRew,
        unclaimedTotalUsd: uFee + uRew,
        source: 'bluefin_sdk',
        fetchedAt,
        sdkReferenceMethod: 'OnChainCalls.getAccruedFeeAndRewards',
    };
}
