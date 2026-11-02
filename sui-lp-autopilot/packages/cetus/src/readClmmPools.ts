import BN from 'bn.js'
import { ClmmPoolUtil, TickMath } from '@cetusprotocol/common-sdk'
import type { Pool as ClmmPool, Position as ClmmPosition } from '@cetusprotocol/sui-clmm-sdk'
import {
	isSui,
	isSuiUsdcPair,
	SUI_COIN_TYPE,
	SUI_DECIMALS,
	USDC_COIN_TYPE,
	USDC_DECIMALS,
} from './coins.js'
import { fetchClmmStatsByPoolIds, listSuiUsdcClmmStatsRows } from './clmmStats.js'
import { unclaimedFeeAprPercent } from './feeRate.js'
import { positionKey, type PoolView, type PositionView } from './provider/types.js'
import { getClmmSdk } from './sdkClmm.js'

/**
 * CLMM `fee_rate` numerator / 1_000_000 → percent.
 * SDK returns string (e.g. `"2500"` → 0.25%). Docs / FEE_RATE_DENOMINATOR in common-sdk.
 */
export function clmmFeeRateToPercent(feeRate: number | string | null | undefined): number | null {
	if (feeRate == null) return null
	const n = typeof feeRate === 'number' ? feeRate : Number(feeRate)
	if (!(n >= 0) || !Number.isFinite(n)) return null
	return (n / 1_000_000) * 100
}

/** Pair price (coin B per coin A, decimals-adjusted) → USDC per 1 SUI. */
export function usdcPerSuiFromClmmSqrt(
	sqrtPriceX64: string | number,
	coinTypeA: string,
): number {
	const bn = new BN(String(sqrtPriceX64))
	const decimalsA = isSui(coinTypeA) ? SUI_DECIMALS : USDC_DECIMALS
	const decimalsB = isSui(coinTypeA) ? USDC_DECIMALS : SUI_DECIMALS
	const pair = Number(TickMath.sqrtPriceX64ToPrice(bn, decimalsA, decimalsB).toString())
	if (!(pair > 0) || !Number.isFinite(pair)) return NaN
	return isSui(coinTypeA) ? pair : 1 / pair
}

export function tickToUsdcPerSui(tickIndex: number, coinTypeA: string): number {
	const sqrt = TickMath.tickIndexToSqrtPriceX64(tickIndex)
	return usdcPerSuiFromClmmSqrt(sqrt.toString(), coinTypeA)
}

/** SDK may return raw amounts as string or number — keep integer string. */
export function rawBalanceString(raw: string | number | null | undefined): string {
	if (raw == null) return '0'
	if (typeof raw === 'string') {
		const t = raw.trim()
		if (/^\d+$/.test(t)) return t
		const n = Number(t)
		if (!Number.isFinite(n) || n < 0) return '0'
		return Math.floor(n).toString()
	}
	if (!Number.isFinite(raw) || raw < 0) return '0'
	return Math.floor(raw).toString()
}

async function toPoolView(pool: ClmmPool): Promise<PoolView> {
	const priceUsdcPerSui = usdcPerSuiFromClmmSqrt(pool.current_sqrt_price, pool.coin_type_a)
	const feePercent = clmmFeeRateToPercent(pool.fee_rate)
	return {
		protocol: 'clmm',
		poolId: pool.id,
		coinTypeA: pool.coin_type_a,
		coinTypeB: pool.coin_type_b,
		priceUsdcPerSui,
		tickSpacing: Number(pool.tick_spacing),
		currentTickIndex: pool.current_tick_index,
		binStep: null,
		activeId: null,
		feePercent,
		swapFeePercent: feePercent,
		tvlUsd: null,
		volume24hUsd: null,
		volume7dUsd: null,
		fees24hUsd: null,
		aprPercent: null,
		rewarders: [],
		balanceA: rawBalanceString(pool.coin_amount_a),
		balanceB: rawBalanceString(pool.coin_amount_b),
		source: 'cetus-clmm-sdk',
		fetchedAtMs: Date.now(),
	}
}

/**
 * Native USDC/SUI CLMM tick spacings observed on mainnet via `getPoolAddress`.
 * Broader than the old [2,10,20,60,200] set — Cetus UI lists every fee tier.
 */
const SUI_USDC_TICK_SPACINGS = [
	1, 2, 4, 5, 8, 10, 16, 20, 30, 40, 50, 60, 80, 100, 120, 140, 160, 180, 200, 220, 250, 300, 400, 500,
] as const

function applyClmmStats(
	view: PoolView,
	s: {
		tvlUsd: number | null
		volume24hUsd: number | null
		volume7dUsd: number | null
		fees24hUsd: number | null
		aprPercent: number | null
		rewarders?: PoolView['rewarders']
	},
): void {
	if (s.tvlUsd != null) view.tvlUsd = s.tvlUsd
	if (s.volume24hUsd != null) view.volume24hUsd = s.volume24hUsd
	if (s.volume7dUsd != null) view.volume7dUsd = s.volume7dUsd
	if (s.fees24hUsd != null) view.fees24hUsd = s.fees24hUsd
	if (s.aprPercent != null) view.aprPercent = s.aprPercent
	if (s.rewarders && s.rewarders.length > 0) view.rewarders = s.rewarders
}

/** TVL from on-chain balances × mark when Cetus stats omit the pool (dust fee tiers). */
export function tvlUsdFromClmmBalances(view: PoolView): number | null {
	try {
		const a = BigInt(view.balanceA || '0')
		const b = BigInt(view.balanceB || '0')
		if (a === 0n && b === 0n) return null
		const aIsSui = isSui(view.coinTypeA)
		const suiRaw = aIsSui ? a : b
		const usdcRaw = aIsSui ? b : a
		const sui = Number(suiRaw) / 10 ** SUI_DECIMALS
		const usdc = Number(usdcRaw) / 10 ** USDC_DECIMALS
		const px = view.priceUsdcPerSui
		if (!(px > 0) || !Number.isFinite(sui) || !Number.isFinite(usdc)) return null
		const tvl = sui * px + usdc
		return Number.isFinite(tvl) && tvl > 0 ? tvl : null
	} catch {
		return null
	}
}

/**
 * Discover native SUI/USDC CLMM pools via `getPoolAddress` across known tick spacings,
 * merge Cetus `stats_pools` IDs, hydrate via SDK. Fees/APR only when stats has the pool.
 */
export async function listClmmSuiUsdcPools(_maxPages = 4): Promise<PoolView[]> {
	const sdk = getClmmSdk()
	const ids = new Set<string>()
	try {
		const fromStats = await listSuiUsdcClmmStatsRows()
		for (const row of fromStats) ids.add(row.poolId)
	} catch {
		/* stats optional */
	}
	for (const spacing of SUI_USDC_TICK_SPACINGS) {
		try {
			const id = await sdk.Pool.getPoolAddress(USDC_COIN_TYPE, SUI_COIN_TYPE, spacing)
			if (id) ids.add(id)
		} catch {
			/* spacing may not exist */
		}
	}
	const unique = [...ids]
	if (unique.length === 0) return []
	const pools =
		typeof sdk.Pool.getAssignPools === 'function'
			? await sdk.Pool.getAssignPools(unique)
			: await Promise.all(unique.map((id) => sdk.Pool.getPool(id)))
	const suiUsdc = pools.filter((p) => isSuiUsdcPair(p.coin_type_a, p.coin_type_b))
	const views = await Promise.all(suiUsdc.map((p) => toPoolView(p)))
	const stats = await fetchClmmStatsByPoolIds(views.map((v) => v.poolId))
	for (const v of views) {
		const s = stats.get(v.poolId)
		if (s) applyClmmStats(v, s)
		if (v.tvlUsd == null) v.tvlUsd = tvlUsdFromClmmBalances(v)
	}
	views.sort((a, b) => (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1))
	return views
}

export async function readClmmPool(poolId: string): Promise<PoolView> {
	const sdk = getClmmSdk()
	const pool = await sdk.Pool.getPool(poolId)
	if (!isSuiUsdcPair(pool.coin_type_a, pool.coin_type_b)) {
		throw new Error(`pool ${poolId} is not a SUI/USDC CLMM pair`)
	}
	const view = await toPoolView(pool)
	const stats = await fetchClmmStatsByPoolIds([view.poolId])
	const s = stats.get(view.poolId)
	if (s) {
		applyClmmStats(view, s)
	}
	if (view.tvlUsd == null) view.tvlUsd = tvlUsdFromClmmBalances(view)
	return view
}

function amountsFromLiquidity(args: {
	liquidity: string
	tickLower: number
	tickUpper: number
	currentSqrt: string | number
	coinTypeA: string
}): { amountSui: number; amountUsdc: number; amountA: string; amountB: string } {
	try {
		const liq = new BN(args.liquidity)
		if (liq.isZero()) {
			return { amountSui: 0, amountUsdc: 0, amountA: '0', amountB: '0' }
		}
		const lower = TickMath.tickIndexToSqrtPriceX64(args.tickLower)
		const upper = TickMath.tickIndexToSqrtPriceX64(args.tickUpper)
		const cur = new BN(String(args.currentSqrt))
		const amounts = ClmmPoolUtil.getCoinAmountFromLiquidity(liq, cur, lower, upper, false)
		const a = amounts.coin_amount_a.toString()
		const b = amounts.coin_amount_b.toString()
		const aIsSui = isSui(args.coinTypeA)
		const suiRaw = aIsSui ? a : b
		const usdcRaw = aIsSui ? b : a
		return {
			amountA: a,
			amountB: b,
			amountSui: Number(suiRaw) / 10 ** SUI_DECIMALS,
			amountUsdc: Number(usdcRaw) / 10 ** USDC_DECIMALS,
		}
	} catch {
		return { amountSui: 0, amountUsdc: 0, amountA: '0', amountB: '0' }
	}
}

/** Digest → timestampMs. Avoids N× getTransaction on every portfolio refresh. */
const clmmDigestTsCache = new Map<string, number>()

async function readOpenDigests(positionIds: string[]): Promise<Map<string, string | null>> {
	const client = getClmmSdk().FullClient
	const out = new Map<string, string | null>()
	await Promise.all(
		positionIds.map(async (id) => {
			try {
				const obj = await client.getObject({ objectId: id, include: { previousTransaction: true } })
				const digest = obj.object.previousTransaction
				out.set(id, typeof digest === 'string' && digest ? digest : null)
			} catch {
				out.set(id, null)
			}
		}),
	)
	return out
}

async function ageDaysForDigests(digests: string[]): Promise<Map<string, number | null>> {
	const client = getClmmSdk().FullClient
	const unique = [...new Set(digests.filter(Boolean))]
	const out = new Map<string, number | null>()
	await Promise.all(
		unique.map(async (digest) => {
			const cached = clmmDigestTsCache.get(digest)
			if (cached != null) {
				const days = (Date.now() - cached) / 86_400_000
				out.set(digest, days > 0 ? days : null)
				return
			}
			try {
				const tx = await client.getTransaction({ digest })
				const ts = tx.$kind === 'Transaction' ? tx.Transaction.timestampMs : null
				if (ts && ts > 0) {
					clmmDigestTsCache.set(digest, ts)
					const days = (Date.now() - ts) / 86_400_000
					out.set(digest, days > 0 ? days : null)
				} else {
					out.set(digest, null)
				}
			} catch {
				out.set(digest, null)
			}
		}),
	)
	return out
}

function feeLegsFromRaw(args: {
	feeOwnedA: string
	feeOwnedB: string
	coinTypeA: string
	markUsdcPerSui: number
}): { feeSui: number; feeUsdc: number; feeUsd: number } {
	const feeA =
		Number(args.feeOwnedA) / 10 ** (isSui(args.coinTypeA) ? SUI_DECIMALS : USDC_DECIMALS)
	const feeB =
		Number(args.feeOwnedB) / 10 ** (isSui(args.coinTypeA) ? USDC_DECIMALS : SUI_DECIMALS)
	const feeSui = isSui(args.coinTypeA) ? feeA : feeB
	const feeUsdc = isSui(args.coinTypeA) ? feeB : feeA
	if (!(Number.isFinite(feeSui) && Number.isFinite(feeUsdc) && Number.isFinite(args.markUsdcPerSui))) {
		return { feeSui: 0, feeUsdc: 0, feeUsd: 0 }
	}
	return {
		feeSui,
		feeUsdc,
		feeUsd: feeSui * args.markUsdcPerSui + feeUsdc,
	}
}

/**
 * Live claimable swap fees (Cetus UI "Claimable Yield" fees part).
 * `Position.fee_owned_*` from getPositionList is often stale/zero until recalculated —
 * official path is Position.fetchPosFeeAmount / batchFetchPositionFees (simulate).
 * @see https://cetus-1.gitbook.io/cetus-developer-docs/developer/via-sdk-v2/sdk-modules/cetusprotocol-sui-clmm-sdk/gets-positions
 */
export async function listClmmOwnerPositions(owner: string): Promise<PositionView[]> {
	const sdk = getClmmSdk()
	const positions = ((await sdk.Position.getPositionList(owner, [], false)) as ClmmPosition[]).filter(
		(pos) => isSuiUsdcPair(pos.coin_type_a, pos.coin_type_b) && !!pos.liquidity && pos.liquidity !== '0',
	)
	if (positions.length === 0) return []

	const poolIds = [...new Set(positions.map((p) => p.pool))]
	const pools = await Promise.all(
		poolIds.map(async (id) => {
			try {
				return [id, await sdk.Pool.getPool(id)] as const
			} catch {
				return [id, null] as const
			}
		}),
	)
	const poolById = new Map(pools.filter(([, p]) => p != null) as [string, ClmmPool][])

	const digestsByPos = await readOpenDigests(positions.map((p) => p.pos_object_id))
	const ageByDigest = await ageDaysForDigests(
		[...digestsByPos.values()].filter((d): d is string => typeof d === 'string'),
	)

	type Draft = {
		view: PositionView
		coinTypeA: string
		mark: number
		fallbackFeeA: string
		fallbackFeeB: string
		principalUsd: number
		ageDays: number | null
	}
	const drafts: Draft[] = []
	const feeParams: {
		pool_id: string
		position_id: string
		coin_type_a: string
		coin_type_b: string
	}[] = []

	for (const pos of positions) {
		const pool = poolById.get(pos.pool)
		if (!pool) continue
		const mark = usdcPerSuiFromClmmSqrt(pool.current_sqrt_price, pos.coin_type_a)
		const lo = tickToUsdcPerSui(pos.tick_lower_index, pos.coin_type_a)
		const hi = tickToUsdcPerSui(pos.tick_upper_index, pos.coin_type_a)
		const amounts = amountsFromLiquidity({
			liquidity: pos.liquidity,
			tickLower: pos.tick_lower_index,
			tickUpper: pos.tick_upper_index,
			currentSqrt: pool.current_sqrt_price,
			coinTypeA: pos.coin_type_a,
		})
		const openTxDigest = digestsByPos.get(pos.pos_object_id) ?? null
		const ageDays = openTxDigest ? (ageByDigest.get(openTxDigest) ?? null) : null
		const fallbackFeeA = String(pos.fee_owned_a ?? '0')
		const fallbackFeeB = String(pos.fee_owned_b ?? '0')
		const principalUsd = amounts.amountSui * mark + amounts.amountUsdc
		feeParams.push({
			pool_id: pool.id,
			position_id: pos.pos_object_id,
			coin_type_a: pool.coin_type_a,
			coin_type_b: pool.coin_type_b,
		})
		drafts.push({
			coinTypeA: pos.coin_type_a,
			mark,
			fallbackFeeA,
			fallbackFeeB,
			principalUsd,
			ageDays,
			view: {
				protocol: 'clmm',
				positionId: pos.pos_object_id,
				poolId: pos.pool,
				key: positionKey('clmm', pos.pool, pos.pos_object_id),
				lowerPriceUsdcPerSui: Math.min(lo, hi),
				upperPriceUsdcPerSui: Math.max(lo, hi),
				markPriceUsdcPerSui: mark,
				inRange:
					pool.current_tick_index >= pos.tick_lower_index &&
					pool.current_tick_index < pos.tick_upper_index,
				amountSui: amounts.amountSui,
				amountUsdc: amounts.amountUsdc,
				...(() => {
					const legs = feeLegsFromRaw({
						feeOwnedA: fallbackFeeA,
						feeOwnedB: fallbackFeeB,
						coinTypeA: pos.coin_type_a,
						markUsdcPerSui: mark,
					})
					return {
						feeUsdEstimate: legs.feeUsd,
						feeSui: legs.feeSui,
						feeUsdc: legs.feeUsdc,
					}
				})(),
				unclaimedFeeAprPercent: null,
				ageDays,
				tickLower: pos.tick_lower_index,
				tickUpper: pos.tick_upper_index,
				lowerBinId: null,
				upperBinId: null,
				openTxDigest,
				source: 'cetus-clmm-sdk',
				liquidityRaw: String(pos.liquidity ?? '0'),
				fetchedAtMs: Date.now(),
			},
		})
	}

	if (feeParams.length > 0) {
		try {
			const quotes = await sdk.Position.fetchPosFeeAmount(feeParams)
			const byId = new Map(quotes.map((q) => [q.position_id, q]))
			for (const d of drafts) {
				const q = byId.get(d.view.positionId)
				if (!q) continue
				const legs = feeLegsFromRaw({
					feeOwnedA: String(q.fee_owned_a ?? d.fallbackFeeA),
					feeOwnedB: String(q.fee_owned_b ?? d.fallbackFeeB),
					coinTypeA: d.coinTypeA,
					markUsdcPerSui: d.mark,
				})
				d.view.feeUsdEstimate = legs.feeUsd
				d.view.feeSui = legs.feeSui
				d.view.feeUsdc = legs.feeUsdc
			}
		} catch {
			// Keep stale fee_owned_* fallbacks if simulate fee fetch fails.
		}
	}

	for (const d of drafts) {
		d.view.unclaimedFeeAprPercent =
			d.ageDays == null
				? null
				: unclaimedFeeAprPercent(d.view.feeUsdEstimate, d.principalUsd, d.ageDays)
	}

	return drafts.map((d) => d.view)
}
