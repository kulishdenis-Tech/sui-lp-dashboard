import { isCurrentMultiplyVaultPosition } from '@/utils/currentMultiplyVault';
import { isCetusVaultPosition } from '@/utils/cetusVault';
/** Протоколи з локальним скануванням подій гаманця + enrichment (PnL / HODL). */
export function lpProtocolUsesOnChainHistory(protocol) {
    return protocol === 'bluefin' || protocol === 'momentum' || protocol === 'cetus' || protocol === 'turbos';
}
/**
 * Whether this *position* should run / expect generic LP on-chain history.
 * Current Multiply obligations are leveraged lending — never Cetus LP event scans.
 */
export function positionUsesOnChainLpHistory(position) {
    if (isCurrentMultiplyVaultPosition(position))
        return false;
    return lpProtocolUsesOnChainHistory(position.protocol);
}
/**
 * True only when the protocol uses on-chain history AND enrichment has completed
 * with events + deposit basis (so PnL / ROI are real, not placeholder $0).
 */
export function isLpPositionHistoryEnriched(position, positionEvents) {
    if (isCurrentMultiplyVaultPosition(position))
        return false;
    // Earn / Haedal vault enrichment is separate; treat as not Cetus-CLMM-history-gated when vault.
    if (!lpProtocolUsesOnChainHistory(position.protocol))
        return true;
    if (isCetusVaultPosition(position) && !isCurrentMultiplyVaultPosition(position)) {
        // Existing Earn vault path still uses protocol==='cetus' history when available.
    }
    const evs = positionEvents[position.id];
    if (!Array.isArray(evs) || evs.length === 0)
        return false;
    const dep = position.depositedUSD;
    return Number.isFinite(dep) && dep > 0;
}
/**
 * True while the enrichment scan is actively running for this position.
 * Driven by `loadingEvents` in appStore (set true before scan, cleared after).
 */
export function isLpPositionEnrichmentPending(positionId, loadingEvents) {
    return loadingEvents[positionId] === true;
}
