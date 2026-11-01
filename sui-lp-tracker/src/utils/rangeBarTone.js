import { isEmptyLpPosition } from '@/utils/lpLifecycle';
/** CLMM half-open band: tick ∈ [lower, upper). */
export function tickInClmmRange(tick, lower, upper) {
    if (!Number.isFinite(tick) || !Number.isFinite(lower) || !Number.isFinite(upper))
        return false;
    const lo = Math.min(lower, upper);
    const hi = Math.max(lower, upper);
    return tick >= lo && tick < hi;
}
function memberCoversTick(m, tick) {
    // Prefer live tick math so Empty/Active share one pool price; fall back to status.
    if (Number.isFinite(tick))
        return tickInClmmRange(tick, m.tickLower, m.tickUpper);
    return m.status === 'in_range';
}
/**
 * Single LP strip:
 * - active + in band → blue
 * - empty + in band → gray (no principal liquidity)
 * - out of band → red
 */
export function rangeBarToneForPosition(p) {
    const inBand = memberCoversTick(p, p.currentTick);
    if (!inBand)
        return 'out';
    return isEmptyLpPosition(p) ? 'empty' : 'active';
}
/**
 * Cascade strip (union of all member bands for the visual width):
 * 1. blue  — price in any funded (working) LP
 * 2. gray  — price only in Empty LP band(s)
 * 3. red   — price outside every member band
 */
export function rangeBarToneForCascade(members) {
    if (members.length === 0)
        return 'out';
    const tick = members.find((m) => Number.isFinite(m.currentTick))?.currentTick ?? Number.NaN;
    let inEmpty = false;
    for (const m of members) {
        if (!memberCoversTick(m, tick))
            continue;
        if (!isEmptyLpPosition(m))
            return 'active';
        inEmpty = true;
    }
    return inEmpty ? 'empty' : 'out';
}
