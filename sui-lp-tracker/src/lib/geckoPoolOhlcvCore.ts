/**
 * Чиста логіка URL + парсинг GeckoTerminal pool OHLCV (без @ alias).
 * Підходить для Vite dev-middleware Node та для клієнта.
 */

const GT_ACCEPT = { Accept: 'application/json;version=20230302' } as const

/**
 * Публічний GeckoTerminal OHLCV: у спільнотній / обгортковій доке зустрічається дефолт ~100 барів і верхня межа до **1000** на один запит.
 * Точний максимум узгоджуйте з https://api.geckoTerminal.com/docs — при 413/400 зменшіть значення коду (`GECKO_POOL_OHLC_LIMIT_MAX`).
 */
export const GECKO_POOL_OHLC_LIMIT_DEFAULT = 500
export const GECKO_POOL_OHLC_LIMIT_MAX = 1000

export type GeckoOhlcvTimeframe = 'minute' | 'hour' | 'day'

/** Кнопки на UI → параметри Gecko. */
export type PoolCandleTimeframeId = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'

export type PoolCandleRow = {
	time: number
	open: number
	high: number
	low: number
	close: number
	/** 6-й стовпець у ohlcv_list, якщо є. */
	volume: number | null
}

const TF_MAP: Record<PoolCandleTimeframeId, { timeframe: GeckoOhlcvTimeframe; aggregate: string }> = {
	'1m': { timeframe: 'minute', aggregate: '1' },
	'5m': { timeframe: 'minute', aggregate: '5' },
	'15m': { timeframe: 'minute', aggregate: '15' },
	'1h': { timeframe: 'hour', aggregate: '1' },
	'4h': { timeframe: 'hour', aggregate: '4' },
	'1d': { timeframe: 'day', aggregate: '1' },
}

export function listPoolCandleTimeframeIds(): PoolCandleTimeframeId[] {
	return ['1m', '5m', '15m', '1h', '4h', '1d']
}

/** Gecko часто ключує пули в URL за адресою в нижньому регістрі; не змінює довжину hex. */
export function normalizePoolAddressForGeckoOhlcv(poolAddress: string): string {
	const x = poolAddress.trim().toLowerCase()
	if (!x) return x
	return x.startsWith('0x') ? x : `0x${x}`
}

/** Сторінка пулу в UI GeckoTerminal (типово для перевірки, чи пул узагалі проіндексований). */
export function geckoTerminalPoolWebUrl(network: string, poolAddress: string): string {
	const id = normalizePoolAddressForGeckoOhlcv(poolAddress)
	const net = network.trim() || 'sui-network'
	return `https://www.geckoterminal.com/${encodeURIComponent(net)}/pools/${encodeURIComponent(id)}`
}

/**
 * URL для вкладення графіка GeckoTerminal Share → Embed / generator (або параметри того ж рівня, що підставляють {pool URL} у iframe).
 * Параметри: `embed`, `light_chart`, `info`, `swaps`, `grayscale` — режим лише для UI; офіційно описані на сторінці embed Charts.
 *
 * На prod зі суворим CSP додайте `frame-src` для `https://www.geckoTerminal.com` (і CDN, які підвантажує вкладення, якщо потрібно).
 */
export function geckoTerminalPoolEmbedWebUrl(
	network: string,
	poolAddress: string,
	opts?: {
		dark?: boolean
		/** показувати бічні блоки всередині вкладення */
		infoPanel?: boolean
		swaps?: boolean
		grayscale?: boolean
	},
): string {
	const id = normalizePoolAddressForGeckoOhlcv(poolAddress)
	const net = network.trim() || 'sui-network'
	const u = new URL(
		`https://www.geckoterminal.com/${encodeURIComponent(net)}/pools/${encodeURIComponent(id)}`,
	)
	u.searchParams.set('embed', '1')
	const dark = opts?.dark ?? true
	u.searchParams.set('light_chart', dark ? '0' : '1')
	u.searchParams.set('info', (opts?.infoPanel ?? false) ? '1' : '0')
	u.searchParams.set('swaps', (opts?.swaps ?? false) ? '1' : '0')
	u.searchParams.set('grayscale', opts?.grayscale ? '1' : '0')
	return u.toString()
}

export function poolCandleParams(id: PoolCandleTimeframeId) {
	return TF_MAP[id] ?? { timeframe: 'hour' as const, aggregate: '1' }
}

export function buildGeckoPoolOhlcvUrl(
	network: string,
	poolAddress: string,
	timeframe: GeckoOhlcvTimeframe,
	options: {
		aggregate: string
		limit: number
		currency: 'usd' | 'token'
		beforeTimestampSec?: number
	},
): string {
	const poolPath = normalizePoolAddressForGeckoOhlcv(poolAddress)
	const base = `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(poolPath)}/ohlcv/${timeframe}`
	const u = new URL(base)
	u.searchParams.set('aggregate', options.aggregate)
	u.searchParams.set('limit', String(options.limit))
	u.searchParams.set('currency', options.currency)
	if (options.beforeTimestampSec != null) {
		u.searchParams.set('before_timestamp', String(options.beforeTimestampSec))
	}
	return u.toString()
}

type GeckoJson = { data?: { attributes?: { ohlcv_list?: number[][] } } }

export function parseGeckoOhlcvResponse(json: unknown): PoolCandleRow[] {
	const j = json as GeckoJson
	const list = j.data?.attributes?.ohlcv_list
	if (!list?.length) return []
	const out: PoolCandleRow[] = []
	for (const row of list) {
		if (!Array.isArray(row) || row.length < 5) continue
		const t = Number(row[0])
		const o = Number(row[1])
		const h = Number(row[2])
		const l = Number(row[3])
		const c = Number(row[4])
		const v = row.length >= 6 ? Number(row[5]) : NaN
		if (!Number.isFinite(t) || !Number.isFinite(c)) continue
		if (!Number.isFinite(o)) continue
		const timeSec = t > 1e12 ? Math.floor(t / 1000) : Math.floor(t)
		const vol = Number.isFinite(v) && v >= 0 ? v : null
		out.push({
			time: timeSec,
			open: o,
			high: Number.isFinite(h) ? h : o,
			low: Number.isFinite(l) ? l : o,
			close: c,
			volume: vol,
		})
	}
	out.sort((a, b) => a.time - b.time)
	return out
}

/** Єдиний масив timestamps (prepend старішої історії + основний запит). */
export function mergeDedupePoolRows(a: readonly PoolCandleRow[], b: readonly PoolCandleRow[]): PoolCandleRow[] {
	const byT = new Map<number, PoolCandleRow>()
	for (const r of [...a, ...b]) {
		byT.set(r.time, r)
	}
	return [...byT.keys()]
		.sort((x, y) => x - y)
		.map((t) => byT.get(t))
		.filter((x): x is PoolCandleRow => x != null)
}

export async function fetchGeckoPoolOhlcvByUrl(absoluteUrl: string): Promise<PoolCandleRow[]> {
	const r = await fetch(absoluteUrl, { headers: GT_ACCEPT })
	if (!r.ok) return []
	let j: unknown
	try {
		j = await r.json()
	} catch {
		return []
	}
	return parseGeckoOhlcvResponse(j)
}
