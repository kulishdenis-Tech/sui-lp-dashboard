/**
 * IndexedDB-сховище сирих LP-транзакцій (replay після змін парсера).
 * DB версія збільшується при incompatible schema.
 */
const DB_NAME = 'sui-lp-tracker-lp-indexer-v1';
const STORE = 'lpTxRaw';
const DB_VER = 1;
import { normalizeSuiAddress } from '@mysten/sui/utils';
function walletKey(wallet) {
    let n = wallet.trim();
    try {
        n = normalizeSuiAddress(wallet);
    }
    catch {
        /* */
    }
    return `w:${n}`;
}
function compoundKey(wallet, digest) {
    return `${walletKey(wallet)}|${digest}`;
}
function request(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function openDb() {
    return await new Promise((resolve, reject) => {
        const rq = indexedDB.open(DB_NAME, DB_VER);
        rq.onerror = () => reject(rq.error);
        rq.onsuccess = () => resolve(rq.result);
        rq.onupgradeneeded = () => {
            const db = rq.result;
            if (!db.objectStoreNames.contains(STORE))
                db.createObjectStore(STORE);
        };
    });
}
/** Зберегти / оновити сирі блоки для гаманця. */
export async function lpTxRawStorePutBatch(wallet, records) {
    if (typeof indexedDB === 'undefined' || records.length === 0)
        return;
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    await Promise.all(records.map((r) => request(st.put({ ...r }, compoundKey(wallet, r.digest)))));
    await new Promise((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error);
    });
    db.close();
}
/** Один блок за digest (compound key включає wallet). */
export async function lpTxRawStoreGet(wallet, digest) {
    if (typeof indexedDB === 'undefined')
        return null;
    let db = null;
    try {
        db = await openDb();
        const tx = db.transaction(STORE, 'readonly');
        const st = tx.objectStore(STORE);
        const hit = await request(st.get(compoundKey(wallet, digest)));
        return hit ?? null;
    }
    catch {
        return null;
    }
    finally {
        db?.close();
    }
}
/** У браузері без IndexedDB або SSR — noop. */
export function isLpTxIndexedDbSupported() {
    return typeof indexedDB !== 'undefined';
}
