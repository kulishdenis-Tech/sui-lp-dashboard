/** Cetus DLMM `FEE_PRECISION` from `@cetusprotocol/dlmm-sdk` 1.3.3. */
export const FEE_RATE_DENOMINATOR = 1_000_000_000

/** Raw fee rate → percent. 4_000_000 → 0.4. */
export function feeRateToPercent(raw: string | null | undefined): number | null {
	if (!raw || !/^\d+$/.test(raw)) return null
	return (Number(raw) / FEE_RATE_DENOMINATOR) * 100
}

/**
 * Unclaimed-fee APR from principal and the age of the last known object change.
 * This is not a historical APR: fees already collected are absent.
 */
export function unclaimedFeeAprPercent(feeUsd: number, principalUsd: number, ageDays: number): number | null {
	if (!(feeUsd >= 0) || !(principalUsd > 0) || !(ageDays > 0) || !Number.isFinite(ageDays)) return null
	return (feeUsd / principalUsd) * (365 / ageDays) * 100
}
