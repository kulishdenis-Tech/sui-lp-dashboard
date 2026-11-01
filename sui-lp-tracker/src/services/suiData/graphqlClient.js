/**
 * Thin Mysten public GraphQL helper (no SDK required).
 * Used for event history + affectedObject transaction scans.
 */
import { extFetchUrl } from '@/utils/externalFetchUrl';
import { resolveBlockvisionApiKey, resolveSuiGraphqlUrl } from '@/services/suiData/config';
import { withSuiDataThrottle } from '@/services/suiData/throttle';
function graphqlEndpoint() {
    const absolute = resolveSuiGraphqlUrl();
    if (typeof window === 'undefined')
        return absolute;
    try {
        const proxied = extFetchUrl(absolute);
        return proxied;
    }
    catch {
        return absolute;
    }
}
export async function suiGraphqlRequest(query, variables) {
    return withSuiDataThrottle(async () => {
        const apiKey = resolveBlockvisionApiKey();
        const headers = { 'content-type': 'application/json' };
        if (apiKey)
            headers['x-api-key'] = apiKey;
        const res = await fetch(graphqlEndpoint(), {
            method: 'POST',
            headers,
            body: JSON.stringify({ query, variables }),
            signal: AbortSignal.timeout(20_000),
        });
        const body = (await res.json());
        if (!res.ok) {
            throw new Error(`GraphQL HTTP ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 240)}`);
        }
        if (body.errors?.length) {
            throw new Error(body.errors.map((e) => e.message).join('; '));
        }
        if (body.data == null)
            throw new Error('GraphQL empty data');
        return body.data;
    });
}
