const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Creates an isolated rate limiter that spaces calls by at least `minIntervalMs`.
 * Prefer this over `withMinInterval` so different API callers don't share one global queue.
 *
 * @example
 * const gtLimiter = createRateLimiter(2100)
 * const result = await gtLimiter(() => fetch(...))
 */
export function createRateLimiter(minIntervalMs) {
    let lastCallAt = 0;
    return async function (fn) {
        const now = Date.now();
        const wait = Math.max(0, minIntervalMs - (now - lastCallAt));
        if (wait > 0)
            await sleep(wait);
        try {
            return await fn();
        }
        finally {
            lastCallAt = Date.now();
        }
    };
}
// Legacy export kept for backward-compatibility with any remaining callers.
// New code should use createRateLimiter() instead.
const _legacyLimiter = createRateLimiter(0); // no-op delay; callers pass their own minIntervalMs
/** @deprecated Use createRateLimiter(minIntervalMs) for per-instance limiters to avoid a shared global queue. */
export async function withMinInterval(minIntervalMs, fn) {
    // Re-implement inline so the per-call minIntervalMs is still respected for legacy callers
    void _legacyLimiter; // suppress unused warning
    const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Use a module-level fallback for legacy callers
    return _withMinIntervalLegacy(minIntervalMs, fn, _sleep);
}
let _legacyLastCallAt = 0;
async function _withMinIntervalLegacy(minIntervalMs, fn, sleepFn) {
    const now = Date.now();
    const wait = Math.max(0, minIntervalMs - (now - _legacyLastCallAt));
    if (wait > 0)
        await sleepFn(wait);
    try {
        return await fn();
    }
    finally {
        _legacyLastCallAt = Date.now();
    }
}
