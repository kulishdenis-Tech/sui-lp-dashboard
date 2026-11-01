/** Retry transient RPC / HTTP failures (429, timeout, 5xx). */
export async function withRpcBackoff(fn, opts = {}) {
    const retries = opts.retries ?? 4;
    const baseMs = opts.baseMs ?? 700;
    const maxTotalWaitMs = opts.maxTotalWaitMs ?? 18_000;
    const retryOn = /429|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|503|502|FetchError|fetch failed|rate limit|Too Many|too frequent|Unexpected status code/i;
    let last;
    let waited = 0;
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        }
        catch (e) {
            last = e;
            const msg = e instanceof Error ? e.message : String(e);
            if (!retryOn.test(msg) || i === retries)
                break;
            let wait = baseMs * 2 ** i + Math.floor(Math.random() * 350);
            if (waited + wait > maxTotalWaitMs)
                wait = Math.max(0, maxTotalWaitMs - waited);
            if (wait <= 0)
                break;
            waited += wait;
            if (opts.label) {
                console.warn(`[rpc-backoff] ${opts.label} attempt ${i + 1}/${retries + 1} wait ${wait}ms: ${msg.slice(0, 140)}`);
            }
            await new Promise((r) => setTimeout(r, wait));
        }
    }
    throw last instanceof Error ? last : new Error(String(last));
}
