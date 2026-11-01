/** Coerce to finite USD; NaN/Infinity/null → 0. */
export function finiteUsd(n) {
    if (n == null || !Number.isFinite(n))
        return 0;
    return n;
}
