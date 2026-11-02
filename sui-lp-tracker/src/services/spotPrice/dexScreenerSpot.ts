import { extFetchUrl } from '@/utils/externalFetchUrl'
import { normalizeCoinTypeForMatch } from '@/utils/suiCoinType'

type Pair = {
	priceUsd?: string
	liquidity?: { usd?: string }
	priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number }
	baseToken?: { address?: string }
	quoteToken?: { address?: string }
}

const DS = 'https://api.dexscreener.com'

function pickBest(pairs: Pair[], coinTypeNorm: string): Pair | null {
	const pkgNorm = (coinTypeNorm.split('::')[0] ?? '').toLowerCase()

	const matchFull = (addr?: string) =>
		!!addr && normalizeCoinTypeForMatch(addr) === coinTypeNorm
	// DexScreener on Sui stores baseToken.address as just the package address (no ::module::STRUCT),
	// so also match by package-only comparison.
	const matchPkg = (addr?: string) => {
		if (!addr) return false
		const p = addr.split('::')[0] ?? addr
		try {
			return normalizeCoinTypeForMatch(p).toLowerCase() === pkgNorm
		} catch { return p.toLowerCase() === pkgNorm }
	}

	const byLiq = (a: Pair, b: Pair) =>
		parseFloat(String(b.liquidity?.usd ?? '0')) - parseFloat(String(a.liquidity?.usd ?? '0'))

	// 1. Full-type match where our token is the BASE → priceUsd is directly our token's USD price.
	const fullBase = pairs.filter((p) => matchFull(p.baseToken?.address))
	if (fullBase.length > 0) return [...fullBase].sort(byLiq)[0]!

	// 2. Package-only match where our token is the BASE (DexScreener's typical Sui address format).
	const pkgBase = pairs.filter((p) => matchPkg(p.baseToken?.address) && !matchPkg(p.quoteToken?.address))
	if (pkgBase.length > 0) return [...pkgBase].sort(byLiq)[0]!

	// 3. Full-type match where our token is the QUOTE.
	const fullQuote = pairs.filter((p) => matchFull(p.quoteToken?.address))
	if (fullQuote.length > 0) return [...fullQuote].sort(byLiq)[0]!

	// 4. Package-only match (either role) — /tokens/{pkg} results should all involve our token.
	//    Prefer base-role within this set so priceUsd is more likely to be our token's price.
	const pkgAny = pairs.filter((p) => matchPkg(p.baseToken?.address) || matchPkg(p.quoteToken?.address))
	if (pkgAny.length > 0) {
		const pkgAnyBase = pkgAny.filter((p) => matchPkg(p.baseToken?.address))
		return [...(pkgAnyBase.length > 0 ? pkgAnyBase : pkgAny)].sort(byLiq)[0]!
	}

	// 5. Last resort: pick highest-liquidity pair from whatever DexScreener returned.
	//    Covers the /search fallback path where all results are relevant to the query.
	if (pairs.length === 0) return null
	return [...pairs].sort(byLiq)[0]!
}

function parsePair(top: Pair): {
	price: number
	change24h: number | null
	change5m: number | null
	change1h: number | null
} | null {
	const price = parseFloat(String(top.priceUsd ?? ''))
	if (!Number.isFinite(price) || price <= 0) return null
	const m5 = top.priceChange?.m5
	const h1 = top.priceChange?.h1
	const h24 = top.priceChange?.h24
	return {
		price,
		change5m: m5 != null && Number.isFinite(m5) ? m5 : null,
		change1h: h1 != null && Number.isFinite(h1) ? h1 : null,
		change24h: h24 != null && Number.isFinite(h24) ? h24 : null,
	}
}

function packageId(coinType: string): string | null {
	const p0 = coinType.split('::')[0]
	return p0?.startsWith('0x') ? p0 : null
}

/** Best-effort spot from largest-liquidity pair; якщо /tokens/addr дає void — fallback на /search. */
export async function dexScreenerPrice(coinType: string): Promise<{
	price: number | null
	change24h: number | null
	change5m: number | null
	change1h: number | null
} | null> {
	const norm = normalizeCoinTypeForMatch(coinType)
	const addr = packageId(coinType)
	/* 1) tokens/{package} */
	if (addr) {
		try {
			const u = extFetchUrl(`${DS}/latest/dex/tokens/${addr}`)
			const r = await fetch(u, { signal: AbortSignal.timeout(8_000) })
			if (r.ok) {
				const j = (await r.json()) as { pairs?: Pair[] | null }
				const pairs = j.pairs
				if (pairs?.length) {
					const top = pickBest(pairs, norm)
					if (top) {
						const p = parsePair(top)
						if (p) return p
					}
				}
			}
		} catch {
			/* */
		}
	}
	/* 2) search по повному coinType (працює для 0x2::sui::SUI, коли pairs=null) */
	try {
		const u = extFetchUrl(`${DS}/latest/dex/search?q=${encodeURIComponent(coinType)}`)
		const r = await fetch(u)
		if (!r.ok) return null
		const j = (await r.json()) as { pairs?: Pair[] }
		const pairs = j.pairs
		if (!pairs?.length) return null
		const top = pickBest(pairs, norm)
		if (!top) return null
		return parsePair(top)
	} catch {
		return null
	}
}
