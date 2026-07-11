import type { OpenPosition } from '@/types'

/** Такий самий поріг як у enrichment для APR (ще не «розплющуємо» внутрішню добу). */
const MIN_DAYS_FOR_APR = 0.02

/** Claimed fee+reward (history) + accrued unclaimed at spot. */
export function totalLifetimeEarningsUsd(
	p: Pick<OpenPosition, 'lifetimeEarningsUSD' | 'unclaimedFeeUSD' | 'unclaimedRewardUSD'>,
): number {
	const claimed = Number.isFinite(p.lifetimeEarningsUSD) ? p.lifetimeEarningsUSD : 0
	const uF = Number.isFinite(p.unclaimedFeeUSD) ? p.unclaimedFeeUSD : 0
	const uR = Number.isFinite(p.unclaimedRewardUSD) ? p.unclaimedRewardUSD : 0
	return claimed + uF + uR
}

/**
 * APR лише від накопичених fee+reward відносно net deposited USD: (lifetime/deposited)×(365/days).
 * Порівняння з екраном типу Bluefin «Earnings APR на капітал».
 */
export function earningsAnnualizedAprPct(
	p: Pick<OpenPosition, 'lifetimeEarningsUSD' | 'unclaimedFeeUSD' | 'unclaimedRewardUSD' | 'depositedUSD' | 'daysOpen'>,
): number | null {
	const earn = totalLifetimeEarningsUsd(p)
	const dep = p.depositedUSD
	const days = p.daysOpen
	if (!Number.isFinite(earn) || !Number.isFinite(dep) || dep <= 0) return null
	if (!Number.isFinite(days) || days <= MIN_DAYS_FOR_APR) return null
	return (earn / dep) * (365 / days) * 100
}

/** **Liquidity** (USD) at spot; **Value** = `positionValueUsd()`. See `docs/GLOSSARY.md`. */
export function liquidityUsd(p: Pick<OpenPosition, 'currentValueUSD'>): number {
	return Number.isFinite(p.currentValueUSD) ? p.currentValueUSD : 0
}

/** **Value** = Liquidity + unclaimed fee/reward USD at spot (`docs/GLOSSARY.md`). */
export function positionValueUsd(
	p: Pick<OpenPosition, 'currentValueUSD' | 'unclaimedFeeUSD' | 'unclaimedRewardUSD'>,
): number {
	const uF = Number.isFinite(p.unclaimedFeeUSD) ? p.unclaimedFeeUSD : 0
	const uR = Number.isFinite(p.unclaimedRewardUSD) ? p.unclaimedRewardUSD : 0
	return liquidityUsd(p) + uF + uR
}

/** Імперманент-дівергенція марки пулової позиції vs HODL (net qty × поточний спот): (Liq − HODL) / HODL. */
export function liquidityVsHodlIlPct(currentValueUsd: number, hodlUsd: number): number | null {
	if (!Number.isFinite(hodlUsd) || hodlUsd <= 0) return null
	if (!Number.isFinite(currentValueUsd)) return null
	return ((currentValueUsd - hodlUsd) / hodlUsd) * 100
}

export function avgDailyLifetimeEarningsUsd(
	p: Pick<OpenPosition, 'lifetimeEarningsUSD' | 'unclaimedFeeUSD' | 'unclaimedRewardUSD' | 'daysOpen'>,
): number | null {
	const earn = totalLifetimeEarningsUsd(p)
	const days = p.daysOpen
	if (!Number.isFinite(earn) || !Number.isFinite(days) || days <= MIN_DAYS_FOR_APR) return null
	return earn / days
}
