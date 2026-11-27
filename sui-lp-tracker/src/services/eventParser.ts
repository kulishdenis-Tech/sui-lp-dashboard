import type { EventType, PositionEvent } from '@/types'
import { suiClient } from '@/services/suiClient'
import { MOMENTUM_PUBLISHED_AT, PROTOCOL_PACKAGES } from '@/utils/constants'
import { normalizeSuiAddress, normalizeStructTag } from '@mysten/sui/utils'
import Decimal from 'decimal.js'
import {
	hydrateMomentumRewardAmounts,
	parseMomentumEventFromSui,
	readMomentumPositionId,
	isMomentumLpLifecycleMoveEventType,
	isMomentumLpLifecycleStruct,
} from '@/services/momentumLpEvents'
import {
	loadLpCacheEntry,
	saveLpCacheEntry,
	flattenToRows,
	rowsToMap,
	computeMaxTs,
} from '@/services/lpEventIdbCache'
import { querySenderAndMoveEventTypes } from '@/services/querySenderMoveEvents'
import {
	ensureWalletSenderEventPages,
	invalidateWalletSenderEventsCache,
} from '@/services/walletSenderEventsCache'
// lpFeatureFlags: getBluefinPositionClosedAssistPages / shouldLpAscendingBackfill removed — scan redesigned to event-based approach

/**
 * Обгортка Sui-події (Bluefin ланцюжок) перед отриманням decimals пулу для `parseEventFromSui`.
 */
export type BluefinWalletRawEvt = {
	digest: string
	tsSec: number
	event: { type: string; parsedJson?: unknown; id?: { eventSeq: string; txDigest: string } }
}

/** Momentum CLMM події того ж shape, що й Bluefin-обгортка. */
export type MomentumWalletRawEvt = BluefinWalletRawEvt

const PKG = PROTOCOL_PACKAGES.BLUEFIN_CLMM

/**
 * Upgrade-safe: Bluefin CLMM upgrades change the package address AND possibly the module
 * name in event types. Matching purely on struct suffix (without a module requirement) is
 * the most resilient approach. The struct names are specific enough to Bluefin CLMM that
 * false positives are handled by the downstream `readPositionId` + `STRUCT_TO_TYPE` checks.
 *
 * Old approach (`startsWith(PKG::events::)`) broke on package upgrades.
 * Previous fix (`includes('::events::')`) broke if the module name changed.
 */
const BLUEFIN_EVENT_STRUCT_SUFFIXES = [
	'::PositionOpened',
	'::LiquidityProvided',
	'::LiquidityRemoved',
	'::UserFeeCollected',
	'::UserRewardCollected',
	'::PositionClosed',
] as const

/** Known Bluefin struct names for O(1) lookup (tail after last `::`). */
const BLUEFIN_STRUCT_NAME_SET = new Set(
	BLUEFIN_EVENT_STRUCT_SUFFIXES.map((s) => s.slice(2)), // strip leading '::'
)

export function isBluefinLpLifecycleMoveEventType(type: string): boolean {
	// Pure struct-name match — no module/package requirement.
	// Resilient across Bluefin package upgrades and module renames.
	// Downstream `STRUCT_TO_TYPE[sn]` + `readPositionId` filter out false positives.
	const tail = type.split('::').pop() ?? ''
	return BLUEFIN_STRUCT_NAME_SET.has(tail)
}

/** Extract `0x{pkg}` prefix from a Move type string. */
function pkgFromMoveType(type: string): string | null {
	const m = type.match(/^(0x[0-9a-f]+)::/)
	return m?.[1] ?? null
}


const scanCache = new Map<
	string,
	{ at: number; data: { eventsByPositionId: Map<string, PositionEvent[]>; historyPartial: boolean } }
>()
const CACHE_MS = 5 * 60 * 1000
/** Кеш `scanBluefinWalletAllPositionEvents` (повний набір позицій гаманця). */
const scanBluefinAllCache = new Map<string, { raw: Map<string, BluefinWalletRawEvt[]>; partial: boolean; at: number }>()
/** In-flight full Bluefin scan — closed/enrich share one cold pass. */
const scanBluefinInflight = new Map<
	string,
	Promise<{ rawByPositionId: Map<string, BluefinWalletRawEvt[]>; historyPartial: boolean }>
>()
/** Wallet-level typed GraphQL Promise cache (Turbos-style). */
const _bluefinWalletTypedCache = new Map<
	string,
	Promise<Awaited<ReturnType<typeof querySenderAndMoveEventTypes>>>
>()
const _momentumWalletTypedCache = new Map<
	string,
	Promise<Awaited<ReturnType<typeof querySenderAndMoveEventTypes>>>
>()
/** Кеш повного скану Momentum-подій гаманця. */
const scanMomentumAllCache = new Map<
	string,
	{ raw: Map<string, MomentumWalletRawEvt[]>; partial: boolean; at: number }
>()

function loadBluefinWalletTyped(
	wallet: string,
	mode: 'full' | 'delta',
	stopBeforeTsSec?: number,
): Promise<Awaited<ReturnType<typeof querySenderAndMoveEventTypes>>> {
	const key = `${wallet}|${mode}`
	let p = _bluefinWalletTypedCache.get(key)
	if (!p) {
		p = querySenderAndMoveEventTypes(wallet, bluefinTypedEventPaths(), {
			maxPagesPerType: mode === 'delta' ? 8 : 40,
			pageSize: 50,
			stopBeforeTsSec,
			typeConcurrency: 3,
		}).catch((e) => {
			_bluefinWalletTypedCache.delete(key)
			throw e
		})
		_bluefinWalletTypedCache.set(key, p)
		setTimeout(() => _bluefinWalletTypedCache.delete(key), CACHE_MS)
	}
	return p
}

function loadMomentumWalletTyped(
	wallet: string,
	mode: 'full' | 'delta',
	stopBeforeTsSec?: number,
): Promise<Awaited<ReturnType<typeof querySenderAndMoveEventTypes>>> {
	const key = `${wallet}|${mode}`
	let p = _momentumWalletTypedCache.get(key)
	if (!p) {
		p = querySenderAndMoveEventTypes(wallet, momentumTypedEventPaths(), {
			maxPagesPerType: mode === 'delta' ? 10 : 40,
			pageSize: 50,
			stopBeforeTsSec,
			typeConcurrency: 3,
		}).catch((e) => {
			_momentumWalletTypedCache.delete(key)
			throw e
		})
		_momentumWalletTypedCache.set(key, p)
		setTimeout(() => _momentumWalletTypedCache.delete(key), CACHE_MS)
	}
	return p
}

/**
 * Invalidate the in-memory Momentum scan cache for a wallet.
 * Call this when the IDB cache is cleared so the next
 * scanMomentumWalletAllPositionEvents call triggers a fresh cold scan
 * instead of returning the stale in-memory copy.
 */
export function clearMomentumScanCache(walletAddress: string): void {
	try {
		const walletNormKey = normalizeSuiAddress(walletAddress)
		scanMomentumAllCache.delete(`${walletNormKey}|mmt_events_all_v5`)
	} catch {
		// ignore
	}
}
/** Sender-event scan для Bluefin (cold after successful typed → capped). */
const MAX_BF_SENDER_EVENT_PAGES = 120
/** Cold Sender pages when GraphQL typed already returned LP events. */
const MAX_BF_SENDER_AFTER_TYPED = 50
const BF_EVENTS_PAGE_SIZE = 50
/** Глобальний scan PositionClosed (без TX-фетчів): фільтр по parsedJson.sender. */
const MAX_BF_GLOBAL_CLOSED_PAGES = 250
/** Cap global PositionClosed assist when typed already covered closes. */
const MAX_BF_GLOBAL_CLOSED_PAGES_ASSIST = 40
/**
 * Momentum Sender-event cold-start scan (100 pages × 50 = 5 000 events).
 * Runs as Phase 2 safety net after the TX scan in scanMomentumWalletAllPositionEvents.
 * Raised from 40 → 100 to match Cetus's Sender scan depth and catch older positions.
 */
const MAX_MMT_SENDER_EVENT_PAGES = 100

// ─── Delta (incremental) scan constants ──────────────────────────────────────
/**
 * Warm-start (delta) scans: max pages to check for NEW events.
 * Cold start always uses the full page limits above.
 * 5 pages × 50 events = 250 events max per delta scan — enough for any burst of activity.
 */
const MAX_BF_DELTA_PAGES = 5
const MAX_MMT_DELTA_SENDER_PAGES = 5
/**
 * Overlap buffer for delta stop condition (seconds).
 * Stop scanning when event tsSec < lastEventTs − DELTA_OVERLAP_SEC.
 * 3 hours covers any reasonable clock skew or late-indexed events.
 */
const DELTA_OVERLAP_SEC = 3 * 3600

type Parsed = Record<string, unknown>

const STRUCT_TO_TYPE: Record<string, EventType> = {
	PositionOpened: 'open_position',
	LiquidityProvided: 'add_liquidity',
	LiquidityRemoved: 'remove_liquidity',
	UserFeeCollected: 'collect_fee',
	UserRewardCollected: 'collect_reward',
	PositionClosed: 'close_position',
}

export type GetPositionEventOpts = {
	tokenADecimals: number
	tokenBDecimals: number
}

/**
 * Обхід транзакцій гаманця: усі відомі Bluefin `events::*` із `STRUCT_TO_TYPE`.
 * На виході ще без нормалізованих сум (decimals з’являються в `bluefinClosedPositions.ts` через pool).
 *
 * Обмеження: спочатку транзакції з `FromAddress === wallet`; додатково — `suix_queryEvents` з фільтром
 * **`Sender`** (життєвий цикл Bluefin із `parsedJson`), щоб не губити історію при «шумному» газ‑спонсорі /
 * складних підписантах або коли просто бракує охоплення серед останніх `queryTransactionBlocks`-сторінок.
 * Третій канал (**assist**): через тієї ж RPC неможливий комбінований запит Sender+MoveEventType; при дуже
 * активному гаманці старі `PositionClosed` випадають за меж сторінок `Sender` — доповнюємо допоміжним
 * посторінковим **`MoveEventType` → PositionClosed** (глобально, від новіших до старіших) і залишаємо лише
 * транзакції, де **`transaction.data.sender` === wallet** (`sui_multiGetTransactionBlocks`).
 * (як дефолт Sui-клієнта): спочатку недавні tx — під лімітом сторінок зберігаються актуальні LP-події;
 * обхід ascending раніше відсікав нові активності для «гарячих» гаманців.
 */
/**
 * Сканує Bluefin-події гаманця двофазово — без важкого `queryTransactionBlocks`:
 * Transport: dashboard `suiClient` defaults to gRPC/GraphQL compat (`@/services/suiData`).
 * 1. `queryEvents({ Sender: wallet })` — усі події цього гаманця (≤ 60 сторінок ≈ 3 000 подій).
 * 2. `queryEvents({ MoveEventType: PositionClosed })` глобально, фільтр по `parsedJson.sender` —
 *    ловить старі закриті позиції поза вікном Sender-скану. **Жодних TX-фетчів.**
 */
export async function scanBluefinWalletAllPositionEvents(walletAddress: string): Promise<{
	rawByPositionId: Map<string, BluefinWalletRawEvt[]>
	historyPartial: boolean
}> {
	const walletNormKey = normalizeSuiAddress(walletAddress)
	const memCacheKey = `${walletNormKey}|bluefin_events_all_v7`

	const cached = scanBluefinAllCache.get(memCacheKey)
	if (cached && Date.now() - cached.at < CACHE_MS) {
		const m = new Map<string, BluefinWalletRawEvt[]>()
		for (const [k, v] of cached.raw) m.set(k, [...v])
		return { rawByPositionId: m, historyPartial: cached.partial }
	}

	const existing = scanBluefinInflight.get(walletNormKey)
	if (existing) return existing

	const run = (async () => {
		const idbEntry = await loadLpCacheEntry(walletNormKey, 'bluefin')

		const rawByPositionId: Map<string, BluefinWalletRawEvt[]> = idbEntry
			? rowsToMap<BluefinWalletRawEvt>(idbEntry.rows)
			: new Map()
		let historyPartial = idbEntry?.historyPartial ?? false
		const seenPkgs = new Set<string>(idbEntry?.seenPkgs ?? [])

		if (!idbEntry) {
			console.log('[bf-scan] cold start wallet=', walletNormKey.slice(0, 12))
			let typedClosedCount = 0
			let typedOk = false
			let typedPartial = true

			try {
				const typed = await loadBluefinWalletTyped(walletNormKey, 'full')
				typedPartial = typed.partial
				if (typed.partial) historyPartial = true
				typedOk = typed.events.length > 0
				const dedupe = assistDedupeSetsFrom(rawByPositionId)
				for (const ev of typed.events) {
					const typeStr = ev.type
					if (!isBluefinLpLifecycleMoveEventType(typeStr)) continue
					const pjRaw = ev.parsedJson
					if (!pjRaw || typeof pjRaw !== 'object') continue
					const pj = pjRaw as Parsed
					const sn = structNameFromType(typeStr)
					if (!STRUCT_TO_TYPE[sn]) continue
					if (sn === 'PositionClosed') typedClosedCount++
					const pid = readPositionId(pj)
					if (!pid) continue
					let posNorm: string
					try {
						posNorm = normalizeSuiAddress(pid)
					} catch {
						continue
					}
					const pkg = pkgFromMoveType(typeStr)
					if (pkg) seenPkgs.add(pkg)
					const dig = ev.id?.txDigest ?? ''
					if (!dig) continue
					const rawMs = ev.timestampMs != null ? Number(ev.timestampMs) : NaN
					const tsSec = Number.isFinite(rawMs) ? Math.floor(rawMs / 1000) : 0
					const row: BluefinWalletRawEvt = {
						digest: dig,
						tsSec,
						event: { type: typeStr, parsedJson: ev.parsedJson, id: ev.id },
					}
					const dk = walletEvtDedupeKey(row)
					let s = dedupe.get(posNorm)
					if (!s) {
						s = new Set()
						dedupe.set(posNorm, s)
					}
					if (s.has(dk)) continue
					s.add(dk)
					const arr = rawByPositionId.get(posNorm) ?? []
					arr.push(row)
					rawByPositionId.set(posNorm, arr)
				}
				console.log(
					'[bf-scan] GraphQL typed done — positions=',
					rawByPositionId.size,
					'closedEv=',
					typedClosedCount,
					'partial=',
					typed.partial,
				)
			} catch (e) {
				console.warn('[bf-scan] GraphQL typed cold scan failed', e)
				historyPartial = true
				typedOk = false
			}

			// After successful typed coverage, Sender is assist-only with a hard page cap —
			// do not mark historyPartial when that intentional cap stops early.
			const senderCap = typedOk ? MAX_BF_SENDER_AFTER_TYPED : MAX_BF_SENDER_EVENT_PAGES
			const ignoreSenderPageCapPartial = typedOk && !typedPartial
			await mergeBluefinSenderQueryEvents(
				walletAddress,
				rawByPositionId,
				(partial) => {
					if (partial && !ignoreSenderPageCapPartial) historyPartial = true
				},
				seenPkgs,
				undefined,
				senderCap,
			)

			console.log('[bf-scan] Phase 1 done — positions=', rawByPositionId.size, '| seenPkgs=', [...seenPkgs])

			const skipGlobal = typedClosedCount > 0 && !typedPartial
			await mergeBluefinClosedGlobal(walletAddress, rawByPositionId, seenPkgs, {
				skip: skipGlobal,
				maxPages: skipGlobal ? 0 : typedOk ? MAX_BF_GLOBAL_CLOSED_PAGES_ASSIST : MAX_BF_GLOBAL_CLOSED_PAGES,
			})

			// Typed complete + global skipped → treat as complete unless typed itself was partial.
			if (skipGlobal) historyPartial = typedPartial

			console.log('[bf-scan] Phase 2 done — total positions=', rawByPositionId.size, 'skipGlobal=', skipGlobal)

			const now = Date.now()
			await saveLpCacheEntry({
				id: `${walletNormKey}|bluefin`,
				walletNorm: walletNormKey,
				protocol: 'bluefin',
				rows: flattenToRows(rawByPositionId),
				lastEventTs: computeMaxTs(rawByPositionId),
				seenPkgs: [...seenPkgs],
				historyPartial,
				fullScanDoneAt: now,
			})
		} else {
			const lastTs = idbEntry.lastEventTs
			console.log(
				'[bf-scan] warm start wallet=',
				walletNormKey.slice(0, 12),
				'| lastEventTs=',
				lastTs,
				'| positions=',
				rawByPositionId.size,
			)

			try {
				const typed = await loadBluefinWalletTyped(walletNormKey, 'delta', lastTs - DELTA_OVERLAP_SEC)
				const dedupe = assistDedupeSetsFrom(rawByPositionId)
				for (const ev of typed.events) {
					const typeStr = ev.type
					if (!isBluefinLpLifecycleMoveEventType(typeStr)) continue
					const pjRaw = ev.parsedJson
					if (!pjRaw || typeof pjRaw !== 'object') continue
					const pj = pjRaw as Parsed
					const sn = structNameFromType(typeStr)
					if (!STRUCT_TO_TYPE[sn]) continue
					const pid = readPositionId(pj)
					if (!pid) continue
					let posNorm: string
					try {
						posNorm = normalizeSuiAddress(pid)
					} catch {
						continue
					}
					const dig = ev.id?.txDigest ?? ''
					if (!dig) continue
					const rawMs = ev.timestampMs != null ? Number(ev.timestampMs) : NaN
					const tsSec = Number.isFinite(rawMs) ? Math.floor(rawMs / 1000) : 0
					const row: BluefinWalletRawEvt = {
						digest: dig,
						tsSec,
						event: { type: typeStr, parsedJson: ev.parsedJson, id: ev.id },
					}
					const dk = walletEvtDedupeKey(row)
					let s = dedupe.get(posNorm)
					if (!s) {
						s = new Set()
						dedupe.set(posNorm, s)
					}
					if (s.has(dk)) continue
					s.add(dk)
					const arr = rawByPositionId.get(posNorm) ?? []
					arr.push(row)
					rawByPositionId.set(posNorm, arr)
				}
			} catch (e) {
				console.warn('[bf-scan] GraphQL typed delta failed', e)
			}

			const added = await mergeBluefinSenderQueryEvents(
				walletAddress,
				rawByPositionId,
				() => {},
				seenPkgs,
				lastTs,
			)

			console.log('[bf-scan] delta done — added=', added, '| total positions=', rawByPositionId.size)

			if (added > 0) {
				await saveLpCacheEntry({
					...idbEntry,
					rows: flattenToRows(rawByPositionId),
					lastEventTs: computeMaxTs(rawByPositionId),
					seenPkgs: [...seenPkgs],
				})
			}
		}

		for (const [, list] of rawByPositionId) {
			list.sort((a, b) => {
				if (a.tsSec !== b.tsSec) return a.tsSec - b.tsSec
				return `${a.digest}`.localeCompare(`${b.digest}`)
			})
		}

		const frozen = new Map<string, BluefinWalletRawEvt[]>()
		for (const [k, v] of rawByPositionId) frozen.set(k, [...v])
		scanBluefinAllCache.set(memCacheKey, { raw: frozen, partial: historyPartial, at: Date.now() })

		return { rawByPositionId, historyPartial }
	})()

	scanBluefinInflight.set(walletNormKey, run)
	try {
		return await run
	} finally {
		scanBluefinInflight.delete(walletNormKey)
	}
}

function walletEvtDedupeKey(row: BluefinWalletRawEvt): string {
	const seq = row.event?.id?.eventSeq != null ? String(row.event.id.eventSeq) : ''
	return `${row.digest}|${seq}|${row.event.type}`
}

function assistDedupeSetsFrom(rawByPositionId: Map<string, BluefinWalletRawEvt[]>): Map<string, Set<string>> {
	const dedupe = new Map<string, Set<string>>()
	for (const [pid, rows] of rawByPositionId) {
		dedupe.set(pid, new Set(rows.map(walletEvtDedupeKey)))
	}
	return dedupe
}

/**
 * @param stopBeforeTs  If provided → delta mode: stop when event tsSec < stopBeforeTs − DELTA_OVERLAP_SEC.
 *                      Also caps max pages at MAX_BF_DELTA_PAGES.
 * @returns Number of new event rows added to rawByPositionId.
 */
async function mergeBluefinSenderQueryEvents(
	walletAddress: string,
	rawByPositionId: Map<string, BluefinWalletRawEvt[]>,
	onPartial: (partial: boolean) => void,
	seenPkgs: Set<string>,
	stopBeforeTs?: number,
	coldMaxPages?: number,
): Promise<number> {
	let owner: string
	try {
		owner = normalizeSuiAddress(walletAddress.trim())
	} catch {
		owner = walletAddress.trim()
	}

	const isDelta = stopBeforeTs != null
	const maxPages = isDelta
		? MAX_BF_DELTA_PAGES
		: coldMaxPages ?? MAX_BF_SENDER_EVENT_PAGES
	const cutoffTs = isDelta ? stopBeforeTs! - DELTA_OVERLAP_SEC : -Infinity

	const dedupe = new Map<string, Set<string>>()
	for (const [pid, rows] of rawByPositionId) {
		dedupe.set(pid, new Set(rows.map(walletEvtDedupeKey)))
	}

	let addedCount = 0
	const { pages, exhausted } = await ensureWalletSenderEventPages(
		owner,
		maxPages,
		BF_EVENTS_PAGE_SIZE,
	)

	for (let page = 0; page < Math.min(maxPages, pages.length); page++) {
		const r = pages[page]!
		let reachedCutoff = false
		for (const chainEv of r.data) {
			const typeStr = chainEv.type

			const rawMs = chainEv.timestampMs != null ? Number(chainEv.timestampMs) : NaN
			const tsSec = Number.isFinite(rawMs) ? Math.floor(rawMs / 1000) : 0

			// Delta stop: events are descending → once we hit cutoff, all subsequent are older too
			if (isDelta && tsSec < cutoffTs) {
				reachedCutoff = true
				break
			}

			// Upgrade-safe check: covers any Bluefin CLMM package version
			if (!isBluefinLpLifecycleMoveEventType(typeStr)) continue
			const pjRaw = chainEv.parsedJson
			if (!pjRaw || typeof pjRaw !== 'object') continue
			const pj = pjRaw as Parsed
			const sn = structNameFromType(typeStr)
			if (!STRUCT_TO_TYPE[sn]) continue
			const pid = readPositionId(pj)
			if (!pid) continue
			let posNorm: string
			try {
				posNorm = normalizeSuiAddress(pid)
			} catch {
				continue
			}
			// Collect actual package address for Phase 2 dynamic queries
			const pkg = pkgFromMoveType(typeStr)
			if (pkg) seenPkgs.add(pkg)

			const digest = chainEv.id?.txDigest ?? ''
			if (!digest) continue
			const row: BluefinWalletRawEvt = {
				digest,
				tsSec,
				event: {
					type: typeStr,
					parsedJson: chainEv.parsedJson,
					id: chainEv.id,
				},
			}
			const dk = walletEvtDedupeKey(row)
			let s = dedupe.get(posNorm)
			if (!s) {
				s = new Set<string>()
				dedupe.set(posNorm, s)
			}
			if (s.has(dk)) continue
			s.add(dk)

			const arr = rawByPositionId.get(posNorm) ?? []
			arr.push(row)
			rawByPositionId.set(posNorm, arr)
			addedCount++
		}

		if (reachedCutoff || !r.hasNextPage) break
		if (page + 1 >= maxPages) {
			if (!isDelta && (r.hasNextPage || !exhausted)) onPartial(true)
			break
		}
	}

	return addedCount
}

/**
 * Глобальний scan `PositionClosed` подій Bluefin — фільтр по `parsedJson.sender`.
 * Ловить старі закриті позиції, яких немає у вікні Sender-скану.
 * **Жодних TX-фетчів** — sender відомий прямо з parsedJson події.
 *
 * Запускає окремий прохід для кожного відомого Bluefin package prefix:
 * - Base package (оригінальний `PKG`) — як fallback
 * - Усі prefix-и, виявлені в Phase 1 (актуальний `published_at` після апгрейдів)
 * Це гарантує охоплення як старих, так і нових PositionClosed подій.
 */
async function mergeBluefinClosedGlobal(
	walletAddress: string,
	rawByPositionId: Map<string, BluefinWalletRawEvt[]>,
	seenPkgs: Set<string>,
	opts?: { skip?: boolean; maxPages?: number },
): Promise<void> {
	if (opts?.skip) {
		console.log('[bf-scan] Phase 2 skipped — typed PositionClosed coverage sufficient')
		return
	}
	let walletNorm: string
	try {
		walletNorm = normalizeSuiAddress(walletAddress.trim())
	} catch {
		walletNorm = walletAddress.trim()
	}

	const pageCap = opts?.maxPages ?? MAX_BF_GLOBAL_CLOSED_PAGES
	if (pageCap <= 0) return

	// Build the set of package addresses to query PositionClosed for:
	// always include base PKG as fallback; add any packages discovered in Phase 1
	const pkgsToQuery = new Set<string>([PKG, ...seenPkgs])
	const dedupe = assistDedupeSetsFrom(rawByPositionId)

	for (const pkg of pkgsToQuery) {
		const moveEventType = `${pkg}::events::PositionClosed`
		let eventsCursor: { txDigest: string; eventSeq: string } | null | undefined

		for (let page = 0; page < pageCap; page++) {
			const r = await suiClient.queryEvents({
				query: { MoveEventType: moveEventType },
				order: 'descending',
				limit: BF_EVENTS_PAGE_SIZE,
				cursor: eventsCursor ?? null,
			})

			for (const chainEv of r.data) {
				const pjRaw = chainEv.parsedJson
				if (!pjRaw || typeof pjRaw !== 'object') continue
				const pj = pjRaw as Parsed

				// Filter by sender directly from parsedJson — no TX fetches!
				const senderRaw = pj['sender']
				let senderNorm: string | null = null
				if (typeof senderRaw === 'string' && senderRaw.startsWith('0x')) {
					try {
						senderNorm = normalizeSuiAddress(senderRaw)
					} catch {
						senderNorm = senderRaw
					}
				}
				if (senderNorm !== walletNorm) continue

				const typeStr = chainEv.type
				// Upgrade-safe: accept any Bluefin CLMM package version
				if (!isBluefinLpLifecycleMoveEventType(typeStr)) continue
				const sn = structNameFromType(typeStr)
				if (!STRUCT_TO_TYPE[sn]) continue
				const pid = readPositionId(pj)
				if (!pid) continue
				let posNorm: string
				try {
					posNorm = normalizeSuiAddress(pid)
				} catch {
					continue
				}

				const rawMs = chainEv.timestampMs != null ? Number(chainEv.timestampMs) : NaN
				const tsSec = Number.isFinite(rawMs) ? Math.floor(rawMs / 1000) : 0
				const digest = chainEv.id?.txDigest ?? ''
				if (!digest) continue

				const row: BluefinWalletRawEvt = {
					digest,
					tsSec,
					event: { type: typeStr, parsedJson: chainEv.parsedJson, id: chainEv.id },
				}
				const dk = walletEvtDedupeKey(row)
				let ds = dedupe.get(posNorm)
				if (!ds) {
					ds = new Set<string>()
					dedupe.set(posNorm, ds)
				}
				if (ds.has(dk)) continue
				ds.add(dk)

				const arr = rawByPositionId.get(posNorm) ?? []
				arr.push(row)
				rawByPositionId.set(posNorm, arr)
			}

			if (!r.hasNextPage) break
			const next = r.nextCursor ?? null
			if (next == null) break
			eventsCursor = next
		}
	}
}

/**
 * Sender-event scan для Momentum.
 * @param stopBeforeTs  Delta mode: stop when tsSec < stopBeforeTs − DELTA_OVERLAP_SEC.
 * @returns Count of new rows added.
 */
async function mergeMomentumSenderEvents(
	walletAddress: string,
	rawByPositionId: Map<string, MomentumWalletRawEvt[]>,
	stopBeforeTs?: number,
): Promise<number> {
	let owner: string
	try {
		owner = normalizeSuiAddress(walletAddress.trim())
	} catch {
		owner = walletAddress.trim()
	}

	const isDelta = stopBeforeTs != null
	const maxPages = isDelta ? MAX_MMT_DELTA_SENDER_PAGES : MAX_MMT_SENDER_EVENT_PAGES
	const cutoffTs = isDelta ? stopBeforeTs! - DELTA_OVERLAP_SEC : -Infinity

	const dedupe = new Map<string, Set<string>>()
	for (const [pid, rows] of rawByPositionId) {
		dedupe.set(pid, new Set(rows.map(walletEvtDedupeKey)))
	}

	let addedCount = 0
	const { pages } = await ensureWalletSenderEventPages(owner, maxPages, BF_EVENTS_PAGE_SIZE)

	for (let page = 0; page < Math.min(maxPages, pages.length); page++) {
		const r = pages[page]!
		let reachedCutoff = false
		for (const chainEv of r.data) {
			const rawMs = chainEv.timestampMs != null ? Number(chainEv.timestampMs) : NaN
			const tsSec = Number.isFinite(rawMs) ? Math.floor(rawMs / 1000) : 0
			if (isDelta && tsSec < cutoffTs) {
				reachedCutoff = true
				break
			}

			const typeStr = chainEv.type
			if (!isMomentumLpLifecycleMoveEventType(typeStr)) continue
			const pjRaw = chainEv.parsedJson
			if (!pjRaw || typeof pjRaw !== 'object') continue
			const pj = pjRaw as Parsed
			const sn = structNameFromType(typeStr)
			if (!isMomentumLpLifecycleStruct(sn)) continue
			const pid = readMomentumPositionId(pj)
			if (!pid) continue
			let posNorm: string
			try {
				posNorm = normalizeSuiAddress(pid)
			} catch {
				continue
			}
			const digest = chainEv.id?.txDigest ?? ''
			if (!digest) continue
			const row: MomentumWalletRawEvt = {
				digest,
				tsSec,
				event: { type: typeStr, parsedJson: chainEv.parsedJson, id: chainEv.id },
			}
			const dk = walletEvtDedupeKey(row)
			let s = dedupe.get(posNorm)
			if (!s) {
				s = new Set<string>()
				dedupe.set(posNorm, s)
			}
			if (s.has(dk)) continue
			s.add(dk)
			const arr = rawByPositionId.get(posNorm) ?? []
			arr.push(row)
			rawByPositionId.set(posNorm, arr)
			addedCount++
		}
		if (reachedCutoff || !r.hasNextPage) break
	}
	return addedCount
}

/**
 * Momentum wallet events: GraphQL typed + Sender safety net only.
 * No `queryTransactionBlocks(FromAddress)` — Mysten gRPC prunes (~16d) with BELOW_EARLIEST_AVAILABLE.
 */
export async function scanMomentumWalletAllPositionEvents(walletAddress: string): Promise<{
	rawByPositionId: Map<string, MomentumWalletRawEvt[]>
	historyPartial: boolean
}> {
	const walletNormKey = normalizeSuiAddress(walletAddress)
	const memCacheKey = `${walletNormKey}|mmt_events_all_v5`

	// ── 1. In-memory cache (5 min TTL) ────────────────────────────────────────
	const cached = scanMomentumAllCache.get(memCacheKey)
	if (cached && Date.now() - cached.at < CACHE_MS) {
		const m = new Map<string, MomentumWalletRawEvt[]>()
		for (const [k, v] of cached.raw) m.set(k, [...v])
		return { rawByPositionId: m, historyPartial: cached.partial }
	}

	// ── 2. IDB persistent cache ────────────────────────────────────────────────
	const idbEntry = await loadLpCacheEntry(walletNormKey, 'momentum')

	const rawByPositionId: Map<string, MomentumWalletRawEvt[]> = idbEntry
		? rowsToMap<MomentumWalletRawEvt>(idbEntry.rows)
		: new Map()
	let historyPartial = idbEntry?.historyPartial ?? false

	const ingestTyped = (ev: {
		type: string
		parsedJson?: unknown
		id?: { eventSeq: string; txDigest: string }
		timestampMs?: string | number | null
	}) => {
		const typeStr = ev.type
		if (!isMomentumLpLifecycleMoveEventType(typeStr)) return
		const pjRaw = ev.parsedJson
		if (!pjRaw || typeof pjRaw !== 'object') return
		const pj = pjRaw as Parsed
		const sn = structNameFromType(typeStr)
		if (!isMomentumLpLifecycleStruct(sn)) return
		const pid = readMomentumPositionId(pj)
		if (!pid) return
		let posNorm: string
		try {
			posNorm = normalizeSuiAddress(pid)
		} catch {
			return
		}
		const rawMs = ev.timestampMs != null ? Number(ev.timestampMs) : NaN
		const tsSec = Number.isFinite(rawMs) ? Math.floor(rawMs / 1000) : 0
		const dig = ev.id?.txDigest ?? ''
		const row: MomentumWalletRawEvt = { digest: dig, tsSec, event: ev as never }
		const arr = rawByPositionId.get(posNorm) ?? []
		if (!arr.some((e) => e.digest === dig && e.event.type === typeStr)) {
			arr.push(row)
			rawByPositionId.set(posNorm, arr)
		}
	}

	if (!idbEntry) {
		// ── Cold start: GraphQL typed + Sender (no gRPC TX) ────────────────────
		try {
			const typed = await loadMomentumWalletTyped(walletNormKey, 'full')
			if (typed.partial) historyPartial = true
			for (const ev of typed.events) ingestTyped(ev)
			console.log('[mmt-scan] GraphQL typed done — positions=', rawByPositionId.size)
		} catch (e) {
			console.warn('[mmt-scan] GraphQL typed cold scan failed', e)
			historyPartial = true
		}

		await mergeMomentumSenderEvents(walletAddress, rawByPositionId)

		await saveLpCacheEntry({
			id: `${walletNormKey}|momentum`,
			walletNorm: walletNormKey,
			protocol: 'momentum',
			rows: flattenToRows(rawByPositionId),
			lastEventTs: computeMaxTs(rawByPositionId),
			seenPkgs: [],
			historyPartial,
			fullScanDoneAt: Date.now(),
		})
	} else {
		// ── Warm: GraphQL typed delta + Sender (no FromAddress TX) ─────────────
		const lastTs = idbEntry.lastEventTs
		let typedAdded = 0
		try {
			const typed = await loadMomentumWalletTyped(
				walletNormKey,
				'delta',
				lastTs - DELTA_OVERLAP_SEC,
			)
			const before = flattenToRows(rawByPositionId).length
			for (const ev of typed.events) ingestTyped(ev)
			typedAdded = flattenToRows(rawByPositionId).length - before
		} catch (e) {
			console.warn('[mmt-scan] GraphQL typed delta failed', e)
		}

		const senderAdded = await mergeMomentumSenderEvents(walletAddress, rawByPositionId, lastTs)
		const totalAdded = typedAdded + senderAdded

		if (totalAdded > 0) {
			await saveLpCacheEntry({
				...idbEntry,
				rows: flattenToRows(rawByPositionId),
				lastEventTs: computeMaxTs(rawByPositionId),
			})
		}
	}

	for (const [, list] of rawByPositionId) {
		list.sort((a, b) => {
			if (a.tsSec !== b.tsSec) return a.tsSec - b.tsSec
			return `${a.digest}`.localeCompare(`${b.digest}`)
		})
	}

	const frozen = new Map<string, MomentumWalletRawEvt[]>()
	for (const [k, v] of rawByPositionId) frozen.set(k, [...v])
	scanMomentumAllCache.set(memCacheKey, { raw: frozen, partial: historyPartial, at: Date.now() })

	return { rawByPositionId, historyPartial }
}

/**
 * Поле `pool_id` у json Bluefin-події (deposit/remove), якщо є.
 */
export function readBluefinPoolIdFromEventJson(pj: unknown): string | null {
	if (!pj || typeof pj !== 'object') return null
	const p = pj as Parsed
	const v = p['pool_id']
	if (typeof v === 'string' && v.startsWith('0x')) {
		try {
			return normalizeSuiAddress(v)
		} catch {
			return v
		}
	}
	return null
}

function rawToHuman(raw: string, d: number): number {
	if (!/^\d+$/.test(raw) || d < 0) return 0
	try {
		return new Decimal(raw).div(new Decimal(10).pow(d)).toNumber()
	} catch {
		return 0
	}
}

/**
 * Sui Move I32 is serialised as `{ "bits": <u32> }` in parsedJson.
 * Converts to a signed JS number: bits ≥ 2^31 → bits − 2^32.
 * Also handles plain numbers (some SDK versions inline the value directly).
 */
function readI32Bits(v: unknown): number | null {
	if (v == null) return null
	if (typeof v === 'number' && Number.isFinite(v)) {
		const n = Math.trunc(v)
		return n > 0x7fffffff ? n - 0x100000000 : n
	}
	if (typeof v === 'object') {
		const b = (v as Record<string, unknown>)['bits']
		if (typeof b === 'number' && Number.isFinite(b)) {
			const n = Math.trunc(b)
			return n > 0x7fffffff ? n - 0x100000000 : n
		}
	}
	return null
}

function readU64String(v: unknown): string {
	if (typeof v === 'string' && /^\d+$/.test(v)) return v
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return String(Math.floor(v))
	return '0'
}

function readPositionId(pj: Parsed): string | null {
	const pid = pj['position_id']
	if (typeof pid === 'string' && pid.startsWith('0x')) {
		try {
			return normalizeSuiAddress(pid)
		} catch {
			return pid
		}
	}
	return null
}

function structNameFromType(type: string): string {
	const p = type.split('::')
	return p[p.length - 1] ?? ''
}

/** TypeName / UTF-8 string / plain struct tag у parsedJson Bluefin/Move. */
export function readMoveCoinTypeFromJson(v: unknown): string | null {
	if (typeof v === 'string') {
		const t = v.trim()
		if (!t.includes('::')) return null
		try {
			return normalizeStructTag(t)
		} catch {
			return t
		}
	}
	if (v && typeof v === 'object') {
		const name = (v as { name?: string }).name
		if (typeof name === 'string' && name.includes('::')) {
			try {
				const raw = name.startsWith('0x') ? name : `0x${name}`
				return normalizeStructTag(raw)
			} catch {
				return name.startsWith('0x') ? name : `0x${name}`
			}
		}
		if ('fields' in (v as object)) {
			const bytes = (v as { fields?: { bytes?: number[] } }).fields?.bytes
			if (Array.isArray(bytes) && bytes.length) {
				try {
					const s = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes)).trim()
					if (s.includes('::')) {
						try {
							return normalizeStructTag(s)
						} catch {
							return s
						}
					}
				} catch {
					/* ignore */
				}
			}
		}
	}
	return null
}

function rewardSymbolTail(coinType: string): string {
	const parts = coinType.split('::')
	return (parts[parts.length - 1] ?? coinType).trim()
}

/**
 * Map однієї Sui event → PositionEvent (Bluefin). Потрібні decimals пари для coin_a / coin_b.
 */
export function parseEventFromSui(
	e: {
		type: string
		parsedJson?: unknown
		id?: { eventSeq: string; txDigest: string }
	},
	txDigest: string,
	timestampSec: number,
	positionIdNorm: string,
	tokenADecimals: number,
	tokenBDecimals: number,
): PositionEvent | null {
	if (!e.parsedJson || typeof e.parsedJson !== 'object') return null
	if (!isBluefinLpLifecycleMoveEventType(e.type)) return null
	const pj = e.parsedJson as Parsed
	const struct = structNameFromType(e.type)
	const et = STRUCT_TO_TYPE[struct]
	if (!et) return null
	const pos = readPositionId(pj)
	if (!pos) return null
	let posNorm: string
	try {
		posNorm = normalizeSuiAddress(pos)
	} catch {
		return null
	}
	if (posNorm !== positionIdNorm) return null

	const seq = e.id?.eventSeq != null ? String(e.id.eventSeq) : '0'
	const id = `${txDigest}::${seq}`

	let tokenAAmount = 0
	let tokenBAmount = 0
	let feeAmountA = 0
	let feeAmountB = 0
	let liquidityDelta = 0
	let rewardAmount = 0
	let rewardToken = ''
	let rewardCoinType: string | undefined
	let tickLower: number | undefined
	let tickUpper: number | undefined

	if (et === 'open_position') {
		const tl = readI32Bits(pj['tick_lower_index'])
		const tu = readI32Bits(pj['tick_upper_index'])
		if (tl != null) tickLower = tl
		if (tu != null) tickUpper = tu
	} else if (et === 'add_liquidity' || et === 'remove_liquidity') {
		const ca = readU64String(pj['coin_a_amount'])
		const cb = readU64String(pj['coin_b_amount'])
		const liq = readU64String(pj['liquidity'])
		tokenAAmount = rawToHuman(ca, tokenADecimals)
		tokenBAmount = rawToHuman(cb, tokenBDecimals)
		liquidityDelta = liq.length < 20 ? parseFloat(liq) : 0
	} else if (et === 'collect_fee') {
		feeAmountA = rawToHuman(readU64String(pj['coin_a_amount']), tokenADecimals)
		feeAmountB = rawToHuman(readU64String(pj['coin_b_amount']), tokenBDecimals)
	} else if (et === 'collect_reward') {
		const ra = readU64String(pj['reward_amount'])
		const rd =
			typeof pj['reward_decimals'] === 'number' && (pj as { reward_decimals: number }).reward_decimals >= 0
				? (pj as { reward_decimals: number }).reward_decimals
				: 9
		rewardAmount = rawToHuman(ra, rd)
		const rs = pj['reward_symbol']
		if (typeof rs === 'string') {
			rewardToken = rs
		}
		const ct =
			readMoveCoinTypeFromJson(pj['reward_coin_type']) ??
			readMoveCoinTypeFromJson(pj['reward_type']) ??
			readMoveCoinTypeFromJson(pj['coin_type'])
		if (ct) {
			rewardCoinType = ct
			if (!rewardToken) rewardToken = rewardSymbolTail(ct)
		}
	}

	return {
		id,
		txDigest,
		type: et,
		timestamp: Math.floor(Number.isFinite(timestampSec) && timestampSec > 0 ? timestampSec : 0),
		positionId: positionIdNorm,
		protocol: 'bluefin',
		tokenAAmount,
		tokenBAmount,
		liquidityDelta,
		feeAmountA,
		feeAmountB,
		rewardAmount,
		rewardToken,
		rewardCoinType,
		...(tickLower != null ? { tickLower } : {}),
		...(tickUpper != null ? { tickUpper } : {}),
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

export type BluefinScanTarget = { id: string; tokenADecimals: number; tokenBDecimals: number }

export type LpWalletHistoryTarget = BluefinScanTarget & { protocol?: 'bluefin' | 'momentum' }

function lpHistoryCacheKey(wallet: string, targets: LpWalletHistoryTarget[]): string {
	const sig = [...targets]
		.map((t) => {
			let id: string
			try {
				id = normalizeSuiAddress(t.id)
			} catch {
				id = t.id
			}
			const prot = t.protocol ?? 'bluefin'
			return `${prot}:${id}`
		})
		.sort()
		.join('|')
	return `${wallet}|mixv2|${sig}`
}

/** Bluefin lifecycle Move types under both CLMM + spot packages (GraphQL typed query). */
function bluefinTypedEventPaths(): string[] {
	const structs = [
		'PositionOpened',
		'LiquidityProvided',
		'LiquidityRemoved',
		'UserFeeCollected',
		'UserRewardCollected',
		'PositionClosed',
	]
	const pkgs = [PROTOCOL_PACKAGES.BLUEFIN_CLMM, PROTOCOL_PACKAGES.BLUEFIN_SPOT]
	const paths: string[] = []
	for (const pkg of pkgs) {
		for (const s of structs) paths.push(`${pkg}::events::${s}`)
	}
	return paths
}

/** Momentum lifecycle Move types (published_at + original package). */
function momentumTypedEventPaths(): string[] {
	const liq = ['OpenPositionEvent', 'ClosePositionEvent', 'AddLiquidityEvent', 'RemoveLiquidityEvent']
	const col = ['FeeCollectedEvent', 'CollectPoolRewardEvent']
	const pkgs = [MOMENTUM_PUBLISHED_AT, PROTOCOL_PACKAGES.MOMENTUM_CLMM]
	const paths: string[] = []
	for (const pkg of pkgs) {
		for (const s of liq) paths.push(`${pkg}::liquidity::${s}`)
		for (const s of col) paths.push(`${pkg}::collect::${s}`)
	}
	return paths
}

/**
 * GraphQL `SenderAndMoveEventType` only (no gRPC ListTransactions / FromAddress).
 * Deep typed retry when deposits are still missing after the first pass.
 */
export async function scanLpWalletPositionHistory(
	walletAddress: string,
	targets: LpWalletHistoryTarget[],
): Promise<{ eventsByPositionId: Map<string, PositionEvent[]>; historyPartial: boolean }> {
	const decByPos = new Map<string, { a: number; b: number }>()
	const wantBf = new Set<string>()
	const wantMt = new Set<string>()
	for (const t of targets) {
		let n: string
		try {
			n = normalizeSuiAddress(t.id)
		} catch {
			continue
		}
		decByPos.set(n, { a: t.tokenADecimals, b: t.tokenBDecimals })
		const prot = t.protocol ?? 'bluefin'
		if (prot === 'momentum') wantMt.add(n)
		else wantBf.add(n)
	}
	if (wantBf.size === 0 && wantMt.size === 0) {
		return { eventsByPositionId: new Map(), historyPartial: false }
	}

	const cacheKey = lpHistoryCacheKey(walletAddress, targets)
	const hit = scanCache.get(cacheKey)
	if (hit && Date.now() - hit.at < CACHE_MS) {
		return {
			eventsByPositionId: new Map(hit.data.eventsByPositionId),
			historyPartial: hit.data.historyPartial,
		}
	}

	const byPos = new Map<string, PositionEvent[]>()
	for (const id of [...wantBf, ...wantMt]) {
		if (!byPos.has(id)) byPos.set(id, [])
	}

	let historyPartial = false

	const ingestRaw = (
		ev: { type: string; parsedJson?: unknown; id?: { eventSeq: string; txDigest: string }; timestampMs?: string | number | null },
		txDigest: string,
		tsSec: number,
	) => {
		const typeStr = ev.type
		const pjRaw = ev.parsedJson
		if (!pjRaw || typeof pjRaw !== 'object') return
		const pj = pjRaw as Parsed
		let posNorm: string
		let kind: 'bf' | 'mt'
		if (isBluefinLpLifecycleMoveEventType(typeStr)) {
			const pos = readPositionId(pj)
			if (!pos) return
			try {
				posNorm = normalizeSuiAddress(pos)
			} catch {
				return
			}
			if (!wantBf.has(posNorm)) return
			kind = 'bf'
		} else if (isMomentumLpLifecycleMoveEventType(typeStr)) {
			const pos = readMomentumPositionId(pj)
			if (!pos) return
			try {
				posNorm = normalizeSuiAddress(pos)
			} catch {
				return
			}
			if (!wantMt.has(posNorm)) return
			kind = 'mt'
		} else {
			return
		}
		const dec = decByPos.get(posNorm)
		if (!dec) return
		const pe =
			kind === 'bf'
				? parseEventFromSui(ev as never, txDigest, tsSec, posNorm, dec.a, dec.b)
				: parseMomentumEventFromSui(ev as never, txDigest, tsSec, posNorm, dec.a, dec.b)
		if (pe) byPos.get(posNorm)!.push(pe)
	}

	const typedPaths = [
		...(wantBf.size ? bluefinTypedEventPaths() : []),
		...(wantMt.size ? momentumTypedEventPaths() : []),
	]

	// ── GraphQL typed path (shared wallet typed caches) ────────────────────
	try {
		const parts: Awaited<ReturnType<typeof querySenderAndMoveEventTypes>>[] = []
		if (wantBf.size) parts.push(await loadBluefinWalletTyped(normalizeSuiAddress(walletAddress), 'full'))
		if (wantMt.size) parts.push(await loadMomentumWalletTyped(normalizeSuiAddress(walletAddress), 'full'))
		for (const typed of parts) {
			if (typed.partial) historyPartial = true
			for (const ev of typed.events) {
				const dig = ev.id?.txDigest ?? ''
				const rawMs = ev.timestampMs != null ? Number(ev.timestampMs) : NaN
				const tsSec = Number.isFinite(rawMs) ? Math.floor(rawMs / 1000) : 0
				ingestRaw(ev, dig, tsSec)
			}
		}
		if (!parts.length && typedPaths.length) {
			const typed = await querySenderAndMoveEventTypes(walletAddress, typedPaths, {
				maxPagesPerType: 40,
				pageSize: 50,
			})
			if (typed.partial) historyPartial = true
			for (const ev of typed.events) {
				const dig = ev.id?.txDigest ?? ''
				const rawMs = ev.timestampMs != null ? Number(ev.timestampMs) : NaN
				const tsSec = Number.isFinite(rawMs) ? Math.floor(rawMs / 1000) : 0
				ingestRaw(ev, dig, tsSec)
			}
		}
	} catch (e) {
		console.warn('[lp-history] GraphQL typed scan failed', e)
		historyPartial = true
	}

	const hasAnyDeposit = [...byPos.values()].some((list) =>
		list.some((e) => e.type === 'add_liquidity' || e.type === 'open_position'),
	)

	// Deeper GraphQL pages when deposits still missing (no gRPC FromAddress).
	if (!hasAnyDeposit && typedPaths.length > 0) {
		try {
			const deep = await querySenderAndMoveEventTypes(walletAddress, typedPaths, {
				maxPagesPerType: 80,
				pageSize: 50,
			})
			if (deep.partial) historyPartial = true
			for (const ev of deep.events) {
				const dig = ev.id?.txDigest ?? ''
				const rawMs = ev.timestampMs != null ? Number(ev.timestampMs) : NaN
				const tsSec = Number.isFinite(rawMs) ? Math.floor(rawMs / 1000) : 0
				ingestRaw(ev, dig, tsSec)
			}
		} catch (e) {
			console.warn('[lp-history] GraphQL deep typed retry failed', e)
			historyPartial = true
		}
	} else if (!hasAnyDeposit) {
		historyPartial = true
	}

	await hydrateMomentumRewardAmounts(byPos)

	for (const [, list] of byPos) {
		list.sort((a, b) => {
			if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
			return a.id.localeCompare(b.id)
		})
	}

	scanCache.set(cacheKey, {
		at: Date.now(),
		data: { eventsByPositionId: new Map(byPos), historyPartial },
	})
	return { eventsByPositionId: byPos, historyPartial }
}

/**
 * Targeted fetch of tick range for a closed position whose PositionOpened event
 * is beyond the TX-scan window.
 *
 * Strategy: `queryTransactionBlocks({ ChangedObject: positionId, order: 'ascending', limit: 1 })`
 * returns the minting TX (first TX that created/changed the position NFT).
 * We then parse its events for a PositionOpened struct to extract tick_lower_index / tick_upper_index.
 *
 * This is a single targeted RPC call — no page scanning.
 */
/** Read a signed tick from parsedJson trying several field-name variants. */
function readTickField(pj: Record<string, unknown>, ...keys: string[]): number | null {
	for (const k of keys) {
		const v = readI32Bits(pj[k])
		if (v != null) return v
	}
	return null
}

type SuiTxBlock = Awaited<ReturnType<typeof suiClient.queryTransactionBlocks>>['data'][number]

/** Scan an array of TXs for a PositionOpened event; returns ticks or null. */
function ticksFromTxList(
	txList: SuiTxBlock[],
	posNorm: string,
): { tickLower: number; tickUpper: number } | null {
	for (const tx of txList) {
		for (const ev of tx.events ?? []) {
			if (!isBluefinLpLifecycleMoveEventType(ev.type)) continue
			if (structNameFromType(ev.type) !== 'PositionOpened') continue
			const pj = ev.parsedJson as Record<string, unknown> | null
			if (!pj) continue
			// Only accept events for this specific position
			const evPid = readPositionId(pj)
			if (evPid && evPid !== posNorm) continue
			const tl = readTickField(pj,
				'tick_lower_index', 'tick_lower', 'lower_tick', 'lower_tick_index', 'lower_index')
			const tu = readTickField(pj,
				'tick_upper_index', 'tick_upper', 'upper_tick', 'upper_tick_index', 'upper_index')
			if (tl != null && tu != null) return { tickLower: tl, tickUpper: tu }
		}
	}
	return null
}

export async function fetchTicksForClosedPosition(
	positionId: string,
	protocol: 'bluefin' | 'momentum',
): Promise<{ tickLower: number; tickUpper: number } | null> {
	if (protocol !== 'bluefin') return null
	let posNorm: string
	try {
		posNorm = normalizeSuiAddress(positionId)
	} catch {
		return null
	}

	const opts = { options: { showEvents: true }, limit: 1, order: 'ascending' } as const

	// Strategy 1: ChangedObject — includes creation TX on most Sui indexers
	try {
		const r = await suiClient.queryTransactionBlocks({ filter: { ChangedObject: posNorm }, ...opts })
		const hit = ticksFromTxList(r.data, posNorm)
		if (hit) return hit
	} catch {
		/* non-fatal */
	}

	// Strategy 2: InputObject — first TX where position NFT was used as input
	try {
		const r = await suiClient.queryTransactionBlocks({ filter: { InputObject: posNorm }, ...opts })
		const hit = ticksFromTxList(r.data, posNorm)
		if (hit) return hit
	} catch {
		/* non-fatal */
	}

	return null
}

/**
 * Targeted scan: ALL events for a specific position NFT by querying transactions
 * that changed or used the object, regardless of wallet activity level or time depth.
 *
 * Unlike sender-based scans (limited to N most recent events), this queries the
 * indexer by the position's on-chain object ID and returns EVERY transaction that
 * ever touched it — from open to close — even if the wallet made thousands of
 * unrelated txs in between.
 *
 * Used as a fallback for closed positions where the bulk sender scan missed early
 * events (add_liquidity / open_position beyond the scan window).
 */
export async function scanPositionAllEventsByObjectId(
	positionId: string,
	protocol: 'bluefin' | 'momentum',
	tokenADecimals: number,
	tokenBDecimals: number,
): Promise<PositionEvent[]> {
	let posNorm: string
	try {
		posNorm = normalizeSuiAddress(positionId)
	} catch (e) {
		console.warn('[objectScan] normalizeSuiAddress failed for', positionId, e)
		return []
	}

	const tag = `[objectScan/${protocol}] ${posNorm.slice(0, 10)}…`

	type TxBlock = Awaited<ReturnType<typeof suiClient.queryTransactionBlocks>>['data'][number]
	const allTxs = new Map<string, TxBlock>()

	// Pass 1: InputObject — TXs that used the position NFT as input (liquidity ops, collect fees).
	// Paginated up to 10 pages × 50 = 500 TXs (more than enough for any single LP position).
	try {
		let cursor: string | null | undefined
		for (let page = 0; page < 10; page++) {
			const r = await suiClient.queryTransactionBlocks({
				filter: { InputObject: posNorm },
				options: { showEvents: true },
				limit: 50,
				cursor: cursor ?? null,
			})
			for (const tx of r.data) allTxs.set(tx.digest, tx)
			if (!r.hasNextPage) break
			cursor = r.nextCursor ?? null
			if (cursor == null) break
		}
		console.log(`${tag} Pass1(InputObject) found ${allTxs.size} tx(s)`)
	} catch (e) {
		console.warn(`${tag} Pass1(InputObject) failed:`, e instanceof Error ? e.message : e)
	}

	// Pass 2: ChangedObject ascending — catches the minting TX (position creation) which
	// may not appear in InputObject queries because the NFT didn't yet exist as an input.
	// Paginated to cover positions with many historical interactions (creation + all add/remove).
	try {
		let cursor: string | null | undefined
		const beforeSize = allTxs.size
		for (let page = 0; page < 10; page++) {
			const r = await suiClient.queryTransactionBlocks({
				filter: { ChangedObject: posNorm },
				options: { showEvents: true },
				limit: 50,
				order: 'ascending',
				cursor: cursor ?? null,
			})
			for (const tx of r.data) allTxs.set(tx.digest, tx)
			if (!r.hasNextPage) break
			cursor = r.nextCursor ?? null
			if (cursor == null) break
		}
		console.log(`${tag} Pass2(ChangedObject) added ${allTxs.size - beforeSize} new tx(s), total ${allTxs.size}`)
	} catch (e) {
		console.warn(`${tag} Pass2(ChangedObject) failed:`, e instanceof Error ? e.message : e)
	}

	if (allTxs.size === 0) {
		console.warn(`${tag} 0 TXs found — position may be unreachable via object queries`)
		return []
	}

	const events: PositionEvent[] = []
	const seen = new Set<string>()
	const isBf = protocol === 'bluefin'
	let parsedCount = 0
	let skippedCount = 0

	for (const tx of allTxs.values()) {
		const rawTs = tx.timestampMs
		const tsSec = rawTs ? parseInt(String(rawTs), 10) / 1000 : 0
		for (const ev of tx.events ?? []) {
			const pe = isBf
				? parseEventFromSui(ev, tx.digest, tsSec, posNorm, tokenADecimals, tokenBDecimals)
				: parseMomentumEventFromSui(ev, tx.digest, tsSec, posNorm, tokenADecimals, tokenBDecimals)
			if (pe && !seen.has(pe.id)) {
				seen.add(pe.id)
				events.push(pe)
				parsedCount++
			} else if (!pe) {
				skippedCount++
			}
		}
	}

	console.log(`${tag} parsed ${parsedCount} event(s), skipped ${skippedCount} non-matching`)
	if (events.length === 0 && allTxs.size > 0) {
		// Log first event type from each TX to help diagnose parsing failures
		let sampleCount = 0
		for (const tx of allTxs.values()) {
			for (const ev of tx.events ?? []) {
				if (sampleCount >= 3) break
				console.warn(`${tag} unmatched event type: ${ev.type}`, ev.parsedJson)
				sampleCount++
			}
			if (sampleCount >= 3) break
		}
	}

	events.sort((a, b) => a.timestamp - b.timestamp)
	return events
}

/**
 * Legacy: лише Bluefin-події.
 */
export async function scanBluefinPositionEventsForWallet(
	walletAddress: string,
	targets: BluefinScanTarget[],
): Promise<{ eventsByPositionId: Map<string, PositionEvent[]>; historyPartial: boolean }> {
	return scanLpWalletPositionHistory(
		walletAddress,
		targets.map((t) => ({ ...t, protocol: 'bluefin' as const })),
	)
}

/**
 * Сканує on-chain tx відправника для Bluefin або Momentum.
 */
export async function getPositionEvents(
	walletAddress: string,
	positionId: string,
	protocol: 'cetus' | 'momentum' | 'bluefin' | 'turbos' | 'flowx' | 'aftermath',
	options?: GetPositionEventOpts,
): Promise<{ events: PositionEvent[]; historyPartial: boolean }> {
	if ((protocol !== 'bluefin' && protocol !== 'momentum') || !options) {
		return { events: [], historyPartial: false }
	}
	let posNorm: string
	try {
		posNorm = normalizeSuiAddress(positionId)
	} catch {
		return { events: [], historyPartial: false }
	}
	const { eventsByPositionId, historyPartial } = await scanLpWalletPositionHistory(walletAddress, [
		{
			id: positionId,
			tokenADecimals: options.tokenADecimals,
			tokenBDecimals: options.tokenBDecimals,
			protocol,
		},
	])
	return {
		events: eventsByPositionId.get(posNorm) ?? [],
		historyPartial,
	}
}

/**
 * Скидає in-memory кеші подій (Bluefin + Momentum) для конкретного гаманця.
 * Викликається адаптерами при ручному Refresh.
 * IDB-кеш залишається — при наступному cold start виконується delta-скан.
 */
export function invalidateBluefinMomentumScanCache(walletAddress: string): void {
	for (const cache of [scanCache, scanBluefinAllCache, scanMomentumAllCache]) {
		for (const key of cache.keys()) {
			if (key.startsWith(walletAddress) || key.includes(`|${walletAddress}`)) {
				cache.delete(key)
			}
		}
	}
	let norm = walletAddress.trim()
	try {
		norm = normalizeSuiAddress(norm)
	} catch {
		/* keep */
	}
	for (const cache of [_bluefinWalletTypedCache, _momentumWalletTypedCache, scanBluefinInflight]) {
		for (const key of [...cache.keys()]) {
			if (key.startsWith(norm) || key.includes(walletAddress)) cache.delete(key)
		}
	}
	try {
		invalidateWalletSenderEventsCache(norm)
	} catch {
		invalidateWalletSenderEventsCache(walletAddress.trim())
	}
}
