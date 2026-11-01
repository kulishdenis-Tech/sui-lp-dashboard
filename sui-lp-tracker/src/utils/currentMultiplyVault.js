/** Current Finance Multiply vaults (leveraged eMode obligations). */
export function isCurrentMultiplyVaultPosition(p) {
    if (p?.currentMultiply?.kind === 'current_multiply')
        return true;
    return p?.cetusVault?.provider === 'Current' && p.cetusVault?.feeLabel === 'Multiply';
}
/** Parse API/on-chain integer amounts without Number→BigInt precision loss. */
export function parseRawIntegerAmount(v) {
    if (v == null)
        return null;
    if (typeof v === 'bigint')
        return v;
    if (typeof v === 'number') {
        if (!Number.isFinite(v) || !Number.isInteger(v) || !Number.isSafeInteger(v))
            return null;
        return BigInt(v);
    }
    const s = String(v).trim();
    if (!/^-?\d+$/.test(s))
        return null;
    try {
        return BigInt(s);
    }
    catch {
        return null;
    }
}
export function humanFromRawBigint(raw, decimals) {
    const scale = 10 ** decimals;
    const neg = raw < 0n;
    const v = neg ? -raw : raw;
    const whole = v / BigInt(Math.trunc(scale));
    const frac = v % BigInt(Math.trunc(scale));
    const n = Number(whole) + Number(frac) / scale;
    return neg ? -n : n;
}
export function multiplyEquityUsd(collateralUsd, debtUsd) {
    if (collateralUsd == null || debtUsd == null)
        return null;
    if (!Number.isFinite(collateralUsd) || !Number.isFinite(debtUsd))
        return null;
    return collateralUsd - debtUsd;
}
/** collateral USD / equity — only when equity > 0. */
export function multiplyMultiplier(collateralUsd, equityUsd) {
    if (collateralUsd == null || equityUsd == null)
        return null;
    if (!(equityUsd > 0) || !(collateralUsd > 0))
        return null;
    if (!Number.isFinite(collateralUsd) || !Number.isFinite(equityUsd))
        return null;
    return collateralUsd / equityUsd;
}
/** Spot LTV = debt USD / collateral USD. */
export function multiplyCurrentLtv(debtUsd, collateralUsd) {
    if (debtUsd == null || collateralUsd == null)
        return null;
    if (!(collateralUsd > 0) || !Number.isFinite(debtUsd) || !Number.isFinite(collateralUsd))
        return null;
    return debtUsd / collateralUsd;
}
/**
 * Net APR on equity (percent).
 *
 * annual = supply×baseSupply − debt×baseBorrow + supply×depIncentive + debt×borIncentive
 * netAprPct = annual / equity × 100
 *
 * Multiply list `supplyAPR`/`borrowAPR` are interest fractions and do **not** include LM.
 * Borrow incentive may exceed borrow APR (negative net borrow cost) — do not clamp to 0.
 */
export function multiplyNetAprBreakdown(input) {
    const { collateralUsd, debtUsd, equityUsd, baseSupplyApr, baseBorrowApr, depositIncentiveApr, borrowIncentiveApr, ratesSource, } = input;
    const supplyAnnualUsd = collateralUsd != null && baseSupplyApr != null && Number.isFinite(collateralUsd) && Number.isFinite(baseSupplyApr)
        ? collateralUsd * baseSupplyApr
        : null;
    const borrowCostAnnualUsd = debtUsd != null && baseBorrowApr != null && Number.isFinite(debtUsd) && Number.isFinite(baseBorrowApr)
        ? debtUsd * baseBorrowApr
        : null;
    const reasons = [];
    if (baseSupplyApr == null || baseBorrowApr == null || ratesSource !== 'multiply_list') {
        reasons.push('base rates unavailable');
    }
    if (supplyAnnualUsd == null || borrowCostAnnualUsd == null)
        reasons.push('base annual unavailable');
    if (depositIncentiveApr == null)
        reasons.push('deposit incentive unavailable');
    if (borrowIncentiveApr == null)
        reasons.push('borrow incentive unavailable');
    if (equityUsd == null || !(equityUsd > 0))
        reasons.push('equity unavailable');
    const depositIncentiveAnnualUsd = depositIncentiveApr != null && collateralUsd != null && Number.isFinite(collateralUsd) && Number.isFinite(depositIncentiveApr)
        ? collateralUsd * depositIncentiveApr
        : null;
    const borrowIncentiveAnnualUsd = borrowIncentiveApr != null && debtUsd != null && Number.isFinite(debtUsd) && Number.isFinite(borrowIncentiveApr)
        ? debtUsd * borrowIncentiveApr
        : null;
    const baseAnnualUsd = supplyAnnualUsd != null && borrowCostAnnualUsd != null ? supplyAnnualUsd - borrowCostAnnualUsd : null;
    const aprOnEquity = (annual) => annual != null && equityUsd != null && equityUsd > 0 && Number.isFinite(annual)
        ? (annual / equityUsd) * 100
        : null;
    const baseNetAprPct = aprOnEquity(baseAnnualUsd);
    const knownIncentiveAnnualUsd = depositIncentiveAnnualUsd == null && borrowIncentiveAnnualUsd == null
        ? null
        : (depositIncentiveAnnualUsd ?? 0) + (borrowIncentiveAnnualUsd ?? 0);
    const incentivesComplete = depositIncentiveApr != null && borrowIncentiveApr != null;
    let coverage = 'unavailable';
    if (baseAnnualUsd != null && incentivesComplete && equityUsd != null && equityUsd > 0)
        coverage = 'complete';
    else if (baseAnnualUsd != null || depositIncentiveAnnualUsd != null || borrowIncentiveAnnualUsd != null) {
        coverage = 'partial';
    }
    const netAnnualUsd = coverage === 'complete' && baseAnnualUsd != null
        ? baseAnnualUsd + (depositIncentiveAnnualUsd ?? 0) + (borrowIncentiveAnnualUsd ?? 0)
        : null;
    const netAprPct = aprOnEquity(netAnnualUsd);
    let partialAnnualUsd = null;
    if (coverage === 'partial' && baseAnnualUsd != null) {
        partialAnnualUsd = baseAnnualUsd;
        if (depositIncentiveAnnualUsd != null)
            partialAnnualUsd += depositIncentiveAnnualUsd;
        if (borrowIncentiveAnnualUsd != null)
            partialAnnualUsd += borrowIncentiveAnnualUsd;
    }
    const partialAprPct = coverage === 'partial' ? aprOnEquity(partialAnnualUsd) : null;
    return {
        baseSupplyApr,
        baseBorrowApr,
        depositIncentiveApr,
        borrowIncentiveApr,
        supplyAnnualUsd,
        borrowCostAnnualUsd,
        baseAnnualUsd,
        baseNetAprPct,
        depositIncentiveAnnualUsd,
        borrowIncentiveAnnualUsd,
        knownIncentiveAnnualUsd,
        netAnnualUsd,
        netAprPct,
        partialAnnualUsd,
        partialAprPct,
        coverage,
        reasons: coverage === 'complete' ? [] : reasons,
        incentivesIncluded: coverage === 'complete',
        ratesSource,
    };
}
/**
 * Liquidation estimates from protocol liq LTV + spot amounts.
 * Not a protocol oracle quote — label as estimated.
 */
export function multiplyRiskFromSpot(input) {
    const currentLtv = multiplyCurrentLtv(input.debtUsd, input.collateralUsd);
    const liqRaw = input.liquidationLtv;
    const liq = liqRaw != null && Number.isFinite(liqRaw) && liqRaw > 0 && liqRaw <= 1 ? liqRaw : null;
    const maxLtv = input.maxLtv != null && Number.isFinite(input.maxLtv) && input.maxLtv > 0 && input.maxLtv <= 1
        ? input.maxLtv
        : null;
    const bufferPctPoints = currentLtv != null && liq != null ? (liq - currentLtv) * 100 : null;
    let liquidationPriceCollateralUsd = null;
    let liquidationRatioDebtPerCollateral = null;
    let source = 'unavailable';
    if (liq != null &&
        liq > 0 &&
        input.collateralAmount != null &&
        input.collateralAmount > 0 &&
        input.debtUsd != null &&
        Number.isFinite(input.debtUsd) &&
        input.debtAmount != null &&
        Number.isFinite(input.debtAmount)) {
        liquidationPriceCollateralUsd = input.debtUsd / (input.collateralAmount * liq);
        liquidationRatioDebtPerCollateral = input.debtAmount / (input.collateralAmount * liq);
        source = 'estimated_from_liq_ltv';
    }
    return {
        currentLtv,
        liquidationLtv: liq,
        maxLtv,
        bufferPctPoints,
        liquidationPriceCollateralUsd,
        liquidationRatioDebtPerCollateral,
        orientation: 'collateral_usd_at_liq',
        source,
        valuationBasis: 'spot_usd',
        protocolRisk: null,
    };
}
export function mergeMultiplyCompleteness(flags) {
    const set = new Set(flags.filter(Boolean));
    if (set.size === 0)
        return 'complete';
    if (set.has('partial_missing_prices'))
        return 'partial_missing_prices';
    if (set.has('partial_missing_decimals'))
        return 'partial_missing_decimals';
    if (set.has('partial_api_fallback'))
        return 'partial_api_fallback';
    if (set.has('partial_missing_rates'))
        return 'partial_missing_rates';
    if (set.has('partial_missing_rewards'))
        return 'partial_missing_rewards';
    if (set.has('partial'))
        return 'partial';
    return 'complete';
}
/** Current Multiply app vault URL (pair page; connect wallet there to manage). */
export function currentMultiplyAppUrl(opts) {
    const market = (opts.fromMarket || 'MainMarket').replace(/\s+/g, '');
    const strip = (t) => t.replace(/^0x/i, '');
    return `https://app.current.finance/multiply/${encodeURIComponent(market)}/${strip(opts.collateralCoinType)}/${strip(opts.debtCoinType)}`;
}
/**
 * Portfolio contribution of one Multiply obligation.
 * Equity plus claimable rewards, each once. Unknown equity contributes nothing.
 * Unknown rewards keep the known equity and mark the total partial.
 */
export function multiplyPortfolioContribution(p) {
    const m = p.currentMultiply;
    if (!m) {
        return { usd: null, partial: true };
    }
    const equity = m.equityUsd;
    if (equity == null || !Number.isFinite(equity))
        return { usd: null, partial: true };
    const rewards = m.claimableRewardsUsd;
    if (rewards != null && Number.isFinite(rewards))
        return { usd: equity + rewards, partial: false };
    if (m.rewardsStatus === 'empty')
        return { usd: equity, partial: false };
    return { usd: equity, partial: true };
}
/** Estimated daily net USD from current rates (not realized earnings). */
export function multiplyEstimatedDailyNetUsd(netAnnualUsd) {
    if (netAnnualUsd == null || !Number.isFinite(netAnnualUsd))
        return null;
    return netAnnualUsd / 365;
}
/** Aggregate full Net APR only: Σ complete annual USD / Σ equity of those positions. */
export function aggregateMultiplyNetAprPct(rows) {
    let annual = 0;
    let equity = 0;
    let n = 0;
    let eligible = 0;
    for (const r of rows) {
        eligible += 1;
        if (r.coverage != null && r.coverage !== 'complete')
            continue;
        if (r.netAnnualUsd == null || r.equityUsd == null)
            continue;
        if (!(r.equityUsd > 0) || !Number.isFinite(r.netAnnualUsd) || !Number.isFinite(r.equityUsd))
            continue;
        annual += r.netAnnualUsd;
        equity += r.equityUsd;
        n += 1;
    }
    return {
        aprPct: equity > 0 ? (annual / equity) * 100 : null,
        coverageEquityUsd: equity,
        coverageCount: n,
        eligible,
        partial: eligible > 0 && n < eligible,
    };
}
