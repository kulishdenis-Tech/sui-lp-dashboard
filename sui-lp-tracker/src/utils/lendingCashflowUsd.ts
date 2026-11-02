import type { LendingCashflowUsd } from '@/types'

export function buildLendingCashflowUsd(input: {
	supplyInterestUSD: number
	borrowInterestUSD: number
	claimedRewardsUSD: number
	unclaimedRewardsUSD: number
	usedSpotPrice: boolean
}): LendingCashflowUsd {
	const realizedUSD =
		input.supplyInterestUSD - input.borrowInterestUSD + input.claimedRewardsUSD
	const resultUSD = realizedUSD + input.unclaimedRewardsUSD
	return {
		supplyInterestUSD: input.supplyInterestUSD,
		borrowInterestUSD: input.borrowInterestUSD,
		claimedRewardsUSD: input.claimedRewardsUSD,
		unclaimedRewardsUSD: input.unclaimedRewardsUSD,
		realizedUSD,
		resultUSD,
		usedSpotPrice: input.usedSpotPrice,
	}
}

/** QA: realizedUSD + unclaimedRewardsUSD ≈ resultUSD */
export function cashflowResultMatchesParts(
	cf: LendingCashflowUsd,
	toleranceUSD = 0.01,
): boolean {
	const sum = (cf.realizedUSD ?? 0) + (cf.unclaimedRewardsUSD ?? 0)
	return Math.abs(sum - cf.resultUSD) <= toleranceUSD
}
