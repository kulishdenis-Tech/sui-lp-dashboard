import type { EventType, PositionEvent } from '@/types'
import { suiClient } from '@/services/suiClient'
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import Decimal from 'decimal.js'
import {
	loadLpCacheEntry,
	saveLpCacheEntry,
	type RawEventRow,
} from '@/services/lpEventIdbCache'

// ---------------------------------------------------------------------------
// Event type detection
// ---------------------------------------------------------------------------

/**
 * Cetus CLMM LP lifecycle event struct names (V1 + V2).
 * Source: Cetus SDK switch block in event processing code.
 */
const CETUS_LP_EVENT_STRUCT_SET = new Set([
	'AddLiquidityEvent',
	'RemoveLiquidityEvent',
	'AddLiquidityV2Event',
	'RemoveLiquidityV2Event',
	'CollectFeeEvent',
	'CollectRewardEvent',
	'CollectRewardV2Event',
	'HarvestEvent',
	'ClosePositionEvent',
])

const CETUS_STRUCT_TO_EVTYPE: Record<string, EventType> = {
	AddLiquidityEvent: 'add_liquidity',
	AddLiquidityV2Event: 'add_liquidity',
	RemoveLiquidityEvent: 'remove_liquidity',
	RemoveLiquidityV2Event: 'remove_liquidity',
	CollectFeeEvent: 'collect_fee',
	CollectRewardEvent: 'collect_reward',
	CollectRewardV2Event: 'collect_reward',
	HarvestEvent: 'collect_reward',
	ClosePositionEvent: 'close_position',
}

/**
 * Extract Move struct name, stripping generic type parameters first.
 * e.g. "pkg::pool::AddLiquidityEvent<0x2::sui::SUI, ...>" → "AddLiquidityEvent"
 */
function structNameFromType(type: string): string {
	const bare = type.indexOf('<') >= 0 ? type.slice(0, type.indexOf('<')) : type
	const p = bare.split('::')
	return p[p.length - 1] ?? ''
}

export function isCetusLpEventType(type: string): boolean {
	return CETUS_LP_EVENT_STRUCT_SET.has(structNameFromType(type))
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

type Parsed = Record<string, unknown>

function readU64String(v: unknown): string {
	if (typeof v === 'string' && /^\d+$/.test(v)) return v
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return String(Math.floor(v))
	return '0'
}

function rawToHuman(raw: string, d: number): number {
	if (!/^\d+$/.test(raw) || d < 0) return 0
	try {
		return new Decimal(raw).div(new Decimal(10).pow(d)).toNumber()
	} catch {
		return 0
	}
}

function normSafe(id: string): string | null {
	try {
		return normalizeSuiAddress(id)
	} catch {
		return null
	}
}

/**
 * Try to read the position object ID from event parsedJson.
 * CLMM: CollectFee/Reward use `position`; add/remove may use `position` / `pos`.
 * DLMM (`@cetusprotocol/dlmm` pool events): Add/Remove/Close use `position_id`;
 * CollectFee/Reward use `position`.
 */
function readPositionFromEvent(pj: Parsed): string | null {
	for (const key of ['position', 'position_id', 'wrapped_position_id', 'pos', 'pos_id'] as const) {
		const v = pj[key]
		if (typeof v === 'string' && v.startsWith('0x')) {
			return normSafe(v)
		}
	}
	return null
}

/**
 * Extract reward coin type from a generic Cetus CollectReward event type string.
 * e.g. "pkg::pool::CollectRewardEvent<CoinA, CoinB, RewardCoin>" → "RewardCoin" normalized.
 */
/** Cetus `CollectRewardV2Event` stores the coin in `rewarder_type.name` without a `0x` prefix. */
function coinTypeFromRewardField(v: unknown): string | null {
	const name =
		typeof v === 'string'
			? v
			: v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string'
				? (v as { name: string }).name
				: ''
	let raw = name.trim()
	if (!raw) return null
	if (!raw.startsWith('0x') && /^[0-9a-fA-F]{1,64}::/.test(raw)) raw = `0x${raw}`
	try {
		return normalizeStructTag(raw)
	} catch {
		return raw
	}
}

function splitTypeParams(type: string): string[] {
	const match = type.match(/<(.+)>$/)
	if (!match) return []
	let depth = 0
	const params: string[] = []
	let cur = ''
	for (const ch of match[1]!) {
		if (ch === '<') { depth++; cur += ch }
		else if (ch === '>') { depth--; cur += ch }
		else if (ch === ',' && depth === 0) { params.push(cur.trim()); cur = '' }
		else { cur += ch }
	}
	if (cur.trim()) params.push(cur.trim())
	return params
}

/** Pool coin types from `Add/RemoveLiquidity*Event<CoinA, CoinB>`. */
export function cetusPoolCoinsFromEventType(type: string): { coinTypeA: string; coinTypeB: string } | null {
	const params = splitTypeParams(type)
	if (params.length < 2) return null
	try {
		return {
			coinTypeA: normalizeStructTag(params[0]!),
			coinTypeB: normalizeStructTag(params[1]!),
		}
	} catch {
		return null
	}
}

function readCetusI32(val: unknown): number | null {
	let bits: number
	if (val != null && typeof val === 'object') {
		const o = val as Record<string, unknown>
		const fields = o.fields && typeof o.fields === 'object' ? (o.fields as Record<string, unknown>) : o
		if (fields.bits == null) return null
		bits = Number(fields.bits)
	} else if (typeof val === 'number' || typeof val === 'string') {
		bits = Number(val)
	} else {
		return null
	}
	if (!Number.isFinite(bits)) return null
	return bits > 0x7fff_ffff ? bits - 0x1_0000_0000 : bits
}

export type CetusBurnedPositionSeed = {
	objectId: string
	poolId: string
	coinTypeA: string
	coinTypeB: string
	lowerTick: number
	upperTick: number
}

/**
 * Positions whose NFT was burned by `ClosePositionEvent`.
 * Coin types and ticks come from the add/remove events in the same wallet scan.
 */
export function cetusBurnedSeedsFromWalletMap(
	rawByPosition: Map<string, { type: string; parsedJson?: unknown }[]>,
): CetusBurnedPositionSeed[] {
	const out: CetusBurnedPositionSeed[] = []
	for (const [pid, evs] of rawByPosition) {
		const close = evs.find((e) => structNameFromType(e.type) === 'ClosePositionEvent')
		if (!close?.parsedJson || typeof close.parsedJson !== 'object') continue
		const closePj = close.parsedJson as Parsed
		const poolRaw = typeof closePj.pool === 'string' ? closePj.pool : ''
		const poolId = poolRaw ? normSafe(poolRaw) : null
		if (!poolId) continue

		let coinTypeA = ''
		let coinTypeB = ''
		let lowerTick = 0
		let upperTick = 0
		let haveTicks = false
		for (const ev of evs) {
			const name = structNameFromType(ev.type)
			if (
				name !== 'AddLiquidityEvent' &&
				name !== 'AddLiquidityV2Event' &&
				name !== 'RemoveLiquidityEvent' &&
				name !== 'RemoveLiquidityV2Event'
			) continue
			const pair = cetusPoolCoinsFromEventType(ev.type)
			if (pair) {
				coinTypeA = pair.coinTypeA
				coinTypeB = pair.coinTypeB
			}
			if (!ev.parsedJson || typeof ev.parsedJson !== 'object') continue
			const pj = ev.parsedJson as Parsed
			const lo = readCetusI32(pj.tick_lower)
			const hi = readCetusI32(pj.tick_upper)
			if (lo != null && hi != null) {
				lowerTick = lo
				upperTick = hi
				haveTicks = true
			}
		}
		if (!haveTicks) continue
		out.push({ objectId: pid, poolId, coinTypeA, coinTypeB, lowerTick, upperTick })
	}
	return out
}

function extractRewardCoinType(type: string): string | null {
	const match = type.match(/<(.+)>$/)
	if (!match) return null
	// Split type params handling nested generics
	let depth = 0
	const params: string[] = []
	let cur = ''
	for (const ch of match[1]!) {
		if (ch === '<') { depth++; cur += ch }
		else if (ch === '>') { depth--; cur += ch }
		else if (ch === ',' && depth === 0) { params.push(cur.trim()); cur = '' }
		else { cur += ch }
	}
	if (cur.trim()) params.push(cur.trim())
	if (params.length === 0) return null
	const last = params[params.length - 1]!
	try {
		return normalizeStructTag(last)
	} catch {
		return last
	}
}

function symbolTailFromCoinType(ct: string): string {
	const parts = ct.split('::')
	return (parts[parts.length - 1] ?? '').trim() || '—'
}

// ---------------------------------------------------------------------------
// Event → PositionEvent mapper
// ---------------------------------------------------------------------------

type RawEvent = {
	type: string
	parsedJson?: unknown
	id?: { eventSeq: string; txDigest: string }
	timestampMs?: string | number | null
}

/**
 * Map one raw Cetus chain event to a PositionEvent.
 * Returns null if the event doesn't belong to positionIdNorm.
 *
 * positionIdNorm: may be null when we want all positions (wallet-wide scan).
 * poolId: optional pool ID used to attribute liquidity events that lack a 'position' field.
 */
export function parseCetusEvent(
	ev: RawEvent,
	txDigest: string,
	timestampSec: number,
	positionIdNorm: string,
	tokenADecimals: number,
	tokenBDecimals: number,
): PositionEvent | null {
	if (!ev.parsedJson || typeof ev.parsedJson !== 'object') return null
	if (!isCetusLpEventType(ev.type)) return null

	const struct = structNameFromType(ev.type)
	const et = CETUS_STRUCT_TO_EVTYPE[struct]
	if (!et) return null

	const pj = ev.parsedJson as Parsed

	// Verify position when the event carries that field
	const pidInEvent = readPositionFromEvent(pj)
	if (pidInEvent && pidInEvent !== positionIdNorm) return null

	const seq = ev.id?.eventSeq != null ? String(ev.id.eventSeq) : '0'
	const id = `${txDigest}::${seq}`

	let tokenAAmount = 0
	let tokenBAmount = 0
	let feeAmountA = 0
	let feeAmountB = 0
	let liquidityDelta = 0
	const rewardAmount = 0
	let rewardToken = ''
	let rewardCoinType: string | undefined
	let rewardRawAmount: string | undefined

	if (et === 'add_liquidity' || et === 'remove_liquidity') {
		// CLMM: amount_a/b; DLMM Add/RemoveLiquidityEvent: total_amount_a/b
		tokenAAmount = rawToHuman(
			readU64String(pj.amount_a ?? pj.total_amount_a),
			tokenADecimals,
		)
		tokenBAmount = rawToHuman(
			readU64String(pj.amount_b ?? pj.total_amount_b),
			tokenBDecimals,
		)
		const liqRaw = readU64String(pj.liquidity)
		liquidityDelta = liqRaw.length < 22 ? parseFloat(liqRaw) : 0
	} else if (et === 'collect_fee') {
		// CLMM: amount_a/b; DLMM CollectFeeEvent: fee_a/b
		feeAmountA = rawToHuman(readU64String(pj.amount_a ?? pj.fee_a), tokenADecimals)
		feeAmountB = rawToHuman(readU64String(pj.amount_b ?? pj.fee_b), tokenBDecimals)
	} else if (et === 'collect_reward') {
		rewardRawAmount = readU64String(pj.amount ?? pj.reward_amount)
		const ct =
			coinTypeFromRewardField(pj.rewarder_type) ??
			coinTypeFromRewardField(pj.reward_type) ??
			coinTypeFromRewardField(pj.reward) ??
			extractRewardCoinType(ev.type)
		if (ct) {
			rewardCoinType = ct
			rewardToken = symbolTailFromCoinType(ct)
		}
	}

	return {
		id,
		txDigest,
		type: et,
		timestamp: Math.floor(Number.isFinite(timestampSec) && timestampSec > 0 ? timestampSec : 0),
		positionId: positionIdNorm,
		protocol: 'cetus',
		tokenAAmount,
		tokenBAmount,
		liquidityDelta,
		feeAmountA,
		feeAmountB,
		rewardAmount,
		rewardToken,
		rewardCoinType,
		rewardRawAmount,
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

// ---------------------------------------------------------------------------
// Reward decimals hydration
// ---------------------------------------------------------------------------

async function hydrateCetusRewardAmounts(events: PositionEvent[]): Promise<void> {
	const need = events.filter(
		(e) => e.type === 'collect_reward' && e.rewardRawAmount && e.rewardCoinType,
	)
	await Promise.all(
		need.map(async (ev) => {
			const ct = ev.rewardCoinType!.trim()
			let decimals = 9
			try {
				const m = await suiClient.getCoinMetadata({ coinType: ct })
				if (typeof m?.decimals === 'number' && m.decimals >= 0) decimals = m.decimals
			} catch {
				decimals = 9
			}
			ev.rewardAmount = rawToHuman(ev.rewardRawAmount!, decimals)
			ev.rewardRawAmount = undefined
		}),
	)
}

// ---------------------------------------------------------------------------
// Wallet-wide Cetus event scan (Sender-based — works on all RPC nodes)
// ---------------------------------------------------------------------------

/**
 * Max pages for the full cold-start Sender scan (100 × 50 = 5 000 events).
 * Raised from 50 → 100 to match Momentum's Sender depth and catch older open positions.
 * Closed positions that fall outside this window are served via IDB TX cache.
 */
const MAX_EVENT_PAGES = 100
const EVENTS_PER_PAGE = 50
/** Delta scan: only re-scan the last N pages on warm start. */
const MAX_CETUS_DELTA_PAGES = 5
/** Overlap window to avoid missing events at the delta boundary (seconds). */
const CETUS_DELTA_OVERLAP_SEC = 3 * 3600 // 3 hours

// ---------------------------------------------------------------------------
// IDB ↔ ChainEvent conversion helpers
// ---------------------------------------------------------------------------

type ChainEventLike = {
	type: string
	parsedJson?: unknown
	id: { eventSeq: string; txDigest: string }
	timestampMs: string | number | null | undefined
}

function chainEventToRow(pid: string, ev: ChainEventLike): RawEventRow {
	return {
		pid,
		digest: ev.id.txDigest,
		tsSec: ev.timestampMs != null ? parseInt(String(ev.timestampMs), 10) / 1000 : 0,
		event: { type: ev.type, parsedJson: ev.parsedJson, id: ev.id },
	}
}

function rowToChainEvent(row: RawEventRow): ChainEventLike {
	return {
		type: row.event.type,
		parsedJson: row.event.parsedJson,
		id: { eventSeq: row.event.id?.eventSeq ?? '0', txDigest: row.digest },
		timestampMs: String(Math.floor(row.tsSec * 1000)),
	}
}

/** Convert eventsByPosition map → IDB rows (flat list). */
function eventMapToRows(evByPos: Map<string, ChainEventLike[]>): RawEventRow[] {
	const rows: RawEventRow[] = []
	for (const [pid, evs] of evByPos) {
		for (const ev of evs) rows.push(chainEventToRow(pid, ev))
	}
	return rows
}

/** Reconstruct eventsByPosition map from IDB rows. */
function rowsToEventMap(rows: RawEventRow[]): Map<string, ChainEventLike[]> {
	const m = new Map<string, ChainEventLike[]>()
	for (const row of rows) {
		const arr = m.get(row.pid) ?? []
		arr.push(rowToChainEvent(row))
		m.set(row.pid, arr)
	}
	return m
}

/** Save Cetus Sender scan results to IDB (fire-and-forget). */
function saveCetusSenderCache(
	walletNorm: string,
	evByPos: Map<string, ChainEventLike[]>,
): void {
	const rows = eventMapToRows(evByPos)
	const lastEventTs = rows.length > 0 ? Math.max(...rows.map((r) => r.tsSec)) : 0
	void saveLpCacheEntry({
		id: `${walletNorm}|cetus`,
		walletNorm,
		protocol: 'cetus',
		rows,
		lastEventTs,
		seenPkgs: [],
		historyPartial: false,
		fullScanDoneAt: Date.now(),
	})
}

/**
 * Scan ALL Cetus LP lifecycle events emitted by walletAddress.
 *
 * Strategy: `queryEvents({ Sender: walletAddress })` — indexed on every Sui fullnode.
 * The InputObject/ChangedObject TX filter requires a specialised indexer not available
 * on the default Mysten mainnet RPC.
 *
 * IDB warm-start: on subsequent loads only the last MAX_CETUS_DELTA_PAGES pages are
 * re-scanned, dramatically reducing cold-vs-warm RPC cost from 50 → 5 pages.
 *
 * Returns a Map from normalised positionId → raw event list.
 * Events without a 'position' field in parsedJson are attributed via the TX's
 * CollectFee/CollectReward events that share the same digest, or skipped.
 */
export async function scanCetusWalletEvents(
	walletAddress: string,
): Promise<Map<string, ChainEventLike[]>> {
	try {
		return await _scanCetusWalletEventsInner(walletAddress)
	} catch (err) {
		 
		console.error('[cetus-scan] FATAL ERROR in scanCetusWalletEvents:', err)
		return new Map()
	}
}

async function _scanCetusWalletEventsInner(
	walletAddress: string,
): Promise<Map<string, ChainEventLike[]>> {
	let walletNorm: string
	try {
		walletNorm = normalizeSuiAddress(walletAddress)
	} catch {
		walletNorm = walletAddress
	}

	// ── IDB warm-start ────────────────────────────────────────────────────
	const cached = await loadLpCacheEntry(walletNorm, 'cetus')
	 
	console.log('[cetus-scan] IDB cache:', cached ? `${cached.rows.length} rows` : 'null')

	let baseEvByPos: Map<string, ChainEventLike[]>
	let scanPages: number
	let cutoffTs: number

	if (cached && cached.rows.length > 0) {
		baseEvByPos = rowsToEventMap(cached.rows)
		scanPages = MAX_CETUS_DELTA_PAGES
		cutoffTs = cached.lastEventTs - CETUS_DELTA_OVERLAP_SEC
	} else {
		baseEvByPos = new Map()
		scanPages = MAX_EVENT_PAGES
		cutoffTs = 0
	}

	// ── Scan chain (full cold-start or delta) ────────────────────────────
	const newEvents: ChainEventLike[] = []
	let cursor: { eventSeq: string; txDigest: string } | null | undefined
	let hasMore = true
	let reachedCutoff = false
	let pagesScanned = 0
	/** Set to true if any page timed out — prevents saving empty results to IDB */
	let senderScanTimedOut = false

	/** Per-page RPC timeout: if a single queryEvents page hangs past this, break out */
	const PAGE_TIMEOUT_MS = 12_000

	for (let page = 0; page < scanPages && hasMore && !reachedCutoff; page++) {
		try {
			const r = await Promise.race([
				suiClient.queryEvents({
					query: { Sender: walletAddress },
					cursor: cursor ?? undefined,
					limit: EVENTS_PER_PAGE,
					order: 'descending',
				}),
				new Promise<never>((_, rej) =>
					setTimeout(() => rej(new Error('queryEvents-page-timeout')), PAGE_TIMEOUT_MS),
				),
			])
			pagesScanned++
			for (const ev of r.data) {
				if (!isCetusLpEventType(ev.type)) continue
				const tsSec = ev.timestampMs != null ? parseInt(String(ev.timestampMs), 10) / 1000 : 0
				if (cached && tsSec < cutoffTs) {
					reachedCutoff = true
					break
				}
				newEvents.push(ev as unknown as ChainEventLike)
			}
			hasMore = r.hasNextPage
			cursor = r.nextCursor ?? null
		} catch (e) {
			// Timeout or RPC error — stop scanning and use what we have
			if (String((e as Error)?.message).includes('timeout')) senderScanTimedOut = true
			break
		}
	}

	 
	console.log(`[cetus-scan] Sender scan: ${pagesScanned} pages, ${newEvents.length} Cetus LP events found (warm=${cached != null})`)

	// Nothing new on warm start — return cached map as-is (no IDB write needed)
	if (newEvents.length === 0 && cached) {
		 
		console.log(`[cetus-scan] Warm start: returning ${baseEvByPos.size} cached positions, keys:`, [...baseEvByPos.keys()].map(k => k.slice(0, 16)))
		return baseEvByPos
	}

	// ── Group new events by TX for position attribution ───────────────────
	const byTx = new Map<string, ChainEventLike[]>()
	for (const ev of newEvents) {
		const digest = ev.id.txDigest
		const arr = byTx.get(digest) ?? []
		arr.push(ev)
		byTx.set(digest, arr)
	}

	let skippedNoPid = 0
	// Merge new events into baseEvByPos (dedup by digest::eventSeq)
	for (const [, txEvs] of byTx.entries()) {
		const posIdsInTx = new Set<string>()
		for (const ev of txEvs) {
			if (!ev.parsedJson || typeof ev.parsedJson !== 'object') continue
			const pj = ev.parsedJson as Parsed
			const pid = readPositionFromEvent(pj)
			if (pid) posIdsInTx.add(pid)
			else {
				// Log the first unmatched event so we can see what field names it uses
				if (skippedNoPid === 0) {
					 
					console.log('[cetus-scan] Event with no position field, type:', ev.type, 'parsedJson keys:', Object.keys(pj))
				}
				skippedNoPid++
			}
		}

		if (posIdsInTx.size === 1) {
			const pid = [...posIdsInTx][0]!
			const arr = baseEvByPos.get(pid) ?? []
			const existingKeys = new Set(arr.map((e) => `${e.id.txDigest}::${e.id.eventSeq}`))
			for (const ev of txEvs) {
				const key = `${ev.id.txDigest}::${ev.id.eventSeq}`
				if (!existingKeys.has(key)) arr.push(ev)
			}
			baseEvByPos.set(pid, arr)
		} else if (posIdsInTx.size > 1) {
			// Multiple positions in one TX — attribute each event individually
			for (const ev of txEvs) {
				if (!ev.parsedJson || typeof ev.parsedJson !== 'object') continue
				const pj = ev.parsedJson as Parsed
				const pid = readPositionFromEvent(pj)
				if (!pid) continue
				const arr = baseEvByPos.get(pid) ?? []
				const key = `${ev.id.txDigest}::${ev.id.eventSeq}`
				if (!arr.some((e) => `${e.id.txDigest}::${e.id.eventSeq}` === key)) arr.push(ev)
				baseEvByPos.set(pid, arr)
			}
		}
		// posIdsInTx.size === 0: no position field found — skip
	}

	if (skippedNoPid > 0) {
		 
		console.warn(`[cetus-scan] ${skippedNoPid} events skipped — no position field in parsedJson`)
	}
	 
	console.log(`[cetus-scan] Result: ${baseEvByPos.size} positions attributed, keys:`, [...baseEvByPos.keys()].map(k => k.slice(0, 16)))

	// ── Persist to IDB (fire-and-forget) ─────────────────────────────────
	// Skip save if the scan timed out — preserves IDB state for next load
	// so we don't permanently cache an empty result and waste 12s on every reload.
	if (!senderScanTimedOut) {
		saveCetusSenderCache(walletNorm, baseEvByPos)
	}

	return baseEvByPos
}

// ---------------------------------------------------------------------------
// Per-position event scan (uses the wallet scan above, cached per session)
// ---------------------------------------------------------------------------

/** Session-level cache: walletAddress → scan promise (re-use across concurrent calls). */
const _walletScanCache = new Map<string, Promise<Map<string, ChainEventLike[]>>>()

/**
 * Returns all Cetus LP events for one position.
 * Internally runs a wallet-wide `queryEvents({ Sender })` scan once per wallet per session.
 */
/** Same wallet scan as `scanCetusPositionEvents`, including the 5-minute session cache. */
export async function loadCetusWalletRawEvents(
	walletAddress: string,
): Promise<Map<string, ChainEventLike[]>> {
	let scanPromise = _walletScanCache.get(walletAddress)
	if (!scanPromise) {
		scanPromise = scanCetusWalletEvents(walletAddress)
		_walletScanCache.set(walletAddress, scanPromise)
		setTimeout(() => _walletScanCache.delete(walletAddress), 5 * 60 * 1000)
	}
	return scanPromise
}

export async function scanCetusPositionEvents(
	walletAddress: string,
	positionId: string,
	tokenADecimals: number,
	tokenBDecimals: number,
): Promise<PositionEvent[]> {
	let posNorm: string
	try {
		posNorm = normalizeSuiAddress(positionId)
	} catch {
		return []
	}

	const rawByPosition = await loadCetusWalletRawEvents(walletAddress)

	 
	console.log(`[cetus-scan] Looking up posNorm=${posNorm.slice(0, 16)}… map has ${rawByPosition.size} positions, hit=${rawByPosition.has(posNorm)}`)

	const rawEvs = rawByPosition.get(posNorm) ?? []
	if (rawEvs.length === 0) return []

	const events: PositionEvent[] = []
	const seen = new Set<string>()

	for (const ev of rawEvs) {
		const tsSec = ev.timestampMs ? parseInt(String(ev.timestampMs), 10) / 1000 : 0
		const txDigest = ev.id.txDigest
		const pe = parseCetusEvent(ev as RawEvent, txDigest, tsSec, posNorm, tokenADecimals, tokenBDecimals)
		if (pe && !seen.has(pe.id)) {
			seen.add(pe.id)
			events.push(pe)
		}
	}

	await hydrateCetusRewardAmounts(events)
	events.sort((a, b) => a.timestamp - b.timestamp)
	return events
}

/**
 * Invalidate the wallet event caches for a given address.
 * Call this when the user clicks Refresh.
 */
export function invalidateCetusEventCache(walletAddress: string): void {
	_walletScanCache.delete(walletAddress)
	_walletTxScanCache.delete(walletAddress)
}

// ---------------------------------------------------------------------------
// Deep wallet TX scan (FromAddress-based fallback for old closed positions)
// ---------------------------------------------------------------------------

/**
 * Session-level cache: walletAddress → deep TX scan promise.
 * Separate from _walletScanCache — covers ALL wallet TXs, not just the last
 * 2500 events from the Sender scan.
 */
const _walletTxScanCache = new Map<string, Promise<Map<string, RawEvent[]>>>()

/** Max pages for the deep TX scan (100 × 50 = up to 5 000 TXs from the wallet). */
const MAX_TX_SCAN_PAGES = 100

/**
 * Scan ALL TXs sent by the wallet, extracting Cetus LP events grouped by position.
 *
 * Unlike the Sender event scan (limited to the last ~2500 total events emitted
 * by the wallet), this walks the full TX history and therefore reaches events
 * from positions that were opened months or years ago.
 *
 * Returns a Map from normalised positionId → list of RawEvents (enriched with
 * tx digest + tx-level timestamp so they can be parsed later with decimals).
 */
async function scanCetusWalletTxs(
	walletAddress: string,
): Promise<Map<string, RawEvent[]>> {
	const byPosition = new Map<string, RawEvent[]>()

	let cursor: string | null | undefined
	let hasMore = true

	const TX_PAGE_TIMEOUT_MS = 15_000

	for (let page = 0; page < MAX_TX_SCAN_PAGES && hasMore; page++) {
		try {
			const r = await Promise.race([
				suiClient.queryTransactionBlocks({
					filter: { FromAddress: walletAddress },
					options: { showEvents: true },
					limit: 50,
					cursor: cursor ?? undefined,
					order: 'descending',
				}),
				new Promise<never>((_, rej) =>
					setTimeout(() => rej(new Error('queryTxBlocks-page-timeout')), TX_PAGE_TIMEOUT_MS),
				),
			])

			for (const tx of r.data) {
				const tsSec = tx.timestampMs ? parseInt(String(tx.timestampMs), 10) / 1000 : 0
				for (const ev of (tx.events ?? []) as RawEvent[]) {
					if (!isCetusLpEventType(ev.type)) continue
					if (!ev.parsedJson || typeof ev.parsedJson !== 'object') continue
					const pj = ev.parsedJson as Parsed
					const pid = readPositionFromEvent(pj)
					if (!pid) continue

					// Enrich the event with tx-level metadata so consumers can parse it later
					const enriched: RawEvent = {
						type: ev.type,
						parsedJson: ev.parsedJson,
						id: {
							eventSeq: (ev.id as { eventSeq?: string } | undefined)?.eventSeq ?? '0',
							txDigest: tx.digest,
						},
						timestampMs: String(Math.floor(tsSec * 1000)),
					}

					if (!byPosition.has(pid)) byPosition.set(pid, [])
					byPosition.get(pid)!.push(enriched)
				}
			}

			hasMore = r.hasNextPage
			cursor = r.nextCursor ?? null
		} catch {
			break
		}
	}

	 
	console.log(`[cetus-tx-scan] TX scan done: ${byPosition.size} positions found, keys:`, [...byPosition.keys()].map(k => k.slice(0, 16)))

	return byPosition
}

/**
 * Returns all Cetus LP events for one position using a deep wallet TX scan.
 *
 * Uses `queryTransactionBlocks({ FromAddress: wallet })` to walk the wallet's
 * full TX history (up to 5 000 TXs).  This is the fallback for old closed
 * positions whose events fall outside the 2 500-event window of the fast
 * Sender-based scan.
 *
 * The result is cached per wallet for 5 minutes so that multiple old positions
 * share a single scan.
 */
export async function scanCetusPositionEventsByWalletTxs(
	walletAddress: string,
	positionId: string,
	tokenADecimals: number,
	tokenBDecimals: number,
): Promise<PositionEvent[]> {
	let posNorm: string
	try {
		posNorm = normalizeSuiAddress(positionId)
	} catch {
		return []
	}

	// Use or create the wallet-wide TX scan promise (deduplicated)
	let scanPromise = _walletTxScanCache.get(walletAddress)
	if (!scanPromise) {
		scanPromise = scanCetusWalletTxs(walletAddress)
		_walletTxScanCache.set(walletAddress, scanPromise)
		// Evict after 5 minutes so a Refresh re-scans
		setTimeout(() => _walletTxScanCache.delete(walletAddress), 5 * 60 * 1000)
	}

	const byPosition = await scanPromise
	const rawEvs = byPosition.get(posNorm) ?? []
	if (rawEvs.length === 0) return []

	const events: PositionEvent[] = []
	const seen = new Set<string>()

	for (const ev of rawEvs) {
		const tsSec = ev.timestampMs ? parseInt(String(ev.timestampMs), 10) / 1000 : 0
		const txDigest = ev.id?.txDigest ?? ''
		const pe = parseCetusEvent(ev, txDigest, tsSec, posNorm, tokenADecimals, tokenBDecimals)
		if (pe && !seen.has(pe.id)) {
			seen.add(pe.id)
			events.push(pe)
		}
	}

	await hydrateCetusRewardAmounts(events)
	events.sort((a, b) => a.timestamp - b.timestamp)
	return events
}
