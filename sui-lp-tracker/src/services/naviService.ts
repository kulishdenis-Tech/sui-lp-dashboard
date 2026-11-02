/**
 * Navi Protocol lending integration.
 *
 * Architecture: hybrid REST + direct Sui JSON-RPC.
 *
 *  1. Pool data (APRs, prices, symbols):
 *     REST → /ext/navi/api/navi/pools  (proxied by Vite dev server)
 *
 *  2. Protocol config (contract addresses):
 *     REST → /ext/navi/api/navi/config
 *
 *  3. User position balances:
 *     Sui JSON-RPC → sui_devInspectTransactionBlock
 *     Move call: {uiGetter}::getter_unchecked::get_user_state(storage, userAddress)
 *     Returns BCS: vector<UserStateInfo { asset_id: u8, borrow_balance: u256, supply_balance: u256 }>
 *
 *  4. Claimable rewards:
 *     SDK → getUserAvailableLendingRewards (on-chain devInspect via incentive_v3_getter)
 *     Note: REST /api/navi/user/rewards is claimed-history style data, not claimable balances.
 *
 *  5. Cashflow (net deposited in coin units, interest + rewards in USD):
 *     REST → /api/navi/user/transactions  (SDK getTransactions)
 *     @see https://sdk.naviprotocol.io/lending/account
 */
import type {
	LendingSnapshot,
	SupplyPosition,
	BorrowPosition,
	CollateralInfo,
	LendingRewardToClaim,
	LendingCashflowUsd,
} from '@/types'
import { getCurrentSpot } from '@/services/spotPrice/currentSpotCache'
import { extFetchUrl } from '@/utils/externalFetchUrl'
import { suiClient } from '@/services/suiClient'
import { getDashboardSuiClient } from '@/rpc/dashboardPool'
import { enrichSupplyLiquidationPrices, normalizeLiquidationThresholdFactor } from '@/utils/supplyLiquidationPrice'

const NAVI_ORIGIN = 'https://open-api.naviprotocol.io'
const SDK_VER = '2.0.12'

function naviUrl(path: string): string {
	const p = path.startsWith('/') ? path : `/${path}`
	return extFetchUrl(`${NAVI_ORIGIN}${p}`)
}

function naviLog(...args: unknown[]): void {
	if (import.meta.env.DEV) {
		 
		console.log('[Navi]', ...args)
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function n(v: unknown): number {
	if (v == null) return 0
	if (typeof v === 'number') return isFinite(v) ? v : 0
	if (typeof v === 'string') {
		const x = parseFloat(v)
		return isFinite(x) ? x : 0
	}
	return 0
}

/** APR %-string → decimal fraction: "3.428" → 0.03428 */
function pct(v: string | number | undefined | null): number {
	return n(v) / 100
}

function coinSymbol(coinType: string): string {
	return coinType.split('::').pop() ?? '?'
}

/**
 * Normalise a Sui coin type so short package addresses (0x2) and padded ones
 * (0x0000...0002) resolve to the same map key.
 */
function normalizeType(ct: string): string {
	const parts = ct.trim().split('::')
	if (parts.length !== 3) return ct.trim()
	const pkg = parts[0]
	if (pkg.startsWith('0x') || pkg.startsWith('0X')) {
		const hex = pkg.slice(2).padStart(64, '0')
		return `0x${hex}::${parts[1]}::${parts[2]}`
	}
	return ct.trim()
}

// ── Navi REST: pool + config ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _poolCache: { ts: number; data: any[] } | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchPools(forceRefresh = false): Promise<any[]> {
	const now = Date.now()
	if (!forceRefresh && _poolCache && now - _poolCache.ts < 5 * 60_000) return _poolCache.data
	const url = naviUrl(`/api/navi/pools?env=prod&sdk=${SDK_VER}&market=main`)
	naviLog('fetching pools:', url)
	const res = await fetch(url, {
		signal: AbortSignal.timeout(15_000),
		cache: forceRefresh ? 'no-store' : 'default',
	})
	if (!res.ok) throw new Error(`Navi pools API ${res.status}`)
	const json = await res.json()
	const data = json.data ?? []
	naviLog(`pools loaded: ${data.length}`)
	_poolCache = { ts: now, data }
	return data
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _cfgCache: { ts: number; data: any } | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchConfig(forceRefresh = false): Promise<any> {
	const now = Date.now()
	if (!forceRefresh && _cfgCache && now - _cfgCache.ts < 10 * 60_000) return _cfgCache.data
	const url = naviUrl(`/api/navi/config?env=prod&sdk=${SDK_VER}&market=main`)
	naviLog('fetching config:', url)
	const res = await fetch(url, {
		signal: AbortSignal.timeout(15_000),
		cache: forceRefresh ? 'no-store' : 'default',
	})
	if (!res.ok) throw new Error(`Navi config API ${res.status}`)
	const json = await res.json()
	const data = json.data
	naviLog('config uiGetter:', data?.uiGetter)
	_cfgCache = { ts: now, data }
	return data
}

// ── Navi SDK: claimable rewards via on-chain devInspect ──────────────────────
//
// getUserAvailableLendingRewards() runs a devInspect against the Navi contract
// and returns LendingReward[] where userClaimableReward is already a
// human-readable decimal (divided by 10^priceDecimal inside the SDK).
// This is the exact same data source Navi's own UI uses.

async function fetchRewards(
	walletAddress: string,
	priceByType: Map<string, number>,
	symbolByType: Map<string, string>,
): Promise<LendingRewardToClaim[]> {
	try {
		const { getUserAvailableLendingRewards } = await import('@naviprotocol/lending')
		// SDK requires a Core-capable JSON-RPC client (`client.core`); portfolio reads use gRPC compat.
		const client = getDashboardSuiClient()

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const rawRewards: any[] = await getUserAvailableLendingRewards(walletAddress, {
			client,
			env: 'prod',
		})

		// Aggregate by rewardCoinType — userClaimableReward is already a decimal float
		const agg = new Map<string, number>()
		for (const r of rawRewards) {
			const rawCt: string = r.rewardCoinType ?? ''
			if (!rawCt) continue
			const ct = normalizeType(rawCt)
			const amt = typeof r.userClaimableReward === 'number' ? r.userClaimableReward : Number(r.userClaimableReward)
			if (!isFinite(amt) || amt <= 0) continue
			agg.set(ct, (agg.get(ct) ?? 0) + amt)
		}

		return [...agg.entries()].map(([coinType, amount]) => {
			// Pool price first; fall back to app's spot-price cache
			const price =
				(priceByType.get(coinType) ?? 0) ||
				(getCurrentSpot(coinType)?.price ?? 0)
			return {
				coinType,
				symbol: symbolByType.get(coinType) ?? coinSymbol(coinType),
				amount,
				valueUSD: price > 0 ? amount * price : 0,
			}
		})
	} catch (e) {
		console.error('[Navi] fetchRewards error:', e)
		return []
	}
}

// ── BCS utils (minimal inline parser) ────────────────────────────────────────

/** Read a u256 from little-endian bytes at offset, returns [BigInt, newOffset] */
function readU256LE(bytes: number[], off: number): [bigint, number] {
	let val = 0n
	for (let i = 0; i < 32; i++) {
		val |= BigInt(bytes[off + i] ?? 0) << BigInt(i * 8)
	}
	return [val, off + 32]
}

/** Read a ULEB128 length prefix (used for vector length) */
function readULEB128(bytes: number[], off: number): [number, number] {
	let result = 0
	let shift = 0
	while (true) {
		const b = bytes[off++] ?? 0
		result |= (b & 0x7f) << shift
		if ((b & 0x80) === 0) break
		shift += 7
	}
	return [result, off]
}

/**
 * Parse the BCS return value of get_user_state.
 * Struct field order (from SDK source): asset_id: u8, borrow_balance: u256, supply_balance: u256
 */
function parseUserState(raw: number[]): Array<{
	assetId: number
	supplyBalance: bigint
	borrowBalance: bigint
}> {
	let off = 0
	const [len, newOff] = readULEB128(raw, off)
	off = newOff
	naviLog(`BCS: parsing ${len} user state entries from ${raw.length} bytes`)
	const entries = []
	for (let i = 0; i < len; i++) {
		const assetId = raw[off++] ?? 0
		let bb: bigint, sb: bigint
		// BCS field order: borrow_balance first, then supply_balance
		;[bb, off] = readU256LE(raw, off) // borrow_balance
		;[sb, off] = readU256LE(raw, off) // supply_balance
		entries.push({ assetId, supplyBalance: sb, borrowBalance: bb })
		naviLog(`BCS entry ${i}: assetId=${assetId}, borrowBalance=${bb}, supplyBalance=${sb}`)
	}
	return entries
}

// ── Sui JSON-RPC: devInspectTransactionBlock ──────────────────────────────────

async function inspectUserState(
	uiGetter: string,
	storageId: string,
	userAddress: string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
	naviLog('devInspect get_user_state via gRPC compat', { uiGetter, storageId, userAddress })
	const { Transaction } = await import('@mysten/sui/transactions')
	const client = suiClient
	const tx = new Transaction()
	tx.moveCall({
		target: `${uiGetter}::getter_unchecked::get_user_state`,
		arguments: [tx.object(storageId), tx.pure.address(userAddress)],
	})
	const data = await client.devInspectTransactionBlock({
		transactionBlock: tx,
		sender: userAddress,
	})
	naviLog('devInspect results count:', data?.results?.length, 'error:', data?.error)
	return data
}

// ── Index precision: Navi stores balances as raw * index / 1e27 ──────────────

const INDEX_SCALE = 10n ** 27n

function applyIndex(raw: bigint, index: bigint): bigint {
	if (raw === 0n || index === 0n) return 0n
	// (raw * index + 5e26) / 1e27  (round half-up)
	return (raw * index + INDEX_SCALE / 2n) / INDEX_SCALE
}

function bignumToHuman(amount: bigint, decimals = 9): number {
	const scale = 10n ** BigInt(decimals)
	const whole = amount / scale
	const frac = amount % scale
	return Number(whole) + Number(frac) / Number(scale)
}

type NaviTx = {
	type?: string
	status?: string
	timestamp?: string
	coinChanges?: Array<{ symbol?: string; amount?: string; value?: number | string }>
}

type NaviTxPage = { data?: NaviTx[]; cursor?: string }

function symKey(symbol: string): string {
	return symbol.trim().toUpperCase()
}

/** Signed raw amount → human units. Amount strings can exceed Number.MAX_SAFE_INTEGER. */
function signedHuman(amount: string, decimals: number): number {
	const trimmed = amount.trim()
	const neg = trimmed.startsWith('-')
	const digits = trimmed.replace(/^[+-]/, '')
	if (!/^\d+$/.test(digits)) return 0
	const scale = 10n ** BigInt(Math.max(0, decimals))
	const bi = BigInt(digits)
	const human = Number(bi / scale) + Number(bi % scale) / Number(scale)
	return neg ? -human : human
}

/**
 * Wallet coin-change history.
 * Supply/withdraw amounts are the wallet delta (deposit is negative).
 * Borrow is positive, repay is negative.
 * `claim reward` rows carry USD `value` at the claim and are not principal.
 * @see https://sdk.naviprotocol.io/lending/account
 */
type NaviCashflowTokens = {
	deposited: Map<string, number>
	borrowed: Map<string, number>
	claimedRewardsUSD: number
	priceBySymbol: Map<string, number>
}

let naviCashflowCache: { address: string; ts: number; value: NaviCashflowTokens } | null = null
let naviCashflowInflight: { address: string; promise: Promise<NaviCashflowTokens> } | null = null

async function loadNaviCashflow(
	address: string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	pools: any[],
	forceRefresh = false,
): Promise<{
	deposited: Map<string, number>
	borrowed: Map<string, number>
	claimedRewardsUSD: number
	priceBySymbol: Map<string, number>
} | null> {
	const now = Date.now()
	if (
		!forceRefresh &&
		naviCashflowCache &&
		naviCashflowCache.address === address &&
		now - naviCashflowCache.ts < 60_000
	) {
		return naviCashflowCache.value
	}
	if (!forceRefresh && naviCashflowInflight?.address === address) return naviCashflowInflight.promise

	const run = loadNaviCashflowUncached(address, pools)
	naviCashflowInflight = { address, promise: run }
	try {
		const value = await run
		naviCashflowCache = { address, ts: Date.now(), value }
		return value
	} finally {
		if (naviCashflowInflight?.promise === run) naviCashflowInflight = null
	}
}

async function loadNaviCashflowUncached(
	address: string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	pools: any[],
): Promise<NaviCashflowTokens> {
	const priceBySymbol = new Map<string, number>()
	const decimalsBySymbol = new Map<string, number>()
	for (const pool of pools) {
		const symbol = pool.token?.symbol as string | undefined
		if (!symbol) continue
		const key = symKey(symbol)
		const decimals = Number(pool.token?.decimals ?? 9)
		decimalsBySymbol.set(key, Number.isFinite(decimals) ? decimals : 9)
		const price = n(pool.oracle?.price)
		if (price > 0) priceBySymbol.set(key, price)
	}

	const rows: NaviTx[] = []
	const seenCursors = new Set<string>()
	let cursor = ''
	for (let page = 0; page < 40; page++) {
		const q = new URLSearchParams({ userAddress: address, sdk: SDK_VER })
		if (cursor) q.set('cursor', cursor)
		const url = naviUrl(`/api/navi/user/transactions?${q}`)
		let json: { data?: NaviTxPage } | null = null
		let lastErr: unknown
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
				if (!res.ok) throw new Error(`Navi transactions API ${res.status}`)
				json = (await res.json()) as { data?: NaviTxPage }
				break
			} catch (err) {
				lastErr = err
			}
		}
		if (!json) {
			if (page === 0) throw lastErr
			break
		}
		const batch = json.data?.data ?? []
		rows.push(...batch)
		const next = json.data?.cursor ?? ''
		if (!next || next.startsWith('no_more') || batch.length === 0 || seenCursors.has(next)) break
		seenCursors.add(next)
		cursor = next
	}

	const deposited = new Map<string, number>()
	const borrowed = new Map<string, number>()
	let claimedRewardsUSD = 0
	const add = (map: Map<string, number>, key: string, amount: number) => {
		map.set(key, (map.get(key) ?? 0) + amount)
	}

	for (const tx of rows) {
		if (tx.status && tx.status !== 'success') continue
		const type = (tx.type ?? '').toLowerCase()
		for (const change of tx.coinChanges ?? []) {
			const key = symKey(change.symbol ?? '')
			if (!key) continue
			if (type === 'claim reward') {
				const value = Number(change.value)
				if (Number.isFinite(value)) claimedRewardsUSD += value
				continue
			}
			const decimals = decimalsBySymbol.get(key)
			if (decimals == null || change.amount == null) continue
			const human = signedHuman(String(change.amount), decimals)
			if (type === 'supply' || type === 'withdraw') add(deposited, key, -human)
			else if (type === 'borrow' || type === 'repay') add(borrowed, key, human)
		}
	}

	return { deposited, borrowed, claimedRewardsUSD, priceBySymbol }
}

// ── Service ───────────────────────────────────────────────────────────────────

export async function getNaviPositions(
	walletAddress: string,
	options?: { forceRefresh?: boolean },
): Promise<LendingSnapshot> {
	naviLog('getNaviPositions called for:', walletAddress)
	const force = options?.forceRefresh === true
	if (force) {
		_poolCache = null
		_cfgCache = null
	}

	// Fetch pool data and config in parallel (REST)
	const [pools, cfg] = await Promise.all([fetchPools(force), fetchConfig(force)])

	if (!pools || pools.length === 0) {
		throw new Error('Navi pools unavailable (not a confirmed empty position list)')
	}

	// Build maps keyed by numeric id
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const poolById = new Map<number, any>()
	for (const p of pools) {
		if (typeof p.id === 'number') poolById.set(p.id, p)
	}
	console.log('[Navi] poolById keys:', [...poolById.keys()])

	// Verify the pool index fields exist on the first pool
	const firstPool = pools[0]
	console.log('[Navi] pool index field check — currentSupplyIndex:', firstPool?.currentSupplyIndex, ', currentBorrowIndex:', firstPool?.currentBorrowIndex)

	const symbolCache = new Map<string, string>()
	for (const p of pools) {
		if (p.token?.coinType && p.token?.symbol) {
			symbolCache.set(p.token.coinType, p.token.symbol)
		}
	}

	// ── Fetch user positions via devInspect ───────────────────────────────────
	const uiGetter: string = cfg?.uiGetter ?? ''
	const storageId: string = cfg?.storage ?? ''
	if (!uiGetter || !storageId) {
		console.error('[Navi] missing config — uiGetter:', uiGetter, 'storage:', storageId)
		throw new Error('Navi config missing uiGetter/storage')
	}

	const rpcResult = await inspectUserState(uiGetter, storageId, walletAddress)

	if (rpcResult.error) {
		throw new Error(`Navi devInspect error: ${JSON.stringify(rpcResult.error)}`)
	}

	const rawReturn =
		rpcResult.results?.[0]?.returnValues ??
		rpcResult.result?.results?.[0]?.returnValues ??
		[]
	const returnValues: number[][] = rawReturn.map((rv: [number[] | Uint8Array, string]) =>
		Array.from(rv[0] ?? []),
	)

	console.log('[Navi] returnValues count:', returnValues.length)

	if (returnValues.length === 0) {
		throw new Error('Navi devInspect returned no values (unavailable, not confirmed zero borrows)')
	}

	const userStates = parseUserState(returnValues[0])
	console.log('[Navi] parsed userStates count:', userStates.length)

	// Compute index-adjusted balances
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const activeStates: Array<{ pool: any; supplyHuman: number; borrowHuman: number }> = []
	for (const state of userStates) {
		if (state.supplyBalance === 0n && state.borrowBalance === 0n) continue
		const pool = poolById.get(state.assetId)
		if (!pool) {
			console.warn('[Navi] no pool found for assetId:', state.assetId)
			continue
		}

		const supplyIndex = BigInt(pool.currentSupplyIndex ?? '0')
		const borrowIndex = BigInt(pool.currentBorrowIndex ?? '0')
		const decimals: number = pool.token?.decimals ?? 9

		console.log(`[Navi] assetId=${state.assetId} pool=${pool.token?.symbol} supplyIndex=${supplyIndex} borrowIndex=${borrowIndex}`)

		const supplyAdj = applyIndex(state.supplyBalance, supplyIndex)
		const borrowAdj = applyIndex(state.borrowBalance, borrowIndex)

		const supplyHuman = bignumToHuman(supplyAdj, 9)
		const factor = 10 ** decimals
		const supplyHumanTrunc = Math.trunc(supplyHuman * factor) / factor
		const borrowHuman = bignumToHuman(borrowAdj, 9)
		const borrowHumanTrunc = Math.trunc(borrowHuman * factor) / factor

		console.log(`[Navi] assetId=${state.assetId}: supplyHuman=${supplyHumanTrunc}, borrowHuman=${borrowHumanTrunc}`)

		if (supplyHumanTrunc === 0 && borrowHumanTrunc === 0) continue
		activeStates.push({ pool, supplyHuman: supplyHumanTrunc, borrowHuman: borrowHumanTrunc })
	}

	console.log('[Navi] activeStates count:', activeStates.length)

	if (activeStates.length === 0) {
		console.warn('[Navi] no active positions after filtering')
		return EMPTY_NAVI_SNAP
	}

	// ── Build supplies ────────────────────────────────────────────────────────
	const supplies: SupplyPosition[] = []
	for (const { pool, supplyHuman } of activeStates) {
		if (supplyHuman <= 0) continue
		const aprInfo = pool.supplyIncentiveApyInfo ?? {}
		const baseAPR = pct(aprInfo.vaultApr)
		const rewardAPR = pct(aprInfo.boostedApr)
		const rewardCoins: string[] = aprInfo.rewardCoin ?? []
		const perTokenAPR = rewardCoins.length > 0 ? rewardAPR / rewardCoins.length : 0
		const rewards = rewardCoins.map((ct: string) => ({
			symbol: symbolCache.get(ct) ?? coinSymbol(ct),
			coinType: ct,
			apr: perTokenAPR,
		}))
		const priceUSD: number = n(pool.oracle?.price)
		const ltFactor = normalizeLiquidationThresholdFactor(n(pool.liquidationFactor?.threshold))
		supplies.push({
			id: `navi-supply-${pool.id}`,
			asset: pool.token?.symbol ?? coinSymbol(pool.suiCoinType ?? ''),
			coinType: pool.suiCoinType ?? pool.coinType ?? '',
			sCoinType: '',
			suppliedAmount: supplyHuman,
			currentAmount: supplyHuman,
			earnedInterest: 0,
			earnedInterestUSD: 0,
			supplyAPR: baseAPR + rewardAPR,
			supplyRewardAPR: rewardAPR,
			aprBreakdown: { baseAPR, rewardAPR, rewards },
			currentValueUSD: supplyHuman * priceUSD,
			liquidationThresholdFactor: ltFactor > 0 ? ltFactor : undefined,
			startedAt: 0,
			daysActive: 0,
			events: [],
			protocol: 'Navi',
			iconUrl: pool.token?.logoUri ?? null,
		})
	}

	// ── Collateral ────────────────────────────────────────────────────────────
	const collateral: CollateralInfo[] = supplies.map((s) => ({
		asset: s.asset,
		amount: s.currentAmount,
		valueUSD: s.currentValueUSD,
		collateralWeight: 0,
		effectiveValueUSD: s.currentValueUSD,
	}))

	// ── Build borrows ─────────────────────────────────────────────────────────
	const borrows: BorrowPosition[] = []
	for (const { pool, borrowHuman } of activeStates) {
		if (borrowHuman <= 0) continue
		const aprInfo = pool.borrowIncentiveApyInfo ?? {}
		const baseAPR = pct(aprInfo.vaultApr)
		const rewardAPR = pct(aprInfo.boostedApr)
		const netBorrowCost = baseAPR - rewardAPR
		const rewardCoins: string[] = aprInfo.rewardCoin ?? []
		const perTokenAPR = rewardCoins.length > 0 ? rewardAPR / rewardCoins.length : 0
		const rewards = rewardCoins.map((ct: string) => ({
			symbol: symbolCache.get(ct) ?? coinSymbol(ct),
			coinType: ct,
			apr: perTokenAPR,
		}))
		const priceUSD: number = n(pool.oracle?.price)
		borrows.push({
			id: `navi-borrow-${pool.id}`,
			obligationId: '',
			asset: pool.token?.symbol ?? coinSymbol(pool.suiCoinType ?? ''),
			coinType: pool.suiCoinType ?? pool.coinType ?? '',
			borrowedAmount: borrowHuman,
			currentDebt: borrowHuman,
			accruedInterest: 0,
			accruedInterestUSD: 0,
			borrowAPR: netBorrowCost,
			borrowRewardAPR: rewardAPR,
			netBorrowCost,
			aprBreakdown: { baseAPR, rewardAPR, rewards },
			currentDebtUSD: borrowHuman * priceUSD,
			collateral,
			healthFactor: 0,
			liquidationThreshold: 0,
			startedAt: 0,
			daysActive: 0,
			events: [],
			protocol: 'Navi',
			iconUrl: pool.token?.logoUri ?? null,
		})
	}

	// ── Totals + health factor ────────────────────────────────────────────────
	const totalSuppliedUSD = supplies.reduce((s, x) => s + x.currentValueUSD, 0)
	const totalBorrowedUSD = borrows.reduce((s, x) => s + x.currentDebtUSD, 0)
	const netValueUSD = totalSuppliedUSD - totalBorrowedUSD

	let liquidationValue = 0
	for (const { pool, supplyHuman } of activeStates) {
		const lt = normalizeLiquidationThresholdFactor(n(pool.liquidationFactor?.threshold))
		const priceUSD = n(pool.oracle?.price)
		liquidationValue += supplyHuman * priceUSD * lt
	}
	const healthFactor = totalBorrowedUSD > 0 ? liquidationValue / totalBorrowedUSD : null

	for (const b of borrows) {
		b.healthFactor = healthFactor ?? 0
		b.liquidationThreshold = liquidationValue
	}

	const suppliesWithLiq = enrichSupplyLiquidationPrices(supplies, totalBorrowedUSD)

	// ── Net APR ───────────────────────────────────────────────────────────────
	let weightedSupply = 0
	for (const s of suppliesWithLiq) weightedSupply += s.supplyAPR * s.currentValueUSD
	let weightedBorrow = 0
	for (const b of borrows) weightedBorrow += b.netBorrowCost * b.currentDebtUSD
	const netAPR =
		netValueUSD > 0 ? (weightedSupply - weightedBorrow) / netValueUSD : null
	const dailyEarningsUSD =
		netValueUSD && netAPR != null && isFinite(netAPR)
			? (netValueUSD * netAPR) / 365
			: null

	// ── Price + symbol maps (fallback for reward price lookup) ──────────────
	const priceByType = new Map<string, number>()
	const symbolByType = new Map<string, string>()
	for (const pool of pools) {
		const candidates = [
			pool.suiCoinType, pool.coinType, pool.token?.coinType,
		].filter(Boolean) as string[]
		for (const raw of candidates) {
			const ct = normalizeType(raw)
			const price = n(pool.oracle?.price)
			if (price > 0) priceByType.set(ct, price)
			const sym: string = pool.token?.symbol ?? ''
			if (sym) symbolByType.set(ct, sym)
		}
	}

	// ── Claimable rewards (SDK devInspect — same source as Navi UI) ──────────
	const rewardsToClaim = await fetchRewards(walletAddress, priceByType, symbolByType).catch(() => [])
	const unclaimedUSD = rewardsToClaim.reduce((s, r) => s + r.valueUSD, 0)
	const loaded = await loadNaviCashflow(walletAddress, pools, force).catch((err) => {
		console.warn('[Navi] cashflow history failed', err)
		return null
	})
	let cashflowUsd: LendingCashflowUsd | null = null
	if (loaded) {
		let supplyInterestUSD = 0
		const seenSupply = new Set<string>()
		for (const s of suppliesWithLiq) {
			const key = symKey(s.asset)
			seenSupply.add(key)
			const net = loaded.deposited.get(key) ?? 0
			s.netDeposited = net
			const px = s.currentAmount > 0 ? s.currentValueUSD / s.currentAmount : (loaded.priceBySymbol.get(key) ?? 0)
			supplyInterestUSD += (s.currentAmount - net) * px
		}
		for (const [coin, net] of loaded.deposited) {
			if (seenSupply.has(coin)) continue
			supplyInterestUSD += -net * (loaded.priceBySymbol.get(coin) ?? 0)
		}
		let borrowInterestUSD = 0
		const seenBorrow = new Set<string>()
		for (const b of borrows) {
			const key = symKey(b.asset)
			seenBorrow.add(key)
			const net = loaded.borrowed.get(key) ?? 0
			b.netBorrowed = net
			const px = b.currentDebt > 0 ? b.currentDebtUSD / b.currentDebt : (loaded.priceBySymbol.get(key) ?? 0)
			borrowInterestUSD += (b.currentDebt - net) * px
		}
		for (const [coin, net] of loaded.borrowed) {
			if (seenBorrow.has(coin)) continue
			borrowInterestUSD += -net * (loaded.priceBySymbol.get(coin) ?? 0)
		}
		cashflowUsd = {
			supplyInterestUSD,
			borrowInterestUSD,
			claimedRewardsUSD: loaded.claimedRewardsUSD,
			resultUSD: supplyInterestUSD - borrowInterestUSD + loaded.claimedRewardsUSD + unclaimedUSD,
			usedSpotPrice: false,
		}
	}

	console.log('[Navi] final snapshot: supplies=%d borrows=%d netValueUSD=%s',
		suppliesWithLiq.length, borrows.length, netValueUSD.toFixed(2))

	return {
		supplies: suppliesWithLiq,
		borrows,
		totalSuppliedUSD,
		totalBorrowedUSD,
		netValueUSD,
		healthFactor,
		netAPR,
		dailyEarningsUSD,
		rewardsToClaim,
		cashflowUsd,
		protocol: 'Navi',
	}
}

// ── Empty snapshot ────────────────────────────────────────────────────────────

export const EMPTY_NAVI_SNAP: LendingSnapshot = {
	supplies: [],
	borrows: [],
	totalSuppliedUSD: 0,
	totalBorrowedUSD: 0,
	netValueUSD: 0,
	healthFactor: null,
	rewardsToClaim: [],
	protocol: 'Navi',
}
