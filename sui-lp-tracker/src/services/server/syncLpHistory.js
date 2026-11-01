import { normalizeSuiAddress } from '@mysten/sui/utils';
import { ensureLpWalletScanSession, clearLpWalletScanSession } from '@/services/lpScanSession';
import { getClosedPositions, fetchClosedFromAdapters } from '@/services/positionService';
import { getMomentumPositions } from '@/services/momentumService';
import { getBluefinSpotPositions } from '@/services/bluefinService';
import { getCetusPositions } from '@/services/cetusService';
import { getTurbosPositions } from '@/services/turbosService';
import { enrichAllBluefinOpenPositions, enrichBluefinOpenPositionWithEvents, } from '@/services/enrichment';
import { enrichAllCetusOpenPositions } from '@/services/cetusOpenEnrichment';
import { scanTurbosPositionEvents } from '@/services/turbosLpEvents';
import { mapPool } from '@/utils/concurrency';
import { TURBOS_ENRICH_CONCURRENCY } from '@/utils/constants';
import { closedPositionToRow, getLpHistoryForWallet, openEventsToRow, upsertLpHistoryRows, } from '../../../api/_lib/supabaseLpHistory.ts';
function wantFullResync() {
    const v = process.env.LP_HISTORY_FULL_RESYNC;
    return v === '1' || v === 'true';
}
async function loadOpenPositions(wallet) {
    const [momentum, bluefin, cetus, turbos] = await Promise.all([
        getMomentumPositions(wallet).catch(() => []),
        getBluefinSpotPositions(wallet).catch(() => []),
        getCetusPositions(wallet).catch(() => []),
        getTurbosPositions(wallet).catch(() => []),
    ]);
    return [...momentum, ...bluefin, ...cetus, ...turbos];
}
async function enrichTurbosOpen(wallet, positions) {
    const turbos = positions.filter((p) => p.protocol === 'turbos');
    if (turbos.length === 0)
        return [];
    return mapPool(turbos, TURBOS_ENRICH_CONCURRENCY, async (p) => {
        const origDecA = p.turbosOriginalDecimalsA ?? p.tokenADecimals;
        const origDecB = p.turbosOriginalDecimalsB ?? p.tokenBDecimals;
        let evs = await scanTurbosPositionEvents(wallet, p.id, p.turbosPositionObjectId ?? '', origDecA, origDecB);
        if (p.turbosSwapped) {
            evs = evs.map((e) => ({
                ...e,
                tokenAAmount: e.tokenBAmount,
                tokenBAmount: e.tokenAAmount,
                feeAmountA: e.feeAmountB,
                feeAmountB: e.feeAmountA,
                priceA_USD: e.priceB_USD,
                priceB_USD: e.priceA_USD,
                valueUsdA: e.valueUsdB,
                valueUsdB: e.valueUsdA,
                quoteAsOfUnixSecA: e.quoteAsOfUnixSecB,
                quoteAsOfUnixSecB: e.quoteAsOfUnixSecA,
            }));
        }
        const enriched = await enrichBluefinOpenPositionWithEvents(p, evs, false);
        return { id: p.id, events: enriched.events };
    });
}
/**
 * LP history sync for one watch wallet (open + incremental closed).
 * Intended for GitHub Actions / local vite-node — not Vercel Hobby timeout.
 *
 * Set `LP_HISTORY_FULL_RESYNC=1` to re-enrich every closed position.
 */
export async function syncLpHistoryForWallet(rawWallet) {
    const wallet = normalizeSuiAddress(rawWallet).toLowerCase();
    const fullResync = wantFullResync();
    try {
        clearLpWalletScanSession();
        const session = await ensureLpWalletScanSession(wallet, { forceRefresh: fullResync });
        const knownClosed = await getLpHistoryForWallet(wallet, 'closed');
        const knownIds = new Set(knownClosed.map((p) => p.positionId.toLowerCase()));
        const discovered = await fetchClosedFromAdapters(wallet);
        const newIds = fullResync
            ? discovered.map((c) => c.id)
            : discovered.filter((c) => !knownIds.has(c.id.toLowerCase())).map((c) => c.id);
        const closed = newIds.length === 0
            ? []
            : await getClosedPositions(wallet, { onlyIds: newIds, prefetched: discovered });
        const openPositions = await loadOpenPositions(wallet);
        const [bfRows, cetusRows, turbosRows] = await Promise.all([
            openPositions.length > 0
                ? enrichAllBluefinOpenPositions(wallet, openPositions, { session }).catch(() => [])
                : Promise.resolve([]),
            openPositions.some((p) => p.protocol === 'cetus')
                ? enrichAllCetusOpenPositions(wallet, openPositions).catch(() => [])
                : Promise.resolve([]),
            openPositions.some((p) => p.protocol === 'turbos')
                ? enrichTurbosOpen(wallet, openPositions).catch(() => [])
                : Promise.resolve([]),
        ]);
        const eventsById = new Map();
        for (const row of bfRows) {
            if (row.events?.length)
                eventsById.set(row.id, row.events);
        }
        for (const row of cetusRows) {
            if (row.evs?.length)
                eventsById.set(row.id, row.evs);
        }
        for (const row of turbosRows) {
            if (row.events?.length)
                eventsById.set(row.id, row.events);
        }
        const rows = [];
        for (const cp of closed) {
            rows.push(closedPositionToRow(wallet, cp));
        }
        for (const pos of openPositions) {
            const events = eventsById.get(pos.id) ?? [];
            if (events.length === 0)
                continue;
            rows.push(openEventsToRow(wallet, {
                positionId: pos.id,
                protocol: pos.protocol,
                pair: pos.pair,
                events: events,
                openedAt: pos.openedAt ?? null,
                extra: {
                    tokenA: pos.tokenA,
                    tokenB: pos.tokenB,
                    poolId: pos.poolId,
                    fee: pos.fee,
                },
            }));
        }
        console.log(`[lp-history] ${wallet.slice(0, 10)}… rows=${rows.length} closedNew=${closed.length}/${discovered.length}` +
            ` openEvents=${rows.filter((r) => r.status === 'open').length}` +
            ` incremental=${!fullResync}`);
        await upsertLpHistoryRows(rows);
        return {
            wallet,
            ok: true,
            closed: discovered.length,
            closedNew: closed.length,
            open: rows.filter((r) => r.status === 'open').length,
            incremental: !fullResync,
        };
    }
    catch (e) {
        const error = e instanceof Error
            ? e.message
            : typeof e === 'object' && e !== null
                ? JSON.stringify(e)
                : String(e);
        console.error(`[lp-history] ${wallet.slice(0, 10)}… failed`, error);
        return {
            wallet,
            ok: false,
            closed: 0,
            closedNew: 0,
            open: 0,
            incremental: !fullResync,
            error,
        };
    }
    finally {
        clearLpWalletScanSession();
    }
}
