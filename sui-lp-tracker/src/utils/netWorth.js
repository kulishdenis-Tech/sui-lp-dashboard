import { liquidityUsdOrNull, positionValueUsdOrNull } from '@/utils/positionDerivedMetrics';
import { isCurrentMultiplyVaultPosition, multiplyPortfolioContribution } from '@/utils/currentMultiplyVault';
import { finiteUsd } from '@/utils/finiteUsd';
/**
 * Net worth: wallet (on-chain) + open LP − borrows.
 * `walletAssetsUSD` зазвичай передають уже **без** прихованих токенів (спам / без ціни / dust).
 * Open LP = complete **Value** when known; otherwise known Liquidity only
 * (unknown unclaimed must not zero the whole LP, and must not invent fees as $0).
 */
export function computeNetWorth(tokenBalances, openPositions, lending, walletAssetsUSDOverride) {
    const walletAssetsUSD = finiteUsd(walletAssetsUSDOverride !== undefined
        ? walletAssetsUSDOverride
        : tokenBalances.reduce((s, t) => s + finiteUsd(t.valueUSD), 0));
    let openLpPartial = false;
    const openLpUSD = finiteUsd(openPositions.reduce((s, p) => {
        if (isCurrentMultiplyVaultPosition(p)) {
            const part = multiplyPortfolioContribution(p);
            if (part.partial)
                openLpPartial = true;
            if (part.usd == null)
                return s;
            return s + part.usd;
        }
        const value = positionValueUsdOrNull(p);
        if (value != null)
            return s + value;
        const liq = liquidityUsdOrNull(p);
        if (liq == null)
            return s;
        return s + liq;
    }, 0));
    const outstandingBorrowUSD = finiteUsd((lending?.borrows ?? []).reduce((s, b) => s + finiteUsd(b.currentDebtUSD), 0));
    const netLendingUSD = finiteUsd(lending?.netValueUSD ?? finiteUsd(lending?.totalSuppliedUSD) - outstandingBorrowUSD);
    const totalNetUSD = finiteUsd(walletAssetsUSD + openLpUSD + netLendingUSD);
    return {
        walletAssetsUSD,
        openLpUSD,
        openLpPartial,
        outstandingBorrowUSD,
        netLendingUSD,
        totalNetUSD,
    };
}
