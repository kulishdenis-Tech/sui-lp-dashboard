import { Transaction } from '@mysten/sui/transactions';
import { normalizeStructTag, normalizeSuiAddress, SUI_CLOCK_OBJECT_ID } from '@mysten/sui/utils';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/**
 * Cetus integrate package `published_at` (mainnet).
 * Keep in sync with `@cetusprotocol/sui-clmm-sdk` mainnet sdkOptions.integrate.
 */
const CETUS_INTEGRATE_AT = '0x9ee0534b703b14457aee7698ea3a07a5080f954ed2b7e9910fbb7a55506824fa';
/**
 * Cetus CLMM global config object ID.
 * Passed as first arg to all fetcher_script view functions.
 */
const CETUS_GLOBAL_CONFIG = '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f';
const FETCHER_MODULE = 'fetcher_script';
const DEVINSPECT_SENDER = '0x0000000000000000000000000000000000000000000000000000000000000000';
const DEVINSPECT_TIMEOUT_MS = 20_000;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normType(ct) {
    if (!ct)
        return '';
    try {
        return normalizeStructTag(ct);
    }
    catch {
        return ct;
    }
}
function readU64(v) {
    if (typeof v === 'string' && /^\d+$/.test(v))
        return v;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0)
        return String(Math.trunc(v));
    return '0';
}
// ---------------------------------------------------------------------------
// Core devInspect call
// ---------------------------------------------------------------------------
async function devInspectCetusOnce(client, input, sender) {
    const tx = new Transaction();
    const cfg = tx.object(CETUS_GLOBAL_CONFIG);
    const pool = tx.object(input.poolId);
    // position_id is passed as `pure.address`, not as an object ref — matches Cetus SDK
    const posRef = tx.pure.address(input.positionId);
    const clock = tx.object(SUI_CLOCK_OBJECT_ID);
    const tA = input.coinTypeA;
    const tB = input.coinTypeB;
    // move call 1: fetch_position_fees → emits FetchPositionFeesEvent
    tx.moveCall({
        target: `${CETUS_INTEGRATE_AT}::${FETCHER_MODULE}::fetch_position_fees`,
        typeArguments: [tA, tB],
        arguments: [cfg, pool, posRef],
    });
    // move call 2: fetch_position_rewards → emits FetchPositionRewardsEvent
    tx.moveCall({
        target: `${CETUS_INTEGRATE_AT}::${FETCHER_MODULE}::fetch_position_rewards`,
        typeArguments: [tA, tB],
        arguments: [cfg, pool, posRef, clock],
    });
    let res;
    try {
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error(`devInspect timeout after ${DEVINSPECT_TIMEOUT_MS}ms`)), DEVINSPECT_TIMEOUT_MS));
        res = await Promise.race([
            client.devInspectTransactionBlock({ transactionBlock: tx, sender }),
            timeout,
        ]);
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (res.error)
        return { ok: false, error: String(res.error) };
    // Parse emitted events — Cetus view scripts emit events, not return values
    const events = Array.isArray(res.events) ? res.events : [];
    let feeOwedA = '0';
    let feeOwedB = '0';
    let rewardOweds = [];
    let feeEventFound = false;
    for (const ev of events) {
        const evObj = ev;
        const type = typeof evObj.type === 'string' ? evObj.type : '';
        const pj = evObj.parsedJson && typeof evObj.parsedJson === 'object'
            ? evObj.parsedJson
            : null;
        if (!pj)
            continue;
        if (type.includes('FetchPositionFeesEvent')) {
            feeOwedA = readU64(pj.fee_owned_a);
            feeOwedB = readU64(pj.fee_owned_b);
            feeEventFound = true;
        }
        else if (type.includes('FetchPositionRewardsEvent')) {
            const data = Array.isArray(pj.data) ? pj.data : [];
            rewardOweds = data.map(readU64);
        }
    }
    if (!feeEventFound) {
        return {
            ok: false,
            error: `FetchPositionFeesEvent not found in devInspect events (total events: ${events.length})`,
        };
    }
    return { ok: true, feeOwedA, feeOwedB, rewardOweds };
}
// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
/**
 * Fetch real-time unclaimed fees + rewards for a Cetus CLMM position
 * via `devInspect` → `fetcher_script::fetch_position_fees/rewards`.
 *
 * Retries with zero sender if wallet sender fails.
 */
export async function fetchCetusAccruedFees(client, input) {
    const tA = normType(input.coinTypeA);
    const tB = normType(input.coinTypeB);
    if (!tA || !tB) {
        return { ok: false, error: 'Missing coin type args' };
    }
    let walletSender = DEVINSPECT_SENDER;
    if (input.sender) {
        try {
            walletSender = normalizeSuiAddress(input.sender);
        }
        catch {
            walletSender = DEVINSPECT_SENDER;
        }
    }
    const core = {
        positionId: input.positionId,
        poolId: input.poolId,
        coinTypeA: tA,
        coinTypeB: tB,
    };
    // Try wallet sender first, fall back to zero address
    const attempts = [walletSender];
    if (walletSender !== DEVINSPECT_SENDER)
        attempts.push(DEVINSPECT_SENDER);
    let lastErr = 'all devInspect attempts failed';
    for (const sender of attempts) {
        const r = await devInspectCetusOnce(client, core, sender);
        if (r.ok)
            return r;
        lastErr = r.error;
    }
    return { ok: false, error: lastErr };
}
