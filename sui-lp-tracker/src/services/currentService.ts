/**
 * Current Finance lending (https://app.current.finance/lend).
 *
 * Obligation ids: GET https://api.current.finance/user/getObligationList/{address}
 * Market APR / price / decimals: GET /market/getMarketList?marketType=…
 *   (unfiltered list is MainMarket only — also load Ember / AltCoin / Ethena / …)
 * Balances: devInspect `obligation_query::get_obligation_overview` plus
 * `market_query::get_asset_market_rates` (official SDK query, JSON-RPC pool).
 * Claimable rewards: liquidity-mining obligation manager, SDK `calculateClaimableRewards`.
 *
 * Docs: https://current-finance.gitbook.io/buildkit
 * SDK: https://github.com/current-finance/current-sdk
 */
import type { BorrowPosition, LendingCashflowUsd, LendingRewardToClaim, LendingSnapshot, SupplyPosition } from '@/types'
import { suiClient } from '@/services/suiClient'
import { getUsdPerTokenAtTimestamp } from '@/services/priceService'
import { extFetchUrl } from '@/utils/externalFetchUrl'
import {
	enrichSupplyLiquidationPrices,
	normalizeLiquidationThresholdFactor,
} from '@/utils/supplyLiquidationPrice'
import { mapPool } from '@/utils/concurrency'
import { buildLendingCashflowUsd } from '@/utils/lendingCashflowUsd'
import { classifySuiObjectRead } from '@/utils/suiObjectRead'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'

const API = 'https://api.current.finance'
const PROTOCOL_PKG = '0x45bae0425e9098ce5cba3d3fa2836220ad24c9f88aa0dffffb5a52b49319fc70'
/** SDK `NetworkConfig.coinDecimalsRegistryId` for `get_asset_market_overview`. */
const COIN_DECIMALS_REGISTRY = '0x53785858526d8ed3826cfc245b0fd53f16179036f38fc024c3851ef07b1538d7'
const DECIMAL_SCALE = 10n ** 18n
const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n

/** Official BuildKit market object ids (mainnet). */
const MARKET_OBJECT_BY_TYPE: Record<string, string> = {
	'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket':
		'0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
	'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::EmberMarket':
		'0x8e85c433f791685c65fa66923110b8385e13f955daf8792ef805ce2d47139bbc',
	'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::AltCoinMarket':
		'0x6f5230c346e27132b8d4d92cb3f4f9c7f4e736d5c32b8f0a2b063c97e67d78f7',
	'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::EthenaMarket':
		'0xeeef7e9abe201e16c3ca6417b91fa49bec28edcb077eb2fd4a1f126c251e6899',
	'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MatrixGoldMarket':
		'0xafe28c816d322a56bdab27b90d4b5e882a0a34ee2d9f02c6a07402a2b69be900',
	'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::Market01':
		'0x2d682541f1e983e48d5c628f013d11d4c8f96f410338532791d3ece882766220',
}

/**
 * `/market/getMarketList` without a filter returns MainMarket only.
 * Pass short names (AltCoinMarket, EmberMarket, …) to load each venue’s assets.
 */
const MARKET_LIST_TYPES = [
	'MainMarket',
	'EmberMarket',
	'AltCoinMarket',
	'EthenaMarket',
	'MatrixGoldMarket',
	'Market01',
] as const

const decimalSchema = bcs.struct('Decimal', { value: bcs.u256() })
const overviewSchema = bcs.struct('ObligationDetail', {
	emode_group_id: bcs.u8(),
	borrows: bcs.vector(
		bcs.struct('ObligationBorrow', {
			asset: bcs.string(),
			borrow_index: decimalSchema,
			debt: decimalSchema,
		}),
	),
	deposits: bcs.vector(
		bcs.struct('ObligationDeposit', {
			asset: bcs.string(),
			ctoken_amount: bcs.u64(),
		}),
	),
})

export type CurrentMarketRow = {
	marketType?: string
	marketID?: string
	/** Human market label from Current `/market/getMarketList` (same for all assets in the market). */
	name?: string
	token?: string
	/** Liquidation LTV (0–1), API `liqLTV`. */
	liqLTV?: number
	/** Max borrow LTV (0–1), API `maxLTV`. */
	maxLTV?: number
	/**
	 * Risk weight on debt (API `borrowWeight`). Official docs:
	 * Current LTV = (debt × borrowWeight) / collateral_value.
	 */
	borrowWeight?: number
	supplyAPY?: number
	borrowAPY?: number
	tokenInfo?: {
		symbol?: string
		decimals?: string | number
		price?: string
		icon?: string | null
	}
}

type MarketRow = CurrentMarketRow

type ObligationRow = {
	obligationObject?: string
	marketType?: string
	emodeGroup?: number
}

function with0x(t: string): string {
	const s = t.trim()
	return s.startsWith('0x') || s.startsWith('0X') ? s : `0x${s}`
}

function typeKey(t: string): string {
	return t.trim().replace(/^0x/i, '').toLowerCase()
}

async function getJson<T>(path: string): Promise<T> {
	const res = await fetch(extFetchUrl(`${API}${path}`), { signal: AbortSignal.timeout(20_000) })
	if (!res.ok) throw new Error(`Current API ${res.status} ${path}`)
	const json = (await res.json()) as { code?: number; data?: T; message?: string }
	if (json.code != null && json.code !== 0) {
		throw new Error(`Current API ${json.message ?? json.code} ${path}`)
	}
	return json.data as T
}

let marketCache: { ts: number; rows: MarketRow[]; partial: boolean; failed: string[] } | null = null

export function currentMarketListMeta(): {
	receivedAtMs: number | null
	ageMs: number | null
	partial: boolean
	failedMarkets: string[]
} {
	if (!marketCache) return { receivedAtMs: null, ageMs: null, partial: false, failedMarkets: [] }
	return {
		receivedAtMs: marketCache.ts,
		ageMs: Date.now() - marketCache.ts,
		partial: marketCache.partial,
		failedMarkets: marketCache.failed,
	}
}

async function fetchMarketListPage(marketType?: string): Promise<MarketRow[]> {
	const q = marketType
		? `/market/getMarketList?page=1&size=100&marketType=${encodeURIComponent(marketType)}`
		: '/market/getMarketList?page=1&size=100'
	const data = await getJson<{ content?: MarketRow[] }>(q)
	return data?.content ?? []
}

export async function fetchAllMarketRows(): Promise<MarketRow[]> {
	const now = Date.now()
	if (!marketCache || now - marketCache.ts >= 60_000) {
		const failed: string[] = []
		const pages = await Promise.all(
			MARKET_LIST_TYPES.map(async (t) => {
				try {
					return await fetchMarketListPage(t)
				} catch (err) {
					console.warn('[Current] market list skipped', t, err)
					failed.push(t)
					return [] as MarketRow[]
				}
			}),
		)
		const merged: MarketRow[] = []
		const seen = new Set<string>()
		for (const page of pages) {
			for (const row of page) {
				const key = `${typeKey(row.marketType ?? '')}|${typeKey(row.token ?? '')}`
				if (seen.has(key)) continue
				seen.add(key)
				merged.push(row)
			}
		}
		// Fallback: unfiltered list (Main) if typed queries all failed.
		if (merged.length === 0) {
			try {
				merged.push(...(await fetchMarketListPage()))
			} catch (err) {
				console.warn('[Current] unfiltered market list failed', err)
				failed.push('unfiltered')
			}
		}
		marketCache = {
			ts: now,
			rows: merged,
			partial: failed.length > 0 || merged.length === 0,
			failed,
		}
	}
	return marketCache.rows
}

/** Rows for this market type only. Other markets are not a stand-in. */
function rowsForMarket(all: MarketRow[], marketType: string): MarketRow[] {
	const key = typeKey(marketType)
	return all.filter((r) => typeKey(r.marketType ?? '') === key)
}

function venueNameFromType(marketType: string): string {
	const name = marketType.split('::').pop() ?? 'Market'
	if (name === 'MainMarket') return 'Main'
	if (name === 'EmberMarket') return 'Ember'
	if (name === 'AltCoinMarket') return 'AltCoin'
	if (name === 'EthenaMarket') return 'Ethena'
	if (name === 'MatrixGoldMarket') return 'Matrix Gold'
	if (name === 'Market01') return 'sUSN Market'
	return name.replace(/([a-z])([A-Z0-9])/g, '$1 $2')
}

/** Supply base APR from market list row or on-chain rates — `0` is valid; missing is not. */
export function resolveCurrentSupplyBaseApr(
	listSupplyApy: number | undefined,
	chainSupplyApy: number | undefined,
): { baseApr: number; baseKnown: boolean } {
	if (typeof listSupplyApy === 'number' && Number.isFinite(listSupplyApy)) {
		return { baseApr: listSupplyApy, baseKnown: true }
	}
	if (typeof chainSupplyApy === 'number' && Number.isFinite(chainSupplyApy)) {
		return { baseApr: chainSupplyApy, baseKnown: true }
	}
	return { baseApr: Number.NaN, baseKnown: false }
}

/** Display label from Current list rows for this `marketObjectId` (not hardcoded Move type names). */
export function resolveCurrentVenueLabel(
	marketObjectId: string,
	listed: MarketRow[],
	marketType: string,
): string {
	const idKey = typeKey(marketObjectId)
	const rows = listed.filter((r) => typeKey(r.marketID ?? '') === idKey)
	const apiName = rows.find((r) => r.name?.trim())?.name?.trim()
	const typeShort = marketType.split('::').pop() ?? ''
	if (apiName && apiName !== typeShort) return apiName
	return venueNameFromType(marketType)
}

function resolveMarketObjectId(marketType: string, listed: MarketRow[]): string | null {
	const fromList = listed.find((r) => r.marketID)?.marketID
	if (typeof fromList === 'string' && fromList.startsWith('0x')) return fromList
	const key = typeKey(marketType)
	for (const [t, id] of Object.entries(MARKET_OBJECT_BY_TYPE)) {
		if (typeKey(t) === key) return id
	}
	return null
}

/** Obligation field `lending_market_id` when list/SDK map have no object id. */
async function readLendingMarketId(obligationId: string): Promise<string | null> {
	const client = suiClient
	const obj = await client.getObject({ id: obligationId, options: { showContent: true } })
	const id = (obj.data?.content as { fields?: { lending_market_id?: string } } | undefined)?.fields
		?.lending_market_id
	return typeof id === 'string' && id.startsWith('0x') ? id : null
}

function flowKey(marketType: string, coin: string): string {
	return `${typeKey(marketType)}|${typeKey(coin)}`
}

function marketByToken(rows: MarketRow[], asset: string): MarketRow | undefined {
	const key = typeKey(asset)
	return rows.find((r) => typeKey(r.token ?? '') === key)
}

async function inspectOverview(marketType: string, marketId: string, obligationId: string, sender: string) {
	const client = suiClient
	const tx = new Transaction()
	tx.moveCall({
		target: `${PROTOCOL_PKG}::obligation_query::get_obligation_overview`,
		typeArguments: [with0x(marketType)],
		arguments: [tx.object(marketId), tx.pure.id(obligationId)],
	})
	const res = await client.devInspectTransactionBlock({ sender, transactionBlock: tx })
	if (res.error) throw new Error(`Current overview: ${res.error}`)
	const raw = res.results?.[0]?.returnValues?.[0]?.[0]
	if (!raw) throw new Error('Current overview: empty return')
	return parseCurrentObligationOverviewReturn(raw)
}

/** DevInspect / gRPC simulate: first return value is BCS `ObligationDetail`. */
export function parseCurrentObligationOverviewReturn(raw: number[] | Uint8Array) {
	const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw)
	const parsed = overviewSchema.parse(bytes)
	return {
		emode_group_id: parsed.emode_group_id,
		deposits: Array.isArray(parsed.deposits) ? parsed.deposits : [],
		borrows: Array.isArray(parsed.borrows) ? parsed.borrows : [],
	}
}

/** Test helper: same BCS schema as live devInspect (gRPC `number[]`). */
export function encodeCurrentObligationOverviewForTest(
	input: Parameters<typeof overviewSchema.serialize>[0],
): number[] {
	return Array.from(overviewSchema.serialize(input).toBytes())
}

function parseRatesVectorReturn(raw: number[] | Uint8Array): ReturnType<typeof decimalSchema.parse>[] {
	const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw)
	const vec = bcs.vector(decimalSchema)
	return vec.parse(bytes)
}

/** Test helper for rates devInspect return (vector of two decimals). */
export function encodeCurrentRatesVectorForTest(
	decimals: Array<{ value: string | number | bigint }>,
): number[] {
	const vec = bcs.vector(decimalSchema)
	return Array.from(vec.serialize(decimals as never).toBytes())
}

/** Exported for tests (gRPC devInspect returns `number[]` bytes). */
export function parseCurrentRatesVectorReturn(raw: number[] | Uint8Array) {
	return parseRatesVectorReturn(raw)
}

async function inspectRates(
	marketType: string,
	marketId: string,
	assets: string[],
	sender: string,
): Promise<Map<string, { exchange: bigint; borrowIndex: bigint }>> {
	const out = new Map<string, { exchange: bigint; borrowIndex: bigint }>()
	if (assets.length === 0) return out
	const client = suiClient
	const tx = new Transaction()
	for (const asset of assets) {
		tx.moveCall({
			target: `${PROTOCOL_PKG}::market_query::get_asset_market_rates`,
			typeArguments: [with0x(marketType)],
			arguments: [tx.object(marketId), tx.pure.string(asset.replace(/^0x/i, '')), tx.object('0x6')],
		})
	}
	const res = await client.devInspectTransactionBlock({ sender, transactionBlock: tx })
	if (res.error) throw new Error(`Current rates: ${res.error}`)
	for (let i = 0; i < assets.length; i++) {
		const raw = res.results?.[i]?.returnValues?.[0]?.[0]
		if (!raw) continue
		const parsed = parseRatesVectorReturn(raw)
		out.set(typeKey(assets[i]!), {
			exchange: BigInt(parsed[0]?.value ?? 0),
			borrowIndex: BigInt(parsed[1]?.value ?? 0),
		})
	}
	return out
}

const overviewDecimal = bcs.struct('OverviewDecimal', { value: bcs.u256() })
const assetOverviewSchema = bcs.struct('AssetConfiguration', {
	coin_type: bcs.string(),
	interest_model: bcs.struct('InterestModel', {
		base_borrow_rate_per_sec: overviewDecimal,
		borrow_rate_on_mid_kink: overviewDecimal,
		mid_kink: overviewDecimal,
		borrow_rate_on_high_kink: overviewDecimal,
		high_kink: overviewDecimal,
		max_borrow_rate: overviewDecimal,
	}),
	utilization_rate: overviewDecimal,
	borrow_paused: bcs.bool(),
	deposit_paused: bcs.bool(),
	withdraw_paused: bcs.bool(),
	liquidation_paused: bcs.bool(),
	flash_loan_paused: bcs.bool(),
	reserve: bcs.u64(),
	asset_setting: bcs.struct('BorrowConfig', {
		min_borrow_amount: bcs.u64(),
		max_borrow_amount: bcs.u64(),
		max_deposit_amount: bcs.u64(),
		repay_fee_rate: overviewDecimal,
		liquidation_fee_rate: overviewDecimal,
	}),
	deposit_usage: bcs.struct('AssetDeposit', {
		is_collateral: bcs.bool(),
		valuation: bcs.struct('AssetValuation', {
			coin_type: bcs.string(),
			amount: bcs.u64(),
			usd: overviewDecimal,
			price: overviewDecimal,
		}),
		ctoken_amount: bcs.u64(),
		exchange_rate: overviewDecimal,
	}),
	borrow_usage: bcs.struct('AssetBorrow', {
		valuation: bcs.struct('BorrowValuation', {
			coin_type: bcs.string(),
			amount: bcs.u64(),
			usd: overviewDecimal,
			price: overviewDecimal,
		}),
		borrow_index: overviewDecimal,
	}),
})

function wadMul(a: bigint, b: bigint): bigint {
	return (a * b) / DECIMAL_SCALE
}

function wadDiv(a: bigint, b: bigint): bigint {
	if (b === 0n) return 0n
	return (a * DECIMAL_SCALE) / b
}

/** SDK `borrowInterestRate`: kinked per-second borrow rate. */
function borrowRatePerSec(
	model: {
		base_borrow_rate_per_sec: { value: string }
		borrow_rate_on_mid_kink: { value: string }
		mid_kink: { value: string }
		borrow_rate_on_high_kink: { value: string }
		high_kink: { value: string }
		max_borrow_rate: { value: string }
	},
	utilization: bigint,
): bigint {
	const base = BigInt(model.base_borrow_rate_per_sec.value)
	const mid = BigInt(model.mid_kink.value)
	const high = BigInt(model.high_kink.value)
	const onMid = BigInt(model.borrow_rate_on_mid_kink.value)
	const onHigh = BigInt(model.borrow_rate_on_high_kink.value)
	const max = BigInt(model.max_borrow_rate.value)
	const gap = (a: bigint, b: bigint) => (a > b ? a - b : 0n)
	if (utilization <= mid) return wadMul(wadDiv(utilization, mid), gap(onMid, base)) + base
	if (utilization <= high) return wadMul(wadDiv(gap(utilization, mid), gap(high, mid)), gap(onHigh, onMid)) + onMid
	return wadMul(wadDiv(gap(utilization, high), gap(DECIMAL_SCALE, high)), gap(max, onHigh)) + onHigh
}

function aprFromPerSec(perSec: bigint): number {
	const annual = (perSec * SECONDS_PER_YEAR * 1_000_000_000_000n) / DECIMAL_SCALE
	return Number(annual) / 1_000_000_000_000
}

/**
 * Base supply/borrow APR for markets missing from `/market/getMarketList`.
 * Official `market_query::get_asset_market_overview` plus SDK `depositInterestRate`:
 * supply per second = borrow per second × (1 − repay fee) × utilization,
 * then × 31_536_000. Matches MainMarket `supplyAPY` exactly.
 */
async function inspectInterestApr(
	marketType: string,
	marketId: string,
	assets: string[],
	sender: string,
): Promise<Map<string, { supply: number; borrow: number }>> {
	const out = new Map<string, { supply: number; borrow: number }>()
	if (assets.length === 0) return out
	const client = suiClient
	const tx = new Transaction()
	for (const asset of assets) {
		tx.moveCall({
			target: `${PROTOCOL_PKG}::market_query::get_asset_market_overview`,
			typeArguments: [with0x(marketType)],
			arguments: [
				tx.object(marketId),
				tx.pure.string(asset.replace(/^0x/i, '')),
				tx.object(COIN_DECIMALS_REGISTRY),
				tx.pure.u64(DECIMAL_SCALE),
				tx.pure.u64(DECIMAL_SCALE),
				tx.object('0x6'),
			],
		})
	}
	const res = await client.devInspectTransactionBlock({ sender, transactionBlock: tx })
	if (res.error) throw new Error(`Current interest overview: ${res.error}`)
	for (let i = 0; i < assets.length; i++) {
		const raw = res.results?.[i]?.returnValues?.[0]?.[0]
		if (!raw) continue
		const asset = assetOverviewSchema.parse(Uint8Array.from(raw))
		const utilization = BigInt(asset.utilization_rate.value)
		const fee = BigInt(asset.asset_setting.repay_fee_rate.value)
		const borrowPerSec = asset.borrow_paused ? 0n : borrowRatePerSec(asset.interest_model, utilization)
		const supplyPerSec = wadMul(wadMul(borrowRatePerSec(asset.interest_model, utilization), DECIMAL_SCALE - fee), utilization)
		out.set(typeKey(assets[i]!), { supply: aprFromPerSec(supplyPerSec), borrow: aprFromPerSec(borrowPerSec) })
	}
	return out
}

function humanFromRaw(raw: bigint, decimals: number): number {
	const scale = 10 ** decimals
	const neg = raw < 0n
	const v = neg ? -raw : raw
	const whole = v / BigInt(scale)
	const frac = v % BigInt(scale)
	const n = Number(whole) + Number(frac) / scale
	return neg ? -n : n
}

function coinRaw(scaled: bigint, scale = DECIMAL_SCALE): bigint {
	if (scale === 0n) return 0n
	return scaled / scale
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000

function normTypeName(s: string): string {
	const parts = s.trim().replace(/^0x/i, '').split('::')
	if (parts.length < 3) return s.trim().replace(/^0x/i, '')
	return `${parts[0]!.padStart(64, '0').toLowerCase()}::${parts.slice(1).join('::')}`
}

export type CurrentReadStatus = 'complete' | 'empty' | 'partial' | 'unavailable'

export type MiningAprPart = {
	symbol: string
	coinType: string
	apr: number | null
	amountRaw: string
	decimals: number | null
	priceUsd: number | null
}

export type MiningAprRead = {
	status: CurrentReadStatus
	/** Fraction. Null when the read is unavailable. 0 when confirmed empty. */
	apr: number | null
	parts: MiningAprPart[]
	reason?: string
	readAtMs: number
}

export type ClaimableMiningRow = {
	symbol: string
	coinType: string
	amountRaw: string
	decimals: number | null
	amount: number | null
	valueUSD: number | null
}

export type ClaimableMiningRead = {
	status: CurrentReadStatus
	rows: ClaimableMiningRow[]
	reason?: string
	readAtMs: number
}

/**
 * Parallel mining APR reads + claimable rewards (one obligation).
 * Fixed in 0f9b209: Promise.all returns 2 values, not 3 (216139c bug).
 */
export async function parallelCurrentMiningAndClaimable<
	TDep extends MiningAprRead,
	TBor extends MiningAprRead,
	TMined extends ClaimableMiningRead,
>(
	depositMiningReads: Promise<TDep>[],
	borrowMiningReads: Promise<TBor>[],
	claimableRead: Promise<TMined>,
): Promise<{
	depositMiningResults: TDep[]
	borrowMiningResults: TBor[]
	mined: TMined
}> {
	return parallelCurrentMiningAndClaimableFromBundle(
		Promise.all([Promise.all(depositMiningReads), Promise.all(borrowMiningReads)]),
		claimableRead,
	)
}

/** Matches production: mining bundle promise ∥ claimable (gRPC-safe unpack). */
export async function parallelCurrentMiningAndClaimableFromBundle<
	TDep extends MiningAprRead,
	TBor extends MiningAprRead,
	TMined extends ClaimableMiningRead,
>(
	miningBundlePromise: Promise<[TDep[], TBor[]]>,
	claimableRead: Promise<TMined>,
): Promise<{
	depositMiningResults: TDep[]
	borrowMiningResults: TBor[]
	mined: TMined
}> {
	const [miningBundle, mined] = await Promise.all([miningBundlePromise, claimableRead])
	const [depositMiningResults, borrowMiningResults] = miningBundle
	return { depositMiningResults, borrowMiningResults, mined }
}

/** Pre-0f9b209 bug — used only in regression tests (216139c). */
export async function parallelCurrentMiningAndClaimableWrong216139c<
	TDep extends MiningAprRead,
	TBor extends MiningAprRead,
	TMined extends ClaimableMiningRead,
>(
	miningBundlePromise: Promise<[TDep[], TBor[]]>,
	claimableRead: Promise<TMined>,
): Promise<{
	depositMiningResults: [TDep[], TBor[]]
	borrowMiningResults: TMined
	mined: undefined
}> {
	const packed = (await Promise.all([miningBundlePromise, claimableRead])) as unknown as [
		[TDep[], TBor[]],
		TMined,
		undefined,
	]
	const depositMiningResults = packed[0]
	const borrowMiningResults = packed[1]
	const mined = packed[2]
	return {
		depositMiningResults: depositMiningResults as [TDep[], TBor[]],
		borrowMiningResults: borrowMiningResults as TMined,
		mined,
	}
}

type RewardPart = { symbol: string; coinType: string; apr: number }

function readDecimals(meta: MarketRow | undefined): number | null {
	const d = Number(meta?.tokenInfo?.decimals)
	return Number.isFinite(d) && d >= 0 && d <= 18 ? d : null
}

function readPrice(meta: MarketRow | undefined): number | null {
	const p = Number(meta?.tokenInfo?.price)
	return Number.isFinite(p) && p > 0 ? p : null
}

/** Liquidity-mining APR. Confirmed empty (no pool) is apr 0. RPC/metadata failures stay unavailable. */
export async function readMiningRewardApr(
	marketId: string,
	side: 'deposit' | 'borrow',
	reserveCoin: string,
	exchangeOrIndex: bigint,
	reserveDecimals: number,
	reservePrice: number,
	listed: MarketRow[],
	priceCatalog?: MarketRow[],
): Promise<MiningAprRead> {
	const catalog = priceCatalog ?? listed
	const readAtMs = Date.now()
	if (!(reservePrice > 0) || exchangeOrIndex <= 0n || !(reserveDecimals >= 0)) {
		return { status: 'unavailable', apr: null, parts: [], reason: 'reserve price or scale missing', readAtMs }
	}
	let market: Awaited<ReturnType<typeof suiClient.getObject>>
	try {
		market = await suiClient.getObject({ id: marketId, options: { showContent: true } })
	} catch (err) {
		return { status: 'unavailable', apr: null, parts: [], reason: err instanceof Error ? err.message : String(err), readAtMs }
	}
	const marketClass = classifySuiObjectRead(market)
	if (marketClass.kind !== 'ok') {
		return { status: 'unavailable', apr: null, parts: [], reason: marketClass.reason || 'market object', readAtMs }
	}
	const content = fieldsOf(market.data?.content)
	const miner = fieldsOf(content?.liquidity_miner)
	const tableId = uidOf(miner?.[side])
	if (!miner) {
		return { status: 'unavailable', apr: null, parts: [], reason: 'malformed liquidity miner', readAtMs }
	}
	if (!tableId) {
		return { status: 'empty', apr: 0, parts: [], reason: 'no mining table', readAtMs }
	}
	let df: Awaited<ReturnType<typeof suiClient.getDynamicFieldObject>>
	try {
		df = await suiClient.getDynamicFieldObject({
			parentId: tableId,
			name: { type: '0x1::type_name::TypeName', value: { name: normTypeName(reserveCoin) } },
		})
	} catch (err) {
		const classified = classifySuiObjectRead(null, err)
		if (classified.kind === 'not_found') return { status: 'empty', apr: 0, parts: [], readAtMs }
		return { status: 'unavailable', apr: null, parts: [], reason: classified.reason, readAtMs }
	}
	const dfClass = classifySuiObjectRead(df)
	if (dfClass.kind === 'not_found') return { status: 'empty', apr: 0, parts: [], readAtMs }
	if (dfClass.kind !== 'ok') {
		return { status: 'unavailable', apr: null, parts: [], reason: dfClass.reason, readAtMs }
	}
	const manager = fieldsOf(fieldsOf(df.data?.content)?.value)
	if (!manager) {
		return { status: 'unavailable', apr: null, parts: [], reason: 'malformed reward manager', readAtMs }
	}
	const totalShares = BigInt(String(manager.total_shares ?? '0'))
	if (totalShares <= 0n) return { status: 'empty', apr: 0, parts: [], readAtMs }
	const underlyingRaw = coinRaw(totalShares * exchangeOrIndex)
	const tvl = humanFromRaw(underlyingRaw, reserveDecimals) * reservePrice
	if (!(tvl > 0)) return { status: 'unavailable', apr: null, parts: [], reason: 'reserve tvl missing', readAtMs }
	const now = Date.now()
	const parts: MiningAprPart[] = []
	let missingMeta = false
	const rewards = Array.isArray(manager.pool_rewards) ? manager.pool_rewards : []
	for (const reward of rewards) {
		const f = fieldsOf(reward) ?? {}
		const start = Number(f.start_time_ms ?? 0)
		const end = Number(f.end_time_ms ?? 0)
		if (!(start <= now && now < end) || end <= start) continue
		const coin = typeNameString(f.coin_type ?? (f as { coinType?: unknown }).coinType)
		if (!coin) continue
		const meta = marketByToken(catalog, coin)
		const dec = readDecimals(meta)
		const price = readPrice(meta)
		const raw = String(f.total_rewards ?? '0')
		if (dec == null || price == null) {
			missingMeta = true
			parts.push({
				symbol: meta?.tokenInfo?.symbol ?? coin.split('::').pop() ?? '?',
				coinType: with0x(coin),
				apr: null,
				amountRaw: raw,
				decimals: dec,
				priceUsd: price,
			})
			continue
		}
		const total = humanFromRaw(BigInt(raw), dec)
		const annual = total * (YEAR_MS / (end - start))
		const apr = (annual * price) / tvl
		parts.push({
			symbol: meta?.tokenInfo?.symbol ?? coin.split('::').pop() ?? '?',
			coinType: with0x(coin),
			apr,
			amountRaw: raw,
			decimals: dec,
			priceUsd: price,
		})
	}
	const priced = parts.filter((p) => p.apr != null)
	if (parts.length === 0) return { status: 'empty', apr: 0, parts: [], readAtMs }
	if (missingMeta) {
		return {
			status: 'partial',
			apr: priced.reduce((s, p) => s + (p.apr ?? 0), 0),
			parts,
			reason: 'reward metadata incomplete',
			readAtMs,
		}
	}
	return { status: 'complete', apr: priced.reduce((s, p) => s + (p.apr ?? 0), 0), parts, readAtMs }
}

/** Compatibility adapter. Throws when the read is unavailable so callers cannot treat it as zero. */
export async function miningRewardApr(
	marketId: string,
	side: 'deposit' | 'borrow',
	reserveCoin: string,
	exchangeOrIndex: bigint,
	reserveDecimals: number,
	reservePrice: number,
	listed: MarketRow[],
): Promise<{ apr: number; parts: RewardPart[] }> {
	const read = await readMiningRewardApr(
		marketId,
		side,
		reserveCoin,
		exchangeOrIndex,
		reserveDecimals,
		reservePrice,
		listed,
	)
	if (read.status === 'unavailable') throw new Error(read.reason ?? 'mining apr unavailable')
	return {
		apr: read.apr ?? 0,
		parts: read.parts
			.filter((p): p is MiningAprPart & { apr: number } => p.apr != null)
			.map((p) => ({ symbol: p.symbol, coinType: p.coinType, apr: p.apr })),
	}
}

function moveDecimal(v: unknown): bigint {
	if (v == null) return 0n
	if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') return BigInt(v)
	const o = v as { value?: string; fields?: { value?: string } }
	if (o.value != null) return BigInt(o.value)
	if (o.fields?.value != null) return BigInt(o.fields.value)
	return 0n
}

/** JSON-RPC nests Move structs under `.fields`; gRPC/GraphQL json is flat. */
function fieldsOf(v: unknown): Record<string, unknown> | null {
	if (!v || typeof v !== 'object') return null
	const o = v as { fields?: Record<string, unknown> }
	if (o.fields && typeof o.fields === 'object') return o.fields
	return o as Record<string, unknown>
}

function uidOf(v: unknown): string | null {
	if (typeof v === 'string' && v.startsWith('0x')) return v
	const f = fieldsOf(v)
	const id = f?.id
	if (typeof id === 'string' && id.startsWith('0x')) return id
	if (id && typeof id === 'object') {
		const inner = (id as { id?: string }).id
		if (typeof inner === 'string' && inner.startsWith('0x')) return inner
	}
	return null
}

function typeNameString(v: unknown): string {
	if (typeof v === 'string') return v
	const f = fieldsOf(v)
	if (typeof f?.name === 'string') return f.name
	return ''
}

function mulDec(a: bigint, b: bigint): bigint {
	return (a * b) / DECIMAL_SCALE
}

function divDec(a: bigint, b: bigint): bigint {
	if (b === 0n) return 0n
	return (a * DECIMAL_SCALE) / b
}

/** Raw claimable per reward coin. Matches Current SDK `calculateClaimableRewards`. */
function claimableRows(
	pool: Record<string, unknown>,
	ob: Record<string, unknown>,
	now: bigint,
): { coin: string; raw: bigint }[] {
	const share = BigInt(String(ob.share ?? '0'))
	const totalShares = BigInt(String(pool.total_shares ?? '0'))
	if (share <= 0n || totalShares <= 0n) return []
	const poolLast = BigInt(String(pool.last_update_time_ms ?? '0'))
	const obLast = BigInt(String(ob.last_update_time_ms ?? '0'))
	const rewards = Array.isArray(pool.pool_rewards) ? pool.pool_rewards : []
	const slots = Array.isArray(ob.rewards) ? ob.rewards : []
	const totalSharesDec = totalShares * DECIMAL_SCALE
	const out: { coin: string; raw: bigint }[] = []
	for (let i = 0; i < rewards.length; i++) {
		const f = fieldsOf(rewards[i]) ?? {}
		const start = BigInt(String(f.start_time_ms ?? '0'))
		const end = BigInt(String(f.end_time_ms ?? '0'))
		const duration = end > start ? end - start : 0n
		let updated = moveDecimal(f.cumulative_rewards_per_share)
		if (now > poolLast && duration > 0n) {
			const maxStart = start > poolLast ? start : poolLast
			const minEnd = end < now ? end : now
			if (minEnd > maxStart) {
				const timePassed = minEnd - maxStart
				const totalRewards = BigInt(String(f.total_rewards ?? '0'))
				const unlocked = divDec(
					mulDec(totalRewards * DECIMAL_SCALE, timePassed * DECIMAL_SCALE),
					duration * DECIMAL_SCALE,
				)
				updated += divDec(unlocked, totalSharesDec)
			}
		}
		const slot = fieldsOf(slots[i])
		let prev: bigint
		let earned = 0n
		if (slot && slot.cumulative_rewards_per_share != null && slot.earned_rewards != null) {
			prev = moveDecimal(slot.cumulative_rewards_per_share)
			earned = moveDecimal(slot.earned_rewards)
		} else if (obLast <= end) {
			if (obLast <= start) earned = updated * share
			prev = updated
		} else {
			prev = updated
		}
		const claim = (earned + (updated - prev) * share) / DECIMAL_SCALE
		if (claim <= 0n) continue
		const coin = typeNameString(f.coin_type)
		if (!coin) continue
		out.push({ coin, raw: claim })
	}
	return out
}

/** Claimable LM tokens. Confirmed absence is empty; RPC failures are unavailable. */
export async function readClaimableMining(
	marketId: string,
	obligationId: string,
	deposits: string[],
	borrows: string[],
	listed: MarketRow[],
): Promise<ClaimableMiningRead> {
	const readAtMs = Date.now()
	const bySide = {
		deposit: [...new Set(deposits.map(normTypeName))],
		borrow: [...new Set(borrows.map(normTypeName))],
	}
	if (bySide.deposit.length === 0 && bySide.borrow.length === 0) {
		return { status: 'empty', rows: [], readAtMs }
	}
	let market: Awaited<ReturnType<typeof suiClient.getObject>>
	try {
		market = await suiClient.getObject({ id: marketId, options: { showContent: true } })
	} catch (err) {
		return {
			status: 'unavailable',
			rows: [],
			reason: err instanceof Error ? err.message : String(err),
			readAtMs,
		}
	}
	const marketClass = classifySuiObjectRead(market)
	if (marketClass.kind !== 'ok') {
		return { status: 'unavailable', rows: [], reason: marketClass.reason || 'market object', readAtMs }
	}
	const miner = fieldsOf(fieldsOf(market.data?.content)?.liquidity_miner)
	if (!miner) return { status: 'unavailable', rows: [], reason: 'malformed liquidity miner', readAtMs }
	const now = BigInt(Date.now())
	const rawByCoin = new Map<string, bigint>()
	let sawError = false
	let errorReason = ''
	let sawPool = false
	const sides = ['deposit', 'borrow'] as const
	for (const side of sides) {
		const coins = bySide[side]
		if (coins.length === 0) continue
		const parentId = uidOf(miner[side])
		if (!parentId) continue
		for (const coin of coins) {
			let poolDf: Awaited<ReturnType<typeof suiClient.getDynamicFieldObject>>
			try {
				poolDf = await suiClient.getDynamicFieldObject({
					parentId,
					name: { type: '0x1::type_name::TypeName', value: { name: coin } },
				})
			} catch (err) {
				const classified = classifySuiObjectRead(null, err)
				if (classified.kind === 'not_found') continue
				sawError = true
				errorReason = classified.reason
				continue
			}
			const poolClass = classifySuiObjectRead(poolDf)
			if (poolClass.kind === 'not_found') continue
			if (poolClass.kind !== 'ok') {
				sawError = true
				errorReason = poolClass.reason
				continue
			}
			const pool = fieldsOf(fieldsOf(poolDf.data?.content)?.value)
			if (!pool) {
				sawError = true
				errorReason = 'malformed reward pool'
				continue
			}
			sawPool = true
			const obParent = uidOf(pool.obligation_reward_managers)
			if (!obParent) continue
			let obDf: Awaited<ReturnType<typeof suiClient.getDynamicFieldObject>>
			try {
				obDf = await suiClient.getDynamicFieldObject({
					parentId: obParent,
					name: { type: '0x2::object::ID', value: obligationId },
				})
			} catch (err) {
				const classified = classifySuiObjectRead(null, err)
				if (classified.kind === 'not_found') continue
				sawError = true
				errorReason = classified.reason
				continue
			}
			const obClass = classifySuiObjectRead(obDf)
			if (obClass.kind === 'not_found') continue
			if (obClass.kind !== 'ok') {
				sawError = true
				errorReason = obClass.reason
				continue
			}
			const ob = fieldsOf(fieldsOf(obDf.data?.content)?.value)
			if (!ob) {
				sawError = true
				errorReason = 'malformed obligation rewards'
				continue
			}
			for (const row of claimableRows(pool, ob, now)) {
				rawByCoin.set(row.coin, (rawByCoin.get(row.coin) ?? 0n) + row.raw)
			}
		}
	}
	const rows: ClaimableMiningRow[] = []
	let missingMeta = false
	for (const [coin, raw] of rawByCoin) {
		if (raw <= 0n) continue
		const meta = marketByToken(listed, coin)
		const decimals = readDecimals(meta)
		const price = readPrice(meta)
		const amount = decimals != null ? humanFromRaw(raw, decimals) : null
		if (decimals == null || price == null || amount == null) missingMeta = true
		rows.push({
			coinType: with0x(coin),
			symbol: meta?.tokenInfo?.symbol ?? coin.split('::').pop() ?? '?',
			amountRaw: raw.toString(),
			decimals,
			amount,
			valueUSD: amount != null && price != null ? amount * price : null,
		})
	}
	if (sawError && rows.length === 0 && !sawPool) {
		return { status: 'unavailable', rows: [], reason: errorReason || 'reward read failed', readAtMs }
	}
	if (rows.length === 0 && !sawError) return { status: 'empty', rows: [], readAtMs }
	if (sawError || missingMeta) {
		return { status: 'partial', rows, reason: errorReason || 'reward metadata incomplete', readAtMs }
	}
	return { status: 'complete', rows, readAtMs }
}

/** Adapter for Current Lend. Throws on unavailable so an empty list is not a failed read. */
export async function claimableMining(
	marketId: string,
	obligationId: string,
	deposits: string[],
	borrows: string[],
	listed: MarketRow[],
): Promise<LendingRewardToClaim[]> {
	const read = await readClaimableMining(marketId, obligationId, deposits, borrows, listed)
	if (read.status === 'unavailable') throw new Error(read.reason ?? 'claimable rewards unavailable')
	const out: LendingRewardToClaim[] = []
	for (const row of read.rows) {
		if (row.amount == null || row.valueUSD == null) continue
		out.push({
			coinType: row.coinType,
			symbol: row.symbol,
			amount: row.amount,
			valueUSD: row.valueUSD,
		})
	}
	return out
}

function mergeClaimed(rows: LendingRewardToClaim[]): LendingRewardToClaim[] {
	const map = new Map<string, LendingRewardToClaim>()
	for (const r of rows) {
		const prev = map.get(r.coinType)
		if (!prev) {
			map.set(r.coinType, { ...r })
			continue
		}
		prev.amount += r.amount
		prev.valueUSD += r.valueUSD
	}
	return [...map.values()]
}

const TX_DEPOSIT = 1
const TX_WITHDRAW = 2
const TX_BORROW = 3
const TX_REPAY = 4
const TX_LIQUIDATE = 5

type HistoryItem = {
	type?: number
	amount?: number | string
	refund?: number | string | null
	token?: string
	chainTimestampMS?: number
	tokenInfo?: { symbol?: string; decimals?: string | number; price?: string }
}

type HistoryPage = {
	content?: HistoryItem[]
	last?: boolean
}

type ClaimHistoryRow = {
	chainTimestampMs?: number
	rewards?: Array<{ rewardCoinType?: string; rewardAmount?: number | string }>
}

function num(v: number | string | null | undefined): number {
	const n = typeof v === 'number' ? v : Number(v ?? 0)
	return Number.isFinite(n) ? n : 0
}

async function usdAt(
	symbol: string,
	coinType: string,
	timestampMs: number,
	fallback: number,
	cache: Map<string, { px: number; spot: boolean }>,
): Promise<{ px: number; spot: boolean }> {
	const sec = Math.floor(timestampMs / 1000)
	const key = `${typeKey(coinType || symbol)}:${sec}`
	const hit = cache.get(key)
	if (hit) return hit
	const quote = symbol
		? await getUsdPerTokenAtTimestamp(symbol, with0x(coinType), sec).catch(() => null)
		: null
	if (quote?.usdPerToken != null && quote.usdPerToken > 0) {
		const row = { px: quote.usdPerToken, spot: quote.approximate }
		cache.set(key, row)
		return row
	}
	return { px: Number.isFinite(fallback) && fallback > 0 ? fallback : 0, spot: true }
}

async function fetchMarketHistory(address: string, marketType: string): Promise<HistoryItem[]> {
	const out: HistoryItem[] = []
	for (let page = 1; page <= 20; page++) {
		const q = new URLSearchParams({
			userAddress: address,
			marketType,
			product: '1',
			page: String(page),
			size: '50',
		})
		const data = await getJson<HistoryPage>(`/user/getMarketTransactionHistory?${q}`)
		out.push(...(data?.content ?? []))
		if (data?.last !== false) break
	}
	return out
}

/**
 * Current history API (`/user/getMarketTransactionHistory`, product=Market).
 * Maps are token amounts: deposits minus withdrawals, borrows minus repayments.
 * Repay refund is change returned, so it is not part of the repayment.
 * Claimed rewards are priced at the claim. Interest USD is applied by the caller
 * from the token delta at the current price.
 */
async function loadCashflowTokens(
	address: string,
	marketTypes: string[],
	listed: MarketRow[],
): Promise<{
	deposited: Map<string, number>
	borrowed: Map<string, number>
	claimedRewardsUSD: number
	usedSpotPrice: boolean
	historyFailed: Set<string>
} | null> {
	const items: Array<HistoryItem & { marketType: string }> = []
	const historyFailed = new Set<string>()
	const pages = await mapPool(marketTypes, 4, async (marketType) => {
		try {
			const page = await fetchMarketHistory(address, marketType)
			return { marketType, page }
		} catch (err) {
			historyFailed.add(typeKey(marketType))
			console.warn('[Current] history skipped', marketType, err)
			return { marketType, page: [] as HistoryItem[] }
		}
	})
	for (const { marketType, page } of pages) {
		for (const item of page) items.push({ ...item, marketType })
	}
	items.sort((a, b) => (a.chainTimestampMS ?? 0) - (b.chainTimestampMS ?? 0))
	const cache = new Map<string, { px: number; spot: boolean }>()
	const deposited = new Map<string, number>()
	const borrowed = new Map<string, number>()
	const borrowedCoins = new Set<string>()

	const add = (map: Map<string, number>, coin: string, amount: number) => {
		map.set(coin, (map.get(coin) ?? 0) + amount)
	}

	for (const item of items) {
		const coin = typeKey(item.token ?? '')
		const market = item.marketType ?? ''
		if (!coin || !market) continue
		const key = flowKey(market, coin)
		const decimals = Number(item.tokenInfo?.decimals ?? 0)
		const scale = 10 ** (Number.isFinite(decimals) ? decimals : 0)
		const human = num(item.amount) / scale
		const refundHuman = num(item.refund) / scale
		if (!(human > 0)) continue
		const type = item.type
		if (type === TX_DEPOSIT) add(deposited, key, human)
		else if (type === TX_WITHDRAW) add(deposited, key, -human)
		else if (type === TX_BORROW) {
			borrowedCoins.add(key)
			add(borrowed, key, human)
		} else if (type === TX_REPAY) {
			add(borrowed, key, -Math.max(0, human - refundHuman))
		} else if (type === TX_LIQUIDATE) {
			if (borrowedCoins.has(key)) add(borrowed, key, -human)
			else add(deposited, key, -human)
		}
	}

	let claimedRewardsUSD = 0
	let usedSpotPrice = false
	const claims = await getJson<ClaimHistoryRow[]>(`/user/getLiquidityMiningHistory/${address}`).catch(
		() => [] as ClaimHistoryRow[],
	)
	for (const row of claims ?? []) {
		const ts = row.chainTimestampMs ?? 0
		for (const reward of row.rewards ?? []) {
			const coin = reward.rewardCoinType ?? ''
			const meta = marketByToken(listed, coin)
			const decimals = Number(meta?.tokenInfo?.decimals ?? (coin.endsWith('::sui::SUI') ? 9 : 6))
			const human = num(reward.rewardAmount) / 10 ** (Number.isFinite(decimals) ? decimals : 9)
			if (!(human > 0)) continue
			const symbol = meta?.tokenInfo?.symbol ?? coin.split('::').pop() ?? ''
			const fallback = Number(meta?.tokenInfo?.price ?? 0)
			const { px, spot } = await usdAt(symbol, coin, ts, fallback, cache)
			if (spot) usedSpotPrice = true
			if (px > 0) claimedRewardsUSD += human * px
		}
	}

	return { deposited, borrowed, claimedRewardsUSD, usedSpotPrice, historyFailed }
}

function currentAdvisorTimingEnabled(): boolean {
	return (
		typeof process !== 'undefined' &&
		process.env?.VITEST !== 'true' &&
		process.env?.SUI_LP_ADVISOR_DEV_TIMING === '1'
	)
}

function logCurrentAdvisorStep(step: string, ms: number): void {
	console.log(`[advisor-state] current/${step}: ${ms.toFixed(0)}ms`)
}

async function currentAdvisorTimed<T>(step: string, fn: () => Promise<T>): Promise<T> {
	if (!currentAdvisorTimingEnabled()) return fn()
	const t0 = performance.now()
	try {
		return await fn()
	} finally {
		logCurrentAdvisorStep(step, performance.now() - t0)
	}
}

export async function getCurrentPositions(
	walletAddress: string,
	options?: { skipCashflow?: boolean },
): Promise<LendingSnapshot> {
	const obligations = await currentAdvisorTimed('obligations-rest', () =>
		getJson<ObligationRow[]>(`/user/getObligationList/${walletAddress}`),
	)
	const rows = (obligations ?? []).filter((o) => o.obligationObject && o.marketType)
	if (rows.length === 0) return EMPTY_CURRENT_SNAP

	const supplies: SupplyPosition[] = []
	const borrows: BorrowPosition[] = []
	const claimed: LendingRewardToClaim[] = []
	const marketTypes: string[] = []
	const marketOf = new Map<SupplyPosition | BorrowPosition, string>()
	/** Per-borrow API `borrowWeight` (default 1). */
	const borrowWeightOf = new Map<BorrowPosition, number>()
	/** Per-supply API `maxLTV` for safe borrow limit. */
	const maxLtvOf = new Map<SupplyPosition, number>()
	const allListed = await currentAdvisorTimed('markets-rest', () => fetchAllMarketRows())

	let devInspectMs = 0
	let miningMs = 0
	let claimableMs = 0
	async function currentAdvisorAccum<T>(
		bucket: 'devInspect' | 'mining' | 'claimable',
		fn: () => Promise<T>,
	): Promise<T> {
		if (!currentAdvisorTimingEnabled()) return fn()
		const t0 = performance.now()
		try {
			return await fn()
		} finally {
			const delta = performance.now() - t0
			if (bucket === 'devInspect') devInspectMs += delta
			else if (bucket === 'mining') miningMs += delta
			else claimableMs += delta
		}
	}

	let skippedObligations = 0
	for (const ob of rows) {
		const marketType = ob.marketType!
		try {
		if (!marketTypes.includes(marketType)) marketTypes.push(marketType)
		const listed = rowsForMarket(allListed, marketType)
		const priceRows = listed.length > 0 ? listed : allListed
		const marketObjectId =
			resolveMarketObjectId(marketType, listed) ??
			(await readLendingMarketId(ob.obligationObject!)) ??
			undefined
		if (!marketObjectId) {
			throw new Error(`Current market object missing for ${marketType}`)
		}
		const overview = await currentAdvisorAccum('devInspect', () =>
			inspectOverview(marketType, marketObjectId, ob.obligationObject!, walletAddress),
		)
		const assets = [
			...overview.deposits.map((d) => d.asset),
			...overview.borrows.map((b) => b.asset),
		]
		const rates = await currentAdvisorAccum('devInspect', () =>
			inspectRates(marketType, marketObjectId, assets, walletAddress),
		)
		const chainApr = await currentAdvisorAccum('devInspect', async () =>
			listed.length > 0
				? new Map<string, { supply: number; borrow: number }>()
				: await inspectInterestApr(marketType, marketObjectId, assets, walletAddress).catch((err) => {
						console.warn('[Current] interest overview', marketType, err)
						return new Map<string, { supply: number; borrow: number }>()
					}),
		)

		// Parallelize mining APR reads for all deposits and borrows
		const depositMiningReads = overview.deposits.map((dep) => {
			const own = marketByToken(listed, dep.asset)
			const meta = own ?? marketByToken(priceRows, dep.asset)
			const rate = rates.get(typeKey(dep.asset))
			const exchange = rate?.exchange ?? DECIMAL_SCALE
			const decimals = Number(meta?.tokenInfo?.decimals ?? 9)
			const price = Number(meta?.tokenInfo?.price ?? 0)
			return readMiningRewardApr(
				marketObjectId,
				'deposit',
				dep.asset,
				exchange,
				decimals,
				price,
				priceRows,
				allListed,
			).catch((err) => ({
				status: 'unavailable' as const,
				apr: null,
				parts: [] as MiningAprPart[],
				reason: err instanceof Error ? err.message : String(err),
				readAtMs: Date.now(),
			}))
		})

		const borrowMiningReads = overview.borrows.map((bor) => {
			const own = marketByToken(listed, bor.asset)
			const meta = own ?? marketByToken(priceRows, bor.asset)
			const decimals = Number(meta?.tokenInfo?.decimals ?? 6)
			const price = Number(meta?.tokenInfo?.price ?? 0)
			return readMiningRewardApr(
				marketObjectId,
				'borrow',
				bor.asset,
				DECIMAL_SCALE,
				decimals,
				price,
				priceRows,
				allListed,
			).catch((err) => ({
				status: 'unavailable' as const,
				apr: null,
				parts: [] as MiningAprPart[],
				reason: err instanceof Error ? err.message : String(err),
				readAtMs: Date.now(),
			}))
		})

		const claimableP = currentAdvisorAccum('claimable', () =>
			readClaimableMining(
				marketObjectId,
				ob.obligationObject!,
				overview.deposits.map((d) => d.asset),
				overview.borrows.map((b) => b.asset),
				priceRows,
			).catch((err) => ({
				status: 'unavailable' as const,
				rows: [] as ClaimableMiningRow[],
				reason: err instanceof Error ? err.message : String(err),
				readAtMs: Date.now(),
			})),
		)
		const miningP = currentAdvisorAccum('mining', () =>
			Promise.all([Promise.all(depositMiningReads), Promise.all(borrowMiningReads)]),
		)
		const { depositMiningResults, borrowMiningResults, mined } =
			await parallelCurrentMiningAndClaimableFromBundle(miningP, claimableP)

		for (let i = 0; i < overview.deposits.length; i++) {
			const dep = overview.deposits[i]!
			const mining = depositMiningResults[i]!
			const own = marketByToken(listed, dep.asset)
			const meta = own ?? marketByToken(priceRows, dep.asset)
			const rate = rates.get(typeKey(dep.asset))
			const exchange = rate?.exchange ?? DECIMAL_SCALE
			const decimals = Number(meta?.tokenInfo?.decimals ?? 9)
			const raw = coinRaw(BigInt(dep.ctoken_amount) * exchange)
			const amount = humanFromRaw(raw, decimals)
			if (amount <= 0) continue
			const price = Number(meta?.tokenInfo?.price ?? 0)
			const usd = amount * (Number.isFinite(price) ? price : 0)
			const { baseApr, baseKnown } = resolveCurrentSupplyBaseApr(
				own?.supplyAPY,
				chainApr.get(typeKey(dep.asset))?.supply,
			)
			const rewardKnown = mining.status === 'complete' || mining.status === 'empty'
			const rewardApr = rewardKnown ? (mining.apr ?? 0) : 0
			const symbol = meta?.tokenInfo?.symbol ?? dep.asset.split('::').pop() ?? '?'
			const supply: SupplyPosition = {
				id: `current-supply-${ob.obligationObject}-${typeKey(dep.asset)}`,
				asset: symbol,
				coinType: with0x(dep.asset),
				sCoinType: '',
				suppliedAmount: amount,
				currentAmount: amount,
				earnedInterest: 0,
				earnedInterestUSD: 0,
				supplyAPR: baseKnown
					? baseApr + (rewardKnown ? rewardApr : 0)
					: rewardKnown
						? rewardApr
						: Number.NaN,
				supplyRewardAPR: rewardKnown ? rewardApr : undefined,
				aprBreakdown: {
					baseAPR: baseKnown ? baseApr : Number.NaN,
					rewardAPR: rewardKnown ? rewardApr : Number.NaN,
					rewards: mining.parts
						.filter((p) => p.apr != null)
						.map((p) => ({ symbol: p.symbol, coinType: p.coinType, apr: p.apr! })),
					rewardReadStatus: mining.status,
				},
				currentValueUSD: usd,
				liquidationThresholdFactor:
					normalizeLiquidationThresholdFactor(Number(own?.liqLTV ?? 0)) || undefined,
				startedAt: 0,
				daysActive: 0,
				events: [],
				protocol: 'Current',
				venue: resolveCurrentVenueLabel(marketObjectId, listed, marketType),
				iconUrl: meta?.tokenInfo?.icon ?? null,
			}
			const maxLtv = normalizeLiquidationThresholdFactor(Number(own?.maxLTV ?? 0))
			if (maxLtv > 0) maxLtvOf.set(supply, maxLtv)
			marketOf.set(supply, marketType)
			supplies.push(supply)
		}

		for (let i = 0; i < overview.borrows.length; i++) {
			const bor = overview.borrows[i]!
			const mining = borrowMiningResults[i]!
			const own = marketByToken(listed, bor.asset)
			const meta = own ?? marketByToken(priceRows, bor.asset)
			const rate = rates.get(typeKey(bor.asset))
			const marketIndex = rate?.borrowIndex ?? DECIMAL_SCALE
			const stored = BigInt(bor.borrow_index.value)
			const debt = BigInt(bor.debt.value)
			const scaled = stored > 0n ? (debt * marketIndex) / stored : debt
			const decimals = Number(meta?.tokenInfo?.decimals ?? 6)
			const amount = humanFromRaw(coinRaw(scaled), decimals)
			if (amount <= 0) continue
			const price = Number(meta?.tokenInfo?.price ?? 0)
			const usd = amount * (Number.isFinite(price) ? price : 0)
			const borrowListApy = own?.borrowAPY
			const chainBorrow = chainApr.get(typeKey(bor.asset))?.borrow
			const borrowBaseKnown =
				(typeof borrowListApy === 'number' && Number.isFinite(borrowListApy)) ||
				(typeof chainBorrow === 'number' && Number.isFinite(chainBorrow))
			const baseApr = borrowBaseKnown
				? Number(
						typeof borrowListApy === 'number' && Number.isFinite(borrowListApy)
							? borrowListApy
							: chainBorrow,
					)
				: Number.NaN
			const bwRaw = Number(own?.borrowWeight ?? 1)
			const borrowWeight = Number.isFinite(bwRaw) && bwRaw > 0 ? bwRaw : 1
			const rewardKnown = mining.status === 'complete' || mining.status === 'empty'
			const rewardApr = rewardKnown ? (mining.apr ?? 0) : 0
			const netCost = borrowBaseKnown
				? baseApr - (rewardKnown ? rewardApr : 0)
				: rewardKnown
					? -rewardApr
					: Number.NaN
			const symbol = meta?.tokenInfo?.symbol ?? bor.asset.split('::').pop() ?? '?'
			const borrow: BorrowPosition = {
				id: `current-borrow-${ob.obligationObject}-${typeKey(bor.asset)}`,
				obligationId: ob.obligationObject!,
				asset: symbol,
				coinType: with0x(bor.asset),
				borrowedAmount: amount,
				currentDebt: amount,
				accruedInterest: 0,
				accruedInterestUSD: 0,
				borrowAPR: netCost,
				borrowRewardAPR: rewardKnown ? rewardApr : undefined,
				netBorrowCost: netCost,
				aprBreakdown: {
					baseAPR: borrowBaseKnown ? baseApr : Number.NaN,
					rewardAPR: rewardKnown ? rewardApr : Number.NaN,
					rewards: mining.parts
						.filter((p) => p.apr != null)
						.map((p) => ({ symbol: p.symbol, coinType: p.coinType, apr: p.apr! })),
					rewardReadStatus: mining.status,
				},
				currentDebtUSD: usd,
				collateral: [],
				healthFactor: 0,
				liquidationThreshold: 0,
				startedAt: 0,
				daysActive: 0,
				events: [],
				protocol: 'Current',
				venue: resolveCurrentVenueLabel(marketObjectId, listed, marketType),
				iconUrl: meta?.tokenInfo?.icon ?? null,
			}
			borrowWeightOf.set(borrow, borrowWeight)
			marketOf.set(borrow, marketType)
			borrows.push(borrow)
		}

		if (mined.status === 'unavailable') {
			console.warn('[Current] claimable rewards unavailable', ob.obligationObject, mined.reason)
		} else {
			for (const row of mined.rows) {
				if (row.amount == null || row.valueUSD == null) continue
				claimed.push({
					coinType: row.coinType,
					symbol: row.symbol,
					amount: row.amount,
					valueUSD: row.valueUSD,
				})
			}
		}
		} catch (err) {
			skippedObligations += 1
			console.warn('[Current] obligation skipped', ob.obligationObject, marketType, err)
		}
	}
	if (skippedObligations > 0) {
		throw new Error(
			`Current: ${skippedObligations} obligation(s) failed to load (borrows unavailable, not confirmed zero)`,
		)
	}

	if (currentAdvisorTimingEnabled()) {
		logCurrentAdvisorStep('devInspect', devInspectMs)
		logCurrentAdvisorStep('mining', miningMs)
		logCurrentAdvisorStep('claimable-rewards', claimableMs)
	}

	const totalSuppliedUSD = supplies.reduce((s, x) => s + x.currentValueUSD, 0)
	const totalBorrowedUSD = borrows.reduce((s, x) => s + x.currentDebtUSD, 0)

	/**
	 * Current markets are isolated: HF / liquidation use only that market’s collateral & debt.
	 * Cross-market totals must not inflate Main HF when AltCoin/Ember have supplies but no borrow.
	 */
	const marketKeys = new Set<string>()
	for (const s of supplies) {
		const m = marketOf.get(s)
		if (m) marketKeys.add(m)
	}
	for (const b of borrows) {
		const m = marketOf.get(b)
		if (m) marketKeys.add(m)
	}

	let healthFactor: number | null = null
	for (const marketType of marketKeys) {
		const mSupplies = supplies.filter((s) => marketOf.get(s) === marketType)
		const mBorrows = borrows.filter((b) => marketOf.get(b) === marketType)
		/** Docs: risk_adjusted_debt = debt × borrowWeight. */
		const mRiskDebt = mBorrows.reduce(
			(s, x) => s + x.currentDebtUSD * (borrowWeightOf.get(x) ?? 1),
			0,
		)
		const mLiq = mSupplies.reduce(
			(s, x) => s + x.currentValueUSD * (x.liquidationThresholdFactor ?? 0),
			0,
		)
		const mSafe = mSupplies.reduce(
			(s, x) => s + x.currentValueUSD * (maxLtvOf.get(x) ?? 0),
			0,
		)
		/**
		 * HF ≡ LiqLTV / CurrentLTV when CurrentLTV = riskDebt / collValue and
		 * weighted Liq = Σ(coll×liqLTV)/collValue → HF = mLiq / mRiskDebt (→1 at liq).
		 */
		const mHf = mRiskDebt > 0 ? mLiq / mRiskDebt : null
		for (const b of mBorrows) {
			const bw = borrowWeightOf.get(b) ?? 1
			b.healthFactor = mHf ?? 0
			b.liquidationThreshold = mLiq
			b.safeBorrowLimit = bw > 0 ? mSafe / bw : mSafe
			b.collateral = mSupplies.map((s) => ({
				asset: s.asset,
				amount: s.currentAmount,
				valueUSD: s.currentValueUSD,
				collateralWeight: s.liquidationThresholdFactor ?? 0,
				effectiveValueUSD: s.currentValueUSD * (s.liquidationThresholdFactor ?? 0),
			}))
		}
		if (mHf != null && mHf > 0) {
			healthFactor = healthFactor == null ? mHf : Math.min(healthFactor, mHf)
		}
		if (mRiskDebt > 0 && mSupplies.length > 0) {
			const priced = enrichSupplyLiquidationPrices(mSupplies, mRiskDebt)
			for (let i = 0; i < mSupplies.length; i++) {
				mSupplies[i]!.liquidationPriceUSD = priced[i]!.liquidationPriceUSD ?? null
			}
		} else {
			for (const s of mSupplies) s.liquidationPriceUSD = null
		}
	}

	const supplyYield = supplies.reduce((s, x) => s + x.currentValueUSD * x.supplyAPR, 0)
	const borrowCost = borrows.reduce((s, x) => s + x.currentDebtUSD * x.netBorrowCost, 0)
	const netValueUSD = totalSuppliedUSD - totalBorrowedUSD
	const netAPR = totalSuppliedUSD > 0 ? (supplyYield - borrowCost) / totalSuppliedUSD : null
	const rewardsToClaim = mergeClaimed(claimed)
	const unclaimedUSD = rewardsToClaim.reduce((s, r) => s + r.valueUSD, 0)
	let cashflowUsd: LendingCashflowUsd | null = null
	if (!options?.skipCashflow) {
	const loaded = await currentAdvisorTimed('cashflow', () =>
		loadCashflowTokens(walletAddress, marketTypes, allListed).catch(() => null),
	)
	if (loaded) {
		const listPrice = (coin: string) => {
			const p = Number(marketByToken(allListed, coin)?.tokenInfo?.price ?? 0)
			return Number.isFinite(p) && p > 0 ? p : 0
		}
		const positionKey = (pos: SupplyPosition | BorrowPosition, coinType: string) => {
			const market = marketOf.get(pos) ?? ''
			return market ? flowKey(market, coinType) : ''
		}
		let supplyInterestUSD = 0
		const seenSupply = new Set<string>()
		for (const s of supplies) {
			const key = positionKey(s, s.coinType)
			if (!key || loaded.historyFailed.has(typeKey(marketOf.get(s) ?? ''))) continue
			seenSupply.add(key)
			const net = loaded.deposited.get(key) ?? 0
			s.netDeposited = net
			const px = s.currentAmount > 0 ? s.currentValueUSD / s.currentAmount : listPrice(s.coinType)
			supplyInterestUSD += (s.currentAmount - net) * px
		}
		for (const [key, net] of loaded.deposited) {
			if (seenSupply.has(key)) continue
			const coin = key.split('|')[1] ?? ''
			supplyInterestUSD += -net * listPrice(coin)
		}
		let borrowInterestUSD = 0
		const seenBorrow = new Set<string>()
		for (const b of borrows) {
			const key = positionKey(b, b.coinType)
			if (!key || loaded.historyFailed.has(typeKey(marketOf.get(b) ?? ''))) continue
			seenBorrow.add(key)
			const net = loaded.borrowed.get(key) ?? 0
			b.netBorrowed = net
			const px = b.currentDebt > 0 ? b.currentDebtUSD / b.currentDebt : listPrice(b.coinType)
			borrowInterestUSD += (b.currentDebt - net) * px
		}
		for (const [key, net] of loaded.borrowed) {
			if (seenBorrow.has(key)) continue
			const coin = key.split('|')[1] ?? ''
			borrowInterestUSD += -net * listPrice(coin)
		}
		cashflowUsd = buildLendingCashflowUsd({
			supplyInterestUSD,
			borrowInterestUSD,
			claimedRewardsUSD: loaded.claimedRewardsUSD,
			unclaimedRewardsUSD: unclaimedUSD,
			usedSpotPrice: loaded.usedSpotPrice,
		})
	}
	}

	return {
		supplies,
		borrows,
		totalSuppliedUSD,
		totalBorrowedUSD,
		netValueUSD,
		healthFactor,
		netAPR,
		dailyEarningsUSD: totalSuppliedUSD > 0 ? (supplyYield - borrowCost) / 365 : null,
		rewardsToClaim,
		cashflowUsd,
		protocol: 'Current',
	}
}

export const EMPTY_CURRENT_SNAP: LendingSnapshot = {
	supplies: [],
	borrows: [],
	totalSuppliedUSD: 0,
	totalBorrowedUSD: 0,
	netValueUSD: 0,
	healthFactor: null,
	rewardsToClaim: [],
	protocol: 'Current',
}
