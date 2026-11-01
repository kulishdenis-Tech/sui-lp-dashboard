import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { HARDCODED_VERIFIED } from '@/config/hardcodedVerifiedCoins'
import { amountsFromCoinMetadata } from '@/services/coinBalanceAmount'
import { withRpcBackoff } from '@/utils/rpcBackoff'
import { extFetchUrl } from '@/utils/externalFetchUrl'
import { normalizeCoinTypeForMatch } from '@/utils/suiCoinType'
import { DASHBOARD_RPC_FALLBACK_URLS } from '@/utils/suiRpcUrl'

/**
 * `suix_getCoinMetadata` — https://docs.sui.io/sui-api-ref#suix_getcoinmetadata
 * PublicNode often returns `result: null` for coins that still have on-chain metadata.
 * A null result is a successful RPC, so the provider pool does not fail over.
 */
const METADATA_FALLBACK_RPCS = DASHBOARD_RPC_FALLBACK_URLS.filter(
	(url) => !url.includes('blastapi.io'),
)

export type ResolvedCoinMeta = {
	decimals: number
	name: string
	symbol: string
	description: string
	iconUrl: string | null
}

const resolvedMetaCache = new Map<string, ResolvedCoinMeta | null>()

const hardcodedByType = new Map(
	HARDCODED_VERIFIED.map((coin) => [normalizeCoinTypeForMatch(coin.type), coin]),
)

export function hardcodedCoinMeta(coinType: string): ResolvedCoinMeta | null {
	const coin = hardcodedByType.get(normalizeCoinTypeForMatch(coinType))
	if (!coin) return null
	const amounts = amountsFromCoinMetadata('0', coin.decimals)
	if (!amounts.decimalsKnown) return null
	return {
		decimals: amounts.decimals,
		name: coin.name,
		symbol: coin.symbol,
		description: '',
		iconUrl: coin.iconUrl || null,
	}
}

function usableMeta(meta: {
	decimals?: number
	name?: string
	symbol?: string
	description?: string
	iconUrl?: string | null
} | null): ResolvedCoinMeta | null {
	if (!meta) return null
	const amounts = amountsFromCoinMetadata('0', meta.decimals)
	if (!amounts.decimalsKnown) return null
	return {
		decimals: amounts.decimals,
		name: meta.name ?? '',
		symbol: meta.symbol ?? '',
		description: meta.description ?? '',
		iconUrl: meta.iconUrl || null,
	}
}

function parseMetadataResponse(body: unknown): ResolvedCoinMeta | null {
	if (!body || typeof body !== 'object') return null
	const result = (body as { result?: unknown }).result
	if (!result || typeof result !== 'object') return null
	return usableMeta(result as ResolvedCoinMeta)
}

async function fetchCoinMetadataFallback(coinType: string): Promise<ResolvedCoinMeta | null> {
	for (const url of METADATA_FALLBACK_RPCS) {
		try {
			const response = await fetch(extFetchUrl(url), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'suix_getCoinMetadata',
					params: [coinType],
				}),
				signal: AbortSignal.timeout(8_000),
			})
			if (!response.ok) continue
			const parsed = parseMetadataResponse(await response.json())
			if (parsed) return parsed
		} catch {
			/* next node */
		}
	}
	return null
}

export async function resolveCoinMetadata(
	client: SuiJsonRpcClient,
	coinType: string,
	options?: { allowNetworkFallback?: boolean },
): Promise<ResolvedCoinMeta | null> {
	const cached = resolvedMetaCache.get(coinType)
	if (cached !== undefined) return cached

	const fromClient = usableMeta(
		await withRpcBackoff(
			() => client.getCoinMetadata({ coinType }),
			{ label: 'wallet-coin-meta', retries: 3, baseMs: 450, maxTotalWaitMs: 10_000 },
		).catch(() => null),
	)
	if (fromClient) {
		resolvedMetaCache.set(coinType, fromClient)
		return fromClient
	}

	const known = hardcodedCoinMeta(coinType)
	if (known) {
		resolvedMetaCache.set(coinType, known)
		return known
	}

	if (options?.allowNetworkFallback === false) {
		resolvedMetaCache.set(coinType, null)
		return null
	}

	const fromFallback = await fetchCoinMetadataFallback(coinType)
	resolvedMetaCache.set(coinType, fromFallback)
	return fromFallback
}
