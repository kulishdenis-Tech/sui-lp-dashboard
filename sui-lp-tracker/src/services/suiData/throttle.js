/**
 * Lightweight throttle for public Mysten gRPC/GraphQL (rate-limited public-good).
 * Mirrors the spirit of dashboard JSON-RPC pool gaps without multi-URL failover.
 */
const MAX_IN_FLIGHT = 3;
const MIN_GAP_MS = 80;
let inFlight = 0;
let lastStart = 0;
const waiters = [];
function kick() {
    while (inFlight < MAX_IN_FLIGHT && waiters.length > 0) {
        const now = Date.now();
        const wait = Math.max(0, MIN_GAP_MS - (now - lastStart));
        if (wait > 0 && inFlight > 0) {
            setTimeout(kick, wait);
            return;
        }
        const next = waiters.shift();
        if (!next)
            return;
        inFlight += 1;
        lastStart = Date.now();
        next();
    }
}
export async function withSuiDataThrottle(fn) {
    await new Promise((resolve) => {
        waiters.push(resolve);
        kick();
    });
    try {
        return await fn();
    }
    finally {
        inFlight = Math.max(0, inFlight - 1);
        kick();
    }
}
