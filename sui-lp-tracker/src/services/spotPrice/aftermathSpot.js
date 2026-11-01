import { Aftermath } from 'aftermath-ts-sdk';
import { getRpcUrl } from '@/services/suiClient';
let sdk = null;
let initFailed = false;
let inFlight = null;
async function getSdk() {
    if (initFailed)
        return null;
    if (sdk)
        return sdk;
    if (inFlight)
        return inFlight;
    inFlight = (async () => {
        try {
            const a = await Aftermath.create({
                network: 'MAINNET',
                fullnodeUrl: getRpcUrl(),
            });
            sdk = a;
            return a;
        }
        catch {
            initFailed = true;
            return null;
        }
        finally {
            inFlight = null;
        }
    })();
    return inFlight;
}
/** Aftermath encodes 24h as fractional (see SDK doc: 0.54 => 55% in spirit). Scale to display percent. */
function normalizeAftermath24h(fraction) {
    if (!Number.isFinite(fraction))
        return null;
    /* If already looks like a percent in typical range, keep. */
    if (Math.abs(fraction) > 1.5)
        return fraction;
    /* 0 / «майже 0» без окремого сенсу — не блокуємо fill24hGaps (CG/GT). */
    if (Math.abs(fraction) < 1e-6)
        return null;
    return fraction * 100;
}
export async function fetchAftermathBatch(coinTypes) {
    if (coinTypes.length === 0)
        return {};
    const a = await getSdk();
    if (!a)
        return {};
    try {
        const p = a.Prices();
        const m = await p.getCoinsToPriceInfo({ coins: coinTypes });
        const out = {};
        for (const c of coinTypes) {
            const info = m[c];
            if (info && typeof info.price === 'number' && Number.isFinite(info.price) && info.price > 0) {
                const ch = normalizeAftermath24h(info.priceChange24HoursPercentage);
                out[c] = { price: info.price, change24h: ch };
            }
        }
        return out;
    }
    catch {
        return {};
    }
}
