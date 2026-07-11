/**
 * Turbos Finance CLMM — LP event scanning.
 *
 * Strategy: queryTransactionBlocks({ filter: { FromAddress: wallet } }) — works on all nodes.
 *   suix_queryEvents({ Sender }) does NOT work for Turbos — the pool module emits events
 *   with the package address as event sender, not the user wallet.
 *
 * We scan the wallet's transactions (descending = newest first), collect all Turbos pool
 * events from those transactions, and filter by the position's NFT ID / positionId.
 *
 * Filtering:
 *   parsedJson.owner === nftId    ← newer Turbos (MintEvent, BurnEvent, CollectEventV2, CollectRewardEventV2)
 *   parsedJson.position === posId ← older Turbos (AddLiquidityEvent, RemoveLiquidityEvent)
 *
 * Verified event types on mainnet:
 *   MintNftEvent          → position created (nft_address = nftId) — lifecycle, skipped
 *   MintEvent             → add_liquidity   (owner = nftId, amount_a, amount_b)
 *   AddLiquidityEvent     → add_liquidity   (position = posId, amount_a, amount_b) [older]
 *   BurnEvent             → remove_liquidity (owner = nftId, amount_a, amount_b)
 *   RemoveLiquidityEvent  → remove_liquidity (position = posId) [older]
 *   DecreaseLiquidityEvent → remove_liquidity [older]
 *   CollectEventV2        → collect_fee     (owner = nftId, amount_a, amount_b)
 *   CollectFeeEvent       → collect_fee     [older]
 *   CollectRewardEventV2  → collect_reward  (owner = nftId, amount, reward_type.name)
 *   CollectRewardEvent    → collect_reward  [older]
 *   IncreaseLiquidityEvent → SKIPPED (duplicate of MintEvent, no owner/position field)
 */
import type { EventType, PositionEvent } from '@/types'
import { suiClient } from '@/services/suiClient'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import Decimal from 'decimal.js'

type Parsed = Record<string, unknown>

// ---------------------------------------------------------------------------
// Event type sets and mapping
// ---------------------------------------------------------------------------

const TURBOS_LP_STRUCT_SET = new Set([
	// Add liquidity
	'MintEvent',               // newer (owner = nftId)
	'AddLiquidityEvent',       // older (position = posId)
	'IncreaseLiquidityEvent',  // duplicate of MintEvent — SKIP
	// Remove liquidity
	'BurnEvent',               // newer (owner = nftId)
	'RemoveLiquidityEvent',    // older
	'DecreaseLiquidityEvent',
	// Collect fee
	'CollectEventV2',          // newer (owner = nftId)
	'CollectFeeEvent',         // older
	'CollectEvent',            // oldest
	// Collect reward
	'CollectRewardEventV2',    // newer (owner = nftId)
	'CollectRewardEvent',
	// Lifecycle — no amounts
	'MintNftEvent',
	'OpenPositionEvent',
	'ClosePositionEvent',
	'BurnNftEvent',
	'BurnPositionEvent',
])

const TURBOS_STRUCT_TO_EVTYPE: Record<string, EventType | null> = {
	MintEvent: 'add_liquidity',
	AddLiquidityEvent: 'add_liquidity',
	IncreaseLiquidityEvent: null,      // skip — duplicate without owner/position field
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

function structNameFromType(type: string): string {
	const bare = type.indexOf('<') >= 0 ? type.slice(0, type.indexOf('<')) : type
	const p = bare.split('::')
	return p[p.length - 1] ?? ''
}

export function isTurbosLpEventType(type: string): boolean {
	return TURBOS_LP_STRUCT_SET.has(structNameFromType(type))
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function normSafe(id: string): string | null {
	try { return normalizeSuiAddress(id) } catch { return null }
}

function readU64(v: unknown): string {
	if (typeof v === 'string' && /^\d+$/.test(v)) return v
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return String(Math.floor(v))
	return '0'
}

function rawToHuman(raw: string, decimals: number): number {
	if (!/^\d+$/.test(raw) || decimals < 0) return 0
	try { return new Decimal(raw).div(new Decimal(10).pow(decimals)).toNumber() }
	catch { return 0 }
}

function readAmountA(pj: Parsed): string {
	for (const k of ['amount_a', 'amount_0', 'coin_a_amount']) {
		const v = pj[k]; if (v != null) return readU64(v)
	}
	return '0'
}

function readAmountB(pj: Parsed): string {
	for (const k of ['amount_b', 'amount_1', 'coin_b_amount']) {
		const v = pj[k]; if (v != null) return readU64(v)
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
		const v = pj[k]; if (v != null) return readU64(v)
	}
	return '0'
}

/**
 * Extract reward coin type from CollectRewardEventV2.
 * reward_type is a TypeName: { name: "addr::module::STRUCT" } (without 0x prefix).
 */
function readRewardCoinType(pj: Parsed): string | null {
	const rt = pj['reward_type'] as Record<string, unknown> | null | undefined
	if (!rt) return null
	const name = typeof rt['name'] === 'string' ? rt['name']
		: typeof (rt['fields'] as Record<string, unknown> | undefined)?.['name'] === 'string'
			? (rt['fields'] as Record<string, unknown>)['name'] as string
			: null
	if (!name) return null
	return name.startsWith('0x') ? name : `0x${name}`
}

function symbolFromCoinType(ct: string): string {
	const p = ct.split('::')
	return p[p.length - 1] ?? 'REWARD'
}

// ---------------------------------------------------------------------------
// TX-based scan (FromAddress filter — works on all SUI fullnodes)
// ---------------------------------------------------------------------------

const TX_PAGE_LIMIT = 50
const MAX_TX_PAGES = 50   // 50 × 50 = 2500 transactions scanned

/**
 * Scan all LP events for a Turbos position.
 *
 * Walks the wallet's transactions in descending order (newest first).
 * Collects Turbos pool events matching nftId (owner field) or positionId (position field).
 * Stops early once the position's opening add_liquidity event is found.
 *
 * @param walletAddress  - SUI wallet address (owner of the position NFT)
 * @param nftId          - TurbosPositionNFT object ID  (position's `id`)
 * @param positionId     - on-chain Position object ID  (for older event format)
 * @param tokenADecimals
 * @param tokenBDecimals
 */
export async function scanTurbosPositionEvents(
	walletAddress: string,
	nftId: string,
	positionId: string,
	tokenADecimals: number,
	tokenBDecimals: number,
): Promise<PositionEvent[]> {
	let walletNorm: string
	let nftNorm: string
	let posNorm: string
	try { walletNorm = normalizeSuiAddress(walletAddress) } catch { walletNorm = walletAddress }
	try { nftNorm = normalizeSuiAddress(nftId) } catch { nftNorm = nftId }
	try { posNorm = positionId ? normalizeSuiAddress(positionId) : '' } catch { posNorm = positionId }

	const out: PositionEvent[] = []
	let cursor: string | undefined = undefined
	let page = 0
	let foundOpeningEvent = false

	do {
		const res: Awaited<ReturnType<typeof suiClient.queryTransactionBlocks>> | null =
			await suiClient.queryTransactionBlocks({
			filter: { FromAddress: walletNorm },
			options: { showEvents: true, showInput: false, showEffects: false },
			limit: TX_PAGE_LIMIT,
			cursor,
			order: 'descending',
		}).catch(() => null)
		if (!res) break

		for (const tx of res.data) {
			if (!tx.events || tx.events.length === 0) continue
			const ts = tx.timestampMs ? Math.floor(Number(tx.timestampMs) / 1000) : 0
			const txDigest = tx.digest

			for (const ev of tx.events) {
				if (!ev.type || !ev.parsedJson) continue

				const sn = structNameFromType(ev.type)
				if (!TURBOS_LP_STRUCT_SET.has(sn)) continue

				const evTypeOrNull = TURBOS_STRUCT_TO_EVTYPE[sn]
				if (evTypeOrNull === null) continue

				const pj = ev.parsedJson as Parsed

				// Filter: event must reference this specific position
				const ownerVal = typeof pj['owner'] === 'string' ? normSafe(pj['owner'] as string) : null
				const posVal   = typeof pj['position'] === 'string' ? normSafe(pj['position'] as string) : null
				const matchesNft = ownerVal === nftNorm
				const matchesPos = posNorm && posVal === posNorm
				if (!matchesNft && !matchesPos) continue

				const seq = ev.id?.eventSeq ?? String(out.length)
				const id = `${txDigest}::${seq}`

				if (evTypeOrNull === 'collect_reward') {
					const rawCoinType = readRewardCoinType(pj)
					const rewardToken = rawCoinType ? symbolFromCoinType(rawCoinType) : 'REWARD'
					const rewardRaw = readRewardAmount(pj)
					const rewardHum = rawToHuman(rewardRaw, 9) // decimals resolved by enrichment

					out.push({
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
					})
					continue
				}

				const rawA = readAmountA(pj)
				const rawB = readAmountB(pj)
				const humA = rawToHuman(rawA, tokenADecimals)
				const humB = rawToHuman(rawB, tokenBDecimals)
				const liqDelta = readLiquidityDelta(pj)

				if (evTypeOrNull === 'add_liquidity') {
					foundOpeningEvent = true
					out.push({
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
					})
				} else if (evTypeOrNull === 'remove_liquidity') {
					out.push({
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
					})
				} else if (evTypeOrNull === 'collect_fee') {
					out.push({
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
					})
				}
			}
		}

		cursor = res.hasNextPage ? (res.nextCursor ?? undefined) : undefined
		page++

		// Early termination: once we've scanned past the opening add_liquidity event,
		// all subsequent (older) txs can't have events for this position.
		if (foundOpeningEvent) break

	} while (cursor && page < MAX_TX_PAGES)

	out.sort((a, b) => a.timestamp - b.timestamp)
	return out
}

// ---------------------------------------------------------------------------
// Cache invalidation (no persistent cache for Turbos yet)
// ---------------------------------------------------------------------------

export function invalidateTurbosEventCache(_wallet: string): void {
	// No persistent cache for Turbos events in this version
}
