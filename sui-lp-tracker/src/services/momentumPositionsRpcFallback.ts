import type { MmtSDK } from '@mmt-finance/clmm-sdk'
import { TickMath, Utils } from '@mmt-finance/clmm-sdk'
import { convertI32ToSigned } from '@mmt-finance/clmm-sdk/dist/utils/math/tickMath'
import BN from 'bn.js'
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import { MOMENTUM_PUBLISHED_AT, PROTOCOL_PACKAGES } from '@/utils/constants'
import { suiClient } from '@/services/suiClient'
import {
	type MomentumOwnedBody,
	fieldsForMomentumSdkFetchRewards,
	ownedObjectDataMoveType,
	readMomentumPoolIdFromMoveFields,
	readMomentumPositionNftObjectId,
} from '@/services/momentumOwnedParse'

/** Позиція після парсингу MMT SDK (`getAllUserPositions` або RPC fallback). */
export type MomentumUserPosRow = {
	objectId: string
	poolId: string
	upperTick: number
	lowerTick: number
	liquidity: BN
	amount: number
	status: string
	claimableRewards: number
	rewarders: { coinType: string; amount: number }[]
	feeAmountXUsd: number
	feeAmountYUsd: number
	feeAmountX: number
	feeAmountY: number
}

/** На mainnet type може бути `package_id::position::Position` або `published_at::…` — SDK дивиться лише publishedAt через Package filter. */
const POSITION_STRUCTS = [
	`${PROTOCOL_PACKAGES.MOMENTUM_CLMM}::position::Position`,
	`${MOMENTUM_PUBLISHED_AT}::position::Position`,
] as const

const POSITION_MOVE_TYPE_SUFFIX = '::position::Position'
const PKG_OWNED_MAX_PAGES = 40

/** Транспорт `suix_getOwnedObjects`: той самий контракт, що в MMT `rpcModule` та в `SuiJsonRpcClient`. */
export type MomentumOwnedObjectsRpc = Pick<typeof suiClient, 'getOwnedObjects'>

/** За замовчуванням — read-only RPC з `@/services/suiClient`; для узгодження з MMT передають `sdk.rpcClient`. */
function defaultMomentumOwnedRpc(): MomentumOwnedObjectsRpc {
	return suiClient
}

function uniqueMomentumPackagesForOwnedFallback(): string[] {
	const pkgs = [PROTOCOL_PACKAGES.MOMENTUM_CLMM, MOMENTUM_PUBLISHED_AT]
	const seen = new Set<string>()
	const out: string[] = []
	for (const p of pkgs) {
		const t = typeof p === 'string' ? p.trim() : ''
		if (!t.length || seen.has(t)) continue
		seen.add(t)
		out.push(t)
	}
	return out
}

function ownedRowIsMomentumPosition(row: unknown): boolean {
	const typ = ownedObjectDataMoveType((row as { data?: unknown }).data)
	return Boolean(typ.endsWith(POSITION_MOVE_TYPE_SUFFIX))
}

/** Усі NFT position id з Package pagination (fallback, якщо StructType дав 0 або неповний набір). */
async function appendMomentumPositionIdsFromPackagePages(
	walletAddress: string,
	ids: Set<string>,
	rpc: MomentumOwnedObjectsRpc,
): Promise<void> {
	const pkgs = uniqueMomentumPackagesForOwnedFallback()
	const objectOpts = {
		showContent: false as const,
		showType: true as const,
		showOwner: true as const,
	}
	for (const pkg of pkgs) {
		let cursor: string | null | undefined
		try {
			for (let page = 0; page < PKG_OWNED_MAX_PAGES; page++) {
				const res = await rpc.getOwnedObjects({
					owner: walletAddress,
					filter: { Package: pkg },
					options: objectOpts,
					cursor,
				})
				for (const row of res.data) {
					if (!ownedRowIsMomentumPosition(row)) continue
					const id = row.data?.objectId
					if (!id) continue
					try {
						ids.add(normalizeSuiAddress(id))
					} catch {
						ids.add(id)
					}
				}
				if (!res.hasNextPage) break
				cursor = res.nextCursor ?? null
				if (cursor == null) break
			}
		} catch {
			/* */
		}
	}
}

export async function scanMomentumOwnedPositionIds(
	walletAddress: string,
	rpc: MomentumOwnedObjectsRpc = defaultMomentumOwnedRpc(),
): Promise<Set<string>> {
	const seen = new Set<string>()
	for (const structType of POSITION_STRUCTS) {
		let cursor: string | null | undefined
		for (;;) {
			const page = await rpc.getOwnedObjects({
				owner: walletAddress,
				filter: { StructType: structType },
				options: { showContent: false, showType: true, showOwner: true },
				cursor,
			})
			for (const it of page.data) {
				const id = it.data?.objectId
				if (!id) continue
				try {
					seen.add(normalizeSuiAddress(id))
				} catch {
					seen.add(id)
				}
			}
			if (!page.hasNextPage) break
			cursor = page.nextCursor ?? null
			if (cursor == null) break
		}
	}
	if (seen.size === 0) {
		await appendMomentumPositionIdsFromPackagePages(walletAddress, seen, rpc)
	}
	return seen
}

export async function fetchMomentumOwnedPositionBodiesForRewards(
	walletAddress: string,
	rpc: MomentumOwnedObjectsRpc = defaultMomentumOwnedRpc(),
): Promise<MomentumOwnedBody[]> {
	const seen = new Set<string>()
	const out: MomentumOwnedBody[] = []

	for (const structType of POSITION_STRUCTS) {
		let cursor: string | null | undefined
		for (;;) {
			const page = await rpc.getOwnedObjects({
				owner: walletAddress,
				filter: { StructType: structType },
				options: { showContent: true, showType: true, showOwner: true },
				cursor,
			})
			for (const row of page.data) {
				const oid = row.data?.objectId
				const content = row.data?.content
				if (!oid || content?.dataType !== 'moveObject' || !content.fields) continue
				let k: string
				try {
					k = normalizeSuiAddress(oid)
				} catch {
					k = oid
				}
				if (seen.has(k)) continue
				seen.add(k)
				out.push({ objectId: k, fields: content.fields as Record<string, unknown> })
			}
			if (!page.hasNextPage) break
			cursor = page.nextCursor ?? null
			if (cursor == null) break
		}
	}

	if (!out.length) {
		await appendBodiesFromMomentumPackagePages(walletAddress, out, seen, rpc)
	}

	return out
}

type MmtPool = Awaited<ReturnType<MmtSDK['Pool']['getAllPools']>>[number]
type MmtToken = Awaited<ReturnType<MmtSDK['Pool']['getAllTokens']>>[number]

/** Ключ для map пулів (нормалізований pool object id). */
export function momentumPoolLookupKey(poolIdRaw: string): string {
	try {
		return normalizeSuiAddress(poolIdRaw.trim())
	} catch {
		return poolIdRaw.trim()
	}
}

/**
 * MMT API часто знає конкретний пул через `/pools/v3/:id`, навіть якщо пул ще потрапляє лише частково в `getAllPools`.
 * validate=false — без on-chain перевірки struct (на випадок розсинхрону апгрейдів).
 */
export async function hydrateMomentumPoolsByApiId(
	sdk: MmtSDK,
	basePools: MmtPool[],
	poolIdHints: string[],
): Promise<Map<string, MmtPool>> {
	const out = new Map<string, MmtPool>()
	for (const p of basePools) {
		out.set(momentumPoolLookupKey(String(p.poolId)), p)
	}
	const uniq = [...new Set(poolIdHints.map((id) => id.trim()).filter(Boolean))]
	await Promise.all(
		uniq.map(async (raw) => {
			const nk = momentumPoolLookupKey(raw)
			if (out.has(nk)) return
			let added: MmtPool | undefined
			try {
				added = await sdk.Pool.getPool(raw, undefined, false)
			} catch {
				try {
					added = await sdk.Pool.getPool(nk, undefined, false)
				} catch {
					/* */
				}
			}
			if (added) {
				out.set(momentumPoolLookupKey(String(added.poolId)), added)
			}
		}),
	)
	return out
}

async function appendBodiesFromMomentumPackagePages(
	walletAddress: string,
	out: MomentumOwnedBody[],
	seen: Set<string>,
	rpc: MomentumOwnedObjectsRpc,
): Promise<void> {
	const pkgs = uniqueMomentumPackagesForOwnedFallback()
	const objectOpts = {
		showContent: true as const,
		showType: true as const,
		showOwner: true as const,
	}

	for (const pkg of pkgs) {
		let cursor: string | null | undefined
		try {
			for (let page = 0; page < PKG_OWNED_MAX_PAGES; page++) {
				const res = await rpc.getOwnedObjects({
					owner: walletAddress,
					filter: { Package: pkg },
					options: objectOpts,
					cursor,
				})
				for (const row of res.data) {
					if (!ownedRowIsMomentumPosition(row)) continue
					const oid = row.data?.objectId
					const content = row.data?.content
					if (!oid || !content || content.dataType !== 'moveObject' || !content.fields) continue
					let k: string
					try {
						k = normalizeSuiAddress(oid)
					} catch {
						k = oid
					}
					if (seen.has(k)) continue
					seen.add(k)
					out.push({ objectId: k, fields: content.fields as Record<string, unknown> })
				}
				if (!res.hasNextPage) break
				cursor = res.nextCursor ?? null
				if (cursor == null) break
			}
		} catch {
			/* некоректний Package id або transient RPC — наступний пакет */
		}
	}
}

function rewardEntryForPosition(
	map: Record<string, { rewards: { coinType: string; amount: number }[]; feeCollected: { amountX: number; amountY: number } }>,
	rawId: string,
) {
	try {
		const n = normalizeSuiAddress(rawId)
		return map[rawId] ?? map[n]
	} catch {
		return map[rawId]
	}
}

/** Статус діапазону як у `@mmt-finance/clmm-sdk` `getPositionStatus` (за sqrt ціною). */
function positionRangeStatusLabel(pool: MmtPool, lowerTickSqrtPrice: BN, upperTickSqrtPrice: BN): string {
	const cur = Number(pool.currentSqrtPrice)
	const low = Number(lowerTickSqrtPrice.toString())
	const high = Number(upperTickSqrtPrice.toString())
	if (cur < low) return 'Above Range'
	if (cur <= high && cur >= low) return 'In Range'
	return 'Below Range'
}

/**
 * Fallback, коли SDK `getAllUserPositions` не бачить NFT (розсинхрон Package filter vs StructType ончейн).
 */
export async function momentumUserRowsFromOwnedRpc(
	walletAddress: string,
	sdk: MmtSDK,
	poolsData: MmtPool[],
	tokensData: MmtToken[],
): Promise<MomentumUserPosRow[]> {
	const bodies = await fetchMomentumOwnedPositionBodiesForRewards(walletAddress, sdk.rpcClient)
	if (!bodies.length) return []

	const poolHintsFromBodies: string[] = []
	for (const b of bodies) {
		const hint = readMomentumPoolIdFromMoveFields(b.fields)
		if (hint) poolHintsFromBodies.push(hint)
	}
	const poolsByNormLookup = await hydrateMomentumPoolsByApiId(sdk, poolsData, poolHintsFromBodies)
	const poolsForRewards = [...poolsByNormLookup.values()]

	let positionRewardsInfo: Record<
		string,
		{ rewards: { coinType: string; amount: number }[]; feeCollected: { amountX: number; amountY: number } }
	> = {}
	try {
		const forSdk = bodies.map((b) => ({
			fields: fieldsForMomentumSdkFetchRewards(b.fields, b.objectId),
		}))
		positionRewardsInfo = (await sdk.Position.fetchRewards(
			forSdk as never,
			poolsForRewards as never,
			walletAddress,
			sdk.rpcClient,
		)) as Record<
			string,
			{ rewards: { coinType: string; amount: number }[]; feeCollected: { amountX: number; amountY: number } }
		>
	} catch {
		positionRewardsInfo = {}
	}

	const tokenPriceMap = new Map(tokensData.map((token) => [token.coinType, Number(token.price)]))

	const out: MomentumUserPosRow[] = []

	for (const body of bodies) {
		const positionData = body.fields
		const objectId = readMomentumPositionNftObjectId({ rpcObjectId: body.objectId, fields: positionData })
		const poolIdRaw = readMomentumPoolIdFromMoveFields(positionData)
		if (!objectId || !poolIdRaw) continue
		let poolIdNorm: string
		try {
			poolIdNorm = normalizeSuiAddress(poolIdRaw)
		} catch {
			poolIdNorm = poolIdRaw
		}

		const pool = poolsByNormLookup.get(poolIdNorm)
		if (!pool) continue

		const liquidity = new BN(String(positionData.liquidity ?? 0), 10)
		const tickUp = positionData.tick_upper_index as { fields?: { bits?: string | number } } | undefined
		const tickLo = positionData.tick_lower_index as { fields?: { bits?: string | number } } | undefined
		const upperBits = Number(tickUp?.fields?.bits ?? 0)
		const lowerBits = Number(tickLo?.fields?.bits ?? 0)
		const upperTick = convertI32ToSigned(upperBits)
		const lowerTick = convertI32ToSigned(lowerBits)

		const upperTickSqrtPrice = TickMath.tickIndexToSqrtPriceX64(upperTick)
		const lowerTickSqrtPrice = TickMath.tickIndexToSqrtPriceX64(lowerTick)
		const { coinA, coinB } = Utils.getCoinAmountFromLiquidity(
			liquidity,
			new BN(pool.currentSqrtPrice.toString()),
			lowerTickSqrtPrice,
			upperTickSqrtPrice,
			false,
		)

		const calculateUsdValue = (amount: number, coinLeg: 'tokenX' | 'tokenY'): number => {
			const dec = pool[coinLeg].decimals ?? 0
			const ct = pool[coinLeg].coinType
			const px = tokenPriceMap.get(ct) ?? 0
			return (amount / 10 ** dec) * px
		}

		const totalUsdValue = calculateUsdValue(Number(coinA), 'tokenX') + calculateUsdValue(Number(coinB), 'tokenY')

		const rewardsData = rewardEntryForPosition(
			positionRewardsInfo as Record<
				string,
				{ rewards: { coinType: string; amount: number }[]; feeCollected: { amountX: number; amountY: number } }
			>,
			objectId,
		)

		const feeUsdValue = rewardsData
			? calculateUsdValue(rewardsData.feeCollected.amountX, 'tokenX') +
				calculateUsdValue(rewardsData.feeCollected.amountY, 'tokenY')
			: 0

		let rewardsUsdValue = 0
		if (rewardsData?.rewards?.length) {
			for (const reward of rewardsData.rewards) {
				let coinType = reward.coinType.includes('0x2::sui::SUI')
					? '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'
					: reward.coinType
				try {
					coinType = normalizeStructTag(coinType)
				} catch {
					/* */
				}
				const token = tokensData.find((t) => {
					try {
						return normalizeStructTag(t.coinType) === coinType
					} catch {
						return t.coinType === coinType
					}
				})
				const dec = token?.decimals ?? 0
				rewardsUsdValue += (reward.amount / 10 ** dec) * (tokenPriceMap.get(token?.coinType ?? coinType) ?? 0)
			}
		}

		out.push({
			objectId,
			poolId: pool.poolId,
			upperTick,
			lowerTick,
			liquidity,
			amount: totalUsdValue,
			status: positionRangeStatusLabel(pool, lowerTickSqrtPrice, upperTickSqrtPrice),
			claimableRewards: rewardsUsdValue + feeUsdValue,
			rewarders: rewardsData ? rewardsData.rewards : [],
			feeAmountXUsd: rewardsData ? calculateUsdValue(rewardsData.feeCollected.amountX, 'tokenX') : 0,
			feeAmountYUsd: rewardsData ? calculateUsdValue(rewardsData.feeCollected.amountY, 'tokenY') : 0,
			feeAmountX: rewardsData ? rewardsData.feeCollected.amountX : 0,
			feeAmountY: rewardsData ? rewardsData.feeCollected.amountY : 0,
		})
	}

	return out
}
