import { isBluefinUnclaimedUnavailable } from '@/utils/bluefinUnclaimedUi';
/** Такий самий поріг як у enrichment для APR (ще не «розплющуємо» внутрішню добу). */
const MIN_DAYS_FOR_APR = 0.02;
/**
 * Live unclaimed fee+reward at spot.
 * Complete only when both fee and reward legs are finite (or Bluefin reader succeeded with zeros).
 * A known reward with unknown fee is Partial — never a full Unclaimed total.
 */
export function unclaimedIncomeMetric(p) {
    if (p.protocol === 'bluefin' &&
        isBluefinUnclaimedUnavailable(p)) {
        return { usd: null, complete: false };
    }
    const uF = Number.isFinite(p.unclaimedFeeUSD) ? Math.max(0, p.unclaimedFeeUSD) : null;
    const uR = Number.isFinite(p.unclaimedRewardUSD) ? Math.max(0, p.unclaimedRewardUSD) : null;
    if (uF == null && uR == null)
        return { usd: null, complete: false };
    if (uF == null || uR == null) {
        return { usd: (uF ?? 0) + (uR ?? 0), complete: false };
    }
    return { usd: uF + uR, complete: true };
}
/** Full unclaimed only; null when incomplete or unknown. */
export function unclaimedIncomeUsdOrNull(p) {
    const m = unclaimedIncomeMetric(p);
    return m.complete ? m.usd : null;
}
/** Claimed fee+reward from history; negative noise clamped to 0. NaN → null (history unknown). */
export function claimedEarningsUsdOrNull(p) {
    return Number.isFinite(p.lifetimeEarningsUSD) ? Math.max(0, p.lifetimeEarningsUSD) : null;
}
/** Claimed fee+reward from history; negative noise clamped to 0. Unknown → 0 for numeric callers. */
export function claimedEarningsUsd(p) {
    return claimedEarningsUsdOrNull(p) ?? 0;
}
/**
 * Lifetime earnings = claimed (history) + unclaimed (live).
 * When `includeClaimed` is false (history not ready), claimed is treated as 0 so
 * Earnings === Unclaimed until collects are known — never invent a gap.
 * Null only when unclaimed is unknown and there is no claimed to show.
 */
export function totalLifetimeEarningsUsdOrNull(p, opts) {
    const includeClaimed = opts?.includeClaimed !== false;
    const claimed = includeClaimed ? claimedEarningsUsd(p) : 0;
    const unclaimed = unclaimedIncomeUsdOrNull(p);
    if (unclaimed == null)
        return claimed > 0 ? claimed : null;
    return claimed + unclaimed;
}
/** Claimed fee+reward (history) + accrued unclaimed at spot. Unknown unclaimed → 0 for numeric callers. */
export function totalLifetimeEarningsUsd(p) {
    return totalLifetimeEarningsUsdOrNull(p) ?? 0;
}
/**
 * APR лише від накопичених fee+reward відносно net deposited USD: (lifetime/deposited)×(365/days).
 * Порівняння з екраном типу Bluefin «Earnings APR на капітал».
 */
export function earningsAnnualizedAprPct(p) {
    const earn = totalLifetimeEarningsUsd(p);
    const dep = p.depositedUSD;
    const days = p.daysOpen;
    if (!Number.isFinite(earn) || !Number.isFinite(dep) || dep <= 0)
        return null;
    if (!Number.isFinite(days) || days <= MIN_DAYS_FOR_APR)
        return null;
    return (earn / dep) * (365 / days) * 100;
}
/**
 * Vault APR from capital PnL (fees/rebalance already in AUM):
 * (pnlUSD ÷ deposited) × (365 ÷ days) × 100.
 *
 * Not used for Earn vault UI: short-horizon mark PnL/IL annualizes into
 * nonsense (±hundreds %). Forward trading-fee APY needs Cetus/Haedal stats.
 */
export function vaultCapitalAprPct(p) {
    const pnl = p.pnlUSD;
    const dep = p.depositedUSD;
    const days = p.daysOpen;
    if (!Number.isFinite(pnl) || !Number.isFinite(dep) || dep <= 0)
        return null;
    // Require a long enough sample that annualization is not pure noise.
    if (!Number.isFinite(days) || days < 14)
        return null;
    return (pnl / dep) * (365 / days) * 100;
}
/**
 * Liquidity USD at spot. Returns null when mark value is unknown — never coerce to $0.
 * See `docs/GLOSSARY.md`.
 */
export function liquidityUsdOrNull(p) {
    return Number.isFinite(p.currentValueUSD) ? p.currentValueUSD : null;
}
/** @deprecated Prefer `liquidityUsdOrNull` — unknown must not display as $0. */
export function liquidityUsd(p) {
    return liquidityUsdOrNull(p) ?? 0;
}
/**
 * Value = Liquidity + unclaimed fee/reward USD at spot.
 * Null when liquidity is unknown OR unclaimed is incomplete — never pretend unknown unclaimed is $0.
 */
export function positionValueUsdOrNull(p) {
    const liq = liquidityUsdOrNull(p);
    if (liq == null)
        return null;
    const u = unclaimedIncomeMetric(p);
    if (!u.complete || u.usd == null)
        return null;
    return liq + u.usd;
}
/** @deprecated Prefer `positionValueUsdOrNull` for Partial/Unknown-aware UI. */
export function positionValueUsd(p) {
    return positionValueUsdOrNull(p) ?? 0;
}
/** Імперманент-дівергенція марки пулової позиції vs HODL (net qty × поточний спот): (Liq − HODL) / HODL. */
export function liquidityVsHodlIlPct(currentValueUsd, hodlUsd) {
    if (!Number.isFinite(hodlUsd) || hodlUsd <= 0)
        return null;
    if (!Number.isFinite(currentValueUsd))
        return null;
    return ((currentValueUsd - hodlUsd) / hodlUsd) * 100;
}
export function avgDailyLifetimeEarningsUsd(p) {
    const earn = totalLifetimeEarningsUsd(p);
    const days = p.daysOpen;
    if (!Number.isFinite(earn) || !Number.isFinite(days) || days <= MIN_DAYS_FOR_APR)
        return null;
    return earn / days;
}
