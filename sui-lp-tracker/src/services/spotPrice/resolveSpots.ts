import type { SpotSource } from '@/types'
import { needs24h } from './spotChange24h'
import { coingeckoIdForSymbol, coingeckoSimpleBatch } from './coingecko24hBatch'
import { fetchAftermathBatch } from './aftermathSpot'
import { geckoTokenPricesBatch } from './geckoSimpleBatch'
import { geckoTokenDetail } from './geckoTokenDetail'
import { dexScreenerPrice } from './dexScreenerSpot'
import { dexpPaprikaPrice } from './dexpPaprikaSpot'
import { isOkxDexConfigured, okxPriceInfoByCoinType, okxEthereumShortWindowForBridgedEth } from './okxDexApi'
import {
	getCurrentSpot,
	getFreshMemSpot,
	patchCurrentSpotMeta,
	setCurrentSpot,
	seedForNetworkRefetch,
} from './currentSpotCache'

import { mapPool } from '@/utils/concurrency'

export type ResolveSpotsOptions = {
	/** Скидати 5хв-«fresh» mem — інакше refetch/Refresh не викликає новий DexScreener. */
	forceRefresh?: boolean
}

export type Row = {
	price: number | null
	change24h: number | null
	/** OKX priceChange5M — лише коли джерело okx. */
	change5m?: number | null
	/** OKX priceChange1H — лише коли джерело okx. */
	change1h?: number | null
	priceSource: SpotSource
}

/**
 * Persist rows into spot cache. Cache hits (fresh mem, same price) only patch
 * change windows — never refresh `observedAt` / TTL.
 */
function syncSpotCacheFromOut(out: Map<string, Row>) {
	for (const [ct, row] of out) {
		if (row.price == null) continue
		const fresh = getFreshMemSpot(ct)
		if (fresh && fresh.price === row.price && fresh.source === row.priceSource) {
			patchCurrentSpotMeta(ct, {
				change24h: row.change24h,
				change5m: row.change5m ?? null,
				change1h: row.change1h ?? null,
			})
			continue
		}
		setCurrentSpot(ct, {
			price: row.price,
			change24h: row.change24h,
			change5m: row.change5m ?? null,
			change1h: row.change1h ?? null,
			source: row.priceSource,
		})
	}
}

const STABLE_SYMBOLS = /^(USDC|USDT|DAI|BUSD|FDUSD|USDZ|PYUSD|TUSD|FRAX|USDD)$/
/** DexScreener: 2 HTTP на токен; 30+ паралельно → 502/EADDRINUSE на Windows dev-proxy. */
const DEXSCREENER_CONCURRENCY = 6

function isStableSymbol(symbol: string): boolean {
	return STABLE_SYMBOLS.test(symbol.toUpperCase())
}

/** OKX інколи дає priceChange24H=0 без ринку — ціну лишаємо, 24h% не довіряємо. */
function okxChange24h(change24h: number | null, symbol: string): number | null {
	if (change24h === 0 && !isStableSymbol(symbol)) return null
	return change24h
}

/**
 * Spot priority: **OKX** (якщо VITE_OKX_*) → **DexScreener** → **Aftermath** → **GeckoTerminal** → **DexPaprika**
 * 24h%: з OKX, потім DexScreener → CoinGecko batch → GeckoTerminal per-token.
 * CoinGecko overlay: лише заповнює gaps (нема ціни від real-time джерел) + патчить 24h%; не перезаписує.
 *
 * OKX: `change24h === 0` на не-стейблі — 24h% не довіряємо (null), але spot USD лишаємо.
 */
export async function resolveSpots(
	coinTypes: string[],
	symbolByType: (ct: string) => string,
	opts?: ResolveSpotsOptions,
): Promise<Map<string, Row>> {
	const out = new Map<string, Row>()

	/* Persist/«холодна» RAM не дозволяє пропустити refetch: … forceRefresh — завжди йти в мережу (кнопка Refresh). */
	const { freshHits } = opts?.forceRefresh
		? { freshHits: new Map() }
		: seedForNetworkRefetch(coinTypes)
	for (const [ct, h] of freshHits) {
		const change24h =
			h.source === 'okx' ? okxChange24h(h.change24h, symbolByType(ct)) : h.change24h
		out.set(ct, {
			price: h.price,
			change24h,
			change5m: h.change5m ?? null,
			change1h: h.change1h ?? null,
			priceSource: h.source,
		})
	}

	if (isOkxDexConfigured() && coinTypes.length > 0) {
		try {
			const okx = await okxPriceInfoByCoinType(coinTypes)
			for (const [ct, v] of okx) {
				if (!Number.isFinite(v.price) || v.price <= 0) continue
				const change24h = okxChange24h(v.change24h, symbolByType(ct))
				const row: Row = {
					price: v.price,
					change24h,
					change5m: v.change5m,
					change1h: v.change1h,
					priceSource: 'okx',
				}
				out.set(ct, row)
				setCurrentSpot(ct, {
					price: v.price,
					change24h,
					change5m: v.change5m,
					change1h: v.change1h,
					source: 'okx',
				})
			}
		} catch {
			/* OKX down — далі стандартний ланцюг */
		}
	}

	/* Early pass: fill 5m/1h for tokens that already have a price (OKX / mem seed). */
	await fillShortWindowGaps(out, coinTypes)

	let work = coinTypes.filter((ct) => out.get(ct)?.price == null)
	if (work.length) {
		/* Один batch CG замість N×DexScreener для відомих символів (SUI, NS, DEEP…). */
		await applyCoingeckoSpotOverlay(out, work, symbolByType)
		work = coinTypes.filter((ct) => out.get(ct)?.price == null)
	}

	if (work.length === 0) {
		await fill24hGaps(out, symbolByType)
		await applyCoingeckoSpotOverlay(out, coinTypes, symbolByType)
		/* Late pass: CG-only prices never went through DexScreener short windows above. */
		await fillShortWindowGaps(out, coinTypes)
		syncSpotCacheFromOut(out)
		return out
	}

	/* 1) DexScreener — обмежена паралельність (2 HTTP/токен; інакше dev-proxy падає). */
	if (work.length) {
		const parts = await mapPool(work, DEXSCREENER_CONCURRENCY, dexScreenerPrice)
		work.forEach((c, j) => {
			const d = parts[j]!
			if (d?.price) {
				const row: Row = {
					price: d.price,
					change24h: d.change24h,
					change5m: d.change5m,
					change1h: d.change1h,
					priceSource: 'dexscreener',
				}
				out.set(c, row)
				setCurrentSpot(c, {
					price: row.price!,
					change24h: row.change24h,
					change5m: row.change5m,
					change1h: row.change1h,
					source: 'dexscreener',
				})
			}
		})
	}

	/* 2) Aftermath */
	let still = work.filter((c) => !out.get(c)?.price)
	if (still.length) {
		const af = await fetchAftermathBatch(still)
		for (const c of still) {
			const a = af[c]
			if (a?.price) {
				const row: Row = {
					price: a.price,
					change24h: a.change24h,
					change5m: null,
					change1h: null,
					priceSource: 'aftermath',
				}
				out.set(c, row)
				setCurrentSpot(c, {
					price: row.price!,
					change24h: row.change24h,
					change5m: null,
					change1h: null,
					source: 'aftermath',
				})
			}
		}
	}

	/* 3) GeckoTerminal (batch spot) */
	still = work.filter((c) => !out.get(c)?.price)
	if (still.length) {
		const gBatch = await geckoTokenPricesBatch(still)
		for (const c of still) {
			const p = gBatch[c]
			if (p != null) {
				out.set(c, {
					price: p,
					change24h: null,
					change5m: null,
					change1h: null,
					priceSource: 'geckoterminal',
				})
				setCurrentSpot(c, {
					price: p,
					change24h: null,
					change5m: null,
					change1h: null,
					source: 'geckoterminal',
				})
			}
		}
	}

	/* 4) DexPaprika — останній фолбек (паралельно невеликими сетами) */
	still = work.filter((c) => !out.get(c)?.price)
	if (still.length) {
		const pbatch = 8
		for (let i = 0; i < still.length; i += pbatch) {
			const chunk = still.slice(i, i + pbatch)
			const results = await Promise.all(chunk.map((c) => dexpPaprikaPrice(c, symbolByType(c))))
			chunk.forEach((c, j) => {
				const p = results[j]!
				if (p?.price) {
					out.set(c, {
						price: p.price,
						change24h: p.change24h,
						change5m: null,
						change1h: null,
						priceSource: 'dexpaprika',
					})
					setCurrentSpot(c, {
						price: p.price,
						change24h: p.change24h,
						change5m: null,
						change1h: null,
						source: 'dexpaprika',
					})
				} else {
					out.set(c, {
						price: null,
						change24h: null,
						change5m: null,
						change1h: null,
						priceSource: 'unavailable',
					})
				}
			})
		}
	}

	await fill24hGaps(out, symbolByType)
	await applyCoingeckoSpotOverlay(out, coinTypes, symbolByType)
	/* Late pass after Aftermath/Gecko/DexPaprika — they omit 5m/1h. */
	await fillShortWindowGaps(out, coinTypes)
	syncSpotCacheFromOut(out)
	return out
}

/**
 * CoinGecko overlay — two roles:
 *  1. **Fallback price**: fills price ONLY when no real-time source (DexScreener / Aftermath /
 *     GeckoTerminal / DexPaprika) returned a price. CoinGecko aggregates many exchanges and can
 *     lag by minutes-to-hours; real-time DEX prices are more accurate for on-chain tokens.
 *  2. **24h change**: always updates the `change24h` field from CoinGecko if available, since
 *     DexScreener sometimes omits it and CoinGecko has broad coverage.
 *
 * OKX price-info is never overwritten (always real-time + authenticated).
 */
async function applyCoingeckoSpotOverlay(
	out: Map<string, Row>,
	coinTypes: string[],
	symbolByType: (ct: string) => string,
): Promise<void> {
	const idByCt = new Map<string, string>()
	for (const ct of coinTypes) {
		const id = coingeckoIdForSymbol(symbolByType(ct))
		if (id) idByCt.set(ct, id)
	}
	if (idByCt.size === 0) return
	const ids = [...new Set([...idByCt.values()])]
	const cg = await coingeckoSimpleBatch(ids)
	for (const [ct, id] of idByCt) {
		const src = out.get(ct)?.priceSource
		/* Never overwrite OKX — authenticated real-time source. */
		if (src === 'okx') continue
		const row = cg[id] as { usd?: number; usd_24h_change?: number } | undefined
		if (!row || typeof row.usd !== 'number' || !Number.isFinite(row.usd) || row.usd <= 0) {
			continue
		}
		const cgChange =
			row.usd_24h_change != null && Number.isFinite(row.usd_24h_change)
				? row.usd_24h_change
				: null
		const existing = out.get(ct)
		if (!existing?.price) {
			/* No price yet — use CoinGecko as fallback (5m/1h filled later by DexScreener). */
			out.set(ct, { price: row.usd, change24h: cgChange, priceSource: 'coingecko' })
			setCurrentSpot(ct, {
				price: row.usd,
				change24h: cgChange,
				change5m: null,
				change1h: null,
				source: 'coingecko',
			})
		} else {
			/* Price already set by a real-time source — only patch 24h change if missing. */
			if (existing.change24h == null && cgChange != null) {
				out.set(ct, { ...existing, change24h: cgChange })
				setCurrentSpot(ct, {
					price: existing.price,
					change24h: cgChange,
					change5m: existing.change5m ?? null,
					change1h: existing.change1h ?? null,
					source: existing.priceSource,
				})
			}
		}
	}
}

function coinTypesNeedingShortWindow(out: Map<string, Row>): string[] {
	return [...out.entries()]
		.filter(([, r]) => {
			if (r.price == null) return false
			// Missing only — OKX `0` is a real flat window; do not block return on DexScreener.
			return r.change5m == null || r.change1h == null
		})
		.map(([ct]) => ct)
}

/**
 * Patch missing 5m/1h: Ethereum OKX for bridged ETH, then DexScreener.
 * Bridged ETH with idle Sui `0` always gets an Ethereum WETH short-window pass.
 */
async function fillShortWindowGaps(out: Map<string, Row>, coinTypes: string[]) {
	const withPrice = coinTypes.filter((ct) => out.get(ct)?.price != null)
	if (!withPrice.length) return

	try {
		const ethWin = await okxEthereumShortWindowForBridgedEth(withPrice)
		for (const [ct, w] of ethWin) {
			const cur = out.get(ct)
			if (!cur?.price) continue
			// Bridged ETH: replace missing or idle-zero 5m from Ethereum WETH.
			const change5m =
				cur.change5m == null || cur.change5m === 0 ? (w.change5m ?? cur.change5m) : cur.change5m
			const change1h = cur.change1h ?? w.change1h ?? null
			if (change5m === cur.change5m && change1h === cur.change1h) continue
			const next: Row = { ...cur, change5m, change1h }
			out.set(ct, next)
			setCurrentSpot(ct, {
				price: next.price!,
				change24h: next.change24h,
				change5m: next.change5m,
				change1h: next.change1h,
				source: next.priceSource,
			})
		}
	} catch {
		/* optional */
	}

	const still = coinTypesNeedingShortWindow(out).filter((ct) => coinTypes.includes(ct))
	if (!still.length) return
	try {
		const parts = await mapPool(still, DEXSCREENER_CONCURRENCY, dexScreenerPrice)
		still.forEach((ct, j) => {
			const d = parts[j]
			const cur = out.get(ct)
			if (!d || !cur?.price) return
			const change5m = cur.change5m ?? d.change5m ?? null
			const change1h = cur.change1h ?? d.change1h ?? null
			if (change5m === cur.change5m && change1h === cur.change1h) return
			const next: Row = { ...cur, change5m, change1h }
			out.set(ct, next)
			setCurrentSpot(ct, {
				price: next.price!,
				change24h: next.change24h,
				change5m: next.change5m,
				change1h: next.change1h,
				source: next.priceSource,
			})
		})
	} catch {
		/* DexScreener optional — keep OKX / existing short windows */
	}
}

function coinTypesNeeding24h(out: Map<string, Row>): string[] {
	return [...out.entries()].filter(([, r]) => needs24h(r)).map(([ct]) => ct)
}

async function fill24hGaps(out: Map<string, Row>, symbolByType: (ct: string) => string) {
	if (coinTypesNeeding24h(out).length === 0) return

	/* 1) 24h%: одне коло DexScreener на всі, що залишились (паралельно) */
	const needH24a = coinTypesNeeding24h(out)
	if (needH24a.length) {
		const parts = await mapPool(needH24a, DEXSCREENER_CONCURRENCY, dexScreenerPrice)
		needH24a.forEach((ct, j) => {
			const d = parts[j]!
			const cur = out.get(ct)
			if (!cur?.price) return
			if (d?.change24h != null && Number.isFinite(d.change24h)) {
				out.set(ct, { ...cur, change24h: d.change24h })
			}
		})
	}

	/* 2) CoinGecko batch (для тих, у кого DS не дав 24h) */
	const needCg = coinTypesNeeding24h(out)
	if (needCg.length === 0) return
	const idSet = new Set<string>()
	for (const ct of needCg) {
		const id = coingeckoIdForSymbol(symbolByType(ct))
		if (id) idSet.add(id)
	}
	if (idSet.size) {
		const cg = await coingeckoSimpleBatch([...idSet])
		for (const ct of needCg) {
			const id = coingeckoIdForSymbol(symbolByType(ct))
			if (!id) continue
			const cur = out.get(ct)
			if (!cur) continue
			if (!needs24h(cur)) continue
			const row = cg[id] as { usd: number; usd_24h_change?: number } | undefined
			if (row && typeof row.usd_24h_change === 'number' && Number.isFinite(row.usd_24h_change)) {
				out.set(ct, { ...cur, change24h: row.usd_24h_change })
			}
		}
	}

	/* 3) GeckoTerminal per-token h24 (решта) */
	const still = coinTypesNeeding24h(out)
	const B = 6
	for (let i = 0; i < still.length; i += B) {
		const chunk = still.slice(i, i + B)
		const parts = await Promise.all(chunk.map((ct) => geckoTokenDetail(ct)))
		chunk.forEach((ct, j) => {
			const p = parts[j]!
			const cur = out.get(ct)
			if (!cur?.price) return
			if (!needs24h(cur)) return
			if (p.change24h != null && Number.isFinite(p.change24h)) {
				out.set(ct, { ...cur, change24h: p.change24h })
			}
		})
	}
}

/* Allow tests / manual re-read of cache */
export { getCurrentSpot, setCurrentSpot }
