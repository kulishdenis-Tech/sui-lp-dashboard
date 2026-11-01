/** Uniswap V3 / CLMM wrapping u128 fee-growth math. */
export const U128_MOD = 2n ** 128n;
export const U64_MAX = 18446744073709551615n;
export function computeFeeGrowthInside(feeGrowthGlobal, lowerFeeGrowthOutside, upperFeeGrowthOutside, lowerTick, upperTick, currentTick) {
    const feeGrowthBelow = currentTick >= lowerTick
        ? lowerFeeGrowthOutside
        : (feeGrowthGlobal - lowerFeeGrowthOutside + U128_MOD) % U128_MOD;
    const feeGrowthAbove = currentTick < upperTick
        ? upperFeeGrowthOutside
        : (feeGrowthGlobal - upperFeeGrowthOutside + U128_MOD) % U128_MOD;
    return (feeGrowthGlobal - feeGrowthBelow - feeGrowthAbove + 2n * U128_MOD) % U128_MOD;
}
/**
 * tokens_owed + live accrued from fee_growth_inside delta × liquidity.
 * `shiftBits` is 128 (Uniswap V3 / Turbos fees) or 64 (Cetus Q64).
 */
export function computeTotalOwed(tokensOwedRaw, feeGrowthInsideNow, feeGrowthInsideLast, liquidity, shiftBits = 128) {
    try {
        const liq = BigInt(liquidity);
        if (liq === 0n)
            return tokensOwedRaw;
        const owed = BigInt(tokensOwedRaw || '0');
        const delta = (feeGrowthInsideNow - feeGrowthInsideLast + U128_MOD) % U128_MOD;
        const live = (delta * liq) >> BigInt(shiftBits);
        const total = owed + live > U64_MAX ? owed : owed + live;
        return total.toString();
    }
    catch {
        return tokensOwedRaw;
    }
}
