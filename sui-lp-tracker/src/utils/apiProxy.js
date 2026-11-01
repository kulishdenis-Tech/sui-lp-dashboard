import { apiUrl, deploymentOrigin } from '@/utils/deploymentOrigin';
/** True when running production static build (Vercel/Netlify). */
export function isProdBuild() {
    return Boolean(import.meta.env.PROD);
}
function okxCredsFromProcess() {
    if (typeof process === 'undefined')
        return null;
    const key = process.env.OKX_API_KEY ?? process.env.VITE_OKX_API_KEY;
    const secret = process.env.OKX_SECRET_KEY ?? process.env.VITE_OKX_SECRET_KEY;
    const pass = process.env.OKX_PASSPHRASE ?? process.env.VITE_OKX_PASSPHRASE;
    if (key && secret && pass)
        return { key, secret, pass };
    return null;
}
function coingeckoKeyFromProcess() {
    if (typeof process === 'undefined')
        return null;
    const key = process.env.COINGECKO_API_KEY ?? process.env.VITE_COINGECKO_API_KEY;
    if (!key || key.length < 3)
        return null;
    return key;
}
async function hmacSha256Base64(secret, message) {
    const te = new TextEncoder();
    const k = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', k, te.encode(message));
    const b = new Uint8Array(sig);
    let s = '';
    for (let i = 0; i < b.length; i++)
        s += String.fromCharCode(b[i]);
    return btoa(s);
}
/** Serverless OKX proxy, or direct signed request when no deployment origin (GHA). */
export async function okxProxyFetch(method, path, bodyStr = '') {
    if (typeof window !== 'undefined' || deploymentOrigin()) {
        return fetch(apiUrl('/api/okx'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method, path, body: bodyStr }),
            signal: AbortSignal.timeout(30_000),
        });
    }
    const creds = okxCredsFromProcess();
    if (!creds) {
        return new Response(JSON.stringify({ code: '1', msg: 'OKX credentials missing' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    const p = path.startsWith('/') ? path : `/${path}`;
    const ts = new Date().toISOString();
    const pre = `${ts}${method}${p}${method === 'POST' ? bodyStr : ''}`;
    const sign = await hmacSha256Base64(creds.secret, pre);
    return fetch(`https://web3.okx.com${p}`, {
        method,
        headers: {
            ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
            'OK-ACCESS-KEY': creds.key,
            'OK-ACCESS-SIGN': sign,
            'OK-ACCESS-TIMESTAMP': ts,
            'OK-ACCESS-PASSPHRASE': creds.pass,
        },
        body: method === 'POST' ? bodyStr : undefined,
        signal: AbortSignal.timeout(30_000),
    });
}
/** Serverless CoinGecko free/demo proxy, or direct key when no deployment origin (GHA). */
export async function coingeckoProxyFetch(pathWithQuery) {
    if (typeof window !== 'undefined' || deploymentOrigin()) {
        return fetch(apiUrl('/api/coingecko'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: pathWithQuery }),
            signal: AbortSignal.timeout(15_000),
        });
    }
    const key = coingeckoKeyFromProcess();
    const p = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
    const headers = {};
    if (key)
        headers['x-cg-demo-api-key'] = key;
    return fetch(`https://api.coingecko.com${p}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
    });
}
