import { GECKO_NETWORK } from '@/utils/constants'
import {
	type PoolCandleRow,
	type PoolCandleTimeframeId,
	normalizePoolAddressForGeckoOhlcv,
} from '@/lib/geckoPoolOhlcvCore'
import { fetchPoolCandles } from '@/services/poolOhlcvGecko'

export type PoolCandlesFetchOpts = {
	/** Свічки строго старші за цей UNIX time (sec), див. `before_timestamp` у Gecko OHLCV. */
	beforeTimestampSec?: number
	limit?: number
}

type ApiResponse = { candles?: PoolCandleRow[]; error?: string }

/**
 * Dev: `/api/lp/pool-candles` (кеш Vite). `VITE_LP_CANDLES_URL` — власний endpoint.
 * Production без env: прямий `fetchPoolCandles` → Gecko.
 * Адреса пула нормалізується (нижній регістр) — Gecko майже завжди так очікує в path.
 */
export async function loadPoolCandlesForChart(
	poolId: string,
	uiTimeframe: PoolCandleTimeframeId,
	network: string = GECKO_NETWORK,
	opts?: PoolCandlesFetchOpts,
): Promise<PoolCandleRow[]> {
	const pid = normalizePoolAddressForGeckoOhlcv(poolId)
	const custom = import.meta.env.VITE_LP_CANDLES_URL?.trim()

	async function fetchForTf(tf: PoolCandleTimeframeId): Promise<PoolCandleRow[]> {
		if (import.meta.env.DEV && !custom) {
			const u = new URL(
				'/api/lp/pool-candles',
				typeof globalThis !== 'undefined' && 'location' in globalThis
					? (globalThis as unknown as { location: { href: string } }).location.href
					: 'http://127.0.0.1:5180',
			)
			u.searchParams.set('poolId', pid)
			u.searchParams.set('tf', tf)
			u.searchParams.set('network', network)
			if (opts?.beforeTimestampSec != null) {
				u.searchParams.set('before', String(Math.floor(opts.beforeTimestampSec)))
			}
			if (opts?.limit != null) {
				u.searchParams.set('limit', String(opts.limit))
			}
			const r = await fetch(u.toString())
			if (!r.ok) return []
			const j = (await r.json()) as ApiResponse
			if (j.error) return []
			return j.candles ?? []
		}

		if (custom) {
			let extra = ''
			if (opts?.beforeTimestampSec != null) {
				extra += `&before=${encodeURIComponent(String(Math.floor(opts.beforeTimestampSec)))}`
			}
			if (opts?.limit != null) {
				extra += `&limit=${encodeURIComponent(String(opts.limit))}`
			}
			const base = custom.includes('?') ? `${custom}&` : `${custom}?`
			const r = await fetch(
				`${base}poolId=${encodeURIComponent(pid)}&tf=${encodeURIComponent(tf)}&network=${encodeURIComponent(network)}${extra}`,
			)
			if (!r.ok) return []
			const j = (await r.json()) as ApiResponse
			return j.candles ?? []
		}

		return fetchPoolCandles({
			poolAddress: pid,
			timeframe: 'fromUi',
			uiTimeframe: tf,
			network,
			beforeTimestampSec: opts?.beforeTimestampSec,
			limit: opts?.limit,
		})
	}

	return fetchForTf(uiTimeframe)
}
