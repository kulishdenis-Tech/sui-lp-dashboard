import { okxProxyFetch } from '@/utils/apiProxy'
import { normalizeCoinTypeForMatch, okxPriceInfoTokenAddress } from '@/utils/suiCoinType'

/** Sui mainnet в OKX Web3 / Onchain OS. */
const CHAIN_SUI = '784'

/** Token Trading Information — official batch (max 100). */
const PRICE_INFO_PATH = '/api/v6/dex/market/price-info'

const BATCH = 100

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
			 
			console.warn('[OKX] circuit tripped — skipping OKX calls for', OKX_CIRCUIT_OPEN_MS / 60_000, 'min')
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms))
}

function okxFetchExtraRetries(): number {
	const v = import.meta.env.VITE_OKX_RETRIES
	const n = v != null && v !== '' ? Number.parseInt(String(v), 10) : Number.NaN
	if (Number.isFinite(n) && n >= 0 && n <= 5) return n
	return DEFAULT_FETCH_RETRIES
}

export type OkxJson = { code: string | number; msg: string; data?: unknown }

function okxSuccess(j: OkxJson): boolean {
	return j.code === '0' || j.code === 0
}

/** Signed OKX request via `/api/okx` (Vite middleware in DEV, serverless in prod). Secrets never in the browser. */
async function okxSignedRequestOnce(
	method: 'GET' | 'POST',
	pathWithQuery: string,
	bodyStr = '',
): Promise<{ ok: boolean; status: number; json: OkxJson } | null> {
	if (okxCircuitOpen()) return null
	const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`

	try {
		const r = await okxProxyFetch(method, path, bodyStr)
		const json = (await r.json()) as OkxJson
		return { ok: r.ok, status: r.status, json }
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		if (/ETIMEDOUT|AbortError|network|fetch|ECONNREFUSED|ENOTFOUND/i.test(msg)) okxTripCircuit()
		return null
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

type PriceInfoRow = {
	chainIndex?: string
	tokenContractAddress?: string
	price?: string
	priceChange5M?: string
	priceChange1H?: string
	priceChange4H?: string
	priceChange24H?: string
	liquidity?: string
	txs24H?: string
}

function parseChangePct(s: string | undefined): number | null {
	if (s == null || s === '') return null
	const n = parseFloat(String(s).trim())
	return Number.isFinite(n) ? n : null
}

export type OkxPriceInfo = {
	price: number
	change5m: number | null
	change1h: number | null
	change24h: number | null
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
		 
		console.warn('[OKX] price-info chunk failed after retries', { lastErr, attempts: maxAttempt })
	}
	return null
}

/**
 * POST `/api/v6/dex/market/price-info` — ціна USD + % зміни (5M / 1H / 24H).
 * Ключі мапи — оригінальні `coinType` з гаманця (можуть бути без leading-zero в адресі).
 *
 * Адреси в body:
 * - більшість токенів — `normalizeSuiAddress` (leading zeros), інакше OKX може віддати ghost-ціну
 *   (CETUS `0x6864…` vs `0x06864…`);
 * - **native SUI** — короткий `0x2::sui::SUI` (padded `0x000…002` → порожня відповідь, тоді
 *   немає 5m/1h і spot падає на CoinGecko лише з 24h%).
 *
 * @see https://web3.okx.com/onchainos/dev-docs/market/market-token-price-info
 */
export async function okxPriceInfoByCoinType(
	coinTypes: string[],
): Promise<Map<string, OkxPriceInfo>> {
	const out = new Map<string, OkxPriceInfo>()
	if (!isOkxDexConfigured() || coinTypes.length === 0) return out

	/** normalized coin type → originals from wallet / caller */
	const originalsByNorm = new Map<string, string[]>()
	for (const ct of coinTypes) {
		const norm = normalizeCoinTypeForMatch(ct)
		const arr = originalsByNorm.get(norm) ?? []
		if (!arr.includes(ct)) arr.push(ct)
		originalsByNorm.set(norm, arr)
	}
	const uniqueNorms = [...originalsByNorm.keys()]

	for (let i = 0; i < uniqueNorms.length; i += BATCH) {
		const chunk = uniqueNorms.slice(i, i + BATCH)
		const bodyStr = JSON.stringify(
			chunk.map((norm) => ({
				chainIndex: CHAIN_SUI,
				tokenContractAddress: okxPriceInfoTokenAddress(norm),
			})),
		)
		const j = await postPriceInfoChunk(bodyStr)
		if (j == null) continue

		/** Best quote per normalized type (prefer live liquidity / txs over ghost rows). */
		const bestByNorm = new Map<
			string,
			OkxPriceInfo & { score: number; rawAddr: string }
		>()

		if (import.meta.env.DEV) {
			 
			console.debug('[OKX price-info] raw response:', JSON.stringify(j.data))
		}
		for (const row of j.data as PriceInfoRow[]) {
			const p = parseFloat(String(row?.price ?? ''))
			if (!Number.isFinite(p) || p <= 0) continue
			const raw = String(row.tokenContractAddress ?? '')
			const normRaw = normalizeCoinTypeForMatch(raw || '0x2::sui::SUI')
			if (!originalsByNorm.has(normRaw)) {
				if (import.meta.env.DEV) {
					 
					console.warn('[OKX price-info] unmatched tokenContractAddress:', raw)
				}
				continue
			}
			const change5m = parseChangePct(row.priceChange5M)
			const change1h = parseChangePct(row.priceChange1H)
			const change24h = parseChangePct(row.priceChange24H)
			const liq = parseFloat(String(row.liquidity ?? ''))
			const txs24 = parseFloat(String(row.txs24H ?? ''))
			// Ghost / mis-indexed rows (wrong Sui address padding) often have ~0 activity.
			const score =
				(Number.isFinite(liq) ? Math.log10(1 + Math.max(0, liq)) : 0) * 10 +
				(Number.isFinite(txs24) ? Math.min(txs24, 1_000_000) / 1000 : 0) +
				(change5m != null || change1h != null || change24h != null ? 1 : 0)
			const prev = bestByNorm.get(normRaw)
			if (prev && prev.score >= score) continue
			bestByNorm.set(normRaw, {
				price: p,
				change5m,
				change1h,
				change24h,
				score,
				rawAddr: raw || '0x2::sui::SUI',
			})
		}

		for (const [norm, info] of bestByNorm) {
			const originals = originalsByNorm.get(norm) ?? []
			if (import.meta.env.DEV) {
				 
				console.debug(
					`[OKX price-info] ${norm.split('::')[2] ?? norm} → $${info.price} ` +
						`5m=${info.change5m} 1h=${info.change1h} 24h=${info.change24h}` +
						(info.rawAddr !== norm
							? ` (req ${okxPriceInfoTokenAddress(norm).slice(0, 18)}… echo ${info.rawAddr.slice(0, 18)}…)`
							: ''),
				)
			}
			for (const ct of originals) {
				out.set(ct, {
					price: info.price,
					change5m: info.change5m,
					change1h: info.change1h,
					change24h: info.change24h,
				})
			}
		}
	}
	return out
}

/** Ethereum mainnet — for short-window % on Sui-bridged ETH/WETH when Sui pools are idle. */
const CHAIN_ETH = '1'
const ETHEREUM_WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

const SUI_BRIDGE_ETH = normalizeCoinTypeForMatch(
	'0xd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH',
)
const SUI_WORMHOLE_WETH = normalizeCoinTypeForMatch(
	'0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN',
)

function isBridgedEthLike(coinType: string): boolean {
	const n = normalizeCoinTypeForMatch(coinType)
	return n === SUI_BRIDGE_ETH || n === SUI_WORMHOLE_WETH
}

/**
 * 5m/1h for Sui Bridge ETH / Wormhole WETH from Ethereum WETH (Sui pools often have txs5M=0).
 */
export async function okxEthereumShortWindowForBridgedEth(
	coinTypes: string[],
): Promise<Map<string, { change5m: number | null; change1h: number | null }>> {
	const out = new Map<string, { change5m: number | null; change1h: number | null }>()
	const targets = coinTypes.filter(isBridgedEthLike)
	if (!targets.length || !isOkxDexConfigured()) return out

	const bodyStr = JSON.stringify([
		{ chainIndex: CHAIN_ETH, tokenContractAddress: ETHEREUM_WETH },
	])
	const j = await postPriceInfoChunk(bodyStr)
	if (j == null) return out
	const row = (j.data as PriceInfoRow[])[0]
	if (!row) return out
	const change5m = parseChangePct(row.priceChange5M)
	const change1h = parseChangePct(row.priceChange1H)
	for (const ct of targets) {
		out.set(ct, { change5m, change1h })
	}
	if (import.meta.env.DEV) {
		 
		console.debug('[OKX eth-short] WETH →', { change5m, change1h, for: targets.length })
	}
	return out
}

/**
 * Мінімальна перевірка після вставки ключів у `.env`.
 */
export async function okxDexConnectionPing(): Promise<{ ok: boolean; error?: string }> {
	if (!isOkxDexConfigured()) {
		return { ok: false, error: 'OKX not configured (/api/okx)' }
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

/** Always true — signing is server-side via `/api/okx`; missing creds surface as 503/null. */
export function isOkxDexConfigured(): boolean {
	return true
}

/** true, якщо OKX щойно дав ETIMEDOUT і circuit відкритий — поточні виклики слід пропускати. */
export function isOkxCircuitOpen(): boolean {
	return okxCircuitOpen()
}
