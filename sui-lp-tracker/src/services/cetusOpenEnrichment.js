import { scanCetusPositionEvents, scanCetusPositionEventsByWalletTxs, scanCetusWalletEvents, } from '@/services/cetusLpEvents';
import { enrichBluefinOpenPositionWithEvents } from '@/services/enrichment';
/**
 * Один wallet Sender scan на batch, потім enrichment по позиціях (Pass2 TX лише якщо немає deposit).
 */
export async function enrichAllCetusOpenPositions(walletAddress, positions, options) {
    const cetus = positions.filter((p) => p.protocol === 'cetus');
    if (cetus.length === 0)
        return [];
    const seedMap = options?.seedEventsByPositionId;
    const allSeeded = cetus.every((p) => {
        const seeded = seedMap?.[p.id];
        return seeded?.some((e) => e.type === 'add_liquidity');
    });
    if (!allSeeded) {
        await scanCetusWalletEvents(walletAddress);
    }
    const conc = 4;
    const out = [];
    let idx = 0;
    async function worker() {
        for (;;) {
            const i = idx++;
            if (i >= cetus.length)
                break;
            const p = cetus[i];
            const origDecA = p.cetusOriginalDecimalsA ?? p.tokenADecimals;
            const origDecB = p.cetusOriginalDecimalsB ?? p.tokenBDecimals;
            let evs = [];
            const seeded = seedMap?.[p.id];
            if (seeded?.length) {
                evs = [...seeded].sort((a, b) => a.timestamp - b.timestamp);
            }
            if (!evs.some((e) => e.type === 'add_liquidity')) {
                try {
                    evs = await Promise.race([
                        scanCetusPositionEvents(walletAddress, p.id, origDecA, origDecB),
                        new Promise((_, rej) => setTimeout(() => rej(new Error('sender-scan-timeout')), 60_000)),
                    ]);
                }
                catch (err) {
                    console.warn('[Cetus] sender-scan failed for', p.id, err instanceof Error ? err.message : err);
                }
            }
            if (!evs.some((e) => e.type === 'add_liquidity')) {
                try {
                    const txEvs = await scanCetusPositionEventsByWalletTxs(walletAddress, p.id, origDecA, origDecB);
                    if (txEvs.length > 0) {
                        const seen = new Set(evs.map((e) => e.id));
                        evs = [...txEvs, ...evs.filter((e) => !seen.has(e.id))].sort((a, b) => a.timestamp - b.timestamp);
                    }
                }
                catch (err2) {
                    console.warn('[Cetus] TX-scan failed for', p.id, err2 instanceof Error ? err2.message : err2);
                }
            }
            if (p.cetusSwapped) {
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
            out.push({ id: p.id, evs: enriched.events, merged: enriched.merged });
        }
    }
    await Promise.all(Array.from({ length: Math.min(conc, cetus.length) }, () => worker()));
    return out;
}
