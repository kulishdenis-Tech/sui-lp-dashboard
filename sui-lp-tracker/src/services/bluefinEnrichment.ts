import type { ClosedPosition, HistoricalEventPriceSource, OpenPosition, PositionEvent } from '@/types'
import { getUsdPerTokenAtTimestamp, type HistoricalUsdQuote } from '@/services/priceService'
import { resolveLpRewardCoinType } from '@/utils/resolveLpRewardCoinType'
import {
	parseEventFromSui,
	scanLpWalletPositionHistory,
	scanMomentumWalletAllPositionEvents,
	scanPositionAllEventsByObjectId,
	clearMomentumScanCache,
	type BluefinWalletRawEvt,
	type MomentumWalletRawEvt,
} from '@/services/eventParser'
import { parseMomentumEventFromSui } from '@/services/momentumLpEvents'
import type { LpWalletScanSession } from '@/services/lpScanSession'
import { getLpWalletScanSession } from '@/services/lpScanSession'
import {
	collectHistoricalQuoteRequestsForClosedBatch,
	collectHistoricalQuoteRequestsFromEvents,
	historicalQuoteKey,
	prefetchHistoricalQuotes,
} from '@/services/prefetchHistoricalQuotes'
import { loadClosedPosTxEntries, loadTicksFromLpCache, saveClosedPosTxEntry, deleteLpCacheEntry } from '@/services/lpEventIdbCache'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { syntheticOpenFromClosed } from '@/utils/syntheticOpenFromClosed'
import { scanCetusPositionEventsByWalletTxs } from '@/services/cetusLpEvents'
import { scanTurbosPositionEvents } from '@/services/turbosLpEvents'

function quoteKey(coinType: string, ts: number): string {
	return historicalQuoteKey(coinType, ts)
}

function bluefinRawToPositionEvents(
	rows: BluefinWalletRawEvt[],
	posKey: string,
	decA: number,
	decB: number,
): PositionEvent[] {
	const out: PositionEvent[] = []
	for (const r of rows) {
		const pe = parseEventFromSui(r.event, r.digest, r.tsSec, posKey, decA, decB)
		if (pe) out.push(pe)
	}
	out.sort((a, b) => a.timestamp - b.timestamp)
	return out
}

function momentumRawToPositionEvents(
	rows: MomentumWalletRawEvt[],
	posKey: string,
	decA: number,
	decB: number,
): PositionEvent[] {
	const out: PositionEvent[] = []
	for (const r of rows) {
		const pe = parseMomentumEventFromSui(r.event, r.digest, r.tsSec, posKey, decA, decB)
		if (pe) out.push(pe)
	}
	out.sort((a, b) => a.timestamp - b.timestamp)
	return out
}

function positionHasDeposit(evs: PositionEvent[]): boolean {
	return evs.some((e) => e.type === 'add_liquidity' || e.type === 'open_position')
}

/**
 * USD already on the event (e.g. Supabase open history).
 * Prefer complete two-leg values; infer the missing leg from total when possible.
 * Do not dump total-only into usdA — that breaks per-leg history sums.
 */
function preexistingEventUsd(e: PositionEvent): {
	usdA: number
	usdB: number
	total: number
	legsComplete: boolean
	hadAny: boolean
} {
	const usdA = Number.isFinite(e.valueUsdA) && (e.valueUsdA as number) > 0 ? (e.valueUsdA as number) : 0
	const usdB = Number.isFinite(e.valueUsdB) && (e.valueUsdB as number) > 0 ? (e.valueUsdB as number) : 0
	const totalFromEvent =
		Number.isFinite(e.totalValueUSD) && (e.totalValueUSD as number) > 0 ? (e.totalValueUSD as number) : 0

	if (usdA > 0 && usdB > 0) {
		return { usdA, usdB, total: usdA + usdB, legsComplete: true, hadAny: true }
	}
	// Server stored total + one leg → infer the other (historical sum stays correct).
	if (usdA > 0 && usdB <= 0 && totalFromEvent > usdA + 1e-9) {
		return {
			usdA,
			usdB: totalFromEvent - usdA,
			total: totalFromEvent,
			legsComplete: true,
			hadAny: true,
		}
	}
	if (usdB > 0 && usdA <= 0 && totalFromEvent > usdB + 1e-9) {
		return {
			usdA: totalFromEvent - usdB,
			usdB,
			total: totalFromEvent,
			legsComplete: true,
			hadAny: true,
		}
	}
	if (usdA > 0 || usdB > 0) {
		return { usdA, usdB, total: usdA + usdB, legsComplete: false, hadAny: true }
	}
	if (totalFromEvent > 0) {
		return { usdA: 0, usdB: 0, total: totalFromEvent, legsComplete: false, hadAny: true }
	}
	return { usdA: 0, usdB: 0, total: 0, legsComplete: false, hadAny: false }
}

export async function enrichBluefinOpenPositionWithEvents(
	p: OpenPosition,
	events: PositionEvent[],
	historyPartial: boolean,
	options?: {
		lifecycle?: 'open' | 'closed'
		/**
		 * Для закриття: секунди для hodl-vs-LP порівняння й тривалості (останній збагачений payout).
		 */
		closeTimestampSec?: number
		/** Попередньо завантажені історичні котирування (див. `prefetchHistoricalQuotes`). */
		quoteMemo?: Map<string, HistoricalUsdQuote>
	},
): Promise<{
	merged: Partial<OpenPosition>
	events: PositionEvent[]
	historyPartial: boolean
}> {
	const lifecycle = options?.lifecycle ?? 'open'
	// Protocol-agnostic: works for bluefin, momentum, cetus, and any future CLMM protocol.
	// Only uses generic OpenPosition fields (tokenA/B, prices, decimals, etc.).
	if (events.length === 0) {
		return {
			merged: { historyPartial },
			events: [],
			historyPartial,
		}
	}

	const validTs = events.map((e) => e.timestamp).filter((t) => t > 0)
	const minTs =
		validTs.length > 0 ? Math.min(...validTs) : p.openedAt > 0 ? p.openedAt : Math.floor(Date.now() / 1000)
	let closeGuessSec =
		validTs.length > 0 ? Math.max(...validTs) : options?.closeTimestampSec ?? Math.floor(Date.now() / 1000)
	if (lifecycle === 'closed' && typeof options?.closeTimestampSec === 'number' && options.closeTimestampSec > 0) {
		closeGuessSec = options.closeTimestampSec
	}
	const nowSec = Date.now() / 1000
	const horizonSec = lifecycle === 'closed' && closeGuessSec > 0 ? closeGuessSec : nowSec
	const daysOpen =
		minTs > 0 && horizonSec >= minTs ? Math.max(0, (horizonSec - minTs) / 86400) : 0
	const quoteMemo = options?.quoteMemo ?? new Map<string, HistoricalUsdQuote>()

	async function quoteAt(symbol: string, coinType: string, ts: number): Promise<HistoricalUsdQuote> {
		const k = quoteKey(coinType, ts)
		let q = quoteMemo.get(k)
		if (!q) {
			q = await getUsdPerTokenAtTimestamp(symbol, coinType, Math.floor(ts))
			quoteMemo.set(k, q)
		}
		return q
	}

	function pickRowSource(
		qa: HistoricalUsdQuote,
		qaUsd: number,
		qb: HistoricalUsdQuote,
		qbUsd: number,
	): HistoricalEventPriceSource | null {
		if (qaUsd + qbUsd <= 0) return null
		if (qaUsd <= 0) return qb.source
		if (qbUsd <= 0) return qa.source
		return qaUsd >= qbUsd ? qa.source : qb.source
	}

	const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp)
	let netDepositedUsd = 0
	let sumClaimedFeeUsd = 0
	let sumClaimedRewardUsd = 0
	const updatedEvents: PositionEvent[] = []

	for (const e of sorted) {
		const symA = p.tokenA
		const symB = p.tokenB
		const addrA = p.tokenAAddress
		const addrB = p.tokenBAddress
		const t = e.timestamp
		const out: PositionEvent = { ...e }

		if (e.type === 'add_liquidity' || e.type === 'remove_liquidity') {
			const a = e.tokenAAmount
			const b = e.tokenBAmount
			const pre = preexistingEventUsd(e)
			let usdA = pre.usdA
			let usdB = pre.usdB
			let usedSpot = false
			let usedPreTotalOnly = false
			let qA: HistoricalUsdQuote = {
				usdPerToken: null,
				source: 'cache',
				approximate: false,
				quoteAsOfUnixSec: null,
			}
			let qB: HistoricalUsdQuote = {
				usdPerToken: null,
				source: 'cache',
				approximate: false,
				quoteAsOfUnixSec: null,
			}
			if (!pre.legsComplete) {
				// Hist-quote only missing legs — keep any priced server/cache leg.
				if (a > 0 && usdA <= 0) {
					qA = await quoteAt(symA, addrA, t)
					usdA = qA.usdPerToken != null ? a * qA.usdPerToken : 0
				}
				if (b > 0 && usdB <= 0) {
					qB = await quoteAt(symB, addrB, t)
					usdB = qB.usdPerToken != null ? b * qB.usdPerToken : 0
				}
				// Prefer server total-only over current spot when both legs still unpriced.
				if (usdA + usdB <= 0 && pre.total > 0) {
					usedPreTotalOnly = true
				} else if (lifecycle === 'open') {
					const pa = Number.isFinite(p.currentPriceA_USD) ? p.currentPriceA_USD : 0
					const pb = Number.isFinite(p.currentPriceB_USD) ? p.currentPriceB_USD : 0
					if (a > 0 && usdA <= 0 && pa > 0) {
						usdA = a * pa
						usedSpot = true
						qA = {
							usdPerToken: pa,
							source: 'okx_dex_spot_current',
							approximate: true,
							quoteAsOfUnixSec: Math.floor(Date.now() / 1000),
						}
					}
					if (b > 0 && usdB <= 0 && pb > 0) {
						usdB = b * pb
						usedSpot = true
						qB = {
							usdPerToken: pb,
							source: 'okx_dex_spot_current',
							approximate: true,
							quoteAsOfUnixSec: Math.floor(Date.now() / 1000),
						}
					}
				}
			}
			const legsUsd = usdA + usdB
			const eventUsd =
				legsUsd > 0
					? legsUsd
					: usedPreTotalOnly || pre.legsComplete
						? pre.total
						: 0
			out.valueUsdA = usdA > 0 ? usdA : null
			out.valueUsdB = usdB > 0 ? usdB : null
			out.valueUsdReward = null
			out.quoteAsOfUnixSecA =
				usdA > 0 ? (qA.quoteAsOfUnixSec ?? e.quoteAsOfUnixSecA ?? null) : null
			out.quoteAsOfUnixSecB =
				usdB > 0 ? (qB.quoteAsOfUnixSec ?? e.quoteAsOfUnixSecB ?? null) : null
			out.quoteAsOfUnixSecReward = null
			out.totalValueUSD = eventUsd > 0 ? eventUsd : 0
			out.priceA_USD = usdA > 0 && a > 0 ? usdA / a : (e.priceA_USD ?? null)
			out.priceB_USD = usdB > 0 && b > 0 ? usdB / b : (e.priceB_USD ?? null)
			out.priceUnavailable = eventUsd <= 0
			out.priceAtTxApproximate =
				usedSpot ||
				qA.approximate ||
				qB.approximate ||
				(pre.legsComplete && (e.priceAtTxApproximate ?? false))
			out.priceSource = pre.legsComplete
				? (e.priceSource ?? 'cache')
				: usedPreTotalOnly
					? (e.priceSource ?? 'cache')
					: (pickRowSource(qA, usdA, qB, usdB) ?? e.priceSource ?? null)
			if (e.type === 'add_liquidity' && eventUsd > 0) {
				netDepositedUsd += eventUsd
			}
			if (e.type === 'remove_liquidity' && eventUsd > 0) {
				netDepositedUsd -= eventUsd
			}
		} else if (e.type === 'collect_fee') {
			const fa = e.feeAmountA
			const fb = e.feeAmountB
			const pre = preexistingEventUsd(e)
			let usdA = pre.usdA
			let usdB = pre.usdB
			let qA: HistoricalUsdQuote = {
				usdPerToken: null,
				source: 'cache',
				approximate: false,
				quoteAsOfUnixSec: null,
			}
			let qB: HistoricalUsdQuote = {
				usdPerToken: null,
				source: 'cache',
				approximate: false,
				quoteAsOfUnixSec: null,
			}
			if (!pre.legsComplete) {
				if (fa > 0 && usdA <= 0) {
					qA = await quoteAt(symA, addrA, t)
					usdA = qA.usdPerToken != null ? fa * qA.usdPerToken : 0
				}
				if (fb > 0 && usdB <= 0) {
					qB = await quoteAt(symB, addrB, t)
					usdB = qB.usdPerToken != null ? fb * qB.usdPerToken : 0
				}
			}
			const legsUsd = usdA + usdB
			const tUsd = legsUsd > 0 ? legsUsd : pre.total
			out.valueUsdA = usdA > 0 ? usdA : null
			out.valueUsdB = usdB > 0 ? usdB : null
			out.valueUsdReward = null
			out.quoteAsOfUnixSecA =
				usdA > 0 ? (qA.quoteAsOfUnixSec ?? e.quoteAsOfUnixSecA ?? null) : null
			out.quoteAsOfUnixSecB =
				usdB > 0 ? (qB.quoteAsOfUnixSec ?? e.quoteAsOfUnixSecB ?? null) : null
			out.quoteAsOfUnixSecReward = null
			out.totalValueUSD = tUsd
			out.priceA_USD = usdA > 0 && fa > 0 ? usdA / fa : (e.priceA_USD ?? null)
			out.priceB_USD = usdB > 0 && fb > 0 ? usdB / fb : (e.priceB_USD ?? null)
			out.priceUnavailable =
				tUsd <= 0 || (fa > 0 && usdA <= 0 && legsUsd <= 0) || (fb > 0 && usdB <= 0 && legsUsd <= 0)
			out.priceAtTxApproximate =
				qA.approximate || qB.approximate || (pre.legsComplete && (e.priceAtTxApproximate ?? false))
			out.priceSource = pre.legsComplete
				? (e.priceSource ?? 'cache')
				: legsUsd > 0
					? (pickRowSource(qA, usdA, qB, usdB) ?? e.priceSource ?? null)
					: (e.priceSource ?? (pre.hadAny ? 'cache' : null))
			sumClaimedFeeUsd += tUsd
		} else if (e.type === 'collect_reward') {
			const r = e.rewardAmount
			const rt = e.rewardToken?.trim() ?? ''
			const rewardCt = resolveLpRewardCoinType(e, p)
			const aU = symA.toUpperCase()
			const bU = symB.toUpperCase()
			const rU = rt.toUpperCase()
			let u = 0
			let qR: HistoricalUsdQuote = {
				usdPerToken: null,
				source: 'cache',
				approximate: false,
				quoteAsOfUnixSec: null,
			}
			const preReward =
				Number.isFinite(e.valueUsdReward) && (e.valueUsdReward as number) > 0
					? (e.valueUsdReward as number)
					: Number.isFinite(e.totalValueUSD) && (e.totalValueUSD as number) > 0
						? (e.totalValueUSD as number)
						: 0
			if (preReward > 0) {
				u = preReward
			} else if (r > 0) {
				if (rewardCt) {
					qR = await quoteAt(rt || rewardCt.split('::').pop() || symA, rewardCt, t)
					u = qR.usdPerToken != null ? r * qR.usdPerToken : 0
				} else if (rU === aU || rt === symA) {
					qR = await quoteAt(symA, addrA, t)
					u = qR.usdPerToken != null ? r * qR.usdPerToken : 0
				} else if (rU === bU || rt === symB) {
					qR = await quoteAt(symB, addrB, t)
					u = qR.usdPerToken != null ? r * qR.usdPerToken : 0
				}
				// Unknown reward token — leave u=0 (never price as max(pool A,B) — e.g. BLUE ≠ BTC).
			}
			out.valueUsdA = null
			out.valueUsdB = null
			out.valueUsdReward = u > 0 ? u : null
			out.quoteAsOfUnixSecA = null
			out.quoteAsOfUnixSecB = null
			out.quoteAsOfUnixSecReward = u > 0 ? qR.quoteAsOfUnixSec : null
			out.totalValueUSD = u
			out.priceUnavailable = u <= 0
			out.priceAtTxApproximate = qR.approximate || preReward > 0
			out.priceSource = u > 0 ? (preReward > 0 ? (e.priceSource ?? 'cache') : qR.source) : null
			sumClaimedRewardUsd += u
		} else {
			out.valueUsdA = null
			out.valueUsdB = null
			out.valueUsdReward = null
			out.quoteAsOfUnixSecA = null
			out.quoteAsOfUnixSecB = null
			out.quoteAsOfUnixSecReward = null
			out.totalValueUSD = null
			out.priceAtTxApproximate = false
			out.priceSource = null
		}
		updatedEvents.push(out)
	}

	let netA = 0
	let netB = 0
	// Gross deposits (never decremented by withdrawals) — used for closed-position HODL basket.
	// For an open position with no withdrawals yet, grossDepA === netA.
	let grossDepA = 0
	let grossDepB = 0
	for (const e of sorted) {
		if (e.type === 'add_liquidity') {
			netA += e.tokenAAmount
			netB += e.tokenBAmount
			grossDepA += e.tokenAAmount
			grossDepB += e.tokenBAmount
		}
		if (e.type === 'remove_liquidity') {
			netA -= e.tokenAAmount
			netB -= e.tokenBAmount
		}
	}

	const symA = p.tokenA
	const symB = p.tokenB
	const addrA = p.tokenAAddress
	const addrB = p.tokenBAddress

	const hodlUsdResult = await (async (): Promise<{
		usd: number
		pa?: number
		pb?: number
	}> => {
		if (lifecycle !== 'closed') {
			// Open position: HODL basket = net deposited tokens (deposits minus any partial
			// withdrawals) valued at current spot — "what would still be at stake if held".
			return {
				usd: netA * p.currentPriceA_USD + netB * p.currentPriceB_USD,
			}
		}
		// Closed position: HODL basket = GROSS deposited tokens valued at close price.
		const ts = Math.floor(closeGuessSec)
		const lastRemove = [...updatedEvents].reverse().find((e) => e.type === 'remove_liquidity')
		const qA =
			ts > 0 && addrA
				? await quoteAt(symA, addrA, ts)
				: ({
						usdPerToken: null,
						approximate: false,
						source: 'cache' as const,
						quoteAsOfUnixSec: null,
					} satisfies HistoricalUsdQuote)
		const qB =
			ts > 0 && addrB
				? await quoteAt(symB, addrB, ts)
				: ({
						usdPerToken: null,
						approximate: false,
						source: 'cache' as const,
						quoteAsOfUnixSec: null,
					} satisfies HistoricalUsdQuote)
		const pa =
			qA.usdPerToken ??
			lastRemove?.priceA_USD ??
			p.currentPriceA_USD
		const pb =
			qB.usdPerToken ??
			lastRemove?.priceB_USD ??
			p.currentPriceB_USD
		return { usd: grossDepA * pa + grossDepB * pb, pa, pb }
	})()

	const hodlUsd = hodlUsdResult.usd
	const horizonPriceA_USD = lifecycle === 'closed' ? hodlUsdResult.pa : undefined
	const horizonPriceB_USD = lifecycle === 'closed' ? hodlUsdResult.pb : undefined

	let sumDepositsUsd = 0
	let sumWithdrawsUsd = 0
	for (const e of updatedEvents) {
		if (e.type === 'add_liquidity') {
			const u = e.totalValueUSD ?? 0
			if (u > 0) sumDepositsUsd += u
		}
		if (e.type === 'remove_liquidity') {
			const u = e.totalValueUSD ?? 0
			if (u > 0) sumWithdrawsUsd += u
		}
	}

	const uFeeE = Number.isFinite(p.unclaimedFeeUSD) ? p.unclaimedFeeUSD : 0
	const uRewE = Number.isFinite(p.unclaimedRewardUSD) ? p.unclaimedRewardUSD : 0
	const lpProceedsUsd = sumWithdrawsUsd + sumClaimedFeeUsd + sumClaimedRewardUsd
	let lpTotal: number
	let pnlUSD: number
	let netDepBasisUsd: number
	if (lifecycle === 'closed') {
		lpTotal = lpProceedsUsd
		netDepBasisUsd = sumDepositsUsd
		pnlUSD = lpProceedsUsd - sumDepositsUsd
	} else {
		lpTotal = p.currentValueUSD + uFeeE + uRewE + sumClaimedFeeUsd + sumClaimedRewardUsd
		netDepBasisUsd = netDepositedUsd
		pnlUSD = lpTotal - netDepBasisUsd
	}
	/** Claimed from event history; unclaimed додається в UI через `totalLifetimeEarningsUsd()`. */
	const lifetimeEarningsUSD = sumClaimedFeeUsd + sumClaimedRewardUsd
	const pnlPct = netDepBasisUsd > 0 ? (pnlUSD / netDepBasisUsd) * 100 : 0
	const vsHodlDeltaUSD = lpTotal - hodlUsd
	const aprEstimatePct =
		daysOpen > 0.02 && netDepBasisUsd > 0
			? (pnlUSD / netDepBasisUsd / (daysOpen / 365)) * 100
			: 0

	// Sanity guard: if deposited or PnL values are astronomically large it almost
	// certainly means a token's decimals were wrong (e.g. decimals=0 makes 1 raw
	// unit look like $1 trillion). Zero-out all metrics rather than display garbage.
	// Threshold: $50 M — realistic max for a single LP position.
	// Risk: a legitimately large position (>$50 M) would also be zeroed, but that's
	// far safer than displaying absurd numbers. Adjust if needed.
	const ABSURD = 50_000_000
	let depOut =
		lifecycle === 'closed' ? sumDepositsUsd : netDepositedUsd
	let pnlOut = pnlUSD
	let pnlPctOut = pnlPct
	let lifeOut = lifetimeEarningsUSD
	let vsHodlOut = vsHodlDeltaUSD
	let aprOut = Number.isFinite(aprEstimatePct) ? aprEstimatePct : 0
	if (Math.abs(depOut) > ABSURD || Math.abs(pnlOut) > ABSURD) {
		console.warn('[enrichment] ABSURD value detected — zeroing metrics for position', { depOut, pnlOut })
		depOut = 0
		pnlOut = 0
		pnlPctOut = 0
		lifeOut = 0
		vsHodlOut = 0
		aprOut = 0
	}

	/** All-in APR лише як «ставка здобутку»; негатив (збиток) через PnL/ROI — показуємо 0. */
	aprOut = Number.isFinite(aprOut) ? Math.max(0, aprOut) : 0

	return {
		events: updatedEvents,
		historyPartial,
		merged: {
			depositedUSD: depOut,
			pnlUSD: pnlOut,
			pnlPct: pnlPctOut,
			openedAt: minTs,
			daysOpen,
			lifetimeEarningsUSD: lifeOut,
			vsHodlDeltaUSD: vsHodlOut,
			aprEstimatePct: Number.isFinite(aprOut) ? aprOut : 0,
			historyPartial,
			// Open: net amounts (what's still at risk in LP, reflecting partial withdrawals).
			// Closed: gross deposit amounts (what you put in — shown as the HODL basket).
			hodlTokenAAmount: lifecycle === 'closed' ? grossDepA : netA,
			hodlTokenBAmount: lifecycle === 'closed' ? grossDepB : netB,
			...(lifecycle === 'closed'
				? {
						hodlBasketUsdAtHorizon: Number.isFinite(hodlUsd) ? hodlUsd : null,
						horizonPriceA_USD:
							horizonPriceA_USD != null && Number.isFinite(horizonPriceA_USD)
								? horizonPriceA_USD
								: null,
						horizonPriceB_USD:
							horizonPriceB_USD != null && Number.isFinite(horizonPriceB_USD)
								? horizonPriceB_USD
								: null,
					}
				: {}),
		},
	}
}

/**
 * Паралельно збагачує Bluefin + Momentum: один скан tx гаманця, потім enrichment по кожній позиції.
 */
export async function enrichAllBluefinOpenPositions(
	wallet: string,
	positions: OpenPosition[],
	options?: {
		session?: LpWalletScanSession | null
		/** Events from Supabase `/api/lp-history?status=open` — skip cold scan when deposit is present. */
		seedEventsByPositionId?: Record<string, PositionEvent[]>
	},
): Promise<
	Array<{ id: string; merged: Partial<OpenPosition>; events: PositionEvent[]; historyPartial: boolean }>
> {
	const tracked = positions.filter(
		(p): p is OpenPosition & { protocol: 'bluefin' | 'momentum' } =>
			p.protocol === 'bluefin' || p.protocol === 'momentum',
	)
	if (tracked.length === 0) {
		return []
	}

	const session = options?.session ?? getLpWalletScanSession()
	const eventsByPositionId = new Map<string, PositionEvent[]>()
	let scanPartial = false

	const seedMap = options?.seedEventsByPositionId
	if (seedMap) {
		for (const p of tracked) {
			let posKey: string
			try {
				posKey = normalizeSuiAddress(p.id)
			} catch {
				posKey = p.id
			}
			const seeded = seedMap[p.id] ?? seedMap[posKey]
			if (seeded && seeded.length > 0) {
				eventsByPositionId.set(posKey, [...seeded].sort((a, b) => a.timestamp - b.timestamp))
			}
		}
	}

	if (session) {
		scanPartial = session.bluefin.historyPartial || session.momentum.historyPartial
		for (const p of tracked) {
			let posKey: string
			try {
				posKey = normalizeSuiAddress(p.id)
			} catch {
				posKey = p.id
			}
			const raw =
				p.protocol === 'momentum'
					? (session.momentum.rawByPositionId.get(posKey) ?? [])
					: (session.bluefin.rawByPositionId.get(posKey) ?? [])
			if (raw.length === 0) continue
			const parsed =
				p.protocol === 'momentum'
					? momentumRawToPositionEvents(raw, posKey, p.tokenADecimals, p.tokenBDecimals)
					: bluefinRawToPositionEvents(raw, posKey, p.tokenADecimals, p.tokenBDecimals)
			if (parsed.length > 0) {
				const existing = eventsByPositionId.get(posKey) ?? []
				eventsByPositionId.set(posKey, mergePositionEvents(parsed, existing))
			}
		}
	}

	const needTxScan = tracked.filter((p) => {
		let posKey: string
		try {
			posKey = normalizeSuiAddress(p.id)
		} catch {
			posKey = p.id
		}
		return !positionHasDeposit(eventsByPositionId.get(posKey) ?? [])
	})

	if (needTxScan.length > 0) {
		const tx = await scanLpWalletPositionHistory(
			wallet,
			needTxScan.map((p) => ({
				id: p.id,
				tokenADecimals: p.tokenADecimals,
				tokenBDecimals: p.tokenBDecimals,
				protocol: p.protocol,
			})),
		)
		scanPartial = scanPartial || tx.historyPartial
		for (const [k, evs] of tx.eventsByPositionId) {
			const existing = eventsByPositionId.get(k) ?? []
			eventsByPositionId.set(k, mergePositionEvents(evs, existing))
		}
	}

	// ── Fallback: recover add_liquidity for positions outside the TX-scan window ─
	//
	// The bulk wallet TX scan is descending, limited to MAX_TX_PAGES pages.  Old
	// positions (e.g. opened 90+ days ago on an active wallet) may have their
	// opening AddLiquidity event beyond that window — the scanner only finds
	// recent collect_fee events, leaving netDepositedUsd = 0 and PnL = 0.
	//
	// Strategy A — Momentum: reuse scanMomentumWalletAllPositionEvents which runs
	//   BOTH a TX scan AND a queryEvents({Sender}) scan (Phase 2, up to 5 000
	//   events).  This function is IDB-cached so it's fast on warm restarts.
	//
	// Strategy B — Bluefin: scanPositionAllEventsByObjectId uses InputObject +
	//   ChangedObject filters (position-specific), bypassing the wallet window.
	const needsFallback = tracked.filter((p) => {
		let posKey: string
		try { posKey = normalizeSuiAddress(p.id) } catch { posKey = p.id }
		const evs = eventsByPositionId.get(posKey) ?? []
		return !evs.some((e) => e.type === 'add_liquidity')
	})

	if (needsFallback.length > 0) {
		console.log(
			`[enrichment] ${needsFallback.length}/${tracked.length} positions missing add_liquidity — running fallback scans`,
			needsFallback.map((p) => `${p.protocol}:${p.id.slice(0, 10)}…`),
		)

		const momentumMissing = needsFallback.filter((p) => p.protocol === 'momentum')

		// Strategy A — Momentum wallet-wide Sender scan (IDB-cached, 5 000 events).
		// Fast on warm restarts; covers positions within the wallet event window.
		let mmtSenderRaw: Map<string, MomentumWalletRawEvt[]> | null = null
		if (momentumMissing.length > 0) {
			if (session) {
				mmtSenderRaw = session.momentum.rawByPositionId
			} else {
				try {
					const { rawByPositionId } = await scanMomentumWalletAllPositionEvents(wallet)
					mmtSenderRaw = rawByPositionId
				} catch (e) {
					console.warn(
						'[enrichment] Strategy A (Momentum Sender scan) failed:',
						e instanceof Error ? e.message : e,
					)
				}
			}
		}

		// Strategy B — Position-object scan (InputObject + ChangedObject queries).
		// Works for BOTH Bluefin and Momentum. Unlike the wallet Sender scan, it is
		// bounded by the position's own transaction history (not wallet depth), so it
		// reliably finds the opening AddLiquidityEvent no matter how old the position is.
		//
		// For Momentum: Strategy A runs first (cheaper — IDB-cached). If A already
		// finds an add_liquidity event we skip the object scan.  If not, Strategy B
		// acts as a guaranteed fallback.
		await Promise.allSettled(
			needsFallback.map(async (p) => {
				let posKey: string
				try { posKey = normalizeSuiAddress(p.id) } catch { posKey = p.id }

				// Momentum Strategy A result: inject events found by the Sender scan
				if (p.protocol === 'momentum' && mmtSenderRaw != null) {
					const rawRows: MomentumWalletRawEvt[] = mmtSenderRaw.get(posKey) ?? []
					if (rawRows.length > 0) {
						const parsed: PositionEvent[] = rawRows
							.map((r) =>
								parseMomentumEventFromSui(
									r.event, r.digest, r.tsSec, posKey,
									p.tokenADecimals, p.tokenBDecimals,
								),
							)
							.filter((e): e is PositionEvent => e !== null)
						if (parsed.length > 0) {
							const existing = eventsByPositionId.get(posKey) ?? []
							const merged = mergePositionEvents(parsed, existing)
							eventsByPositionId.set(posKey, merged)
							// Strategy A found an opening event — no need for Strategy B
							if (merged.some((e) => e.type === 'add_liquidity')) {
								console.log(`[enrichment] Strategy A found add_liquidity for ${posKey.slice(0, 10)}…`)
								return
							}
						}
					} else {
						console.log(`[enrichment] Strategy A: no Sender events cached for ${posKey.slice(0, 10)}…`)
					}
				}

				// Strategy B — object-ID scan (Bluefin + Momentum that Strategy A missed)
				try {
					const fallback = await scanPositionAllEventsByObjectId(
						p.id,
						p.protocol as 'bluefin' | 'momentum',
						p.tokenADecimals,
						p.tokenBDecimals,
					)
					if (fallback.length > 0) {
						const existing = eventsByPositionId.get(posKey) ?? []
						eventsByPositionId.set(posKey, mergePositionEvents(fallback, existing))
						console.log(`[enrichment] Strategy B found ${fallback.length} event(s) for ${posKey.slice(0, 10)}…`)
					} else {
						console.warn(`[enrichment] Strategy B returned 0 events for ${p.protocol}:${posKey.slice(0, 10)}… — position will show —`)
					}
				} catch (e) {
					console.warn(`[enrichment] Strategy B threw for ${p.protocol}:${posKey.slice(0, 10)}…:`, e instanceof Error ? e.message : e)
				}
			}),
		)

		// Log final state after all fallbacks
		const stillMissing = needsFallback.filter((p) => {
			let posKey: string
			try { posKey = normalizeSuiAddress(p.id) } catch { posKey = p.id }
			const evs = eventsByPositionId.get(posKey) ?? []
			return !evs.some((e) => e.type === 'add_liquidity')
		})
		if (stillMissing.length > 0) {
			console.warn(
				`[enrichment] ${stillMissing.length} position(s) still missing add_liquidity after all fallbacks:`,
				stillMissing.map((p) => `${p.protocol}:${p.id.slice(0, 10)}…`),
			)
			// Invalidate the IDB cache for protocols that still have missing positions.
			// This forces a fresh cold scan on the next load, which may capture events
			// that were missed by the previous cold scan (e.g. due to page limit).
			const protocolsToInvalidate = new Set(stillMissing.map((p) => p.protocol as 'bluefin' | 'momentum'))
			let walletNorm: string
			try { walletNorm = normalizeSuiAddress(wallet) } catch { walletNorm = wallet }
			for (const protocol of protocolsToInvalidate) {
				if (protocol === 'bluefin' || protocol === 'momentum') {
					void deleteLpCacheEntry(walletNorm, protocol).then(() => {
						console.log(`[enrichment] Invalidated IDB cache for ${protocol} — will cold-scan next load`)
					})
					if (protocol === 'momentum') {
						clearMomentumScanCache(wallet)
					}
				}
			}
		}
	}

	const prefetchTargets = tracked.map((p) => {
		let posKey: string
		try {
			posKey = normalizeSuiAddress(p.id)
		} catch {
			posKey = p.id
		}
		return {
			tokenA: p.tokenA,
			tokenB: p.tokenB,
			tokenAAddress: p.tokenAAddress,
			tokenBAddress: p.tokenBAddress,
			events: eventsByPositionId.get(posKey) ?? [],
		}
	})
	const quoteMemo = await prefetchHistoricalQuotes(
		collectHistoricalQuoteRequestsFromEvents(prefetchTargets),
		8,
	)

	const out: Array<{
		id: string
		merged: Partial<OpenPosition>
		events: PositionEvent[]
		historyPartial: boolean
	}> = []
	const conc = 6
	for (let i = 0; i < tracked.length; i += conc) {
		const batch = tracked.slice(i, i + conc)
		const r = await Promise.all(
			batch.map(async (p) => {
				let posKey: string
				try {
					posKey = normalizeSuiAddress(p.id)
				} catch {
					posKey = p.id
				}
				const evs = eventsByPositionId.get(posKey) ?? []
				return enrichBluefinOpenPositionWithEvents(p, evs, scanPartial, { quoteMemo })
			}),
		)
		for (let j = 0; j < batch.length; j++) {
			const p = batch[j]!
			const e = r[j]!
			out.push({ id: p.id, ...e })
		}
	}
	return out
}

/**
 * Merges two PositionEvent arrays by unique id (digest::seq).
 * TX-scan events take priority (more complete); bulk-scanner events fill gaps (e.g. close events
 * that the TX scan may miss if they are beyond the 40-page TX window).
 */
function mergePositionEvents(txEvents: PositionEvent[], bulkEvents: PositionEvent[]): PositionEvent[] {
	const seen = new Set<string>()
	const out: PositionEvent[] = []
	for (const e of txEvents) { seen.add(e.id); out.push(e) }
	for (const e of bulkEvents) { if (!seen.has(e.id)) { seen.add(e.id); out.push(e) } }
	out.sort((a, b) => a.timestamp - b.timestamp)
	return out
}

/**
 * USD-події + PnL / vs HODL для закритих Bluefin-позицій (без unclaimed поточної ліквідності).
 *
 * @param walletAddress  If provided, runs a full TX-based scan (`scanLpWalletPositionHistory`)
 *   for all closed positions and merges those events with the bulk-scanner events already in
 *   `cp.events`.  This fixes the "partial history" PnL bug where old deposits were missing
 *   because the bulk event scan (3000-event window) didn't reach back far enough.
 */
export async function enrichAllBluefinClosedPositions(
	closed: ClosedPosition[],
	walletAddress?: string,
	options?: { session?: LpWalletScanSession | null },
): Promise<ClosedPosition[]> {
	const tracked = closed.filter(
		(c) => c.protocol === 'bluefin' || c.protocol === 'momentum' || c.protocol === 'cetus' || c.protocol === 'turbos',
	)
	if (tracked.length === 0) return closed

	// ── TX-based re-scan with IDB cache (bluefin + momentum only) ────────────
	// Cetus closed positions already carry their events from getCetusClosedPositions;
	// they skip the TX scan and use cp.events directly.
	// Bluefin/Momentum: immutable TX events are cached in IndexedDB indefinitely.
	const txEventsByPosId = new Map<string, PositionEvent[]>()
	const txPartialByPosId = new Map<string, boolean>()

	if (walletAddress) {
		// 1. Normalize wallet key for IDB
		let walletNorm = walletAddress
		try { walletNorm = normalizeSuiAddress(walletAddress) } catch {}

		// 2. Normalize all position IDs
		const normIds = tracked.map((c) => {
			try { return normalizeSuiAddress(c.id) } catch { return c.id }
		})

		// 3. Load what we already have in IDB
		const cached = await loadClosedPosTxEntries(walletNorm, normIds)
		for (const [posNorm, entry] of cached) {
			txEventsByPosId.set(posNorm, entry.events)
			txPartialByPosId.set(posNorm, entry.scanPartial)
		}

		// 4. Only scan positions not yet in cache.
		// Cetus and Turbos positions are excluded: they carry their own events from their
		// respective closed-position scanners. The Bluefin/Momentum TX scanner doesn't
		// know how to parse Cetus/Turbos events and would cache empty results, polluting IDB.
		const session = options?.session ?? getLpWalletScanSession()

		const uncachedTargets = tracked
			.filter((c) => {
				const n = normIds[tracked.indexOf(c)]!
				return !cached.has(n) && c.protocol !== 'cetus' && c.protocol !== 'turbos'
			})
			.map((c) => ({
				id: c.id,
				tokenADecimals: c.tokenADecimals,
				tokenBDecimals: c.tokenBDecimals,
				protocol: c.protocol as 'bluefin' | 'momentum',
			}))

		if (session) {
			for (const c of uncachedTargets) {
				let posNorm: string
				try {
					posNorm = normalizeSuiAddress(c.id)
				} catch {
					posNorm = c.id
				}
				const raw =
					c.protocol === 'momentum'
						? (session.momentum.rawByPositionId.get(posNorm) ?? [])
						: (session.bluefin.rawByPositionId.get(posNorm) ?? [])
				if (raw.length === 0) continue
				const decA = c.tokenADecimals ?? 0
				const decB = c.tokenBDecimals ?? 0
				const parsed =
					c.protocol === 'momentum'
						? momentumRawToPositionEvents(raw, posNorm, decA, decB)
						: bluefinRawToPositionEvents(raw, posNorm, decA, decB)
				if (parsed.length > 0) {
					txEventsByPosId.set(posNorm, parsed)
					txPartialByPosId.set(
						posNorm,
						c.protocol === 'momentum' ? session.momentum.historyPartial : session.bluefin.historyPartial,
					)
				}
			}
		}

		const stillUncached = uncachedTargets.filter((c) => {
			let posNorm: string
			try {
				posNorm = normalizeSuiAddress(c.id)
			} catch {
				posNorm = c.id
			}
			return !txEventsByPosId.has(posNorm)
		})

		if (stillUncached.length > 0) {
			try {
				const txTargets = stillUncached.map((c) => ({
					id: c.id,
					protocol: c.protocol,
					tokenADecimals: c.tokenADecimals ?? 0,
					tokenBDecimals: c.tokenBDecimals ?? 0,
				}))
				const { eventsByPositionId, historyPartial } = await scanLpWalletPositionHistory(
					walletAddress,
					txTargets,
				)
				for (const [posNorm, events] of eventsByPositionId) {
					txEventsByPosId.set(posNorm, events)
					txPartialByPosId.set(posNorm, historyPartial)
					// Save to IDB (fire-and-forget — non-fatal if it fails)
					void saveClosedPosTxEntry({
						id: `${walletNorm}|${posNorm}`,
						walletNorm,
						posNorm,
						events,
						scanPartial: historyPartial,
						cachedAt: Date.now(),
					})
				}
			} catch {
				// Non-fatal — uncached positions fall back to cp.events only
			}
		}
	}

	// Pre-load tick data from the raw lp_event_cache (PositionOpened parsedJson).
	// Single IDB read — covers all positions within the Sender event scan window.
	let walletNormForCache = walletAddress ?? ''
	try {
		if (walletAddress) walletNormForCache = normalizeSuiAddress(walletAddress)
	} catch {}
	const [bfTickCache, mmtTickCache] = await Promise.all([
		walletAddress ? loadTicksFromLpCache(walletNormForCache, 'bluefin') : Promise.resolve(new Map<string, { tickLower: number; tickUpper: number }>()),
		walletAddress ? loadTicksFromLpCache(walletNormForCache, 'momentum') : Promise.resolve(new Map<string, { tickLower: number; tickUpper: number }>()),
	])
	function ticksFromCache(posNorm: string, protocol: string) {
		if (protocol === 'momentum') return mmtTickCache.get(posNorm) ?? null
		return bfTickCache.get(posNorm) ?? null
	}

	const outMap = new Map(closed.map((c) => [c.id, c]))

	const prefetchInputs = tracked.map((cp) => {
		const synth = syntheticOpenFromClosed(cp)
		let posNorm: string
		try {
			posNorm = normalizeSuiAddress(cp.id)
		} catch {
			posNorm = cp.id
		}
		const merged = mergePositionEvents(txEventsByPosId.get(posNorm) ?? [], cp.events)
		return {
			tokenA: synth.tokenA,
			tokenB: synth.tokenB,
			tokenAAddress: synth.tokenAAddress,
			tokenBAddress: synth.tokenBAddress,
			events: merged,
			closedAt: cp.closedAt,
		}
	})
	const closedQuoteMemo = await prefetchHistoricalQuotes(
		collectHistoricalQuoteRequestsForClosedBatch(prefetchInputs),
		8,
	)

	const conc = 6
	for (let i = 0; i < tracked.length; i += conc) {
		const batch = tracked.slice(i, i + conc)
		const done = await Promise.all(
			batch.map(async (cp) => {
				const synth = syntheticOpenFromClosed(cp)

				// Merge TX-scan events (more complete) with bulk-scanner events (may have
				// close events beyond the TX window). TX-scan events take priority.
				let posNorm: string
				try { posNorm = normalizeSuiAddress(cp.id) } catch { posNorm = cp.id }
				const txEvs = txEventsByPosId.get(posNorm) ?? []
				let mergedEvents = mergePositionEvents(txEvs, cp.events)

				// ── Fallback: targeted object-ID scan ────────────────────────────────
				// If no add_liquidity events were found by the sender/TX scans (wallet too
				// active → early events beyond the scan window), query by the position NFT
				// object ID directly. This covers ALL transactions that ever touched the
				// NFT regardless of wallet history depth.
				const hasDeposit = mergedEvents.some((e) => e.type === 'add_liquidity')
				if (!hasDeposit) {
					if (cp.protocol === 'bluefin' || cp.protocol === 'momentum') {
						try {
							const targeted = await scanPositionAllEventsByObjectId(
								cp.id,
								cp.protocol,
								synth.tokenADecimals,
								synth.tokenBDecimals,
							)
							if (targeted.length > 0) {
								mergedEvents = mergePositionEvents(targeted, mergedEvents)
							}
						} catch {
							/* non-fatal — keep existing merged events */
						}
					} else if (cp.protocol === 'cetus' && walletAddress) {
						// Cetus fallback: deep wallet TX scan (FromAddress).
						// Covers positions older than the 2500-event wallet Sender scan window.
						try {
							const targeted = await scanCetusPositionEventsByWalletTxs(
								walletAddress,
								cp.id,
								synth.tokenADecimals,
								synth.tokenBDecimals,
							)
							if (targeted.length > 0) {
								mergedEvents = mergePositionEvents(targeted, mergedEvents)
							}
						} catch {
							/* non-fatal — keep existing merged events */
						}
					} else if (cp.protocol === 'turbos') {
						// Turbos fallback: Sender-based scan for positions where events are empty/partial.
						try {
							const targeted = await scanTurbosPositionEvents(
								walletAddress ?? '',
								cp.id,
								'',   // positionObjectId not stored on ClosedPosition; nftId covers newer events
								synth.tokenADecimals,
								synth.tokenBDecimals,
							)
							if (targeted.length > 0) {
								mergedEvents = mergePositionEvents(targeted, mergedEvents)
							}
						} catch {
							/* non-fatal — keep existing merged events */
						}
					}
				}

				// A position's history is "partial" only when the wallet-wide scan was
				// page-capped AND we still lack an opening event for this specific position.
				// If merged events contain add_liquidity or open_position the scan window
				// covered the position's full lifetime → label it complete, not partial.
				// (mergedEvents already includes any targeted object-ID fallback results above.)
				const globalScanPartial = cp.partialHistory === true || (txPartialByPosId.get(posNorm) ?? false)
				const mergedHasOpen = mergedEvents.some(
					(e) => e.type === 'add_liquidity' || e.type === 'open_position',
				)
				const partial = globalScanPartial && !mergedHasOpen
				const closeTs = cp.closedAt > 0 ? Math.floor(cp.closedAt) : undefined
				const { merged, events } = await enrichBluefinOpenPositionWithEvents(synth, mergedEvents, partial, {
					lifecycle: 'closed',
					closeTimestampSec: closeTs,
					quoteMemo: closedQuoteMemo,
				})
				let feesUsd = 0
				for (const e of events) {
					if (e.type === 'collect_fee' || e.type === 'collect_reward') {
						const u = e.totalValueUSD ?? 0
						if (u > 0) feesUsd += u
					}
				}
				const dep = Number.isFinite(merged.depositedUSD) ? merged.depositedUSD! : 0
				const pnl = Number.isFinite(merged.pnlUSD) ? merged.pnlUSD! : 0
				const closedVal = dep + pnl
				const vsH = Number.isFinite(merged.vsHodlDeltaUSD) ? merged.vsHodlDeltaUSD! : 0
				const estIl = vsH < 0 ? vsH : 0
				const hodlBasket = merged.hodlBasketUsdAtHorizon

				// Extract tick range — three sources, in priority order:
				// 1. lp_event_cache IDB (raw PositionOpened parsedJson from bulk Sender scan)
				// 2. mergedEvents open_position entry (parsed during TX-based scan)
				// 3. cp.tickLower / cp.tickUpper already on the record
				let enrichedTickLower: number | undefined
				let enrichedTickUpper: number | undefined

				// Source 1: raw lp_event_cache (most reliable — covers bulk Sender scan window)
				const cachedTicks = ticksFromCache(posNorm, cp.protocol)
				if (cachedTicks) {
					enrichedTickLower = cachedTicks.tickLower
					enrichedTickUpper = cachedTicks.tickUpper
				}

				// Source 2: open_position event from TX-based scan
				if (enrichedTickLower == null) {
					for (const e of mergedEvents) {
						if (e.type === 'open_position' && e.tickLower != null && e.tickUpper != null) {
							enrichedTickLower = e.tickLower
							enrichedTickUpper = e.tickUpper
							break
						}
					}
				}

				// Source 3: whatever was already on the closed position record
				if (enrichedTickLower == null) {
					enrichedTickLower = cp.tickLower
					enrichedTickUpper = cp.tickUpper
				}

				const next: ClosedPosition = {
					...cp,
					events,
					...(enrichedTickLower != null ? { tickLower: enrichedTickLower } : {}),
					...(enrichedTickUpper != null ? { tickUpper: enrichedTickUpper } : {}),
					depositedUSD: dep,
					pnlUSD: pnl,
					pnlPct: Number.isFinite(merged.pnlPct) ? merged.pnlPct! : 0,
					closedValueUSD: closedVal,
					totalFeesCollectedUSD: feesUsd,
					lifetimeEarningsUSD: Number.isFinite(merged.lifetimeEarningsUSD)
						? merged.lifetimeEarningsUSD!
						: feesUsd,
					estimatedIL_USD: Number.isFinite(estIl) ? estIl : 0,
					daysOpen: Number.isFinite(merged.daysOpen) ? merged.daysOpen! : cp.daysOpen,
					openedAt: merged.openedAt ?? cp.openedAt,
					hodlTokenAAmount: merged.hodlTokenAAmount,
					hodlTokenBAmount: merged.hodlTokenBAmount,
					vsHodlDeltaUSD: vsH,
					aprEstimatePct: Number.isFinite(merged.aprEstimatePct) ? merged.aprEstimatePct! : 0,
					partialHistory: partial || merged.historyPartial === true,
					hodlBasketUsdAtClose:
						hodlBasket != null && Number.isFinite(hodlBasket) ? hodlBasket : null,
					horizonPriceA_USD: merged.horizonPriceA_USD ?? null,
					horizonPriceB_USD: merged.horizonPriceB_USD ?? null,
					currentPriceA_USD: cp.currentPriceA_USD ?? synth.currentPriceA_USD,
					currentPriceB_USD: cp.currentPriceB_USD ?? synth.currentPriceB_USD,
				}
				return next
			}),
		)
		for (const c of done) outMap.set(c.id, c)
	}
	return closed.map((c) => outMap.get(c.id) ?? c)
}
