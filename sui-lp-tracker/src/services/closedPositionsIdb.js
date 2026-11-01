import { normalizeSuiAddress } from '@mysten/sui/utils';
const DB_NAME = 'sui_lp_closed_snapshot';
const STORE_NAME = 'closed_by_wallet';
const DB_VERSION = 1;
const _mem = new Map();
function memoryIdbEnabled() {
    if (globalThis.__SUI_LP_MEMORY_IDB__)
        return true;
    return typeof indexedDB === 'undefined';
}
function walletKey(wallet) {
    try {
        return normalizeSuiAddress(wallet.trim());
    }
    catch {
        return wallet.trim().toLowerCase();
    }
}
let _dbPromise = null;
function openDb() {
    if (_dbPromise)
        return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
            _dbPromise = null;
            reject(req.error);
        };
        req.onblocked = () => {
            _dbPromise = null;
            reject(new Error('IDB blocked'));
        };
    });
    return _dbPromise;
}
function idbRequest(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
export async function loadClosedPositionsSnapshot(wallet) {
    const id = walletKey(wallet);
    if (memoryIdbEnabled())
        return _mem.get(id) ?? null;
    try {
        const db = await openDb();
        const row = await idbRequest(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id));
        if (!row || !Array.isArray(row.positions))
            return null;
        return row;
    }
    catch {
        return null;
    }
}
export async function saveClosedPositionsSnapshot(wallet, positions, eventsById) {
    const id = walletKey(wallet);
    const snap = {
        id,
        walletNorm: id,
        positions,
        eventsById,
        updatedAt: Date.now(),
    };
    if (memoryIdbEnabled()) {
        _mem.set(id, snap);
        return;
    }
    try {
        const db = await openDb();
        await idbRequest(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(snap));
    }
    catch {
        /* non-fatal */
    }
}
export async function clearClosedPositionsSnapshot(wallet) {
    const id = walletKey(wallet);
    if (memoryIdbEnabled()) {
        _mem.delete(id);
        return;
    }
    try {
        const db = await openDb();
        await idbRequest(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id));
    }
    catch {
        /* non-fatal */
    }
}
/** Test helper. */
export function _resetClosedPositionsIdbForTests() {
    _mem.clear();
    _dbPromise = null;
}
