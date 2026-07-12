import { extFetchUrl } from '@/utils/externalFetchUrl'
import { isProdBuild, okxProxyFetch } from '@/utils/apiProxy'
import { normalizeCoinTypeForMatch } from '@/utils/suiCoinType'

/** Sui mainnet в OKX Web3 / Onchain OS. */
const CHAIN_SUI = '784'

/** Token Trading Information — official batch (max 100). */
const PRICE_INFO_PATH = '/api/v6/dex/market/price-info'

const BATCH = 100

/** Мін. 5s; за замовчуванням 12s — OS ETIMEDOUT ~20s, обрізаємо раніше щоб швидко трипнути circuit. */
const DEFAULT_FETCH_TIMEOUT_MS = 12_000
/** Скільки додаткових спроб після невдачі (усього спроб = 1 + N). */
const DEFAULT_FETCH_RETRIES = 2
const DEFAULT_RETRY_BACKOFF_MS = 1_500

/**
 * Circuit breaker: після першого ETIMEDOUT / AbortError усі OKX-виклики повертають null
 * одразу протягом OKX_CIRCUIT_OPEN_MS. Запобігає затримці 5-6 хвилин до GeckoTerminal.
 *
 * Стан скидається сам по собі після тайм-ауту — без перезавантаження сторінки.
 */
const OKX_CIRCUIT_OPEN_MS = 4 * 60 * 1000 // 4 хв
let _okxCircuitTrippedAt = 0

function okxCircuitOpen(): boolean {
	return Date.now() - _okxCircuitTrippedAt < OKX_CIRCUIT_OPEN_MS
}

function okxTripCircuit(): void {
	if (!okxCircuitOpen()) {
		_okxCircuitTrippedAt = Date.now()
		if (import.meta.env.DEV) {
			// eslint-disable-next-line no-console
			console.warn('[OKX] circuit tripped — skipping OKX calls for', OKX_CIRCUIT_OPEN_MS / 60_000, 'min')
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms))
}

function okxFetchTimeoutMs(): number {
	const v = import.meta.env.VITE_OKX_TIMEOUT_MS
	const n = v != null && v !== '' ? Number.parseInt(String(v), 10) : Number.NaN
	if (Number.isFinite(n) && n >= 5_000 && n <= 300_000) return n
	return DEFAULT_FETCH_TIMEOUT_MS
}

function okxFetchExtraRetries(): number {
	const v = import.meta.env.VITE_OKX_RETRIES
	const n = v != null && v !== '' ? Number.parseInt(String(v), 10) : Number.NaN
	if (Number.isFinite(n) && n >= 0 && n <= 5) return n
	return DEFAULT_FETCH_RETRIES
}

function okxCreds(): { key: string; secret: string; pass: string } | null {
	const key =
		import.meta.env.VITE_OKX_API_KEY ||
		(typeof process !== 'undefined' ? process.env.OKX_API_KEY ?? process.env.VITE_OKX_API_KEY : undefined)
	const secret =
		import.meta.env.VITE_OKX_SECRET_KEY ||
		(typeof process !== 'undefined'
			? process.env.OKX_SECRET_KEY ?? process.env.VITE_OKX_SECRET_KEY
			: undefined)
	const pass =
		import.meta.env.VITE_OKX_PASSPHRASE ||
		(typeof process !== 'undefined'
			? process.env.OKX_PASSPHRASE ?? process.env.VITE_OKX_PASSPHRASE
			: undefined)
	if (
		typeof key === 'string' &&
		key.length > 0 &&
		typeof secret === 'string' &&
		secret.length > 0 &&
		typeof pass === 'string' &&
		pass.length > 0
	) {
		return { key, secret, pass }
	}
	return null
}

function okxTimestamp(): string {
	return new Date().toISOString()
}

async function hmacSha256Base64(secret: string, message: string): Promise<string> {
	const te = new TextEncoder()
	const k = await crypto.subtle.importKey(
		'raw',
		te.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const sig = await crypto.subtle.sign('HMAC', k, te.encode(message))
	const b = new Uint8Array(sig)
	let s = ''
	for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!)
	return btoa(s)
}

export type OkxJson = { code: string | number; msg: string; data?: unknown }

function okxSuccess(j: OkxJson): boolean {
	return j.code === '0' || j.code === 0
}

function okxUrlOnWire(requestPath: string): string {
	return extFetchUrl(`https://web3.okx.com${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`)
}

/** Signed OKX request — prod uses `/api/okx`; dev signs in-browser with VITE_* creds. */
async function okxSignedRequestOnce(
	method: 'GET' | 'POST',
	pathWithQuery: string,
	bodyStr = '',
): Promise<{ ok: boolean; status: number; json: OkxJson } | null> {
	if (okxCircuitOpen()) return null
	const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`

	if (isProdBuild()) {
		try {
			const r = await okxProxyFetch(method, path, bodyStr)
			const json = (await r.json()) as OkxJson
			return { ok: r.ok, status: r.status, json }
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			if (/ETIMEDOUT|AbortError|network|fetch/i.test(msg)) okxTripCircuit()
			return null
		}
	}

	const creds = okxCreds()
	if (!creds) return null
	const ts = okxTimestamp()
	const pre = `${ts}${method}${path}${method === 'POST' ? bodyStr : ''}`
	const sign = await hmacSha256Base64(creds.secret, pre)
	const url = okxUrlOnWire(path)
	const timeoutMs = okxFetchTimeoutMs()
	const ac = new AbortController()
	const t = setTimeout(() => ac.abort(), timeoutMs)
	try {
		const r = await fetch(url, {
			method,
			signal: ac.signal,
			headers: {
				...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
				'OK-ACCESS-KEY': creds.key,
				'OK-ACCESS-SIGN': sign,
				'OK-ACCESS-TIMESTAMP': ts,
				'OK-ACCESS-PASSPHRASE': creds.pass,
			},
			body: method === 'POST' ? bodyStr : undefined,
		})
		const json = (await r.json()) as OkxJson
		return { ok: r.ok, status: r.status, json }
	} catch (e) {
		const isAbort = e instanceof Error && e.name === 'AbortError'
		const msg = e instanceof Error ? e.message : String(e)
		if (isAbort || /ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(msg)) okxTripCircuit()
		return null
	} finally {
		clearTimeout(t)
	}
}

/** Retry on HTTP 429 (free-tier rate limit) with short backoff. */
async function okxSignedRequest(
	method: 'GET' | 'POST',
	pathWithQuery: string,
	bodyStr = '',
): Promise<{ ok: boolean; status: number; json: OkxJson } | null> {
	const maxAttempts = 1 + okxFetchExtraRetries()
	let last: { ok: boolean; status: number; json: OkxJson } | null = null
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		last = await okxSignedRequestOnce(method, pathWithQuery, bodyStr)
		if (!last) return null
		if (last.status !== 429) return last
		const backoffMs = 400 * (attempt + 1) * (attempt + 1)
		if (import.meta.env.DEV || typeof window === 'undefined') {
			// eslint-disable-next-line no-console
			console.warn('[OKX] 429 backoff', { attempt: attempt + 1, backoffMs, path: pathWithQuery.split('?')[0] })
		}
		await sleep(backoffMs)
	}
	return last
}

/**
 * Підписаний GET (OKX Web3: wallet historical-price, DEX historical-candles, і т.д.).
 * `pathWithQuery` = `/api/...?a=1` (без host).
 * Ті самі `OK-ACCESS-KEY` / `SIGN` / `TIMESTAMP` / `PASSPHRASE`, що й `POST .../price-info` і
 * `okxSignedGetResponseAnyCode` для `/api/v5/wallet/token/token-detail` (іконки токенів).
 */
export async function okxSignedGet(pathWithQuery: string): Promise<OkxJson | null> {
	const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`
	const res = await okxSignedRequest('GET', path)
	if (!res) return null
	if (res.ok && okxSuccess(res.json)) return res.json
	if (import.meta.env.DEV) {
		// eslint-disable-next-line no-console
		console.warn('[OKX] GET', path.split('?')[0], res.status, res.json?.code, res.json?.msg)
	}
	return null
}

/**
 * Той самий підпис і заголовки, що `okxSignedGet`, але при HTTP 200 повертає тіло **навіть якщо**
 * `code !== "0"`. Потрібен лише для діагностики (напр. іконки); **не** викликати з price-флоу.
 */
export async function okxSignedGetResponseAnyCode(pathWithQuery: string): Promise<OkxJson | null> {
	const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`
	const res = await okxSignedRequest('GET', path)
	if (!res?.ok) return null
	return res.json
}

/** POST `/api/v6/dex/market/token/basic-info` — той самий підпис, що `POST .../price-info` (іконки). */
export const OKX_DEX_TOKEN_BASIC_INFO_PATH = '/api/v6/dex/market/token/basic-info'

/**
 * POST з тим самим HMAC, що `postPriceInfoChunk` / price-info. Повертає JSON при HTTP 200
 * навіть якщо `code !== "0"`. Лише для іконок / діагностики, **не** для price-info.
 */
export async function okxSignedPostResponseAnyCode(
	requestPath: string,
	bodyStr: string,
): Promise<OkxJson | null> {
	const path = requestPath.startsWith('/') ? requestPath : `/${requestPath}`
	const res = await okxSignedRequest('POST', path, bodyStr)
	if (!res?.ok) return null
	return res.json
}

type PriceInfoBody = { chainIndex: string; tokenContractAddress: string }[]

type PriceInfoRow = {
	chainIndex?: string
	tokenContractAddress?: string
	price?: string
	priceChange24H?: string
}

function parseChange24h(s: string | undefined): number | null {
	if (s == null || s === '') return null
	const n = parseFloat(String(s).trim())
	return Number.isFinite(n) ? n : null
}

/**
 * Підпис змінюється щоразу (timestamp) — кожен POST окремо.
 * Retries: мережа / таймаут / HTTP ≠ 2xx / code ≠ 0.
 */
async function postPriceInfoChunk(bodyStr: string): Promise<OkxJson | null> {
	const extra = okxFetchExtraRetries()
	const maxAttempt = 1 + extra
	let lastErr: string | null = null

	for (let attempt = 0; attempt < maxAttempt; attempt++) {
		const res = await okxSignedRequest('POST', PRICE_INFO_PATH, bodyStr)
		if (res && res.ok && okxSuccess(res.json) && Array.isArray(res.json.data)) {
			if (import.meta.env.DEV && attempt > 0) {
				// eslint-disable-next-line no-console
				console.log('[OKX] price-info retry success', { attempt: attempt + 1 })
			}
			return res.json
		}
		lastErr = res ? `HTTP ${res.status} code=${res.json?.code}` : 'no response'
		if (okxCircuitOpen()) break
		if (attempt < maxAttempt - 1) {
			await sleep(DEFAULT_RETRY_BACKOFF_MS * (attempt + 1))
		}
	}
	if (import.meta.env.DEV) {
		// eslint-disable-next-line no-console
		console.warn('[OKX] price-info chunk failed after retries', { lastErr, attempts: maxAttempt })
	}
	return null
}

/**
 * POST `/api/v6/dex/market/price-info` — ціна USD + priceChange24H (офіційне поле OKX).
 * Ключі мапи — `coinType` з гаманця.
 */
export async function okxPriceInfoByCoinType(
	coinTypes: string[],
): Promise<Map<string, { price: number; change24h: number | null }>> {
	const out = new Map<string, { price: number; change24h: number | null }>()
	if (!isOkxDexConfigured() || coinTypes.length === 0) return out

	const bodyTemplate: PriceInfoBody = coinTypes.map((tokenContractAddress) => ({
		chainIndex: CHAIN_SUI,
		tokenContractAddress,
	}))

	for (let i = 0; i < bodyTemplate.length; i += BATCH) {
		const chunk = bodyTemplate.slice(i, i + BATCH)
		const bodyStr = JSON.stringify(chunk)
		const j = await postPriceInfoChunk(bodyStr)
		if (j == null) continue
		// Primary key: full normalized coin type (e.g. "0x06864...::cetus::CETUS")
		// Secondary key: package-only (e.g. "0x06864...") for OKX responses that strip ::module::STRUCT
		const normToCt = new Map<string, string>()
		for (const b of chunk) {
			const norm = normalizeCoinTypeForMatch(b.tokenContractAddress)
			normToCt.set(norm, b.tokenContractAddress)
			// Also index by package address alone as fallback
			const pkg = norm.split('::')[0]
			if (pkg && !normToCt.has(pkg)) normToCt.set(pkg, b.tokenContractAddress)
		}
		if (import.meta.env.DEV) {
			// eslint-disable-next-line no-console
			console.debug('[OKX price-info] raw response:', JSON.stringify(j.data))
		}
		for (const row of j.data as PriceInfoRow[]) {
			const p = parseFloat(String(row?.price ?? ''))
			if (!Number.isFinite(p) || p <= 0) continue
			const raw = String(row.tokenContractAddress ?? '')
			// Match by full normalized coin type first, then package-only fallback.
			// OKX sometimes echoes back just the package address without ::module::STRUCT.
			const normRaw = normalizeCoinTypeForMatch(raw)
			const pkgRaw = normRaw.split('::')[0] ?? normRaw
			const ct = normToCt.get(normRaw) ?? normToCt.get(pkgRaw)
			if (!ct) {
				if (import.meta.env.DEV) {
					// eslint-disable-next-line no-console
					console.warn('[OKX price-info] unmatched tokenContractAddress:', raw)
				}
				continue
			}
			const change24h = parseChange24h(row.priceChange24H)
			if (import.meta.env.DEV) {
				// eslint-disable-next-line no-console
				console.debug(`[OKX price-info] ${ct.split('::')[2] ?? ct} → $${p} change24h=${change24h}`)
			}
			out.set(ct, { price: p, change24h })
		}
	}
	return out
}

/**
 * Мінімальна перевірка після вставки ключів у `.env`.
 */
export async function okxDexConnectionPing(): Promise<{ ok: boolean; error?: string }> {
	if (!isOkxDexConfigured()) {
		return { ok: false, error: 'OKX not configured (dev VITE_* or prod /api/okx)' }
	}
	try {
		const m = await okxPriceInfoByCoinType(['0x2::sui::SUI'])
		for (const v of m.values()) {
			if (v.price > 0) return { ok: true }
		}
		return { ok: false, error: 'SUI not returned or price invalid' }
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
}

export function isOkxDexConfigured(): boolean {
	return isProdBuild() || okxCreds() != null
}

/** true, якщо OKX щойно дав ETIMEDOUT і circuit відкритий — поточні виклики слід пропускати. */
export function isOkxCircuitOpen(): boolean {
	return okxCircuitOpen()
}
