import { GECKO_NETWORK } from '@/utils/constants'
import { extFetchUrl } from '@/utils/externalFetchUrl'
import { GT_HEADER } from './http'

const GT = 'https://api.geckoterminal.com/api/v2'
const CHUNK = 30

/**
 * /simple/.../token_prices — batch (≤30 per request), USD only, no 24h.
 * @see https://apiguide.geckoterminal.com
 */
export async function geckoTokenPricesBatch(
	coinTypes: string[],
): Promise<Record<string, number | null>> {
	if (coinTypes.length === 0) return {}
	const out: Record<string, number | null> = {}
	for (let i = 0; i < coinTypes.length; i += CHUNK) {
		const slice = coinTypes.slice(i, i + CHUNK)
		const addrs = slice.join(',')
		const u = extFetchUrl(
			`${GT}/simple/networks/${GECKO_NETWORK}/token_price/${encodeURIComponent(addrs)}`,
		)
		try {
			const r = await fetch(u, { headers: GT_HEADER, signal: AbortSignal.timeout(8_000) })
			if (!r.ok) continue
			const j = (await r.json()) as {
				data?: { attributes?: { token_prices?: Record<string, string> } }
			}
			const tp = j.data?.attributes?.token_prices
			if (!tp) continue
			for (const c of slice) {
				const s = tp[c]
				if (s == null) continue
				const p = Number(s)
				out[c] = Number.isFinite(p) && p > 0 ? p : null
			}
		} catch {
			/* continue */
		}
	}
	return out
}
