import type { OpenPosition } from '@/types'

/**
 * Parse on-chain liquidity raw string.
 * - `zero` — confirmed u128 0 (Empty candidate)
 * - `positive` — confirmed > 0
 * - `unknown` — missing / non-decimal — never treat as Empty
 */
export function liquidityRawState(
	liquidity: string | null | undefined,
): 'zero' | 'positive' | 'unknown' {
	if (liquidity == null || liquidity === '') return 'unknown'
	if (!/^\d+$/.test(liquidity)) return 'unknown'
	try {
		return BigInt(liquidity) === 0n ? 'zero' : 'positive'
	} catch {
		return 'unknown'
	}
}

/** True only when raw liquidity is a confirmed decimal zero. */
export function isZeroLiquidity(liquidity: string | null | undefined): boolean {
	return liquidityRawState(liquidity) === 'zero'
}

export function isUnknownLiquidity(liquidity: string | null | undefined): boolean {
	return liquidityRawState(liquidity) === 'unknown'
}

/**
 * Empty = position NFT still owned, principal liquidity is confirmed zero.
 * Not the same as Closed (object burned / confirmed close event).
 * Unknown / malformed liquidity is not Empty.
 */
export function isEmptyLpPosition(
	p: Pick<OpenPosition, 'liquidity' | 'lifecycleStatus'>,
): boolean {
	if (p.lifecycleStatus === 'empty') return true
	if (p.lifecycleStatus === 'active') return false
	return liquidityRawState(p.liquidity) === 'zero'
}

export function resolveLifecycleStatus(liquidity: string): 'active' | 'empty' | 'unknown' {
	const s = liquidityRawState(liquidity)
	if (s === 'zero') return 'empty'
	if (s === 'positive') return 'active'
	return 'unknown'
}

/** Unclaimed fee/reward value that must stay visible even when principal is $0. */
export function emptyPositionClaimableUsd(
	p: Pick<OpenPosition, 'unclaimedFeeUSD' | 'unclaimedRewardUSD'>,
): number {
	const f = Number.isFinite(p.unclaimedFeeUSD) ? p.unclaimedFeeUSD : 0
	const r = Number.isFinite(p.unclaimedRewardUSD) ? p.unclaimedRewardUSD : 0
	return Math.max(0, f) + Math.max(0, r)
}
