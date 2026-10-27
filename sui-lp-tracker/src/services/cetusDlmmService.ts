/**
 * Cetus DLMM open positions via `@cetusprotocol/dlmm-sdk` 1.3.3.
 *
 * Flow (official Position / Pool APIs):
 *  1. `Position.getOwnerPositionList(wallet)`
 *  2. `Pool.getPool` + `Position.getPositionAmounts` → principal
 *  3. `BinUtils.getPriceFromBinId` → range (B per A in pool coin order)
 *  4. `Pool.getTotalFeeRate` + `Position.fetchPositionFeeAndReward` → fee chip / unclaimed
 *  5. Spot via `resolveSpots`; stablecoin normalised to tokenB (same as CLMM).
 *
 * Mapped as `protocol: 'cetus'` with `cetusDlmm` + `priceRangeOverride` so the
 * open-positions table shows them under Cetus without treating bins as CLMM ticks.
 */
import { BinUtils, FEE_PRECISION } from '@cetusprotocol/dlmm-sdk'
import type { BluefinUnclaimedTokenRow, OpenPosition } from '@/types'
import { getCetusDlmmSdk } from '@/services/cetusDlmmSdk'
import type { ResolveSpotsOptions, Row } from '@/services/spotPrice/resolveSpots'
import { resolveSpots } from '@/services/spotPrice/resolveSpots'
import { resolveCoinMetadata } from '@/services/coinMetadata'
import { suiClient } from '@/services/suiClient'
import { mapPool } from '@/utils/concurrency'
import { RPC_CONCURRENCY } from '@/utils/constants'
import Decimal from 'decimal.js'

const MAX_SANE_POSITION_USD = 50_000_000
const MAX_SANE_HUMAN_TOKENS = 1e18

const STABLECOIN_SYMS = new Set([
	'USDC',
	'USDT',
	'DAI',
	'BUSD',
	'TUSD',
	'FDUSD',
	'PYUSD',
	'USDD',
	'FRAX',
	'LUSD',
	'SUSD',
	'GUSD',
])

export type CetusDlmmPositionsOptions = { forceRefreshPrices?: boolean }

type CoinMeta = { symbol: string; decimals: number; iconUrl: string | null }

function symbolFromCoinType(ct: string): string {
	const parts = ct.split('::')
	return parts[2] ?? parts[1] ?? '—'
}

function clampUsd(v: number): number {
	if (!Number.isFinite(v) || v < 0) return 0
	return v <= MAX_SANE_POSITION_USD ? v : 0
}

function safeHumanFromStringRaw(raw: string | undefined, decimals: number): number {
	const s = raw?.trim()
	if (!s || !/^\d+$/.test(s) || !Number.isFinite(decimals) || decimals < 0) return 0
	try {
		const n = new Decimal(s).div(new Decimal(10).pow(decimals)).toNumber()
		if (!Number.isFinite(n) || n < 0 || n > MAX_SANE_HUMAN_TOKENS) return 0
		return n
	} catch {
		return 0
	}
}

function spotPriceSafe(raw: number | null | undefined): number | null {
	if (raw == null || !Number.isFinite(raw) || raw <= 0 || raw > 1e8) return null
	return raw
}

function binPriceBPerA(
	binId: number,
	binStep: number,
	decimalsA: number,
	decimalsB: number,
): number {
	try {
		const n = Number(BinUtils.getPriceFromBinId(binId, binStep, decimalsA, decimalsB))
		return Number.isFinite(n) && n > 0 ? n : 0
	} catch {
		return 0
	}
}

function feeFractionFromRaw(raw: string | undefined): number {
	if (!raw || !/^\d+$/.test(raw)) return 0
	const n = Number(raw) / FEE_PRECISION
	return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * Returns open Cetus DLMM positions for `walletAddress`.
 * Failures return `[]` so CLMM/vault loads stay independent.
 */
export async function getCetusDlmmPositions(
	walletAddress: string,
	options?: CetusDlmmPositionsOptions,
): Promise<OpenPosition[]> {
	const sdk = getCetusDlmmSdk()
	// Official: setSenderAddress before fee/reward inspect payloads.
	sdk.setSenderAddress(walletAddress)
	let rows: Awaited<ReturnType<typeof sdk.Position.getOwnerPositionList>>
	try {
		rows = await sdk.Position.getOwnerPositionList(walletAddress)
	} catch (e) {
		// eslint-disable-next-line no-console
		console.warn('[cetus-dlmm] getOwnerPositionList failed', e)
		return []
	}
	if (!rows.length) return []

	const poolCache = new Map<string, Awaited<ReturnType<typeof sdk.Pool.getPool>>>()
	const feeCache = new Map<string, number>()

	const allCoinTypes = new Set<string>()
	for (const pos of rows) {
		allCoinTypes.add(pos.coin_type_a)
		allCoinTypes.add(pos.coin_type_b)
	}

	const metaMap = new Map<string, CoinMeta>()
	await mapPool([...allCoinTypes], RPC_CONCURRENCY, async (ct) => {
		const m = await resolveCoinMetadata(suiClient, ct)
		if (!m) return
		metaMap.set(ct, {
			symbol: m.symbol || symbolFromCoinType(ct),
			decimals: m.decimals,
			iconUrl: m.iconUrl,
		})
	})
	const getMeta = (ct: string): CoinMeta =>
		metaMap.get(ct) ?? { symbol: symbolFromCoinType(ct), decimals: -1, iconUrl: null }

	const spotOpts: ResolveSpotsOptions | undefined = options?.forceRefreshPrices
		? { forceRefresh: true }
		: undefined
	let spotsMap: Map<string, Row>
	try {
		spotsMap = await resolveSpots([...allCoinTypes], (ct) => getMeta(ct).symbol, spotOpts)
	} catch {
		spotsMap = new Map()
	}

	const openedAt = Math.floor(Date.now() / 1000)
	const out: OpenPosition[] = []
	const feeFetchOpts: Array<{
		pool_id: string
		position_id: string
		reward_coins: string[]
		coin_type_a: string
		coin_type_b: string
	}> = []

	for (const pos of rows) {
		try {
			let pool = poolCache.get(pos.pool_id)
			if (!pool) {
				pool = await sdk.Pool.getPool(pos.pool_id)
				poolCache.set(pos.pool_id, pool)
			}

			const metaA = getMeta(pos.coin_type_a)
			const metaB = getMeta(pos.coin_type_b)
			const decA = metaA.decimals
			const decB = metaB.decimals
			if (decA < 0 || decB < 0) continue

			const amounts = await sdk.Position.getPositionAmounts(pos, pool)
			const humA = safeHumanFromStringRaw(amounts.amount_a, decA)
			const humB = safeHumanFromStringRaw(amounts.amount_b, decB)

			const pxaF = spotPriceSafe(spotsMap.get(pos.coin_type_a)?.price)
			const pxbF = spotPriceSafe(spotsMap.get(pos.coin_type_b)?.price)
			const valueUsd = clampUsd((pxaF != null ? humA * pxaF : 0) + (pxbF != null ? humB * pxbF : 0))

			let feeFrac = feeCache.get(pos.pool_id)
			if (feeFrac == null) {
				try {
					const fr = await sdk.Pool.getTotalFeeRate({
						pool_id: pool.id,
						coin_type_a: pos.coin_type_a,
						coin_type_b: pos.coin_type_b,
					})
					feeFrac = feeFractionFromRaw(fr.total_fee_rate)
				} catch {
					feeFrac = feeFractionFromRaw(pool.base_fee_rate)
				}
				feeCache.set(pos.pool_id, feeFrac)
			}

			const priceLo = binPriceBPerA(pos.lower_bin_id, pool.bin_step, decA, decB)
			const priceHi = binPriceBPerA(pos.upper_bin_id, pool.bin_step, decA, decB)
			const priceCur = binPriceBPerA(pool.active_id, pool.bin_step, decA, decB)
			if (!(priceLo > 0) || !(priceHi > 0) || !(priceCur > 0)) continue

			const inRange = pool.active_id >= pos.lower_bin_id && pool.active_id <= pos.upper_bin_id
			const feeLabelPct = `${(feeFrac * 100).toFixed(3)}%`
			const pair = `${metaA.symbol}/${metaB.symbol} · DLMM · ${feeLabelPct}${inRange ? '' : ' · OUT'}`

			const rewardCoins = (pool.reward_manager?.rewards ?? [])
				.map((r) => r.reward_coin)
				.filter((c): c is string => typeof c === 'string' && c.length > 0)

			feeFetchOpts.push({
				pool_id: pool.id,
				position_id: pos.id,
				reward_coins: rewardCoins,
				coin_type_a: pos.coin_type_a,
				coin_type_b: pos.coin_type_b,
			})

			out.push({
				id: pos.id,
				protocol: 'cetus',
				poolId: pos.pool_id,
				pair,
				tokenA: metaA.symbol,
				tokenB: metaB.symbol,
				tokenAAddress: pos.coin_type_a,
				tokenBAddress: pos.coin_type_b,
				tokenAIconUrl: metaA.iconUrl,
				tokenBIconUrl: metaB.iconUrl,
				tokenADecimals: decA,
				tokenBDecimals: decB,
				fee: feeFrac,
				// Bins are not CLMM ticks — range bar uses priceRangeOverride.
				tickLower: pos.lower_bin_id,
				tickUpper: pos.upper_bin_id,
				currentTick: pool.active_id,
				currentSqrtPrice: '0',
				liquidity: pos.liquidity_shares?.[0] ?? '0',
				status: inRange ? 'in_range' : 'out_of_range',
				tokenAAmount: humA,
				tokenBAmount: humB,
				currentPriceA_USD: pxaF ?? 0,
				currentPriceB_USD: pxbF ?? 0,
				currentValueUSD: valueUsd,
				depositedUSD: 0,
				pnlUSD: 0,
				pnlPct: 0,
				unclaimedFeeA: 0,
				unclaimedFeeB: 0,
				unclaimedFeeUSD: 0,
				unclaimedRewardUSD: 0,
				openedAt,
				daysOpen: 0,
				lifetimeEarningsUSD: 0,
				vsHodlDeltaUSD: 0,
				aprEstimatePct: 0,
				priceCurrentOverride: priceCur,
				priceRangeOverride: {
					min: Math.min(priceLo, priceHi),
					max: Math.max(priceLo, priceHi),
					current: priceCur,
				},
				cetusDlmm: {
					lowerBinId: pos.lower_bin_id,
					upperBinId: pos.upper_bin_id,
					activeBinId: pool.active_id,
					binStep: pool.bin_step,
				},
			})
		} catch (e) {
			// eslint-disable-next-line no-console
			console.warn('[cetus-dlmm] position map failed', pos.id?.slice?.(0, 10), e)
		}
	}

	if (feeFetchOpts.length > 0) {
		try {
			const { feeData, rewardData } = await sdk.Position.fetchPositionFeeAndReward(feeFetchOpts)
			for (const p of out) {
				const fee = feeData[p.id]
				const rew = rewardData[p.id]
				const feeHumA = safeHumanFromStringRaw(fee?.fee_owned_a, p.tokenADecimals)
				const feeHumB = safeHumanFromStringRaw(fee?.fee_owned_b, p.tokenBDecimals)
				const pxaF = spotPriceSafe(spotsMap.get(p.tokenAAddress)?.price)
				const pxbF = spotPriceSafe(spotsMap.get(p.tokenBAddress)?.price)
				let feeUsd = 0
				if (pxaF != null) feeUsd += feeHumA * pxaF
				if (pxbF != null) feeUsd += feeHumB * pxbF
				p.unclaimedFeeA = feeHumA
				p.unclaimedFeeB = feeHumB
				p.unclaimedFeeUSD = clampUsd(feeUsd)

				const rows: BluefinUnclaimedTokenRow[] = []
				let rewUsd = 0
				for (const r of rew?.rewards ?? []) {
					const ct = r.coin_type
					const meta = getMeta(ct)
					const hum = safeHumanFromStringRaw(r.reward_owned, meta.decimals)
					const spot = spotsMap.get(ct)
					const px = spotPriceSafe(spot?.price)
					const amountUsd = px != null ? clampUsd(hum * px) : 0
					rewUsd += amountUsd
					rows.push({
						token: meta.symbol || symbolFromCoinType(ct),
						coinType: ct,
						amount: hum,
						amount_usd: amountUsd,
						price_source: px != null ? String(spot?.priceSource ?? 'spot') : 'unavailable',
					})
				}
				p.unclaimedRewardUSD = clampUsd(rewUsd)
				p.unclaimedRewardRows = rows
			}
		} catch (e) {
			// eslint-disable-next-line no-console
			console.warn('[cetus-dlmm] fetchPositionFeeAndReward failed', e)
		}
	}

	// Stablecoin as quote (tokenB) — invert bin prices when swapping A↔B.
	for (const p of out) {
		const aIsStable = STABLECOIN_SYMS.has(p.tokenA.toUpperCase())
		const bIsStable = STABLECOIN_SYMS.has(p.tokenB.toUpperCase())
		p.cetusOriginalDecimalsA = p.tokenADecimals
		p.cetusOriginalDecimalsB = p.tokenBDecimals
		if (!aIsStable || bIsStable) continue

		const a = {
			tokenA: p.tokenA,
			tokenB: p.tokenB,
			tokenAAddress: p.tokenAAddress,
			tokenBAddress: p.tokenBAddress,
			tokenAIconUrl: p.tokenAIconUrl,
			tokenBIconUrl: p.tokenBIconUrl,
			tokenADecimals: p.tokenADecimals,
			tokenBDecimals: p.tokenBDecimals,
			tokenAAmount: p.tokenAAmount,
			tokenBAmount: p.tokenBAmount,
			currentPriceA_USD: p.currentPriceA_USD,
			currentPriceB_USD: p.currentPriceB_USD,
			unclaimedFeeA: p.unclaimedFeeA,
			unclaimedFeeB: p.unclaimedFeeB,
			tickLower: p.tickLower,
			tickUpper: p.tickUpper,
			currentTick: p.currentTick,
		}

		p.tokenA = a.tokenB
		p.tokenB = a.tokenA
		p.tokenAAddress = a.tokenBAddress
		p.tokenBAddress = a.tokenAAddress
		p.tokenAIconUrl = a.tokenBIconUrl
		p.tokenBIconUrl = a.tokenAIconUrl
		p.tokenADecimals = a.tokenBDecimals
		p.tokenBDecimals = a.tokenADecimals
		p.tokenAAmount = a.tokenBAmount
		p.tokenBAmount = a.tokenAAmount
		p.currentPriceA_USD = a.currentPriceB_USD
		p.currentPriceB_USD = a.currentPriceA_USD
		p.unclaimedFeeA = a.unclaimedFeeB
		p.unclaimedFeeB = a.unclaimedFeeA
		p.tickLower = -a.tickUpper
		p.tickUpper = -a.tickLower
		p.currentTick = -a.currentTick
		p.cetusSwapped = true

		const ov = p.priceRangeOverride
		if (ov && ov.min > 0 && ov.max > 0 && ov.current > 0) {
			const invMin = 1 / ov.max
			const invMax = 1 / ov.min
			const invCur = 1 / ov.current
			p.priceRangeOverride = { min: invMin, max: invMax, current: invCur }
			p.priceCurrentOverride = invCur
		}

		const feeLabelPct = `${(p.fee * 100).toFixed(3)}%`
		p.pair = `${p.tokenA}/${p.tokenB} · DLMM · ${feeLabelPct}${p.status === 'in_range' ? '' : ' · OUT'}`
	}

	return out
}
