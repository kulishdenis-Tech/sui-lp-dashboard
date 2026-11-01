import { normalizeSuiAddress } from '@mysten/sui/utils';
import { getWalletBalance } from '@/services/balanceService';
import { getLendingPositions } from '@/services/lendingService';
import { getNaviPositions, EMPTY_NAVI_SNAP } from '@/services/naviService';
import { getCurrentPositions, EMPTY_CURRENT_SNAP } from '@/services/currentService';
import { classifyAllBalances, sumVisibleWalletUSD } from '@/services/tokenClassifier';
import { liquidityUsdOrNull, positionValueUsdOrNull } from '@/utils/positionDerivedMetrics';
import { isCurrentMultiplyVaultPosition, multiplyPortfolioContribution } from '@/utils/currentMultiplyVault';
import { finiteUsd } from '@/utils/finiteUsd';
import { currentHourBucket, makeSnapshotId, } from '@/services/portfolioSnapshotIdb';
import { createServerSuiClient } from '@/services/serverSuiClient';
import { loadAllPortfolioLpSources } from '@/services/portfolioLpSources';
const EMPTY_LEND = {
    supplies: [],
    borrows: [],
    totalSuppliedUSD: 0,
    totalBorrowedUSD: 0,
    netValueUSD: 0,
    healthFactor: null,
    rewardsToClaim: [],
    protocol: 'AlphaLend',
};
function logSnapErr(part, e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[snapshot] ${part}:`, msg);
}
/**
 * Load portfolio components and build a 15-min bucket snapshot (no LP event enrichment).
 * Used by cron / GitHub Actions — mirrors client `loadAll` LP source registry (incl. DLMM).
 *
 * Per-source `{ ok, error? }`: fetch error ≠ confirmed zero.
 * `incomplete` when any LP source failed — callers must not overwrite a complete snapshot.
 */
export async function loadPortfolioSnapshotForAddress(rawAddress) {
    const full = await loadPortfolioSnapshotDetailed(rawAddress);
    // Incomplete loads are not returned. Callers must not upsert a partial over a complete bucket.
    if (full.incomplete || !full.snapshot)
        return null;
    return { ...full.snapshot, incomplete: false, lpSources: full.lpSources };
}
export async function loadPortfolioSnapshotDetailed(rawAddress) {
    const walletAddr = normalizeSuiAddress(rawAddress).toLowerCase();
    const client = createServerSuiClient();
    const lendingSources = [];
    let balanceOk = true;
    const balance = await getWalletBalance(walletAddr, client).catch((e) => {
        balanceOk = false;
        logSnapErr('balance', e);
        return [];
    });
    let lend = EMPTY_LEND;
    try {
        lend = await getLendingPositions(walletAddr);
        lendingSources.push({ id: 'alphalend', ok: true, status: 'ok' });
    }
    catch (e) {
        logSnapErr('alphalend', e);
        lendingSources.push({
            id: 'alphalend',
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            status: 'unavailable',
        });
    }
    let navi = EMPTY_NAVI_SNAP;
    try {
        navi = await getNaviPositions(walletAddr);
        lendingSources.push({ id: 'navi', ok: true, status: 'ok' });
    }
    catch (e) {
        logSnapErr('navi', e);
        lendingSources.push({
            id: 'navi',
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            status: 'unavailable',
        });
    }
    let current = EMPTY_CURRENT_SNAP;
    try {
        current = await getCurrentPositions(walletAddr);
        lendingSources.push({ id: 'current', ok: true, status: 'ok' });
    }
    catch (e) {
        logSnapErr('current', e);
        lendingSources.push({
            id: 'current',
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            status: 'unavailable',
        });
    }
    const lp = await loadAllPortfolioLpSources(walletAddr);
    let walletVisibleUSD = 0;
    let classifyOk = true;
    try {
        const bucket = await classifyAllBalances(balance);
        walletVisibleUSD = sumVisibleWalletUSD(bucket);
    }
    catch (e) {
        classifyOk = false;
        logSnapErr('walletClassify', e);
    }
    return assemblePortfolioSnapshot({
        walletAddr,
        hourBucket: currentHourBucket(),
        balanceOk,
        classifyOk,
        walletUSD: finiteUsd(walletVisibleUSD),
        lpLoads: lp.loads,
        positions: lp.positions,
        lendingSources,
        lendingNetUSD: finiteUsd(finiteUsd(lend.netValueUSD) + finiteUsd(navi.netValueUSD) + finiteUsd(current.netValueUSD)),
    });
}
export function assemblePortfolioSnapshot(input) {
    const lpSources = input.lpLoads.map((l) => ({
        id: l.id,
        ok: l.ok,
        error: l.error,
        count: l.ok ? l.positions.length : 0,
    }));
    const lpIncomplete = input.lpLoads.some((l) => !l.ok);
    const lendingIncomplete = input.lendingSources.some((s) => s.status !== 'ok' || !s.ok);
    const incomplete = lpIncomplete || lendingIncomplete || !input.balanceOk || !input.classifyOk;
    // Match computeNetWorth: Multiply equity; else Value; else known Liquidity (incomplete unclaimed ≠ $0 LP).
    let lpUSD = 0;
    let aftermathUSD = 0;
    for (const p of input.positions) {
        let val = null;
        if (isCurrentMultiplyVaultPosition(p)) {
            val = multiplyPortfolioContribution(p).usd;
        }
        else {
            val = positionValueUsdOrNull(p) ?? liquidityUsdOrNull(p);
        }
        if (val == null)
            continue;
        if (p.protocol === 'aftermath')
            aftermathUSD += val;
        else
            lpUSD += val;
    }
    const walletUSD = finiteUsd(input.walletUSD);
    const totalUSD = finiteUsd(walletUSD + lpUSD + aftermathUSD + input.lendingNetUSD);
    if (totalUSD <= 0 && !incomplete) {
        return {
            snapshot: null,
            incomplete: false,
            lpSources,
            lendingSources: input.lendingSources,
            preservePreviousIfIncomplete: false,
        };
    }
    const snapshot = {
        id: makeSnapshotId(input.walletAddr, input.hourBucket),
        walletAddr: input.walletAddr,
        hourBucket: input.hourBucket,
        ts: input.hourBucket,
        lpUSD: finiteUsd(lpUSD),
        aftermathUSD: finiteUsd(aftermathUSD),
        lendingNetUSD: input.lendingNetUSD,
        walletUSD,
        totalUSD,
        incomplete,
        lpSources,
    };
    return {
        snapshot,
        incomplete,
        lpSources,
        lendingSources: input.lendingSources,
        preservePreviousIfIncomplete: incomplete,
    };
}
