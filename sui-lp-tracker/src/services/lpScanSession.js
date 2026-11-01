import { invalidateBluefinMomentumScanCache, scanBluefinWalletAllPositionEvents, scanMomentumWalletAllPositionEvents, } from '@/services/eventParser';
import { normalizeSuiAddress } from '@mysten/sui/utils';
let currentSession = null;
let inflight = null;
function walletNormKey(wallet) {
    try {
        return normalizeSuiAddress(wallet.trim());
    }
    catch {
        return wallet.trim();
    }
}
function emptyBluefinScan() {
    return { rawByPositionId: new Map(), historyPartial: true };
}
function emptyMomentumScan() {
    return { rawByPositionId: new Map(), historyPartial: true };
}
/** Поточна сесія (після `ensureLpWalletScanSession`). */
export function getLpWalletScanSession() {
    return currentSession;
}
export function clearLpWalletScanSession() {
    currentSession = null;
    inflight = null;
}
export function invalidateLpWalletScanSession(wallet) {
    const k = walletNormKey(wallet);
    if (currentSession?.walletNorm === k)
        clearLpWalletScanSession();
    invalidateBluefinMomentumScanCache(wallet);
}
/**
 * Один cold/warm scan Bluefin + Momentum raw events на `loadAll` / Refresh.
 * Ніколи не кидає — при RPC/мережевій помилці повертає порожню сесію (enrichment має fallback).
 */
export async function ensureLpWalletScanSession(wallet, options) {
    const norm = walletNormKey(wallet);
    if (options?.forceRefresh) {
        invalidateLpWalletScanSession(wallet);
    }
    if (!options?.forceRefresh && currentSession?.walletNorm === norm) {
        return currentSession;
    }
    if (!options?.forceRefresh && inflight) {
        const s = await inflight;
        if (s.walletNorm === norm)
            return s;
    }
    inflight = (async () => {
        // Послідовно — менше одночасних RPC (стабільніше у вбудованих браузерах / після restart dev-сервера).
        let bluefin = emptyBluefinScan();
        let momentum = emptyMomentumScan();
        try {
            bluefin = await scanBluefinWalletAllPositionEvents(wallet);
        }
        catch (e) {
            console.warn('[lpScanSession] Bluefin wallet scan failed — continuing with empty raw', e);
        }
        try {
            momentum = await scanMomentumWalletAllPositionEvents(wallet);
        }
        catch (e) {
            console.warn('[lpScanSession] Momentum wallet scan failed — continuing with empty raw', e);
        }
        const session = {
            walletNorm: norm,
            bluefin,
            momentum,
        };
        currentSession = session;
        return session;
    })();
    try {
        return await inflight;
    }
    finally {
        inflight = null;
    }
}
