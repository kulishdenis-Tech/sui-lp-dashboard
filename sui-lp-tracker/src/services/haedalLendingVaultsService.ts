/**
 * Haedal Lending Vault positions (single-asset SUI / USDC / … receipt LPT).
 *
 * Official UI: https://haedal.xyz/lending
 * Share value = user shares × VaultPool.last_total_assets / share treasury supply.
 * Incentives sit in `farming::Pool` (`source_addr` = vault). Pending uses acc-per-share × 1e12.
 */
import Decimal from 'decimal.js'
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import type { OpenPosition } from '@/types'
import { suiClient } from '@/services/suiClient'
import { asRpcObjectClient, multiGetObjectsHydrated } from '@/services/objectVersionCache'
import { resolveSpots, type ResolveSpotsOptions } from '@/services/spotPrice/resolveSpots'
import { withRpcBackoff } from '@/utils/rpcBackoff'
import { vaultFarmRewardAprPct, vaultLpSharePct } from '@/utils/cetusVault'
import {
	lendingStakeShareType,
	normalizeTypeName,
	pendingLendingFarmRewardRaw,
	splitMoveTypeArgs,
} from '@/utils/haedalLendingVault'

const MAX_SANE_POSITION_USD = 50_000_000
const MAX_SANE_HUMAN = 1e18

export type HaedalLendingVaultOptions = { forceRefreshPrices?: boolean }

type CoinMeta = { symbol: string; decimals: number; iconUrl: string | null }

type RewardCfg = {
	coinType: string
	accPerShare: bigint
	rewardPerSecond: bigint
	lastUpdateSec: bigint
	startSec: bigint
	endSec: bigint
}

type FarmPool = {
	id: string
	vaultId: string
	shareType: string
	tableId: string
	totalShares: bigint
	paused: boolean
	rewards: RewardCfg[]
}

function unwrap(val: unknown): Record<string, unknown> | null {
	if (!val || typeof val !== 'object') return null
	const o = val as Record<string, unknown>
	if (o.fields && typeof o.fields === 'object') return o.fields as Record<string, unknown>
	return o
}

function asStr(val: unknown): string {
	if (typeof val === 'string') return val
	if (typeof val === 'number' && Number.isFinite(val)) return String(val)
	if (typeof val === 'bigint') return val.toString()
	return '0'
}

function asBig(val: unknown): bigint {
	try {
		const s = asStr(val)
		if (!/^\d+$/.test(s)) return 0n
		return BigInt(s)
	} catch {
		return 0n
	}
}

function clampUsd(v: number): number {
	if (!Number.isFinite(v) || v < 0) return 0
	return v <= MAX_SANE_POSITION_USD ? v : 0
}

function humanFromRaw(raw: bigint, decimals: number): number {
	if (decimals < 0 || !Number.isFinite(decimals)) return 0
	try {
		const n = new Decimal(raw.toString()).div(new Decimal(10).pow(decimals)).toNumber()
		if (!Number.isFinite(n) || n < 0 || n > MAX_SANE_HUMAN) return 0
		return n
	} catch {
		return 0
	}
}

function symbolFromCoinType(ct: string): string {
	const parts = ct.split('::')
	return parts[2] ?? parts[1] ?? '—'
}

function normCoin(ct: string): string {
	try {
		return normalizeStructTag(ct.startsWith('0x') ? ct : `0x${ct}`)
	} catch {
		return ct
	}
}

async function listStakeInfos(owner: string): Promise<{ objectId: string; shareType: string; poolId: string }[]> {
	const out: { objectId: string; shareType: string; poolId: string }[] = []
	let cursor: string | null | undefined
	for (let page = 0; page < 20; page++) {
		const res = await withRpcBackoff(
			() =>
				suiClient.getOwnedObjects({
					owner,
					cursor: cursor ?? undefined,
					limit: 50,
					options: { showType: true, showContent: true },
				}),
			{ label: 'haedal-lending-owned', retries: 3, baseMs: 600 },
		)
		for (const item of res.data ?? []) {
			const type = item.data?.type ?? ''
			const shareType = lendingStakeShareType(type)
			if (!shareType) continue
			const fields = unwrap((item.data?.content as { fields?: unknown } | undefined)?.fields)
			const poolId = typeof fields?.pool === 'string' ? fields.pool : ''
			const objectId = item.data?.objectId
			if (!poolId || !objectId) continue
			out.push({ objectId, shareType: normCoin(shareType), poolId })
		}
		if (!res.hasNextPage || !res.nextCursor) break
		cursor = res.nextCursor
	}
	return out
}

function parseRewardConfigs(raw: unknown): RewardCfg[] {
	const f = unwrap(raw)
	const contents = f?.contents
	if (!Array.isArray(contents)) return []
	const out: RewardCfg[] = []
	for (const row of contents) {
		const entry = unwrap(row)
		const key = unwrap(entry?.key)
		const name = typeof key?.name === 'string' ? key.name : ''
		const value = unwrap(entry?.value)
		if (!name || !value) continue
		out.push({
			coinType: normCoin(normalizeTypeName(name)),
			accPerShare: asBig(value.acc_reward_per_share),
			rewardPerSecond: asBig(value.reward_per_second),
			lastUpdateSec: asBig(value.last_update_time),
			startSec: asBig(value.start_time),
			endSec: asBig(value.end_time),
		})
	}
	return out
}

function parseFarmPool(objectId: string, type: string, fields: Record<string, unknown>): FarmPool | null {
	const shareType = splitMoveTypeArgs(type)[0]
	const vaultId = typeof fields.source_addr === 'string' ? fields.source_addr : ''
	const positions = unwrap(fields.positions)
	const tableId = unwrap(positions?.id)?.id
	if (!shareType || !vaultId || typeof tableId !== 'string') return null
	return {
		id: objectId,
		vaultId,
		shareType: normCoin(shareType),
		tableId,
		totalShares: asBig(fields.total_shares),
		paused: fields.is_paused === true,
		rewards: parseRewardConfigs(fields.reward_configs),
	}
}

function debtFor(fields: Record<string, unknown>, coinType: string): { debt: bigint; stored: bigint } {
	const want = normCoin(coinType)
	const read = (bag: unknown): bigint => {
		const contents = unwrap(bag)?.contents
		if (!Array.isArray(contents)) return 0n
		for (const row of contents) {
			const entry = unwrap(row)
			const name = unwrap(entry?.key)?.name
			if (typeof name !== 'string') continue
			if (normCoin(normalizeTypeName(name)) === want) return asBig(entry?.value)
		}
		return 0n
	}
	return { debt: read(fields.debts), stored: read(fields.pending_rewards) }
}

export async function getHaedalLendingVaultPositions(
	owner: string,
	options?: HaedalLendingVaultOptions,
): Promise<OpenPosition[]> {
	const ownerNorm = normalizeSuiAddress(owner)
	const stakes = await listStakeInfos(ownerNorm)
	if (stakes.length === 0) return []

	const poolIds = [...new Set(stakes.map((s) => s.poolId))]
	const poolObjs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), poolIds, {
		showType: true,
		showContent: true,
	})
	const farms = new Map<string, FarmPool>()
	for (const item of poolObjs) {
		const obj = item?.data
		const content = obj?.content as { dataType?: string; type?: string; fields?: unknown } | undefined
		if (!obj?.objectId || !content?.fields) continue
		if (content.dataType && content.dataType !== 'moveObject') continue
		const parsed = parseFarmPool(
			obj.objectId,
			content.type ?? obj.type ?? '',
			content.fields as Record<string, unknown>,
		)
		if (parsed) farms.set(obj.objectId, parsed)
	}

	const sharesByVault = new Map<string, bigint>()
	const stakedByVault = new Map<string, bigint>()
	const pendingByVault = new Map<string, Map<string, bigint>>()
	const farmByVault = new Map<string, FarmPool>()

	await Promise.all(
		stakes.map(async (stake) => {
			const farm = farms.get(stake.poolId)
			if (!farm) return
			const pos = await withRpcBackoff(
				() =>
					suiClient.getDynamicFieldObject({
						parentId: farm.tableId,
						name: { type: 'address', value: ownerNorm },
					}),
				{ label: 'haedal-lending-position', retries: 3, baseMs: 500 },
			)
			const value = unwrap(
				unwrap((pos.data?.content as { fields?: unknown } | undefined)?.fields)?.value,
			)
			if (!value) return
			const shares = asBig(value.shares)
			if (shares <= 0n) return
			sharesByVault.set(farm.vaultId, (sharesByVault.get(farm.vaultId) ?? 0n) + shares)
			stakedByVault.set(farm.vaultId, (stakedByVault.get(farm.vaultId) ?? 0n) + shares)
			farmByVault.set(farm.vaultId, farm)
			const bag = pendingByVault.get(farm.vaultId) ?? new Map<string, bigint>()
			const nowSec = BigInt(Math.floor(Date.now() / 1000))
			for (const reward of farm.rewards) {
				const { debt, stored } = debtFor(value, reward.coinType)
				const raw = pendingLendingFarmRewardRaw({
					shares,
					accPerShare: reward.accPerShare,
					debt,
					rewardPerSecond: reward.rewardPerSecond,
					lastUpdateSec: reward.lastUpdateSec,
					startSec: reward.startSec,
					endSec: reward.endSec,
					totalShares: farm.totalShares,
					nowSec,
					storedPending: stored,
					paused: farm.paused,
				})
				if (raw > 0n) bag.set(reward.coinType, (bag.get(reward.coinType) ?? 0n) + raw)
			}
			pendingByVault.set(farm.vaultId, bag)
		}),
	)

	const vaultIds = [...sharesByVault.keys()]
	if (vaultIds.length === 0) return []

	let walletByShare = new Map<string, bigint>()
	try {
		const bals = await suiClient.getAllBalances({ owner: ownerNorm })
		walletByShare = new Map(
			bals.map((b) => [normCoin(b.coinType), asBig(b.totalBalance)]),
		)
	} catch (e) {
		console.warn('[haedal-lending] balances', e)
	}

	const vaultObjs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), vaultIds, {
		showType: true,
		showContent: true,
	})

	type Row = {
		vaultId: string
		assetType: string
		shareType: string
		assetDecimals: number
		totalAssets: bigint
		totalSupply: bigint
		userShares: bigint
		stakedShares: bigint
		farm: FarmPool
	}
	const rows: Row[] = []
	for (const item of vaultObjs) {
		const obj = item?.data
		const content = obj?.content as { dataType?: string; type?: string; fields?: unknown } | undefined
		if (!obj?.objectId || !content?.fields) continue
		if (content.dataType && content.dataType !== 'moveObject') continue
		const fields = content.fields as Record<string, unknown>
		const [assetType, shareFromType] = splitMoveTypeArgs(content.type ?? obj.type ?? '')
		const farm = farmByVault.get(obj.objectId)
		if (!assetType || !farm) continue
		const shareType = normCoin(shareFromType || farm.shareType)
		const treasury = unwrap(fields.share_treasury)
		const totalSupply = asBig(unwrap(treasury?.total_supply)?.value)
		const staked = stakedByVault.get(obj.objectId) ?? 0n
		const wallet = walletByShare.get(shareType) ?? 0n
		const userShares = staked + wallet
		if (userShares <= 0n || totalSupply <= 0n) continue
		rows.push({
			vaultId: obj.objectId,
			assetType: normCoin(assetType),
			shareType,
			assetDecimals: Number(fields.asset_decimals ?? 0),
			totalAssets: asBig(fields.last_total_assets),
			totalSupply,
			userShares,
			stakedShares: staked,
			farm,
		})
	}
	if (rows.length === 0) return []

	const coinTypes = new Set<string>()
	for (const row of rows) {
		coinTypes.add(row.assetType)
		coinTypes.add(row.shareType)
		for (const r of row.farm.rewards) coinTypes.add(r.coinType)
		for (const ct of pendingByVault.get(row.vaultId)?.keys() ?? []) coinTypes.add(ct)
	}
	const metaMap = new Map<string, CoinMeta>()
	await Promise.all(
		[...coinTypes].map(async (ct) => {
			try {
				const m = await suiClient.getCoinMetadata({ coinType: ct })
				metaMap.set(ct, {
					symbol: m?.symbol?.trim() || symbolFromCoinType(ct),
					decimals: typeof m?.decimals === 'number' ? m.decimals : 0,
					iconUrl:
						typeof m?.iconUrl === 'string' && m.iconUrl.startsWith('https://') ? m.iconUrl : null,
				})
			} catch {
				metaMap.set(ct, { symbol: symbolFromCoinType(ct), decimals: 0, iconUrl: null })
			}
		}),
	)
	const metaOf = (ct: string): CoinMeta =>
		metaMap.get(ct) ?? { symbol: symbolFromCoinType(ct), decimals: 0, iconUrl: null }

	const spotOpts: ResolveSpotsOptions | undefined = options?.forceRefreshPrices
		? { forceRefresh: true }
		: undefined
	const spots = await resolveSpots([...coinTypes], (ct) => metaOf(ct).symbol, spotOpts)

	const out: OpenPosition[] = []
	for (const row of rows) {
		const assetMeta = metaOf(row.assetType)
		const shareMeta = metaOf(row.shareType)
		const decimals = row.assetDecimals || assetMeta.decimals || 9
		const userAssetsRaw = (row.userShares * row.totalAssets) / row.totalSupply
		const humanAssets = humanFromRaw(userAssetsRaw, decimals)
		const px = spots.get(row.assetType)?.price
		const pxF = typeof px === 'number' && Number.isFinite(px) ? px : 0
		const valueUsd = clampUsd(humanAssets * pxF)
		const vaultTvlUsd = clampUsd(humanFromRaw(row.totalAssets, decimals) * pxF)
		const sharePct = vaultLpSharePct(row.userShares.toString(), row.totalSupply.toString()) ?? undefined

		const pendingStakeRewards = [...(pendingByVault.get(row.vaultId)?.entries() ?? [])].map(
			([coinType, raw]) => {
				const m = metaOf(coinType)
				const amount = humanFromRaw(raw, m.decimals || 9)
				const rpx = spots.get(coinType)?.price
				const rpxF = typeof rpx === 'number' && Number.isFinite(rpx) ? rpx : 0
				return {
					symbol: m.symbol,
					coinType,
					amount,
					amountUSD: clampUsd(amount * rpxF),
				}
			},
		)
		const unclaimedRewardUSD = clampUsd(
			pendingStakeRewards.reduce((s, r) => s + r.amountUSD, 0),
		)

		let rewardApr = vaultFarmRewardAprPct({
			vaultTvlUsd,
			vaultTotalSupply: row.totalSupply.toString(),
			farmLpStakedRaw: row.totalSupply.toString(),
			emissions: row.farm.rewards.map((e) => {
				const m = metaOf(e.coinType)
				const rpx = spots.get(e.coinType)?.price
				const rpxF = typeof rpx === 'number' && Number.isFinite(rpx) ? rpx : 0
				return {
					ratePerSec: e.rewardPerSecond.toString(),
					decimals: m.decimals || 9,
					priceUsd: rpxF,
				}
			}),
		})
		if (rewardApr != null && rewardApr > 500) rewardApr = null

		const symbol = assetMeta.symbol || 'SUI'
		out.push({
			id: row.vaultId,
			protocol: 'cetus',
			poolId: row.vaultId,
			pair: `${symbol} · Lending`,
			tokenA: symbol,
			tokenB: symbol,
			tokenAAddress: row.assetType,
			tokenBAddress: row.assetType,
			tokenAIconUrl: assetMeta.iconUrl,
			tokenBIconUrl: assetMeta.iconUrl,
			tokenADecimals: decimals,
			tokenBDecimals: decimals,
			fee: 0,
			tickLower: 0,
			tickUpper: 0,
			currentTick: 0,
			currentSqrtPrice: '0',
			liquidity: row.userShares.toString(),
			status: 'in_range',
			tokenAAmount: humanAssets,
			tokenBAmount: 0,
			currentPriceA_USD: pxF,
			currentPriceB_USD: pxF,
			currentValueUSD: valueUsd,
			depositedUSD: 0,
			pnlUSD: 0,
			pnlPct: 0,
			unclaimedFeeA: 0,
			unclaimedFeeB: 0,
			unclaimedFeeUSD: 0,
			unclaimedRewardUSD,
			openedAt: 0,
			daysOpen: 0,
			lifetimeEarningsUSD: 0,
			vsHodlDeltaUSD: 0,
			aprEstimatePct: 0,
			cetusVault: {
				vaultId: row.vaultId,
				lpTokenType: row.shareType,
				lpTokenRaw: row.userShares.toString(),
				lpTokenAmount: humanFromRaw(row.userShares, shareMeta.decimals || decimals),
				stakedLpTokenRaw: row.stakedShares > 0n ? row.stakedShares.toString() : undefined,
				feeLabel: 'Lending',
				provider: 'Haedal',
				quoteCoinType: row.assetType,
				vaultTvlUsd: vaultTvlUsd > 0 ? vaultTvlUsd : undefined,
				sharePct,
				rewardAprPct: rewardApr != null && Number.isFinite(rewardApr) ? rewardApr : undefined,
				pendingStakeRewards: pendingStakeRewards.length ? pendingStakeRewards : undefined,
			},
		})
	}
	return out
}
