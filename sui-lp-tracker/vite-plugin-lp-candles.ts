import type { Plugin } from 'vite'
import {
	buildGeckoPoolOhlcvUrl,
	fetchGeckoPoolOhlcvByUrl,
	normalizePoolAddressForGeckoOhlcv,
	type PoolCandleTimeframeId,
	poolCandleParams,
	GECKO_POOL_OHLC_LIMIT_DEFAULT,
	GECKO_POOL_OHLC_LIMIT_MAX,
} from './src/lib/geckoPoolOhlcvCore.ts'

const DEFAULT_NETWORK = 'sui-network'
const CACHE_TTL_MS = 60_000

type CacheEntry = { expires: number; body: string }

function parseQuery(url: string): Record<string, string> {
	const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
	const out: Record<string, string> = {}
	for (const part of q.split('&')) {
		if (!part) continue
		const [k, v = ''] = part.split('=')
		out[decodeURIComponent(k)] = decodeURIComponent(v)
	}
	return out
}

const UI_IDS = new Set<PoolCandleTimeframeId>(['1m', '5m', '15m', '1h', '4h', '1d'])

export function lpCandlesApiPlugin(): Plugin {
	const cache = new Map<string, CacheEntry>()

	return {
		name: 'lp-candles-api',
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				const raw = req.url ?? ''
				if (!raw.startsWith('/api/lp/pool-candles')) {
					next()
					return
				}
				try {
					const q = parseQuery(raw)
					const network = q.network || DEFAULT_NETWORK
					const poolIdRaw = q.poolId || q.pool_id
					if (!poolIdRaw) {
						res.statusCode = 400
						res.setHeader('Content-Type', 'application/json')
						res.end(JSON.stringify({ error: 'poolId required' }))
						return
					}
					const poolId = normalizePoolAddressForGeckoOhlcv(poolIdRaw)
					const tfUi = (q.tf || q.ui || '1h') as PoolCandleTimeframeId
					const p = UI_IDS.has(tfUi) ? poolCandleParams(tfUi) : poolCandleParams('1h')
					const limit = Math.min(
						GECKO_POOL_OHLC_LIMIT_MAX,
						Math.max(1, parseInt(q.limit || String(GECKO_POOL_OHLC_LIMIT_DEFAULT), 10) || GECKO_POOL_OHLC_LIMIT_DEFAULT),
					)
					const beforeRaw = q.before ?? q.before_timestamp
					const beforeTs =
						beforeRaw != null && String(beforeRaw).trim() !== ''
							? Math.floor(Number(beforeRaw))
							: undefined
					const beforeKey = beforeTs != null && Number.isFinite(beforeTs) ? String(beforeTs) : ''
					const currency = (q.currency === 'token' ? 'token' : 'usd') as 'usd' | 'token'
					const key = `${network}|${poolId}|${p.timeframe}|${p.aggregate}|${limit}|${currency}|${beforeKey}`
					const now = Date.now()
					const hit = cache.get(key)
					if (hit && hit.expires > now) {
						res.statusCode = 200
						res.setHeader('Content-Type', 'application/json')
						res.setHeader('Cache-Control', 'public, max-age=30')
						res.end(hit.body)
						return
					}
					const u = buildGeckoPoolOhlcvUrl(network, poolId, p.timeframe, {
						aggregate: p.aggregate,
						limit,
						currency,
						beforeTimestampSec: beforeTs != null && Number.isFinite(beforeTs) ? beforeTs : undefined,
					})
					const rows = await fetchGeckoPoolOhlcvByUrl(u)
					const body = JSON.stringify({
						network,
						poolId,
						timeframe: p.timeframe,
						aggregate: p.aggregate,
						ui: tfUi,
						candles: rows,
					})
					cache.set(key, { expires: now + CACHE_TTL_MS, body })
					res.statusCode = 200
					res.setHeader('Content-Type', 'application/json')
					res.setHeader('Cache-Control', 'public, max-age=30')
					res.end(body)
				} catch (e) {
					res.statusCode = 500
					res.setHeader('Content-Type', 'application/json')
					res.end(JSON.stringify({ error: String((e as Error).message || e) }))
				}
			})
		},
	}
}
