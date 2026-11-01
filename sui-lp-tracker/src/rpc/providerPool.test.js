import { describe, expect, it } from 'vitest';
import { createPooledSuiClient, createTestRpcProviderPool } from '@/rpc/providerPool';
describe('RpcProviderPool', () => {
    it('quarantines immediately on 429 and failovers', async () => {
        const pool = createTestRpcProviderPool(['https://rpc-a.example', 'https://rpc-b.example'], { timeoutMs: 200, failuresBeforeQuarantine: 99, quarantineMs: 5_000, retriesPerProvider: 1 });
        let aHits = 0;
        const { result, meta } = await pool.execute(async (_c, url) => {
            if (url.includes('rpc-a')) {
                aHits++;
                throw new Error('429 rate limit');
            }
            return `ok:${url}`;
        });
        expect(result).toContain('rpc-b');
        expect(meta.failoverUsed).toBe(true);
        expect(aHits).toBe(1);
        expect(pool.stats().find((s) => s.url.includes('rpc-a')).circuit).toBe('OPEN');
    });
    it('failovers to next provider on timeout', async () => {
        const pool = createTestRpcProviderPool(['https://rpc-a.example', 'https://rpc-b.example'], { timeoutMs: 200, failuresBeforeQuarantine: 1, quarantineMs: 50, retriesPerProvider: 0 });
        const { result, meta } = await pool.execute(async (_c, url) => {
            if (url.includes('rpc-a'))
                throw new Error('RPC timeout after 200ms');
            return `ok:${url}`;
        });
        expect(result).toContain('rpc-b');
        expect(meta.failoverUsed).toBe(true);
        expect(pool.stats().find((s) => s.url.includes('rpc-a')).timeoutCount).toBeGreaterThanOrEqual(1);
    });
    it('call() returns the inner result', async () => {
        const pool = createTestRpcProviderPool(['https://rpc-ok.example']);
        const v = await pool.call(async () => 42);
        expect(v).toBe(42);
    });
    it('soft-quarantines flapping 503 and failovers via staggered race', async () => {
        const pool = createTestRpcProviderPool(['https://rpc-a.example', 'https://rpc-b.example'], { timeoutMs: 200, failuresBeforeQuarantine: 99, quarantineMs: 5_000, retriesPerProvider: 0 });
        let aHits = 0;
        const { result, meta } = await pool.execute(async (_c, url) => {
            if (url.includes('rpc-a')) {
                aHits++;
                throw new Error('Unexpected status code: 503');
            }
            return `ok:${url}`;
        });
        expect(result).toContain('rpc-b');
        expect(aHits).toBeGreaterThanOrEqual(1);
        expect(meta.failoverUsed).toBe(true);
        expect(pool.stats().find((s) => s.url.includes('rpc-a')).circuit).toBe('OPEN');
    });
    it('hard-downs permanently removed APIs (Blast-style)', async () => {
        const pool = createTestRpcProviderPool(['https://rpc-a.example', 'https://rpc-b.example'], { timeoutMs: 200, failuresBeforeQuarantine: 99, retriesPerProvider: 0 });
        const { result } = await pool.execute(async (_c, url) => {
            if (url.includes('rpc-a')) {
                throw new Error('Blast API is no longer available. Please update your integration');
            }
            return `ok:${url}`;
        });
        expect(result).toContain('rpc-b');
        const a = pool.stats().find((s) => s.url.includes('rpc-a'));
        expect(a.circuit).toBe('OPEN');
    });
    it('retries same provider before failing (retriesPerProvider)', async () => {
        const pool = createTestRpcProviderPool(['https://rpc-flaky.example'], {
            retriesPerProvider: 1,
            failuresBeforeQuarantine: 99,
        });
        let n = 0;
        const v = await pool.call(async () => {
            n++;
            if (n === 1)
                throw new Error('RPC timeout after 100ms');
            return 'ok';
        });
        expect(v).toBe('ok');
        expect(n).toBe(2);
    });
    it('createPooledSuiClient returns a Proxy around activeClient', () => {
        const pool = createTestRpcProviderPool(['https://rpc-ok.example']);
        const client = createPooledSuiClient(pool);
        expect(client).toBeTruthy();
        expect(typeof client.getObject).toBe('function');
    });
});
