/**
 * Cetus CLMM closed positions.
 *
 * "Closed" = confirmed final close when the position object is burned
 * (`ClosePositionEvent`). Owned NFTs with liquidity === 0 are **Empty** and
 * stay on the open list via getCetusPositions — never listed here.
 *
 * Flow:
 *  1. Wallet event map → burned position seeds
 *  2. fetchPools → feeRate, rewarder coin types
 *  3. getCoinMetadata → decimals + symbols
 *  4. scanCetusPositionEvents → full event history
 *  5. resolveSpots → current spot prices for pair display
 *  6. Build ClosedPosition[]
 */
import type { ClosedPosition, PositionEvent } from '@/types'
import type { ClosedPositionsResult } from '@/services/adapters/types'
import { suiClient } from '@/services/suiClient'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import type { ParsedPool, ParsedPosition } from '@/services/cetusService'
import { fetchPools } from '@/services/cetusService'
import {
	cetusBurnedSeedsFromWalletMap,
	cetusPoolCoinsFromEventType,
	loadCetusWalletScan,
	scanCetusPositionEvents,
	scanCetusPositionEventsByWalletTxs,
	scanCetusWalletDeepTyped,
} from '@/services/cetusLpEvents'
import { resolveSpots, type Row } from '@/services/spotPrice/resolveSpots'
import {
	loadClosedPosTxEntries,
	saveClosedPosTxEntry,
} from '@/services/lpEventIdbCache'

type CoinMeta = { symbol: string; decimals: number; iconUrl: string | null }

/**
 * Stablecoins whose price is effectively $1 and that should always appear as
 * the QUOTE token (tokenB) in a pair display (e.g. "SUI/USDC" not "USDC/SUI").
 *
 * Cetus orders pool tokens by coin-type address, which may put a stablecoin
 * in the tokenA slot. Normalising here prevents the range bar from showing
 * prices in the inverted direction (e.g. 0.28 SUI-per-USDC instead of 3.5 USDC-per-SUI).
 */
const STABLECOIN_SYMS = new Set([
	'USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'PYUSD',
	'USDD', 'FRAX', 'LUSD', 'SUSD', 'GUSD',
])

/**
 * Swap all A/B-indexed fields in a PositionEvent so that the event's token
 * A/B slots match the normalised (post-swap) position token ordering.
 */
function swapEventAB(ev: PositionEvent): PositionEvent {
	return {
		...ev,
		tokenAAmount: ev.tokenBAmount,
		tokenBAmount: ev.tokenAAmount,
		feeAmountA: ev.feeAmountB,
		feeAmountB: ev.feeAmountA,
		priceA_USD: ev.priceB_USD,
		priceB_USD: ev.priceA_USD,
		valueUsdA: ev.valueUsdB,
		valueUsdB: ev.valueUsdA,
		quoteAsOfUnixSecA: ev.quoteAsOfUnixSecB,
		quoteAsOfUnixSecB: ev.quoteAsOfUnixSecA,
	}
}

function symbolFromCoinType(ct: string): string {
	const parts = ct.split('::')
	return parts[2] ?? parts[1] ?? '—'
}

function feeLabelFromFrac(frac: number): string {
	if (!Number.isFinite(frac) || frac <= 0) return '—'
	return `${(frac * 100).toFixed(3)}%`
}

function spotPriceSafe(raw: number | null | undefined): number {
	if (raw == null || !Number.isFinite(raw) || raw <= 0 || raw > 1e8) return 0
	return raw
}

const POOL_META_CHUNK = 40

/**
 * Resolve missing coinTypeA/B on burned seeds via pool object types.
 * Chunked multiGet + per-id getObject retry — avoids silent [] under RPC stress.
 */
async function fillCetusSeedCoinTypes(
	seeds: { poolId: string; coinTypeA: string; coinTypeB: string }[],
	opts?: { forceRetry?: boolean },
): Promise<void> {
	const need = seeds.filter((s) => !s.coinTypeA || !s.coinTypeB)
	if (need.length === 0) return
	const ids = [...new Set(need.map((s) => s.poolId))]
	const coinsByPool = new Map<string, { coinTypeA: string; coinTypeB: string }>()

	for (let i = 0; i < ids.length; i += POOL_META_CHUNK) {
		const chunk = ids.slice(i, i + POOL_META_CHUNK)
		let objs: Awaited<ReturnType<typeof suiClient.multiGetObjects>> = []
		for (let attempt = 0; attempt < (opts?.forceRetry ? 3 : 2); attempt++) {
			try {
				objs = await suiClient.multiGetObjects({
					ids: chunk,
					options: { showType: true },
				})
				break
			} catch (e) {
				console.warn(
					`[cetus-closed] multiGetObjects pools attempt ${attempt + 1} failed`,
					e instanceof Error ? e.message : e,
				)
				if (attempt === (opts?.forceRetry ? 2 : 1)) objs = []
				else await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
			}
		}
		for (let j = 0; j < chunk.length; j++) {
			const type = objs[j]?.data?.type
			if (!type) continue
			// Pool<CoinA, CoinB> and Event<CoinA, CoinB> share the same type-param layout.
			const pair = cetusPoolCoinsFromEventType(type)
			if (pair) coinsByPool.set(chunk[j]!, pair)
		}
	}

	// Cap per-id fallback — under gRPC cooldown, 1000+ getObject calls never finish.
	const stillMissing = ids.filter((id) => !coinsByPool.has(id)).slice(0, 24)
	if (stillMissing.length > 0) {
		const concurrency = 3
		let cursor = 0
		await Promise.all(
			Array.from({ length: Math.min(concurrency, stillMissing.length) }, async () => {
				for (;;) {
					const idx = cursor++
					if (idx >= stillMissing.length) return
					const poolId = stillMissing[idx]!
					for (let attempt = 0; attempt < 2; attempt++) {
						try {
							const obj = await suiClient.getObject({
								id: poolId,
								options: { showType: true },
							})
							const type = obj.data?.type
							if (!type) break
							const pair = cetusPoolCoinsFromEventType(type)
							if (pair) coinsByPool.set(poolId, pair)
							break
						} catch {
							await new Promise((r) => setTimeout(r, 250 * (attempt + 1)))
						}
					}
				}
			}),
		)
	}

	for (const seed of need) {
		const pair = coinsByPool.get(seed.poolId)
		if (!pair) continue
		seed.coinTypeA = pair.coinTypeA
		seed.coinTypeB = pair.coinTypeB
	}
}

async function fetchCoinMetas(coinTypes: string[]): Promise<Map<string, CoinMeta>> {
	const mm = new Map<string, CoinMeta>()
	await Promise.allSettled(
		coinTypes.map(async (ct) => {
			try {
				const m = await suiClient.getCoinMetadata({ coinType: ct })
				mm.set(ct, {
					symbol: m?.symbol ?? symbolFromCoinType(ct),
					decimals: m?.decimals ?? 9,
					iconUrl:
						typeof m?.iconUrl === 'string' && m.iconUrl.startsWith('https://')
							? m.iconUrl
							: null,
				})
			} catch {
				mm.set(ct, { symbol: symbolFromCoinType(ct), decimals: 9, iconUrl: null })
			}
		}),
	)
	return mm
}

/**
 * Returns Cetus CLMM closed positions for `walletAddress`.
 * Burned NFTs only (ClosePositionEvent). Owned empty NFTs are not Closed.
 */
export async function getCetusClosedPositions(
	walletAddress: string,
): Promise<ClosedPositionsResult> {
	let walletNorm: string
	try {
		walletNorm = normalizeSuiAddress(walletAddress)
	} catch {
		walletNorm = walletAddress
	}

	let incomplete = false
	let reason: string | undefined

	// 1. Burned closes from wallet events only (never owned liquidity===0 NFTs).
	const closed: ParsedPosition[] = []
	let burnedSeeds: ReturnType<typeof cetusBurnedSeedsFromWalletMap> = []
	// (mutated / replaced on stepwise retry)
	try {
		const scan = await loadCetusWalletScan(walletAddress)
		if (scan.historyPartial) {
			incomplete = true
			reason = reason ?? 'page_cap'
		}
		burnedSeeds = cetusBurnedSeedsFromWalletMap(scan.rawByPosition)
		// Under GraphQL/RPC stress the primary window can be empty while closes exist —
		// recover seeds from the deep typed archive scan (same path as event enrichment).
		if (burnedSeeds.length === 0) {
			console.warn('[cetus-closed] primary scan yielded 0 ClosePosition seeds — trying deep typed')
			try {
				const deep = await scanCetusWalletDeepTyped(walletAddress)
				burnedSeeds = cetusBurnedSeedsFromWalletMap(deep)
				if (burnedSeeds.length === 0) {
					incomplete = true
					reason = reason ?? (scan.historyPartial ? 'page_cap' : 'adapter_error')
				}
			} catch (deepErr) {
				console.warn('[cetus-closed] deep typed seed recovery failed', deepErr)
				incomplete = true
				reason = reason ?? 'scan_timeout'
			}
		}
	} catch (e) {
		console.warn('[cetus-closed] burned-position scan failed', e)
		incomplete = true
		reason = 'scan_timeout'
	}
	await fillCetusSeedCoinTypes(burnedSeeds)

	// One short retry when every seed lacks coin types (RPC stress). Do NOT deep-rescan
	// when ClosePosition seeds already exist — that only burns the timeout budget.
	const missingCoins = () => burnedSeeds.filter((s) => !s.coinTypeA || !s.coinTypeB)
	if (burnedSeeds.length > 0 && missingCoins().length === burnedSeeds.length) {
		console.warn(
			`[cetus-closed] ${burnedSeeds.length} ClosePosition seeds without coin types — retry pool meta once`,
		)
		await fillCetusSeedCoinTypes(burnedSeeds, { forceRetry: true })
	}

	const seen = new Set<string>()
	/** objectIds whose coin types are SUI placeholders (pool meta miss) — not real pairs. */
	const placeholderCoinIds = new Set<string>()
	let placeholderCoins = 0
	for (const seed of burnedSeeds) {
		if (!seed.coinTypeA || !seed.coinTypeB) {
			// Keep burned NFT in closed list so §8.3 does not see a silent zero.
			seed.coinTypeA = seed.coinTypeA || '0x2::sui::SUI'
			seed.coinTypeB = seed.coinTypeB || '0x2::sui::SUI'
			placeholderCoins++
			placeholderCoinIds.add(seed.objectId)
			incomplete = true
			reason = reason ?? 'meta_miss'
		}
		if (seen.has(seed.objectId)) continue
		seen.add(seed.objectId)
		closed.push({
			objectId: seed.objectId,
			poolId: seed.poolId,
			coinTypeA: seed.coinTypeA,
			coinTypeB: seed.coinTypeB,
			liquidity: '0',
			lowerTick: seed.lowerTick,
			upperTick: seed.upperTick,
		})
	}
	if (placeholderCoins > 0) {
		console.warn(
			`[cetus-closed] ${placeholderCoins}/${burnedSeeds.length} seeds used placeholder coin types after meta miss`,
		)
	}

	if (closed.length === 0) {
		if (burnedSeeds.length > 0) {
			incomplete = true
			reason = reason ?? 'meta_miss'
		}
		return { positions: [], incomplete, reason: incomplete ? reason ?? 'page_cap' : undefined }
	}

	// 2. Fetch pool metadata (fee rate, rewarder coin types)
	const uniquePoolIds = [...new Set(closed.map((p) => p.poolId))]
	let poolMap: Map<string, ParsedPool>
	try {
		poolMap = await fetchPools(uniquePoolIds)
	} catch (e) {
		 
		console.warn('[cetus-closed] fetchPools failed', e)
		poolMap = new Map()
		incomplete = true
		reason = reason ?? 'adapter_error'
	}

	// 3. Collect all coin types for metadata + spot price lookup
	const allCoinTypes = new Set<string>()
	for (const pos of closed) {
		allCoinTypes.add(pos.coinTypeA)
		allCoinTypes.add(pos.coinTypeB)
	}
	for (const pool of poolMap.values()) {
		for (const ct of pool.rewarderCoinTypes) {
			if (ct) allCoinTypes.add(ct)
		}
	}

	// 4. Fetch coin metadata first (need symbols for resolveSpots), then spot prices
	const metaMap = await fetchCoinMetas([...allCoinTypes])

	let finalSpotsMap: Map<string, Row>
	try {
		finalSpotsMap = await resolveSpots(
			[...allCoinTypes],
			(ct) => metaMap.get(ct)?.symbol ?? symbolFromCoinType(ct),
		)
	} catch {
		finalSpotsMap = new Map()
	}

	const getMeta = (ct: string): CoinMeta =>
		metaMap.get(ct) ?? { symbol: symbolFromCoinType(ct), decimals: 9, iconUrl: null }

	// 5. Pre-load IDB TX event cache for all closed positions (one batch read)
	const posNorms = closed.map((p) => {
		try { return normalizeSuiAddress(p.objectId) } catch { return p.objectId }
	})
	const idbTxCache = await loadClosedPosTxEntries(walletNorm, posNorms).catch(() => new Map())

	// 6. Scan events + build ClosedPosition for each position
	const out: ClosedPosition[] = []
	let anyRowPartial = false

	await Promise.allSettled(
		closed.map(async (pos) => {
			const pool = poolMap.get(pos.poolId)
			const metaA = getMeta(pos.coinTypeA)
			const metaB = getMeta(pos.coinTypeB)

			// Scan on-chain events for this position.
			// Pass 1: wallet-wide Sender/typed scan (IDB warm-start).
			let events = await scanCetusPositionEvents(
				walletAddress,
				pos.objectId,
				metaA.decimals,
				metaB.decimals,
			).catch(() => {
				anyRowPartial = true
				return [] as PositionEvent[]
			})

			// Pass 2: deep GraphQL only when this position has ZERO events in the wallet map.
			// If we already have close/remove rows, skip deep (avoids N× deep scans on fat wallets).
			let rowPartial = !events.some((e) => e.type === 'add_liquidity')
			if (rowPartial && events.length === 0) {
				let posNorm: string
				try { posNorm = normalizeSuiAddress(pos.objectId) } catch { posNorm = pos.objectId }

				const idbHit = idbTxCache.get(posNorm)
				if (idbHit && idbHit.events.length > 0) {
					const seen = new Set(idbHit.events.map((e: PositionEvent) => e.id))
					events = [...idbHit.events, ...events.filter((e) => !seen.has(e.id))]
					events.sort((a, b) => a.timestamp - b.timestamp)
					rowPartial = !events.some((e) => e.type === 'add_liquidity') || idbHit.scanPartial === true
				} else {
					try {
						const targeted = await scanCetusPositionEventsByWalletTxs(
							walletAddress,
							pos.objectId,
							metaA.decimals,
							metaB.decimals,
						)
						if (targeted.length > 0) {
							const seen = new Set(targeted.map((e) => e.id))
							events = [...targeted, ...events.filter((e) => !seen.has(e.id))]
							events.sort((a, b) => a.timestamp - b.timestamp)
							rowPartial = !events.some((e) => e.type === 'add_liquidity')
							void saveClosedPosTxEntry({
								id: `${walletNorm}|${posNorm}`,
								walletNorm,
								posNorm,
								events: targeted,
								scanPartial: rowPartial,
								cachedAt: Date.now(),
							})
						} else {
							rowPartial = true
							console.warn('[cetus-closed] no events found for position', pos.objectId.slice(0, 16), '— Sender and deep typed scans empty')
						}
					} catch (err) {
						rowPartial = true
						console.warn('[cetus-closed] targeted scan failed for', pos.objectId.slice(0, 16), err)
					}
				}
			}
			if (rowPartial) anyRowPartial = true

			events.sort((a, b) => a.timestamp - b.timestamp)

			// Derive open/close timestamps from events
			const firstTs = events.length > 0 ? events[0]!.timestamp : 0
			const lastTs = events.length > 0 ? events[events.length - 1]!.timestamp : 0

			// "Open" = first add_liquidity event (or first event overall)
			const openEvt = events.find((e) => e.type === 'add_liquidity')
			const openedAt = openEvt ? openEvt.timestamp : firstTs

			// "Closed" = last remove_liquidity event (or last event overall)
			const removeEvts = events.filter((e) => e.type === 'remove_liquidity' || e.type === 'close_position')
			const closedAt = removeEvts.length > 0
				? Math.max(...removeEvts.map((e) => e.timestamp))
				: lastTs

			const daysOpen =
				openedAt > 0 && closedAt >= openedAt
					? Math.max(0, (closedAt - openedAt) / 86400)
					: 0

			const feeRate = pool?.feeRate ?? 0
			const feeLbl = feeLabelFromFrac(feeRate)

			const pxA = spotPriceSafe(finalSpotsMap.get(pos.coinTypeA)?.price)
			const pxB = spotPriceSafe(finalSpotsMap.get(pos.coinTypeB)?.price)

			// Accumulate deposited / withdrawn for rough PnL
			let depositedA = 0
			let depositedB = 0
			let withdrawnA = 0
			let withdrawnB = 0
			let feesA = 0
			let feesB = 0

			for (const ev of events) {
				if (ev.type === 'add_liquidity') {
					depositedA += ev.tokenAAmount
					depositedB += ev.tokenBAmount
				} else if (ev.type === 'remove_liquidity') {
					withdrawnA += ev.tokenAAmount
					withdrawnB += ev.tokenBAmount
				} else if (ev.type === 'collect_fee') {
					feesA += ev.feeAmountA
					feesB += ev.feeAmountB
				}
			}

			const coinPlaceholder = placeholderCoinIds.has(pos.objectId)
			if (coinPlaceholder) {
				rowPartial = true
				anyRowPartial = true
			}
			// Missing add_liquidity ⇒ unknown cost basis. Do NOT treat withdraw@spot as profit
			// (N06 bot wallets reuse size → identical fake PnL across distinct positionIds).
			const missingDepositBasis = !events.some((e) => e.type === 'add_liquidity')
			if (missingDepositBasis) {
				rowPartial = true
				anyRowPartial = true
			}

			// Placeholder coin types / missing deposit basis — do not invent USD PnL.
			let depositedUSD: number
			let closedValueUSD: number
			let totalFeesUSD: number
			let pnlUSD: number
			let pnlPct: number
			if (coinPlaceholder) {
				depositedUSD = Number.NaN
				closedValueUSD = Number.NaN
				totalFeesUSD = Number.NaN
				pnlUSD = Number.NaN
				pnlPct = Number.NaN
			} else {
				closedValueUSD =
					(pxA > 0 ? withdrawnA * pxA : 0) + (pxB > 0 ? withdrawnB * pxB : 0)
				totalFeesUSD = (pxA > 0 ? feesA * pxA : 0) + (pxB > 0 ? feesB * pxB : 0)
				if (missingDepositBasis) {
					depositedUSD = Number.NaN
					pnlUSD = Number.NaN
					pnlPct = Number.NaN
				} else {
					depositedUSD =
						(pxA > 0 ? depositedA * pxA : 0) + (pxB > 0 ? depositedB * pxB : 0)
					pnlUSD = closedValueUSD + totalFeesUSD - depositedUSD
					pnlPct = depositedUSD > 0 ? (pnlUSD / depositedUSD) * 100 : 0
				}
			}

			// Normalise token order: Cetus orders pool tokens by coin-type address, so a
			// stablecoin may end up as tokenA. Swap to canonical "crypto/stablecoin" order
			// (e.g. SUI/USDC instead of USDC/SUI) so the range bar shows USDC-per-SUI prices.
			// Tick inversion: swapping A↔B requires negating ticks and swapping lower↔upper
			// because the direction of the price axis flips.
			const aIsStable = STABLECOIN_SYMS.has(metaA.symbol.toUpperCase())
			const bIsStable = STABLECOIN_SYMS.has(metaB.symbol.toUpperCase())
			const swap = !coinPlaceholder && aIsStable && !bIsStable

			const dMetaA = swap ? metaB : metaA
			const dMetaB = swap ? metaA : metaB
			const dCoinTypeA = swap ? pos.coinTypeB : pos.coinTypeA
			const dCoinTypeB = swap ? pos.coinTypeA : pos.coinTypeB
			const dPxA = swap ? pxB : pxA
			const dPxB = swap ? pxA : pxB
			// When A and B are swapped the tick axis inverts: new lower = −(old upper)
			const dTickLower = swap ? -pos.upperTick : pos.lowerTick
			const dTickUpper = swap ? -pos.lowerTick : pos.upperTick
			const dEvents = swap ? events.map(swapEventAB) : events

			const pair = coinPlaceholder
				? `?—? · ${feeLbl}`
				: `${dMetaA.symbol}/${dMetaB.symbol} · ${feeLbl}`

			out.push({
				id: pos.objectId,
				protocol: 'cetus',
				pair,
				tokenA: coinPlaceholder ? '?' : dMetaA.symbol,
				tokenB: coinPlaceholder ? '?' : dMetaB.symbol,
				fee: feeRate,
				depositedUSD,
				closedValueUSD,
				pnlUSD,
				pnlPct,
				totalFeesCollectedUSD: totalFeesUSD,
				estimatedIL_USD: 0,
				openedAt,
				closedAt,
				daysOpen,
				events: dEvents,
				partialHistory: rowPartial,
				poolId: pos.poolId,
				tokenAAddress: coinPlaceholder ? undefined : dCoinTypeA,
				tokenBAddress: coinPlaceholder ? undefined : dCoinTypeB,
				tokenADecimals: dMetaA.decimals,
				tokenBDecimals: dMetaB.decimals,
				tokenAIconUrl: coinPlaceholder ? null : dMetaA.iconUrl,
				tokenBIconUrl: coinPlaceholder ? null : dMetaB.iconUrl,
				currentPriceA_USD: coinPlaceholder ? undefined : dPxA,
				currentPriceB_USD: coinPlaceholder ? undefined : dPxB,
				tickLower: dTickLower,
				tickUpper: dTickUpper,
			})
		}),
	)

	out.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
	if (anyRowPartial) {
		incomplete = true
		reason = reason ?? 'page_cap'
	}
	return { positions: out, incomplete, reason: incomplete ? reason : undefined }
}
