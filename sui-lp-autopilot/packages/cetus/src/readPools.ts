import type { DlmmPool, DlmmPosition, FeeRate } from '@cetusprotocol/dlmm-sdk'
import { BinUtils } from '@cetusprotocol/dlmm-sdk'
import { binPriceUsdcPerSui } from './binGuard.js'
import { isSui, isSuiUsdcPair, SUI_DECIMALS, USDC_DECIMALS, usdcPerSuiFromPairPrice } from './coins.js'
import { feeRateToPercent, unclaimedFeeAprPercent } from './feeRate.js'
import {
	composeDlmmMarketMetrics,
	dlmmRewardPriceMap,
	type DlmmRewarderMetric,
} from './dlmmMarketMetrics.js'
import { fetchVolume24hByPoolIds, tvlUsdFromBalances } from './poolMarketStats.js'
import { getDlmmSdk } from './sdk.js'

export type PoolSnapshot = {
	poolId: string
	coinTypeA: string
	coinTypeB: string
	binStep: number
	activeId: number
	/** USDC per 1 SUI at the active bin. Chain read, not a paper price. */
	priceUsdcPerSui: number
	baseFeeRate: string
	totalFeeRate: string | null
	varFeeRate: string | null
	/** Pool swap fee in percent. Separate from LP fees already earned. */
	swapFeePercent: number | null
	baseFeePercent: number | null
	varFeePercent: number | null
	balanceA: string
	balanceB: string
	/** USD TVL from on-chain balances × mark (SDK has no separate TVL field). */
	tvlUsd: number | null
	/**
	 * 24h volume USD from DexScreener pair feed.
	 * Cetus `stats_pools` / DLMM SDK do not expose DLMM volume.
	 */
	volume24hUsd: number | null
	/**
	 * Estimated 24h fees: volume × live swap fee %.
	 * Cetus has no public DLMM stats_pools equivalent.
	 */
	fees24hUsd: number | null
	/** Fee APR + reward emission APR (same composition as Cetus DLMM UI). */
	aprPercent: number | null
	rewarders: DlmmRewarderMetric[]
	/** Raw reward_manager from SDK — used when enriching metrics after volume fetch. */
	rewardManager: unknown
	source: 'cetus-dlmm-sdk'
	fetchedAtMs: number
}

export type PositionSnapshot = {
	positionId: string
	poolId: string
	lowerBinId: number
	upperBinId: number
	/** Inclusive USDC-per-SUI bounds (always lower ≤ upper after normalization). */
	lowerPriceUsdcPerSui: number
	upperPriceUsdcPerSui: number
	/** Active-bin mark in USDC per 1 SUI. */
	markPriceUsdcPerSui: number
	inRange: boolean
	amountA: string
	amountB: string
	amountSui: number
	amountUsdc: number
	activeBinId: number
	bins: PositionBin[]
	/** Unclaimed LP fees in USD (mark × SUI fee + USDC fee). Not the pool swap fee %. */
	feeUsdEstimate: number
	/** Unclaimed fee legs in human units when known from SDK fee quote. */
	feeSui: number | null
	feeUsdc: number | null
	/**
	 * Unclaimed-fee APR from the current fee balance and the age of the last position change.
	 * Null when that age is unknown. Collected fees are not included.
	 */
	unclaimedFeeAprPercent: number | null
	ageDays: number | null
	/** Object previousTransaction — shared for LPs from the same open PTB. */
	openTxDigest: string | null
	source: 'cetus-dlmm-sdk'
}

export type PositionBin = {
	binId: number
	priceUsdcPerSui: number
	amountSui: number
	amountUsdc: number
	active: boolean
	/** Cetus one-sided remove ignores the active bin. */
	oneSidedRemovable: boolean
}

function pageData<T>(page: { data?: T[] } | T[]): T[] {
	if (Array.isArray(page)) return page
	return page.data ?? []
}

export async function listSuiUsdcPools(maxPages = 4): Promise<PoolSnapshot[]> {
	const sdk = getDlmmSdk()
	const found: DlmmPool[] = []
	let cursor: string | null | undefined = null
	for (let i = 0; i < maxPages; i++) {
		const page = await sdk.Pool.getPools(cursor ? { cursor, limit: 50 } : { limit: 50 })
		const rows = pageData(page as { data?: DlmmPool[] })
		found.push(...rows)
		const next = (page as { next_cursor?: string | null; has_next_page?: boolean }).next_cursor
		const has = (page as { has_next_page?: boolean }).has_next_page
		if (!has || !next) break
		cursor = next
	}
	const suiUsdc = found.filter((p) => isSuiUsdcPair(p.coin_type_a, p.coin_type_b))
	const snaps = await Promise.all(suiUsdc.slice(0, 12).map((p) => snapshotFromPool(p)))
	const volumes = await fetchVolume24hByPoolIds(snaps.map((s) => s.poolId))
	const markSui =
		snaps.find((s) => Number.isFinite(s.priceUsdcPerSui) && s.priceUsdcPerSui > 0)?.priceUsdcPerSui ??
		null
	const prices = await dlmmRewardPriceMap(markSui)
	for (const s of snaps) {
		s.volume24hUsd = volumes.get(s.poolId) ?? null
		applyDlmmMarketMetrics(s, prices)
	}
	snaps.sort((a, b) => {
		const ta = a.tvlUsd ?? -1
		const tb = b.tvlUsd ?? -1
		if (tb !== ta) return tb - ta
		try {
			const d = BigInt(b.balanceA) + BigInt(b.balanceB) - (BigInt(a.balanceA) + BigInt(a.balanceB))
			return d > 0n ? 1 : d < 0n ? -1 : 0
		} catch {
			return 0
		}
	})
	return snaps
}

function rawToHuman(raw: string, decimals: number): number {
	if (!/^\d+$/.test(raw)) return NaN
	const padded = raw.padStart(decimals + 1, '0')
	const whole = padded.slice(0, padded.length - decimals)
	const frac = padded.slice(padded.length - decimals)
	return Number(`${whole}.${frac}`)
}

function normObjId(id: string): string {
	return id.trim().toLowerCase().replace(/^0x/, '')
}

function pickPositionFee(
	feeData: Record<string, { position_id: string; fee_owned_a: string; fee_owned_b: string }>,
	positionId: string,
): { fee_owned_a: string; fee_owned_b: string } | null {
	const direct = feeData[positionId]
	if (direct) return direct
	const want = normObjId(positionId)
	for (const [key, fee] of Object.entries(feeData)) {
		if (normObjId(key) === want || normObjId(fee.position_id) === want) return fee
	}
	return null
}

export async function readPool(poolId: string): Promise<PoolSnapshot> {
	const sdk = getDlmmSdk()
	const pool = await sdk.Pool.getPool(poolId)
	if (!isSuiUsdcPair(pool.coin_type_a, pool.coin_type_b)) {
		throw new Error(`pool ${poolId} is not a SUI/USDC DLMM pair`)
	}
	const snap = await snapshotFromPool(pool)
	const volumes = await fetchVolume24hByPoolIds([snap.poolId])
	snap.volume24hUsd = volumes.get(snap.poolId) ?? null
	const prices = await dlmmRewardPriceMap(
		Number.isFinite(snap.priceUsdcPerSui) && snap.priceUsdcPerSui > 0
			? snap.priceUsdcPerSui
			: null,
	)
	applyDlmmMarketMetrics(snap, prices)
	return snap
}

function applyDlmmMarketMetrics(snap: PoolSnapshot, prices: Map<string, number>): void {
	const m = composeDlmmMarketMetrics({
		volume24hUsd: snap.volume24hUsd,
		feePercent: snap.swapFeePercent ?? snap.baseFeePercent,
		tvlUsd: snap.tvlUsd,
		rewardManager: snap.rewardManager as
			| {
					rewards?: Array<{ reward_coin?: string; emissions_per_day?: string | number }>
					emergency_reward_pause?: boolean
			  }
			| null
			| undefined,
		priceUsdByCoinType: prices,
	})
	snap.fees24hUsd = m.fees24hUsd
	snap.aprPercent = m.aprPercent
	snap.rewarders = m.rewarders
}

async function snapshotFromPool(pool: DlmmPool): Promise<PoolSnapshot> {
	const sdk = getDlmmSdk()
	const decimalsA = isSui(pool.coin_type_a) ? SUI_DECIMALS : USDC_DECIMALS
	const decimalsB = isSui(pool.coin_type_a) ? USDC_DECIMALS : SUI_DECIMALS
	const pair = Number(
		BinUtils.getPriceFromBinId(pool.active_id, pool.bin_step, decimalsA, decimalsB),
	)
	let fee: FeeRate | null = null
	try {
		fee = await sdk.Pool.getTotalFeeRate({
			pool_id: pool.id,
			coin_type_a: pool.coin_type_a,
			coin_type_b: pool.coin_type_b,
		})
	} catch {
		fee = null
	}
	const priceUsdcPerSui = usdcPerSuiFromPairPrice(pair, pool.coin_type_a)
	return {
		poolId: pool.id,
		coinTypeA: pool.coin_type_a,
		coinTypeB: pool.coin_type_b,
		binStep: pool.bin_step,
		activeId: pool.active_id,
		priceUsdcPerSui,
		baseFeeRate: pool.base_fee_rate,
		totalFeeRate: fee ? String(fee.total_fee_rate) : null,
		varFeeRate: fee ? String(fee.var_fee_rate) : null,
		swapFeePercent: feeRateToPercent(fee ? String(fee.total_fee_rate) : pool.base_fee_rate),
		baseFeePercent: feeRateToPercent(pool.base_fee_rate),
		varFeePercent: fee ? feeRateToPercent(String(fee.var_fee_rate)) : null,
		balanceA: pool.balance_a,
		balanceB: pool.balance_b,
		tvlUsd: tvlUsdFromBalances({
			coinTypeA: pool.coin_type_a,
			balanceA: pool.balance_a,
			balanceB: pool.balance_b,
			priceUsdcPerSui,
		}),
		volume24hUsd: null,
		fees24hUsd: null,
		aprPercent: null,
		rewarders: [],
		rewardManager: (pool as { reward_manager?: unknown }).reward_manager ?? null,
		source: 'cetus-dlmm-sdk',
		fetchedAtMs: Date.now(),
	}
}

const dlmmDigestTsCache = new Map<string, number>()

async function readDlmmOpenDigests(positionIds: string[]): Promise<Map<string, string | null>> {
	const client = getDlmmSdk().FullClient
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

async function ageDaysForDlmmDigests(digests: string[]): Promise<Map<string, number | null>> {
	const client = getDlmmSdk().FullClient
	const unique = [...new Set(digests.filter(Boolean))]
	const out = new Map<string, number | null>()
	await Promise.all(
		unique.map(async (digest) => {
			const cached = dlmmDigestTsCache.get(digest)
			if (cached != null) {
				const days = (Date.now() - cached) / 86_400_000
				out.set(digest, days > 0 ? days : null)
				return
			}
			try {
				const tx = await client.getTransaction({ digest })
				const ts = tx.$kind === 'Transaction' ? tx.Transaction.timestampMs : null
				if (ts && ts > 0) {
					dlmmDigestTsCache.set(digest, ts)
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

export async function listOwnerPositions(owner: string): Promise<PositionSnapshot[]> {
	const sdk = getDlmmSdk()
	// Fee simulate uses getSenderAddress() — must be the position owner.
	sdk.setSenderAddress(owner)
	const rows = (await sdk.Position.getOwnerPositionList(owner)).filter((pos) =>
		isSuiUsdcPair(pos.coin_type_a, pos.coin_type_b),
	)
	if (rows.length === 0) return []

	const poolIds = [...new Set(rows.map((p) => p.pool_id))]
	const poolEntries = await Promise.all(
		poolIds.map(async (id) => {
			try {
				return [id, await sdk.Pool.getPool(id)] as const
			} catch {
				return [id, null] as const
			}
		}),
	)
	const poolById = new Map(poolEntries.filter(([, p]) => p != null) as [string, DlmmPool][])

	const amountEntries = await Promise.all(
		rows.map(async (pos) => {
			const pool = poolById.get(pos.pool_id)
			if (!pool) return [pos.id, null] as const
			try {
				return [pos.id, await sdk.Position.getPositionAmounts(pos, pool)] as const
			} catch {
				return [pos.id, null] as const
			}
		}),
	)
	const amountsById = new Map(amountEntries)

	const digestsByPos = await readDlmmOpenDigests(rows.map((p) => p.id))
	const ageByDigest = await ageDaysForDlmmDigests(
		[...digestsByPos.values()].filter((d): d is string => typeof d === 'string'),
	)

	/** One simulate for all positions (was N× and hung the dashboard). */
	let feeByPos = new Map<string, { feeUsd: number; feeSui: number; feeUsdc: number }>()
	try {
		const options = rows
			.map((pos) => {
				const pool = poolById.get(pos.pool_id)
				if (!pool) return null
				return {
					pool_id: pool.id,
					position_id: pos.id,
					coin_type_a: pool.coin_type_a,
					coin_type_b: pool.coin_type_b,
					reward_coins: pool.reward_manager.rewards.map((r) => r.reward_coin),
				}
			})
			.filter((o): o is NonNullable<typeof o> => o != null)
		if (options.length > 0) {
			const pack = await sdk.Position.fetchPositionFeeAndReward(options)
			for (const pos of rows) {
				const pool = poolById.get(pos.pool_id)
				if (!pool) continue
				const fee = pickPositionFee(pack.feeData, pos.id)
				if (!fee) continue
				const mark = usdcPerSuiFromPairPrice(
					Number(
						BinUtils.getPriceFromBinId(
							pool.active_id,
							pool.bin_step,
							isSui(pool.coin_type_a) ? SUI_DECIMALS : USDC_DECIMALS,
							isSui(pool.coin_type_a) ? USDC_DECIMALS : SUI_DECIMALS,
						),
					),
					pos.coin_type_a,
				)
				const feeSui = rawToHuman(
					isSui(pool.coin_type_a) ? fee.fee_owned_a : fee.fee_owned_b,
					SUI_DECIMALS,
				)
				const feeUsdc = rawToHuman(
					isSui(pool.coin_type_a) ? fee.fee_owned_b : fee.fee_owned_a,
					USDC_DECIMALS,
				)
				if (Number.isFinite(feeSui) && Number.isFinite(feeUsdc) && Number.isFinite(mark)) {
					feeByPos.set(pos.id, {
						feeUsd: feeSui * mark + feeUsdc,
						feeSui,
						feeUsdc,
					})
				}
			}
		}
	} catch {
		feeByPos = new Map()
	}

	const out: PositionSnapshot[] = []
	for (const pos of rows) {
		const pool = poolById.get(pos.pool_id)
		const amounts = amountsById.get(pos.id)
		if (!pool || !amounts) continue
		const decimalsA = isSui(pos.coin_type_a) ? SUI_DECIMALS : USDC_DECIMALS
		const decimalsB = isSui(pos.coin_type_a) ? USDC_DECIMALS : SUI_DECIMALS
		const loPair = Number(BinUtils.getPriceFromBinId(pos.lower_bin_id, pool.bin_step, decimalsA, decimalsB))
		const hiPair = Number(BinUtils.getPriceFromBinId(pos.upper_bin_id, pool.bin_step, decimalsA, decimalsB))
		const loMark = usdcPerSuiFromPairPrice(loPair, pos.coin_type_a)
		const hiMark = usdcPerSuiFromPairPrice(hiPair, pos.coin_type_a)
		const mark = usdcPerSuiFromPairPrice(
			Number(BinUtils.getPriceFromBinId(pool.active_id, pool.bin_step, decimalsA, decimalsB)),
			pos.coin_type_a,
		)
		const amountSui = rawToHuman(isSui(pos.coin_type_a) ? amounts.amount_a : amounts.amount_b, SUI_DECIMALS)
		const amountUsdc = rawToHuman(isSui(pos.coin_type_a) ? amounts.amount_b : amounts.amount_a, USDC_DECIMALS)
		const principalUsd = amountSui * mark + amountUsdc
		const fee = feeByPos.get(pos.id)
		const feeUsd = fee?.feeUsd ?? 0
		const openTxDigest = digestsByPos.get(pos.id) ?? null
		const ageDays = openTxDigest ? (ageByDigest.get(openTxDigest) ?? null) : null
		const bins = amounts.bins.map((b) => ({
			binId: b.bin_id,
			priceUsdcPerSui: binPriceUsdcPerSui(b.bin_id, pool.bin_step, pos.coin_type_a),
			amountSui: rawToHuman(isSui(pos.coin_type_a) ? b.amount_a : b.amount_b, SUI_DECIMALS),
			amountUsdc: rawToHuman(isSui(pos.coin_type_a) ? b.amount_b : b.amount_a, USDC_DECIMALS),
			active: b.bin_id === pool.active_id,
			oneSidedRemovable: b.bin_id !== pool.active_id,
		}))
		out.push({
			positionId: pos.id,
			poolId: pos.pool_id,
			lowerBinId: pos.lower_bin_id,
			upperBinId: pos.upper_bin_id,
			lowerPriceUsdcPerSui: Math.min(loMark, hiMark),
			upperPriceUsdcPerSui: Math.max(loMark, hiMark),
			markPriceUsdcPerSui: mark,
			inRange: pool.active_id >= pos.lower_bin_id && pool.active_id <= pos.upper_bin_id,
			amountA: amounts.amount_a,
			amountB: amounts.amount_b,
			amountSui,
			amountUsdc,
			activeBinId: pool.active_id,
			bins,
			feeUsdEstimate: feeUsd,
			feeSui: fee?.feeSui ?? null,
			feeUsdc: fee?.feeUsdc ?? null,
			unclaimedFeeAprPercent:
				ageDays === null ? null : unclaimedFeeAprPercent(feeUsd, principalUsd, ageDays),
			ageDays,
			openTxDigest,
			source: 'cetus-dlmm-sdk',
		})
	}
	return out
}

export type { DlmmPool, DlmmPosition }
