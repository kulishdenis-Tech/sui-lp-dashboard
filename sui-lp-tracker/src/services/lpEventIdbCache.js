const DB_NAME = 'sui_lp_tracker';
const STORE_NAME = 'lp_event_cache';
/** v2 adds closed_pos_tx_events. v3 clears it to repopulate with tick data from PositionOpened events. */
const CLOSED_TX_STORE = 'closed_pos_tx_events';
const DB_VERSION = 3;
// ─── Memory backend (Node / GHA) ─────────────────────────────────────────────
const _memLp = new Map();
const _memClosedTx = new Map();
function memoryIdbEnabled() {
    if (globalThis.__SUI_LP_MEMORY_IDB__)
        return true;
    return typeof indexedDB === 'undefined';
}
// ─── IndexedDB helpers ────────────────────────────────────────────────────────
let _dbPromise = null;
function openDb() {
    if (_dbPromise)
        return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (ev) => {
            const db = req.result;
            const oldVersion = ev.oldVersion;
            if (oldVersion < 1 && !db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
            if (oldVersion < 2 && !db.objectStoreNames.contains(CLOSED_TX_STORE)) {
                db.createObjectStore(CLOSED_TX_STORE, { keyPath: 'id' });
            }
            if (oldVersion < 3 && db.objectStoreNames.contains(CLOSED_TX_STORE)) {
                db.deleteObjectStore(CLOSED_TX_STORE);
                db.createObjectStore(CLOSED_TX_STORE, { keyPath: 'id' });
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
/**
 * Load cached TX events for multiple closed positions in one IDB transaction.
 * Returns a Map keyed by normalised position ID.
 */
export async function loadClosedPosTxEntries(walletNorm, positionIds) {
    if (positionIds.length === 0)
        return new Map();
    if (memoryIdbEnabled()) {
        const out = new Map();
        for (const id of positionIds) {
            const entry = _memClosedTx.get(`${walletNorm}|${id}`);
            if (entry)
                out.set(entry.posNorm, entry);
        }
        return out;
    }
    try {
        const db = await openDb();
        const keys = positionIds.map((id) => `${walletNorm}|${id}`);
        return new Promise((resolve) => {
            const out = new Map();
            const tx = db.transaction(CLOSED_TX_STORE, 'readonly');
            const store = tx.objectStore(CLOSED_TX_STORE);
            let pending = keys.length;
            if (pending === 0) {
                resolve(out);
                return;
            }
            for (const key of keys) {
                const req = store.get(key);
                req.onsuccess = () => {
                    const entry = req.result;
                    if (entry)
                        out.set(entry.posNorm, entry);
                    if (--pending === 0)
                        resolve(out);
                };
                req.onerror = () => {
                    if (--pending === 0)
                        resolve(out);
                };
            }
        });
    }
    catch {
        return new Map();
    }
}
/**
 * Persist a single closed-position TX cache entry.
 * Fire-and-forget safe (errors are swallowed — next load will re-scan).
 */
export async function saveClosedPosTxEntry(entry) {
    if (memoryIdbEnabled()) {
        _memClosedTx.set(entry.id, entry);
        return;
    }
    try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(CLOSED_TX_STORE, 'readwrite');
            const req = tx.objectStore(CLOSED_TX_STORE).put(entry);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
    catch {
        // Non-fatal.
    }
}
export async function loadLpCacheEntry(walletNorm, protocol) {
    const key = `${walletNorm}|${protocol}`;
    if (memoryIdbEnabled()) {
        return _memLp.get(key) ?? null;
    }
    try {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error);
        });
    }
    catch {
        return null;
    }
}
export async function saveLpCacheEntry(entry) {
    if (memoryIdbEnabled()) {
        _memLp.set(entry.id, entry);
        return;
    }
    try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const req = tx.objectStore(STORE_NAME).put(entry);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
    catch {
        // Non-fatal
    }
}
/**
 * Delete the cached event entry for a wallet+protocol combination.
 */
export async function deleteLpCacheEntry(walletNorm, protocol) {
    const key = `${walletNorm}|${protocol}`;
    if (memoryIdbEnabled()) {
        _memLp.delete(key);
        return;
    }
    try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const req = tx.objectStore(STORE_NAME).delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
    catch {
        // Non-fatal.
    }
}
export function flattenToRows(rawByPositionId) {
    const rows = [];
    for (const [pid, evts] of rawByPositionId) {
        for (const e of evts) {
            rows.push({ pid, digest: e.digest, tsSec: e.tsSec, event: e.event });
        }
    }
    return rows;
}
export function rowsToMap(rows) {
    const m = new Map();
    for (const r of rows) {
        const row = { digest: r.digest, tsSec: r.tsSec, event: r.event };
        const arr = m.get(r.pid) ?? [];
        arr.push(row);
        m.set(r.pid, arr);
    }
    return m;
}
/** Inline I32 reader (mirrors readI32Bits in eventParser — no cross-import needed). */
function _readI32(v) {
    if (v == null)
        return null;
    if (typeof v === 'number' && Number.isFinite(v)) {
        const n = Math.trunc(v);
        return n > 0x7fffffff ? n - 0x100000000 : n;
    }
    if (typeof v === 'object') {
        const b = v['bits'];
        if (typeof b === 'number' && Number.isFinite(b)) {
            const n = Math.trunc(b);
            return n > 0x7fffffff ? n - 0x100000000 : n;
        }
    }
    return null;
}
function _readTickField(pj, ...keys) {
    for (const k of keys) {
        const v = _readI32(pj[k]);
        if (v != null)
            return v;
    }
    return null;
}
/**
 * Loads raw lp_event_cache for the given wallet+protocol and extracts CLMM tick ranges
 * from PositionOpened events (parsedJson). Returns Map<posNorm, {tickLower, tickUpper}>.
 */
export async function loadTicksFromLpCache(walletNorm, protocol) {
    const out = new Map();
    try {
        const entry = await loadLpCacheEntry(walletNorm, protocol);
        if (!entry)
            return out;
        for (const row of entry.rows) {
            const sn = row.event.type.split('::').pop() ?? '';
            if (sn !== 'PositionOpened' && sn !== 'OpenPositionEvent')
                continue;
            const pj = row.event.parsedJson;
            if (!pj)
                continue;
            const tl = _readTickField(pj, 'tick_lower_index', 'tick_lower', 'lower_tick', 'lower_tick_index', 'lower_index');
            const tu = _readTickField(pj, 'tick_upper_index', 'tick_upper', 'upper_tick', 'upper_tick_index', 'upper_index');
            if (tl != null && tu != null && row.pid) {
                out.set(row.pid, { tickLower: tl, tickUpper: tu });
            }
        }
    }
    catch {
        // Non-fatal
    }
    return out;
}
export function computeMaxTs(rawByPositionId) {
    let max = 0;
    for (const evts of rawByPositionId.values()) {
        for (const e of evts) {
            if (e.tsSec > max)
                max = e.tsSec;
        }
    }
    return max;
}
