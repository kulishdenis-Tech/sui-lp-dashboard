import Decimal from 'decimal.js'
import type { OpenPosition, PositionEvent } from '@/types'
import { isCetusVaultPosition } from '@/utils/cetusVault'
import { scanHaedalVaultEventsDetailed } from '@/services/haedalVaultEvents'
import { enrichBluefinOpenPositionWithEvents } from '@/services/enrichment'
import { getUsdPerTokenAtTimestamp } from '@/services/priceService'
import { isStablecoinSymbol } from '@/utils/formatting'

export type HaedalVaultEnrichRow = {
	id: string
	evs: PositionEvent[]
	merged: Partial<OpenPosition>
}

function resolveQuoteLeg(p: OpenPosition): {
	coinType: string
	symbol: string
	decimals: number
	isTokenA: boolean
} {
	const q = p.cetusVault?.quoteCoinType
	if (q && q === p.tokenAAddress) {
		return { coinType: p.tokenAAddress, symbol: p.tokenA, decimals: p.tokenADecimals, isTokenA: true }
	}
	if (q && q === p.tokenBAddress) {
		return { coinType: p.tokenBAddress, symbol: p.tokenB, decimals: p.tokenBDecimals, isTokenA: false }
	}
	// Fallback: prefer stable leg (USDC vaults quote in USDC).
	if (isStablecoinSymbol(p.tokenA)) {
		return { coinType: p.tokenAAddress, symbol: p.tokenA, decimals: p.tokenADecimals, isTokenA: true }
	}
	if (isStablecoinSymbol(p.tokenB)) {
		return { coinType: p.tokenBAddress, symbol: p.tokenB, decimals: p.tokenBDecimals, isTokenA: false }
	}
	return { coinType: p.tokenBAddress, symbol: p.tokenB, decimals: p.tokenBDecimals, isTokenA: false }
}

/**
 * Seed deposit USD from on-chain `user_tvl` (quote-token raw) so invested basis
 * matches vault accounting, not only OKX leg candles.
 */
async function seedDepositUsdFromUserTvl(
	p: OpenPosition,
	events: PositionEvent[],
	userTvlRawByDigest: Map<string, string>,
): Promise<PositionEvent[]> {
	if (!userTvlRawByDigest.size) return events
	const quote = resolveQuoteLeg(p)
	if (!Number.isFinite(quote.decimals) || quote.decimals < 0) return events

	const out: PositionEvent[] = []
	for (const e of events) {
		if (e.type !== 'add_liquidity') {
			out.push(e)
			continue
		}
		const raw = userTvlRawByDigest.get(e.txDigest)
		if (!raw || raw === '0' || e.timestamp <= 0) {
			out.push(e)
			continue
		}
		try {
			const tvlHuman = new Decimal(raw).div(new Decimal(10).pow(quote.decimals)).toNumber()
			const qQuote = await getUsdPerTokenAtTimestamp(quote.symbol, quote.coinType, e.timestamp)
			let pxQuote = qQuote.usdPerToken
			// Stables: if hist quote missing, treat as $1.
			if ((pxQuote == null || !(pxQuote > 0)) && isStablecoinSymbol(quote.symbol)) {
				pxQuote = 1
			}
			if (pxQuote == null || !(pxQuote > 0) || !(tvlHuman > 0)) {
				out.push(e)
				continue
			}
			const total = tvlHuman * pxQuote
			const a = e.tokenAAmount
			const b = e.tokenBAmount
			let usdA = 0
			let usdB = 0

			if (quote.isTokenA) {
				if (a > 0) usdA = a * pxQuote
				if (b > 0) {
					const qB = await getUsdPerTokenAtTimestamp(p.tokenB, p.tokenBAddress, e.timestamp)
					if (qB.usdPerToken != null && qB.usdPerToken > 0) usdB = b * qB.usdPerToken
				}
			} else {
				if (b > 0) usdB = b * pxQuote
				if (a > 0) {
					const qA = await getUsdPerTokenAtTimestamp(p.tokenA, p.tokenAAddress, e.timestamp)
					if (qA.usdPerToken != null && qA.usdPerToken > 0) usdA = a * qA.usdPerToken
				}
			}

			const legSum = usdA + usdB
			if (legSum > 0) {
				const scale = total / legSum
				usdA *= scale
				usdB *= scale
			} else if (quote.isTokenA && a > 0) {
				usdA = total
			} else if (!quote.isTokenA && b > 0) {
				usdB = total
			} else if (a > 0 && b > 0) {
				usdA = total / 2
				usdB = total / 2
			} else if (a > 0) {
				usdA = total
			} else {
				usdB = total
			}

			out.push({
				...e,
				valueUsdA: usdA > 0 ? usdA : null,
				valueUsdB: usdB > 0 ? usdB : null,
				totalValueUSD: total,
				priceA_USD: a > 0 && usdA > 0 ? usdA / a : null,
				priceB_USD: b > 0 && usdB > 0 ? usdB / b : null,
				priceUnavailable: false,
				priceAtTxApproximate: qQuote.approximate || isStablecoinSymbol(quote.symbol),
				priceSource: qQuote.source ?? 'okx_dex_spot_current',
				quoteAsOfUnixSecA: qQuote.quoteAsOfUnixSec,
				quoteAsOfUnixSecB: qQuote.quoteAsOfUnixSec,
			})
		} catch {
			out.push(e)
		}
	}
	return out
}

/**
 * Enrich Haedal (Cetus Earn provider) vault positions with deposit/withdraw events
 * and USD basis via the shared enrichment pipeline.
 */
export async function enrichHaedalVaultPositions(
	walletAddress: string,
	positions: OpenPosition[],
): Promise<HaedalVaultEnrichRow[]> {
	const vaults = positions.filter(
		(p) => isCetusVaultPosition(p) && p.cetusVault?.provider === 'Haedal',
	)
	if (!vaults.length) return []

	const out: HaedalVaultEnrichRow[] = []
	for (const p of vaults) {
		let evs: PositionEvent[] = []
		let userTvlRawByDigest = new Map<string, string>()
		try {
			const scanned = await scanHaedalVaultEventsDetailed(
				walletAddress,
				p.id,
				p.tokenADecimals,
				p.tokenBDecimals,
				p.cetusVault?.lpTokenType,
			)
			evs = scanned.events
			userTvlRawByDigest = scanned.userTvlRawByDigest
		} catch (e) {
			console.warn('[haedal-enrich] scan', p.id.slice(0, 10), e)
		}
		evs = await seedDepositUsdFromUserTvl(p, evs, userTvlRawByDigest)
		const enriched = await enrichBluefinOpenPositionWithEvents(p, evs, false)
		out.push({ id: p.id, evs: enriched.events, merged: enriched.merged })
	}
	return out
}
