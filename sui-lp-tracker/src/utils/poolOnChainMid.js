import { clmmRangeFromOpenPosition } from '@/utils/tickPriceRange';
/** On-chain mid: token B per 1 token A from sqrtPrice (not a CEX print). */
export function onChainMidBPerA(p) {
    const r = clmmRangeFromOpenPosition(p);
    if (!r || !(r.priceCurrent > 0))
        return null;
    return r.priceCurrent;
}
/** CEX/spot implied B per A from USD legs. */
export function cexImpliedBPerA(p) {
    const a = p.currentPriceA_USD;
    const b = p.currentPriceB_USD;
    if (!(a > 0 && b > 0))
        return null;
    return a / b;
}
/** (onChain / cex − 1) × 10_000. */
export function midVsCexBps(onChain, cex) {
    if (!(onChain > 0 && cex > 0))
        return null;
    return (onChain / cex - 1) * 10_000;
}
