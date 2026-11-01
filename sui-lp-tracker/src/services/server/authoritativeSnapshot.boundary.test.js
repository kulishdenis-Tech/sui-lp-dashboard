import { describe, expect, it } from 'vitest';
import { requireDlmmOwnerRows } from '@/services/cetusDlmmService';
import { PORTFOLIO_LP_SOURCE_IDS } from '@/services/portfolioLpSources';
import { assemblePortfolioSnapshot } from '@/services/server/loadPortfolioSnapshot';
import { commitAuthoritativeSnapshot, MemorySnapshotStore, } from '@/services/server/authoritativeSnapshot';
const WALLET = '0xabc';
const BUCKET = 1_700_000_000_000;
function loads(over) {
    return PORTFOLIO_LP_SOURCE_IDS.map((id) => id === over.id
        ? { id, ok: over.ok ?? true, error: over.error, positions: over.positions ?? [] }
        : { id, ok: true, positions: [] });
}
const lendingOk = [
    { id: 'alphalend', ok: true, status: 'ok' },
    { id: 'navi', ok: true, status: 'ok' },
    { id: 'current', ok: true, status: 'ok' },
];
function assembled(partial) {
    return assemblePortfolioSnapshot({
        walletAddr: WALLET,
        hourBucket: BUCKET,
        balanceOk: partial.balanceOk ?? true,
        classifyOk: partial.classifyOk ?? true,
        walletUSD: partial.walletUSD ?? 100,
        lpLoads: partial.lpLoads ?? loads({ id: 'cetus-dlmm' }),
        positions: [],
        lendingSources: partial.lendingSources ?? lendingOk,
        lendingNetUSD: partial.lendingNetUSD ?? 0,
    });
}
function asIncoming(result) {
    const s = result.snapshot;
    if (!s)
        throw new Error('expected snapshot');
    return {
        id: s.id,
        walletAddr: s.walletAddr,
        hourBucket: s.hourBucket,
        ts: s.ts,
        lpUSD: s.lpUSD,
        aftermathUSD: s.aftermathUSD,
        lendingNetUSD: s.lendingNetUSD,
        walletUSD: s.walletUSD,
        totalUSD: s.totalUSD,
        incomplete: result.incomplete,
    };
}
describe('authoritative snapshot boundary', () => {
    it('does not replace a complete bucket row with a partial load', async () => {
        const store = new MemorySnapshotStore();
        const complete = asIncoming(assembled({ walletUSD: 250 }));
        expect(complete.incomplete).toBe(false);
        await commitAuthoritativeSnapshot(store, complete);
        const partial = asIncoming(assembled({
            walletUSD: 1,
            lpLoads: loads({ id: 'cetus-dlmm', ok: false, error: 'discovery failed' }),
        }));
        expect(partial.incomplete).toBe(true);
        const decision = await commitAuthoritativeSnapshot(store, partial);
        expect(decision.action).toBe('reject');
        const row = store.rows.get(complete.id);
        expect(row?.total_usd).toBe(250);
        expect(row?.wallet_usd).toBe(250);
        expect(row?.incomplete).toBe(false);
    });
    it('wallet balance error is incomplete and is not written over a complete row', async () => {
        const store = new MemorySnapshotStore();
        const complete = asIncoming(assembled({ walletUSD: 80 }));
        await commitAuthoritativeSnapshot(store, complete);
        const broken = asIncoming(assembled({ balanceOk: false, walletUSD: 0 }));
        expect(broken.incomplete).toBe(true);
        await commitAuthoritativeSnapshot(store, broken);
        expect(store.rows.get(complete.id)?.wallet_usd).toBe(80);
        expect(store.rows.get(complete.id)?.incomplete).toBe(false);
    });
    it('classifier error is incomplete and is not written', async () => {
        const store = new MemorySnapshotStore();
        const broken = asIncoming(assembled({ classifyOk: false, walletUSD: 0 }));
        expect(broken.incomplete).toBe(true);
        const decision = await commitAuthoritativeSnapshot(store, broken);
        expect(decision.action).toBe('reject');
        expect(store.rows.size).toBe(0);
    });
    it('DLMM discovery error is not an ok/empty source and blocks the write', async () => {
        expect(() => requireDlmmOwnerRows(undefined, new Error('getOwnerPositionList failed'))).toThrow(/getOwnerPositionList/);
        expect(requireDlmmOwnerRows([], undefined)).toEqual([]);
        const store = new MemorySnapshotStore();
        const prior = asIncoming(assembled({ walletUSD: 40 }));
        await commitAuthoritativeSnapshot(store, prior);
        const dlmmDown = asIncoming(assembled({
            walletUSD: 40,
            lpLoads: loads({ id: 'cetus-dlmm', ok: false, error: 'getOwnerPositionList failed' }),
        }));
        expect(dlmmDown.incomplete).toBe(true);
        await commitAuthoritativeSnapshot(store, dlmmDown);
        expect(store.rows.get(prior.id)?.incomplete).toBe(false);
        expect(store.rows.get(prior.id)?.total_usd).toBe(40);
    });
    it('unavailable borrows are not a confirmed zero and are not stored as complete', async () => {
        const store = new MemorySnapshotStore();
        const prior = asIncoming(assembled({ walletUSD: 20, lendingNetUSD: 15 }));
        await commitAuthoritativeSnapshot(store, prior);
        const borrowsDown = asIncoming(assembled({
            walletUSD: 20,
            lendingNetUSD: 0,
            lendingSources: [
                { id: 'alphalend', ok: true, status: 'ok' },
                { id: 'navi', ok: false, status: 'unavailable', error: 'devInspect empty' },
                { id: 'current', ok: true, status: 'ok' },
            ],
        }));
        expect(borrowsDown.incomplete).toBe(true);
        await commitAuthoritativeSnapshot(store, borrowsDown);
        const row = store.rows.get(prior.id);
        expect(row?.lending_net_usd).toBe(15);
        expect(row?.incomplete).toBe(false);
    });
});
