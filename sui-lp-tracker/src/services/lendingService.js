import { enrichSupplyLiquidationPrices, normalizeLiquidationThresholdFactor } from '@/utils/supplyLiquidationPrice';
// ── Singleton client ──────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client = null;
async function getClient() {
    if (_client)
        return _client;
    const { AlphalendClient } = await import('@alphafi/alphalend-sdk');
    _client = new AlphalendClient('mainnet');
    return _client;
}
/** Market metadata + APR. stSUI APR is an extra HTTP call inside the SDK. */
const MARKET_DATA_TTL_MS = 5 * 60 * 1000;
let marketDataCache = null;
async function loadMarketRows(client, force) {
    if (!force && marketDataCache && Date.now() - marketDataCache.ts < MARKET_DATA_TTL_MS) {
        return marketDataCache.rows;
    }
    const marketsRaw = await client.getAllMarkets();
    const rows = [];
    for (const m of marketsRaw ?? []) {
        const row = m;
        rows.push((await row.getMarketData?.()) ?? m);
    }
    marketDataCache = { ts: Date.now(), rows };
    return rows;
}
/** Best-effort symbol from an SDK reward object. */
function rewardSymbol(r) {
    if (r.symbol)
        return r.symbol;
    if (r.coinType)
        return r.coinType.split('::').pop() ?? r.coinType;
    return '?';
}
/** Decompose a nested SDK APR object into decimal-fraction parts (0.05 = 5 %). */
function extractAprParts(apr) {
    if (!apr)
        return { total: 0, baseAPR: 0, stakingAPR: 0, rewardAPR: 0, rewardTokens: [] };
    // SDK values are in percentage units (3.5 for 3.5 %) → divide by 100
    const baseAPR = safeNum(apr.interestApr) / 100;
    const stakingAPR = safeNum(apr.stakingApr) / 100;
    const rewardTokens = (apr.rewards ?? [])
        .map((r) => ({ symbol: rewardSymbol(r), coinType: r.coinType, apr: safeNum(r.rewardApr) / 100 }))
        .filter((r) => r.apr > 0);
    const rewardAPR = rewardTokens.reduce((s, r) => s + r.apr, 0);
    return { total: baseAPR + stakingAPR + rewardAPR, baseAPR, stakingAPR, rewardAPR, rewardTokens };
}
// Kept for brevity at call-sites that only need the total.
// (extractAprParts is used directly where needed.)
// ── Service ───────────────────────────────────────────────────────────────────
export async function getLendingPositions(walletAddress, options) {
    // Drop SDK singleton so market.price / portfolio USD are not reused across Refresh
    // (Chrome especially can keep a long-lived tab + cached client state).
    if (options?.forceRefresh) {
        _client = null;
        marketDataCache = null;
    }
    const client = await getClient();
    // Markets are cached for a few minutes. Portfolio is always read fresh.
    const [marketRows, portfolios] = await Promise.all([
        loadMarketRows(client, Boolean(options?.forceRefresh)),
        client.getUserPortfolio(walletAddress),
    ]);
    if (!portfolios || portfolios.length === 0)
        return EMPTY_SNAP;
    const marketByIdRaw = new Map();
    for (const data of marketRows) {
        const id = Number(data.marketId);
        if (!Number.isNaN(id))
            marketByIdRaw.set(id, data);
    }
    // Use first portfolio (single position per wallet is common in AlphaLend)
    const p = portfolios[0];
    const totalSuppliedUSD = safeNum(p.totalSuppliedUsd);
    const totalBorrowedUSD = safeNum(p.totalBorrowedUsd);
    const liquidationUSD = safeNum(p.liquidationThreshold);
    const safeBorrowLimitUSD = safeNum(p.safeBorrowLimit);
    const healthFactor = totalBorrowedUSD > 0 ? liquidationUSD / totalBorrowedUSD : null;
    // ── Supplies ─────────────────────────────────────────────────────────────
    const supplies = [];
    for (const [marketIdNum, amtDecimal] of p.suppliedAmounts.entries()) {
        const mkt = marketByIdRaw.get(marketIdNum);
        if (!mkt)
            continue;
        const amount = safeNum(amtDecimal);
        if (amount === 0)
            continue;
        const priceUsd = mkt.price != null ? parseFloat(String(mkt.price)) : 0;
        const ltFactor = normalizeLiquidationThresholdFactor(safeNum(mkt.liquidationThreshold));
        const supplyParts = extractAprParts(mkt.supplyApr);
        supplies.push({
            id: `alphalend-supply-${marketIdNum}`,
            asset: mkt.symbol ?? mkt.coinType.split('::').pop() ?? `Mkt${marketIdNum}`,
            coinType: mkt.coinType,
            sCoinType: '',
            suppliedAmount: amount,
            currentAmount: amount,
            earnedInterest: 0,
            earnedInterestUSD: 0,
            supplyAPR: supplyParts.total,
            supplyRewardAPR: supplyParts.rewardAPR,
            aprBreakdown: {
                baseAPR: supplyParts.baseAPR,
                ...(supplyParts.stakingAPR > 0 ? { stakingAPR: supplyParts.stakingAPR } : {}),
                rewardAPR: supplyParts.rewardAPR,
                rewards: supplyParts.rewardTokens,
            },
            currentValueUSD: amount * priceUsd,
            liquidationThresholdFactor: ltFactor > 0 ? ltFactor : undefined,
            startedAt: 0,
            daysActive: 0,
            events: [],
            protocol: 'AlphaLend',
            iconUrl: null,
        });
    }
    const suppliesWithLiq = enrichSupplyLiquidationPrices(supplies, totalBorrowedUSD);
    // ── Borrows ──────────────────────────────────────────────────────────────
    const collateral = suppliesWithLiq.map((s) => ({
        asset: s.asset,
        amount: s.currentAmount,
        valueUSD: s.currentValueUSD,
        collateralWeight: 0,
        effectiveValueUSD: s.currentValueUSD,
    }));
    const borrows = [];
    for (const [marketIdNum, amtDecimal] of p.borrowedAmounts.entries()) {
        const mkt = marketByIdRaw.get(marketIdNum);
        if (!mkt)
            continue;
        const amount = safeNum(amtDecimal);
        if (amount === 0)
            continue;
        const priceUsd = mkt.price != null ? parseFloat(String(mkt.price)) : 0;
        const borrowParts = extractAprParts(mkt.borrowApr);
        // For borrows: rewards are an OFFSET (you earn them back), so net cost = base − rewards.
        // borrowAPR displayed = net cost; borrowRewardAPR = magnitude of the offset.
        const rewardAPR = borrowParts.rewardAPR;
        const borrowAPR = borrowParts.baseAPR - rewardAPR; // can be negative (net earn)
        borrows.push({
            id: `alphalend-borrow-${marketIdNum}`,
            obligationId: p.positionId ?? '',
            asset: mkt.symbol ?? mkt.coinType.split('::').pop() ?? `Mkt${marketIdNum}`,
            coinType: mkt.coinType,
            borrowedAmount: amount,
            currentDebt: amount,
            accruedInterest: 0,
            accruedInterestUSD: 0,
            borrowAPR,
            borrowRewardAPR: rewardAPR,
            netBorrowCost: borrowAPR, // already net
            aprBreakdown: {
                baseAPR: borrowParts.baseAPR,
                rewardAPR: borrowParts.rewardAPR,
                rewards: borrowParts.rewardTokens,
            },
            currentDebtUSD: amount * priceUsd,
            collateral,
            healthFactor: healthFactor ?? 0,
            liquidationThreshold: liquidationUSD,
            ...(safeBorrowLimitUSD > 0 ? { safeBorrowLimit: safeBorrowLimitUSD } : {}),
            startedAt: 0,
            daysActive: 0,
            events: [],
            protocol: 'AlphaLend',
            iconUrl: null,
        });
    }
    // ── Rewards ───────────────────────────────────────────────────────────────
    const rewardsToClaim = (p.rewardsToClaim ?? [])
        .filter((r) => safeNum(r.rewardAmount) > 0)
        .map((r) => {
        const mkt = [...marketByIdRaw.values()].find((m) => m.coinType === r.coinType);
        const priceUsd = mkt?.price != null ? parseFloat(String(mkt.price)) : 0;
        const amount = safeNum(r.rewardAmount);
        return {
            coinType: r.coinType,
            symbol: mkt?.symbol ?? r.coinType.split('::').pop() ?? r.coinType,
            amount,
            valueUSD: amount * priceUsd,
        };
    });
    // Net APR from SDK is in percentage units (2.93 = 2.93%) → divide by 100
    const netAPR = safeNum(p.netApr) / 100 || null;
    // Daily earnings already in USD
    const dailyEarningsUSD = safeNum(p.dailyEarnings) || null;
    return {
        supplies: suppliesWithLiq,
        borrows,
        totalSuppliedUSD,
        totalBorrowedUSD,
        netValueUSD: totalSuppliedUSD - totalBorrowedUSD,
        healthFactor,
        netAPR,
        dailyEarningsUSD,
        rewardsToClaim,
        protocol: 'AlphaLend',
    };
}
// ── Helpers ───────────────────────────────────────────────────────────────────
const EMPTY_SNAP = {
    supplies: [],
    borrows: [],
    totalSuppliedUSD: 0,
    totalBorrowedUSD: 0,
    netValueUSD: 0,
    healthFactor: null,
    rewardsToClaim: [],
    protocol: 'AlphaLend',
};
function safeNum(v) {
    if (v == null)
        return 0;
    if (typeof v === 'number')
        return v;
    if (typeof v === 'string')
        return parseFloat(v) || 0;
    if (typeof v === 'object' && 'toNumber' in v) {
        return v.toNumber();
    }
    if (typeof v === 'object' && 'toString' in v) {
        return parseFloat(v.toString()) || 0;
    }
    return 0;
}
