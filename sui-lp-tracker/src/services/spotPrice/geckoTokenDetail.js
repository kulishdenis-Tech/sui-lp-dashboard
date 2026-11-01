import { GECKO_NETWORK } from '@/utils/constants';
import { extFetchUrl } from '@/utils/externalFetchUrl';
import { GT_HEADER } from './http';
function poolIdToAddress(relationshipId) {
    /* e.g. sui-network_0x0df4f... → 0x0df4f... */
    const prefix = `${GECKO_NETWORK}_`;
    if (relationshipId.startsWith(prefix))
        return relationshipId.slice(prefix.length);
    return null;
}
async function change24hFromTopPool(tokenJson) {
    const relId = tokenJson.data?.relationships?.top_pools?.data?.[0]?.id;
    if (!relId)
        return null;
    const poolAddr = poolIdToAddress(relId);
    if (!poolAddr)
        return null;
    const u = extFetchUrl(`https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/pools/${encodeURIComponent(poolAddr)}`);
    try {
        const r = await fetch(u, { headers: GT_HEADER, signal: AbortSignal.timeout(8_000) });
        if (!r.ok)
            return null;
        const j = (await r.json());
        const h = j.data?.attributes?.price_change_percentage?.h24;
        if (h == null || h === '')
            return null;
        const n = Number(h);
        return Number.isFinite(n) ? n : null;
    }
    catch {
        return null;
    }
}
function parseTokenAttributes(j) {
    const a = j.data?.attributes;
    if (!a?.price_usd)
        return { price: null, change24h: null };
    const price = Number(a.price_usd);
    const p = Number.isFinite(price) ? price : null;
    const raw = a.h24_price_change_percentage;
    if (raw != null && raw !== '') {
        const c = Number(raw);
        if (Number.isFinite(c))
            return { price: p, change24h: c };
    }
    return { price: p, change24h: null };
}
/**
 * Token detail: price + 24h. GT прибрали h24 з атрибутів токена; 24h беремо з top pool
 * (`price_change_percentage.h24`), якщо прямий атрибут відсутній.
 */
export async function geckoTokenDetail(coinType) {
    const tryOne = async (ct) => {
        const u = extFetchUrl(`https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/tokens/${encodeURIComponent(ct)}`);
        const r = await fetch(u, { headers: GT_HEADER, signal: AbortSignal.timeout(8_000) });
        if (!r.ok)
            return null;
        const j = (await r.json());
        const base = parseTokenAttributes(j);
        if (base.change24h != null)
            return base;
        if (base.price == null)
            return base;
        const ch = await change24hFromTopPool(j);
        if (ch != null)
            return { ...base, change24h: ch };
        return base;
    };
    try {
        const first = await tryOne(coinType);
        if (first)
            return first;
        const parts = coinType.split('::');
        const short = parts[0]?.startsWith('0x') ? parts[0] : null;
        if (short && short !== coinType) {
            return (await tryOne(short)) ?? { price: null, change24h: null };
        }
    }
    catch {
        /* */
    }
    return { price: null, change24h: null };
}
