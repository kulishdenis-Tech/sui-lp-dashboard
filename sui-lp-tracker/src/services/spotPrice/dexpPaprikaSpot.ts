import { extFetchUrl } from '@/utils/externalFetchUrl'
import { normalizeCoinTypeForMatch } from '@/utils/suiCoinType'

const DEXP = 'https://api.dexpaprika.com'

type DpSearchToken = {
	id?: string
	chain?: string
	symbol?: string
	price_usd?: number
	price_usd_change?: number
}

/**
 * Останній фолбек у ланцюгу spot: /tokens або search по Sui.
 */
export async function dexpPaprikaPrice(
	coinType: string,
	symbol: string,
): Promise<{ price: number; change24h: number | null } | null> {
	try {
		return await dexpPaprikaPriceInner(coinType, symbol)
	} catch {
		return null
	}
}

async function dexpPaprikaPriceInner(
	coinType: string,
	symbol: string,
): Promise<{ price: number; change24h: number | null } | null> {
	const want = normalizeCoinTypeForMatch(coinType)
	const tryDetail = async (idPath: string) => {
		const u = extFetchUrl(`${DEXP}/networks/sui/tokens/${idPath}`)
		const r = await fetch(u)
		if (!r.ok) return null
		const j = (await r.json()) as { summary?: Record<string, unknown> }
		const s = j.summary as
			| { price_usd?: number; '24h'?: { last_price_usd_change?: number } }
			| undefined
		if (!s?.price_usd) return null
		const h24 = s['24h']
		const ch =
			typeof h24 === 'object' && h24 != null && 'last_price_usd_change' in h24
				? (h24 as { last_price_usd_change: number }).last_price_usd_change
				: null
		return {
			price: s.price_usd,
			change24h: typeof ch === 'number' && Number.isFinite(ch) ? ch : null,
		}
	}
	const enc = encodeURIComponent(want)
	const q = await tryDetail(enc)
	if (q) return q
	const su = extFetchUrl(
		`${DEXP}/search?query=${encodeURIComponent(symbol)}&networks=${encodeURIComponent('sui')}`,
	)
	const sr = await fetch(su)
	if (sr.ok) {
		const j = (await sr.json()) as { tokens?: DpSearchToken[] }
		const tok = (j.tokens ?? []).find(
			(t) => t.chain === 'sui' && t.id && normalizeCoinTypeForMatch(t.id) === want,
		)
		if (tok && typeof tok.price_usd === 'number' && Number.isFinite(tok.price_usd)) {
			return {
				price: tok.price_usd,
				change24h: typeof tok.price_usd_change === 'number' ? tok.price_usd_change : null,
			}
		}
	}
	const s2 = await fetch(
		extFetchUrl(`${DEXP}/search?query=${encodeURIComponent(coinType)}&networks=sui`),
	)
	if (s2.ok) {
		const j2 = (await s2.json()) as { tokens?: DpSearchToken[] }
		const tok2 = (j2.tokens ?? []).find(
			(t) => t.chain === 'sui' && t.id && normalizeCoinTypeForMatch(t.id) === want,
		)
		if (tok2 && typeof tok2.price_usd === 'number' && Number.isFinite(tok2.price_usd)) {
			return {
				price: tok2.price_usd,
				change24h: typeof tok2.price_usd_change === 'number' ? tok2.price_usd_change : null,
			}
		}
	}
	return null
}
