/**
 * Turbos Finance CLMM — LP event scanning.
 *
 * MintEvent/BurnEvent carry `owner` = wallet (TX sender), not the NFT id.
 * CollectEventV2 / CollectRewardEventV2 carry `owner` = nftId.
 * BurnNftEvent / MintNftEvent (position_manager) carry `nft_address`.
 *
 * Strategy (GraphQL only — no gRPC FromAddress ListTransactions):
 *  1. Typed Sender+MoveEventType for collect* + *NftEvent paths
 *  2. transactions(filter: { affectedObject: nft|position }) for Mint/Burn amounts
 */
import type { EventType, PositionEvent } from '@/types'
import { suiClient } from '@/services/suiClient'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import Decimal from 'decimal.js'
import { PROTOCOL_PACKAGES } from '@/utils/constants'
import { querySenderAndMoveEventTypes } from '@/services/querySenderMoveEvents'
import { recordScanStep } from '@/services/scanTiming'

type Parsed = Record<string, unknown>

const TURBOS_LP_STRUCT_SET = new Set([
	'MintEvent',
	'AddLiquidityEvent',
	'IncreaseLiquidityEvent',
	'BurnEvent',
	'RemoveLiquidityEvent',
	'DecreaseLiquidityEvent',
	'CollectEventV2',
	'CollectFeeEvent',
	'CollectEvent',
	'CollectRewardEventV2',
	'CollectRewardEvent',
	'MintNftEvent',
	'OpenPositionEvent',
	'ClosePositionEvent',
	'BurnNftEvent',
	'BurnPositionEvent',
])

const TURBOS_STRUCT_TO_EVTYPE: Record<string, EventType | null> = {
	MintEvent: 'add_liquidity',
	AddLiquidityEvent: 'add_liquidity',
	IncreaseLiquidityEvent: null,
	BurnEvent: 'remove_liquidity',
	RemoveLiquidityEvent: 'remove_liquidity',
	DecreaseLiquidityEvent: 'remove_liquidity',
	CollectEventV2: 'collect_fee',
	CollectFeeEvent: 'collect_fee',
	CollectEvent: 'collect_fee',
	CollectRewardEventV2: 'collect_reward',
	CollectRewardEvent: 'collect_reward',
	MintNftEvent: null,
	OpenPositionEvent: null,
	ClosePositionEvent: null,
	BurnNftEvent: null,
	BurnPositionEvent: null,
}

/** Collect* live under identity + published_at; *Nft under position_manager on published_at. */
function buildTurbosTypedEventPaths(): string[] {
	const pkgs = [PROTOCOL_PACKAGES.TURBOS, PROTOCOL_PACKAGES.TURBOS_PUBLISHED_AT]
	const poolStructs = [
		'MintEvent',
		'BurnEvent',
		'CollectEvent',
		'CollectFeeEvent',
		'CollectRewardEvent',
		'CollectEventV2',
		'CollectRewardEventV2',
		'AddLiquidityEvent',
		'RemoveLiquidityEvent',
		'DecreaseLiquidityEvent',
	] as const
	const nftStructs = ['MintNftEvent', 'BurnNftEvent', 'BurnPositionEvent', 'ClosePositionEvent'] as const
	const paths: string[] = []
	for (const pkg of pkgs) {
		for (const s of poolStructs) paths.push(`${pkg}::pool::${s}`)
		for (const s of nftStructs) {
			paths.push(`${pkg}::position_manager::${s}`)
			paths.push(`${pkg}::pool::${s}`)
			paths.push(`${pkg}::position::${s}`)
		}
	}
	return paths
}

const TURBOS_TYPED_PATHS = buildTurbosTypedEventPaths()

function structNameFromType(type: string): string {
	const bare = type.indexOf('<') >= 0 ? type.slice(0, type.indexOf('<')) : type
	const p = bare.split('::')
	return p[p.length - 1] ?? ''
}

export function isTurbosLpEventType(type: string): boolean {
	return TURBOS_LP_STRUCT_SET.has(structNameFromType(type))
}

function normSafe(id: string): string | null {
	try {
		return normalizeSuiAddress(id)
	} catch {
		return null
	}
}

function readU64(v: unknown): string {
	if (typeof v === 'string' && /^\d+$/.test(v)) return v
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return String(Math.floor(v))
	return '0'
}

function rawToHuman(raw: string, decimals: number): number {
	if (!/^\d+$/.test(raw) || decimals < 0) return 0
	try {
		return new Decimal(raw).div(new Decimal(10).pow(decimals)).toNumber()
	} catch {
		return 0
	}
}

function readAmountA(pj: Parsed): string {
	for (const k of ['amount_a', 'amount_0', 'coin_a_amount']) {
		const v = pj[k]
		if (v != null) return readU64(v)
	}
	return '0'
}

function readAmountB(pj: Parsed): string {
	for (const k of ['amount_b', 'amount_1', 'coin_b_amount']) {
		const v = pj[k]
		if (v != null) return readU64(v)
	}
	return '0'
}

function readLiquidityDelta(pj: Parsed): number {
	for (const k of ['liquidity_delta', 'liquidity', 'after_liquidity']) {
		const v = pj[k]
		if (v != null) {
			const raw = readU64(v)
			if (/^\d+$/.test(raw) && raw.length < 22) return parseFloat(raw)
		}
	}
	return 0
}

function readRewardAmount(pj: Parsed): string {
	for (const k of ['amount', 'amount_0', 'amount_collected']) {
		const v = pj[k]
		if (v != null) return readU64(v)
	}
	return '0'
}

function readRewardCoinType(pj: Parsed): string | null {
	const rt = pj['reward_type'] as Record<string, unknown> | null | undefined
	if (!rt) return null
	const name =
		typeof rt['name'] === 'string'
			? rt['name']
			: typeof (rt['fields'] as Record<string, unknown> | undefined)?.['name'] === 'string'
				? ((rt['fields'] as Record<string, unknown>)['name'] as string)
				: null
	if (!name) return null
	return name.startsWith('0x') ? name : `0x${name}`
}

function symbolFromCoinType(ct: string): string {
	const p = ct.split('::')
	return p[p.length - 1] ?? 'REWARD'
}

function readNftRef(pj: Parsed): string | null {
	for (const k of ['owner', 'nft_address', 'nft_id', 'position_nft', 'position'] as const) {
		const v = pj[k]
		if (typeof v === 'string' && v.startsWith('0x')) {
			const n = normSafe(v)
			if (n) return n
		}
	}
	return null
}

const TURBOS_DELTA_OVERLAP_SEC = 3 * 3600
const MAX_AFFECTED_TX_PAGES = 40

export type TurbosScanResult = { events: PositionEvent[]; partial: boolean }

function parseTurbosEvent(
	ev: {
		type: string
		parsedJson?: unknown
		id?: { eventSeq: string; txDigest: string }
		timestampMs?: string | number | null
	},
	nftNorm: string,
	posNorm: string,
	walletNorm: string,
	tokenADecimals: number,
	tokenBDecimals: number,
	/** When true, Mint/Burn with owner=wallet are accepted (from affectedObject TX). */
	allowWalletOwnedMintBurn: boolean,
): PositionEvent | null {
	if (!ev.type || !ev.parsedJson) return null
	const sn = structNameFromType(ev.type)
	if (!TURBOS_LP_STRUCT_SET.has(sn)) return null
	const evTypeOrNull = TURBOS_STRUCT_TO_EVTYPE[sn]
	if (evTypeOrNull === null || evTypeOrNull == null) return null

	const pj = ev.parsedJson as Parsed
	const ownerVal = typeof pj['owner'] === 'string' ? normSafe(pj['owner'] as string) : null
	const posVal = typeof pj['position'] === 'string' ? normSafe(pj['position'] as string) : null
	const nftRef = readNftRef(pj)

	const isMintOrBurn = evTypeOrNull === 'add_liquidity' || evTypeOrNull === 'remove_liquidity'
	const matchesNft = ownerVal === nftNorm || nftRef === nftNorm
	const matchesPos = !!posNorm && (posVal === posNorm || nftRef === posNorm)
	const matchesWalletMintBurn =
		allowWalletOwnedMintBurn && isMintOrBurn && ownerVal === walletNorm

	if (!matchesNft && !matchesPos && !matchesWalletMintBurn) return null

	const rawMs = ev.timestampMs != null ? Number(ev.timestampMs) : NaN
	const ts = Number.isFinite(rawMs) ? Math.floor(rawMs / 1000) : 0
	const txDigest = ev.id?.txDigest ?? ''
	const seq = ev.id?.eventSeq ?? '0'
	const id = `${txDigest}::${seq}`

	if (evTypeOrNull === 'collect_reward') {
		const rawCoinType = readRewardCoinType(pj)
		const rewardToken = rawCoinType ? symbolFromCoinType(rawCoinType) : 'REWARD'
		const rewardRaw = readRewardAmount(pj)
		const rewardHum = rawToHuman(rewardRaw, 9)
		return {
			id,
			txDigest,
			type: 'collect_reward',
			timestamp: ts,
			positionId: nftNorm,
			protocol: 'turbos',
			tokenAAmount: 0,
			tokenBAmount: 0,
			liquidityDelta: 0,
			feeAmountA: 0,
			feeAmountB: 0,
			rewardAmount: rewardHum,
			rewardToken,
			rewardCoinType: rawCoinType ?? null,
			rewardRawAmount: rewardRaw !== '0' ? rewardRaw : null,
			priceA_USD: null,
			priceB_USD: null,
			valueUsdA: null,
			valueUsdB: null,
			valueUsdReward: null,
			totalValueUSD: null,
			priceUnavailable: true,
			priceAtTxApproximate: false,
			priceSource: null,
		}
	}

	const rawA = readAmountA(pj)
	const rawB = readAmountB(pj)
	const humA = rawToHuman(rawA, tokenADecimals)
	const humB = rawToHuman(rawB, tokenBDecimals)
	const liqDelta = readLiquidityDelta(pj)

	if (evTypeOrNull === 'add_liquidity') {
		return {
			id,
			txDigest,
			type: 'add_liquidity',
			timestamp: ts,
			positionId: nftNorm,
			protocol: 'turbos',
			tokenAAmount: humA,
			tokenBAmount: humB,
			liquidityDelta: liqDelta,
			feeAmountA: 0,
			feeAmountB: 0,
			rewardAmount: 0,
			rewardToken: '',
			priceA_USD: null,
			priceB_USD: null,
			valueUsdA: null,
			valueUsdB: null,
			valueUsdReward: null,
			totalValueUSD: null,
			priceUnavailable: true,
			priceAtTxApproximate: false,
			priceSource: null,
		}
	}
	if (evTypeOrNull === 'remove_liquidity') {
		return {
			id,
			txDigest,
			type: 'remove_liquidity',
			timestamp: ts,
			positionId: nftNorm,
			protocol: 'turbos',
			tokenAAmount: humA,
			tokenBAmount: humB,
			liquidityDelta: liqDelta,
			feeAmountA: 0,
			feeAmountB: 0,
			rewardAmount: 0,
			rewardToken: '',
			priceA_USD: null,
			priceB_USD: null,
			valueUsdA: null,
			valueUsdB: null,
			valueUsdReward: null,
			totalValueUSD: null,
			priceUnavailable: true,
			priceAtTxApproximate: false,
			priceSource: null,
		}
	}
	if (evTypeOrNull === 'collect_fee') {
		return {
			id,
			txDigest,
			type: 'collect_fee',
			timestamp: ts,
			positionId: nftNorm,
			protocol: 'turbos',
			tokenAAmount: 0,
			tokenBAmount: 0,
			liquidityDelta: 0,
			feeAmountA: humA,
			feeAmountB: humB,
			rewardAmount: 0,
			rewardToken: '',
			priceA_USD: null,
			priceB_USD: null,
			valueUsdA: null,
			valueUsdB: null,
			valueUsdReward: null,
			totalValueUSD: null,
			priceUnavailable: true,
			priceAtTxApproximate: false,
			priceSource: null,
		}
	}
	return null
}

/**
 * GraphQL `affectedObject` TX pages for an NFT / position (not gRPC FromAddress).
 */
async function scanAffectedObjectEvents(
	objectId: string,
	nftNorm: string,
	posNorm: string,
	walletNorm: string,
	tokenADecimals: number,
	tokenBDecimals: number,
	sinceTs: number,
	out: PositionEvent[],
	seen: Set<string>,
): Promise<boolean> {
	let partial = false
	let cursor: string | undefined
	const stopBefore = sinceTs > 0 ? sinceTs - TURBOS_DELTA_OVERLAP_SEC : 0
	for (let page = 0; page < MAX_AFFECTED_TX_PAGES; page++) {
		const res = await suiClient
			.queryTransactionBlocks({
				filter: { ChangedObject: objectId },
				options: { showEvents: true },
				limit: 50,
				cursor,
				order: 'descending',
			})
			.catch(() => null)
		if (!res) {
			partial = true
			break
		}
		let stop = false
		for (const tx of res.data) {
			const ts = tx.timestampMs ? Math.floor(Number(tx.timestampMs) / 1000) : 0
			if (stopBefore > 0 && ts > 0 && ts < stopBefore) {
				stop = true
				break
			}
			for (const ev of tx.events ?? []) {
				const pe = parseTurbosEvent(
					{
						type: ev.type,
						parsedJson: ev.parsedJson,
						id: {
							eventSeq: ev.id?.eventSeq ?? '0',
							txDigest: tx.digest,
						},
						timestampMs: tx.timestampMs,
					},
					nftNorm,
					posNorm,
					walletNorm,
					tokenADecimals,
					tokenBDecimals,
					true,
				)
				if (!pe || seen.has(pe.id)) continue
				seen.add(pe.id)
				out.push(pe)
			}
		}
		if (stop || !res.hasNextPage) break
		cursor = res.nextCursor ?? undefined
		if (!cursor) break
		if (page === MAX_AFFECTED_TX_PAGES - 1) partial = true
	}
	return partial
}

/**
 * Scan all LP events for a Turbos position (GraphQL typed + affectedObject).
 */
export async function scanTurbosPositionEvents(
	walletAddress: string,
	nftId: string,
	positionId: string,
	tokenADecimals: number,
	tokenBDecimals: number,
	sinceTs?: number,
): Promise<TurbosScanResult> {
	const t0 = Date.now()
	let walletNorm: string
	let nftNorm: string
	let posNorm: string
	try {
		walletNorm = normalizeSuiAddress(walletAddress)
	} catch {
		walletNorm = walletAddress
	}
	try {
		nftNorm = normalizeSuiAddress(nftId)
	} catch {
		nftNorm = nftId
	}
	try {
		posNorm = positionId ? normalizeSuiAddress(positionId) : ''
	} catch {
		posNorm = positionId
	}

	const deltaSince = sinceTs != null && sinceTs > 0 ? sinceTs : 0
	const stopBefore = deltaSince > 0 ? deltaSince - TURBOS_DELTA_OVERLAP_SEC : undefined

	let partial = false
	const out: PositionEvent[] = []
	const seen = new Set<string>()

	try {
		const typed = await querySenderAndMoveEventTypes(walletNorm, TURBOS_TYPED_PATHS, {
			maxPagesPerType: deltaSince > 0 ? 8 : 40,
			pageSize: 50,
			stopBeforeTsSec: stopBefore,
			typeConcurrency: 3,
		})
		if (typed.partial) partial = true
		for (const ev of typed.events) {
			const pe = parseTurbosEvent(
				ev,
				nftNorm,
				posNorm,
				walletNorm,
				tokenADecimals,
				tokenBDecimals,
				false,
			)
			if (!pe || seen.has(pe.id)) continue
			seen.add(pe.id)
			out.push(pe)
		}
	} catch (e) {
		console.warn('[turbos-scan] GraphQL typed scan failed', e)
		partial = true
	}

	// Mint/Burn amounts: GraphQL affectedObject on NFT (and position if distinct).
	const tAff = Date.now()
	const affPartialNft = await scanAffectedObjectEvents(
		nftNorm,
		nftNorm,
		posNorm,
		walletNorm,
		tokenADecimals,
		tokenBDecimals,
		deltaSince,
		out,
		seen,
	)
	let affPartialPos = false
	if (posNorm && posNorm !== nftNorm) {
		affPartialPos = await scanAffectedObjectEvents(
			posNorm,
			nftNorm,
			posNorm,
			walletNorm,
			tokenADecimals,
			tokenBDecimals,
			deltaSince,
			out,
			seen,
		)
	}
	if (affPartialNft || affPartialPos) partial = true
	recordScanStep('turbos.affectedObject', Date.now() - tAff, 'graphql')

	const hasOpen = out.some((e) => e.type === 'add_liquidity')
	if (!hasOpen) partial = true

	out.sort((a, b) => a.timestamp - b.timestamp)
	recordScanStep('turbos.typed+affected', Date.now() - t0, 'graphql')
	return { events: out, partial }
}

export function invalidateTurbosEventCache(_wallet: string): void {
	// No persistent cache for Turbos events in this version
}
