/**
 * Snapshot completeness — shared Overview history helpers / PortfolioChart.
 *
 * - verified: incomplete === false (explicit writer proof)
 * - incomplete: incomplete === true
 * - legacy: incomplete === undefined (pre-flag rows; showable, not proven complete)
 *
 * Never rewrite legacy rows to verified without evidence.
 */
export function snapshotCompleteness(s) {
    if (s.incomplete === true)
        return 'incomplete';
    if (s.incomplete === false)
        return 'verified';
    return 'legacy';
}
/** Chart may draw verified + legacy; skips incomplete. */
export function isChartableSnapshot(s) {
    if (!Number.isFinite(s.totalUSD) || !(s.totalUSD > 0))
        return false;
    if (!Number.isFinite(s.ts) || !(s.ts > 0))
        return false;
    return snapshotCompleteness(s) !== 'incomplete';
}
/** Strict Value Change endpoints — verified only. */
export function isVerifiedEndpoint(s) {
    return snapshotCompleteness(s) === 'verified' && isChartableSnapshot(s);
}
/**
 * Soft endpoint for continuity: verified or legacy.
 * Callers must surface `unverified` when any legacy endpoint is used.
 */
export function isSoftEndpoint(s) {
    const c = snapshotCompleteness(s);
    return (c === 'verified' || c === 'legacy') && isChartableSnapshot(s);
}
export function valueChangeUnavailableLabel(reason) {
    switch (reason) {
        case 'no_data':
            return 'No snapshot history';
        case 'insufficient_history':
            return 'Insufficient history for this window';
        case 'missing_reference':
            return 'Missing reference within tolerance';
        case 'stale_endpoint':
            return 'Stale or unusable endpoint';
        default:
            return 'Unavailable';
    }
}
