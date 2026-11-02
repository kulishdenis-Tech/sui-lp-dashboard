import type { TokenBalance } from '@/types'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { suiClient } from './suiClient'
import { formatTokenAmount } from '@/utils/formatting'
import { type Row, type ResolveSpotsOptions, resolveSpots } from '@/services/spotPrice/resolveSpots'
import { seedFromCache } from '@/services/spotPrice/currentSpotCache'
import { amountsFromCoinMetadata } from '@/services/coinBalanceAmount'
import { resolveCoinMetadata } from '@/services/coinMetadata'
import { MOMENTUM_LST_TYPES } from '@/utils/constants'
import { mapPool } from '@/utils/concurrency'
import { RPC_CONCURRENCY } from '@/utils/constants'
import { withRpcBackoff } from '@/utils/rpcBackoff'

type WithMeta = Awaited<ReturnType<typeof loadBalancesWithMetadata>>

/** Parallel metadata bursts are a common PublicNode 429 trigger during loadAll. */
const BALANCE_META_CONCURRENCY = Math.min(4, RPC_CONCURRENCY)

async function loadBalancesWithMetadata(
	walletAddress: string,
	client: SuiJsonRpcClient,
) {
	// gRPC compat maps listBalances → getAllBalances; Mysten public, no API key.
	const balances = await withRpcBackoff(
		() => client.getAllBalances({ owner: walletAddress }),
		{ label: 'wallet-balances', retries: 4, baseMs: 700 },
	)
	return mapPool(balances, BALANCE_META_CONCURRENCY, async (b) => {
		const meta = await resolveCoinMetadata(client, b.coinType, {
			allowNetworkFallback: b.totalBalance !== '0',
		})
		return { b, meta }
	})
}

function emptyRow(): Row {
	return { price: null, change24h: null, priceSource: 'unavailable' as const }
}

function spotsMapFromCacheHits(coinTypes: string[]): Map<string, Row> {
	const { hits } = seedFromCache(coinTypes)
	const m = new Map<string, Row>()
	for (const ct of coinTypes) {
		const h = hits.get(ct)
		if (h) {
			m.set(ct, {
				price: h.price,
				change24h: h.change24h,
				change5m: h.change5m ?? null,
				change1h: h.change1h ?? null,
				priceSource: h.source,
			})
		} else {
			m.set(ct, emptyRow())
		}
	}
	return m
}

/** Скільки USD коштує 1 USDC (з spot по балансу USDC). Якщо USDC немає — 1 (наближення). */
function usdPerOneUsdc(spots: Map<string, Row>, withMeta: WithMeta): number {
	for (const { b, meta } of withMeta) {
		if ((meta?.symbol ?? '').toUpperCase() !== 'USDC') continue
		const p = spots.get(b.coinType)?.price
		if (p != null && Number.isFinite(p) && p > 0) return p
	}
	return 1
}

function buildTokenRows(withMeta: WithMeta, spots: Map<string, Row>): TokenBalance[] {
	const usdPerUsdc = usdPerOneUsdc(spots, withMeta)
	const out: TokenBalance[] = withMeta.map(({ b, meta }) => {
		const amounts = amountsFromCoinMetadata(b.totalBalance, meta?.decimals)
		const decimals = amounts.decimals
		const raw = BigInt(b.totalBalance)
		const human = amounts.humanBalance
		const sp = amounts.decimalsKnown ? (spots.get(b.coinType) ?? emptyRow()) : emptyRow()
		const price = sp.price
		const priceUSDC =
			price != null && Number.isFinite(price) && usdPerUsdc > 0 ? price / usdPerUsdc : null
		const valueUSD = price != null && Number.isFinite(price) ? human * price : null
		const symbol = meta?.symbol || symbolFromType(b.coinType)
		const scallop =
			(symbol.toLowerCase().startsWith('s') && coinTypeScallopLike(b.coinType)) || undefined
		const mom =
			MOMENTUM_LST_TYPES.includes(b.coinType) || b.coinType.includes('::x_sui::X_SUI')
		return {
			coinType: b.coinType,
			symbol,
			name: meta?.name || symbol,
			decimals,
			description: meta?.description ?? undefined,
			iconUrl: meta?.iconUrl ?? null,
			rawBalance: raw,
			humanBalance: human,
			priceUSD: price,
			priceUSDC,
			valueUSD,
			change24h: sp.change24h,
			change5m: sp.change5m ?? null,
			change1h: sp.change1h ?? null,
			coinObjectCount: b.coinObjectCount,
			scallopDeposit: scallop,
			momentumLST: mom,
			priceSource: sp.priceSource,
		}
	})
	out.sort(
		(a, b) => (b.valueUSD ?? 0) - (a.valueUSD ?? 0) || b.humanBalance - a.humanBalance,
	)
	return out
}

type SymbolByType = (ct: string) => string

/**
 * On-chain баланс + metadata, потім spot (кеш mem/localStorage, потім мережа).
 * `onPartial` викликається одразу після RPC, з цінами з кеша (F5 — попередня сесія) або
 * без цін, щоб таблиця не чекала завершення всіх зовнішніх price API.
 */
export type WalletBalanceOptions = { forceRefreshPrices?: boolean }

export async function getWalletBalance(
	walletAddress: string,
	client: SuiJsonRpcClient = suiClient,
	onPartial?: (rows: TokenBalance[]) => void,
	options?: WalletBalanceOptions,
): Promise<TokenBalance[]> {
	const withMeta = await loadBalancesWithMetadata(walletAddress, client)
	const types = withMeta.map(({ b }) => b.coinType)
	const symbolByType: SymbolByType = (ct) => {
		const row = withMeta.find((x) => x.b.coinType === ct)
		return row?.meta?.symbol || symbolFromType(ct)
	}

	if (onPartial) {
		onPartial(buildTokenRows(withMeta, spotsMapFromCacheHits(types)))
	}

	let spots: Map<string, Row>
	try {
		const rs: ResolveSpotsOptions | undefined = options?.forceRefreshPrices
			? { forceRefresh: true }
			: undefined
		spots = await resolveSpots(types, symbolByType, rs)
	} catch {
		/* price APIs down — залишити on-chain + кеш (F5) замість пустого балансу */
		spots = spotsMapFromCacheHits(types)
	}

	return buildTokenRows(withMeta, spots)
}

function symbolFromType(coinType: string): string {
	const parts = coinType.split('::')
	const last = parts[parts.length - 1]
	return last && last.length > 0 ? last : 'UNKNOWN'
}

function coinTypeScallopLike(coinType: string): boolean {
	return coinType.includes('scallop') || coinType.toLowerCase().includes('ssui')
}

export { formatTokenAmount as formatTokenAmountFromBalance }
