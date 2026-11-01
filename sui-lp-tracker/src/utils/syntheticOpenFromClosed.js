function closedProtocolAsOpen(proto) {
    const p = proto.trim().toLowerCase();
    if (p === 'momentum')
        return 'momentum';
    if (p === 'cetus')
        return 'cetus';
    if (p === 'turbos')
        return 'turbos';
    if (p === 'flowx')
        return 'flowx';
    if (p === 'aftermath')
        return 'aftermath';
    return 'bluefin';
}
/** Мінімальний `OpenPosition` для деталей / reuse віджетів із закритої LP-позиції (Bluefin / Momentum тощо). */
export function syntheticOpenFromClosed(c) {
    const poolId = c.poolId ?? '';
    const feeFrac = Number.isFinite(c.fee) && c.fee >= 0
        ? c.fee
        : 0;
    const pair = c.pair ||
        `${c.tokenA}+${c.tokenB}${feeFrac > 0 ? ` · ${(feeFrac * 100).toFixed(3)}%` : ''}`;
    return {
        id: c.id,
        protocol: closedProtocolAsOpen(c.protocol),
        poolId,
        pair,
        tokenA: c.tokenA,
        tokenB: c.tokenB,
        tokenAAddress: c.tokenAAddress ?? '',
        tokenBAddress: c.tokenBAddress ?? '',
        tokenAIconUrl: c.tokenAIconUrl,
        tokenBIconUrl: c.tokenBIconUrl,
        tokenADecimals: c.tokenADecimals ?? 0,
        tokenBDecimals: c.tokenBDecimals ?? 0,
        fee: feeFrac,
        tickLower: c.tickLower ?? 0,
        tickUpper: c.tickUpper ?? 0,
        currentTick: 0,
        // '0' forces clmmRangeFromOpenPosition to fall back to currentTick;
        // we override it via priceCurrentOverride instead (see below).
        currentSqrtPrice: '0',
        liquidity: '0',
        status: 'out_of_range',
        tokenAAmount: 0,
        tokenBAmount: 0,
        currentPriceA_USD: c.currentPriceA_USD ?? 0,
        currentPriceB_USD: c.currentPriceB_USD ?? 0,
        currentValueUSD: 0,
        depositedUSD: c.depositedUSD,
        pnlUSD: c.pnlUSD,
        pnlPct: c.pnlPct,
        unclaimedFeeA: 0,
        unclaimedFeeB: 0,
        unclaimedFeeUSD: 0,
        unclaimedRewardUSD: 0,
        openedAt: c.openedAt,
        daysOpen: c.daysOpen,
        lifetimeEarningsUSD: c.lifetimeEarningsUSD ?? c.totalFeesCollectedUSD,
        vsHodlDeltaUSD: c.vsHodlDeltaUSD ?? 0,
        hodlTokenAAmount: c.hodlTokenAAmount,
        hodlTokenBAmount: c.hodlTokenBAmount,
        hodlBasketUsdAtHorizon: c.hodlBasketUsdAtClose ?? null,
        horizonPriceA_USD: c.horizonPriceA_USD ?? null,
        horizonPriceB_USD: c.horizonPriceB_USD ?? null,
        aprEstimatePct: c.aprEstimatePct ?? 0,
        historyPartial: c.partialHistory === true,
        // B per A at current spot — used by PositionRangeBar when on-chain sqrtPrice
        // is unavailable (NFT burned after close).
        priceCurrentOverride: c.currentPriceA_USD != null &&
            c.currentPriceB_USD != null &&
            c.currentPriceB_USD > 0
            ? c.currentPriceA_USD / c.currentPriceB_USD
            : undefined,
    };
}
