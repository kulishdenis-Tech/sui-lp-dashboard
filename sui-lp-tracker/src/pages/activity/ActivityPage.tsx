import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageShell } from '@/components/ui/PageShell'
import { AppCard } from '@/components/ui/AppCard'
import { Button } from '@/components/ui/Button'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'
import { useWalletLabel } from '@/config/walletNicknameStore'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import { isJunkToken } from '@/config/junkTokens'
import { HARDCODED_VERIFIED } from '@/config/hardcodedVerifiedCoins'
import { SUISCAN_TX } from '@/utils/constants'
import { shortAddress } from '@/utils/formatting'
import { normalizeCoinTypeForMatch } from '@/utils/suiCoinType'
import { getPythBenchmarkQuote } from '@/services/pythBenchmark'
import { fetchActivityDigest, fetchActivityPage, fetchNextActivitySlice } from '@/services/activity/activityGraphql'
import {
	ACTIVITY_LABEL,
	ACTIVITY_PARSER_VERSION,
	collectFeesExplicitlyZero,
	interpretActivity,
	upsertActivity,
	walletSuiChangeIsNetworkFee,
	type ActivityKind,
	type ActivityTransaction,
} from '@/services/activity/activityModel'
import {
	activityMetaId,
	clearActivityCache,
	loadActivityCache,
	loadActivityRaw,
	saveActivityBatch,
	type ActivitySyncMeta,
} from '@/services/activity/activityIdb'
import {
	activityExportJson,
	activityExportRows,
	activityRowsToCsv,
	displayAmount,
	historicalPriceNote,
	humanRaw,
	type ActivityExportCoverage,
	type HistoricalPriceNote,
} from '@/services/activity/activityExport'
import { advanceBackfill, canBackfill, commitPageProgress, createSingleFlight, isCurrentGeneration } from '@/services/activity/activitySync'

const PAGE_SIZE = 20
const BACKFILL_CAP = 30
const AUTO_EXPORT_DEBOUNCE_MS = 400

function coverageFromRows(
	mergedRows: ActivityTransaction[],
	syncMeta: ActivitySyncMeta | null,
	hasOlder: boolean,
): ActivityExportCoverage {
	const oldestMs = mergedRows.reduce<number | null>(
		(m, t) => (t.timestampMs == null ? m : m == null ? t.timestampMs : Math.min(m, t.timestampMs)),
		null,
	)
	const newestMs = mergedRows.reduce<number | null>(
		(m, t) => (t.timestampMs == null ? m : m == null ? t.timestampMs : Math.max(m, t.timestampMs)),
		null,
	)
	return {
		loadedOnly: true,
		oldestMs,
		newestMs,
		exhausted: syncMeta?.exhausted ?? !hasOlder,
		count: mergedRows.length,
		parserVersion: ACTIVITY_PARSER_VERSION,
		gaps: hasOlder ? 'older pages not loaded' : '',
	}
}

function coinLabel(coinType: string): { symbol: string; decimals: number | null; name: string } {
	const norm = normalizeCoinTypeForMatch(coinType)
	const hit = HARDCODED_VERIFIED.find((c) => normalizeCoinTypeForMatch(c.type) === norm)
	const tail = coinType.split('::').pop() ?? 'Asset'
	return { symbol: hit?.symbol ?? tail, decimals: hit ? hit.decimals : null, name: hit?.name ?? '' }
}

function txCoins(tx: ActivityTransaction): string[] {
	const set = new Set<string>()
	for (const c of tx.walletChanges) set.add(c.coinType)
	for (const a of tx.activities) for (const amt of a.actionAmounts) if (amt.coinType) set.add(amt.coinType)
	return [...set]
}

function isSuspicious(tx: ActivityTransaction): boolean {
	const coins = txCoins(tx)
	if (coins.length === 0) return false
	return coins.every((c) => {
		const meta = coinLabel(c)
		return isJunkToken(c, meta.symbol, meta.name)
	})
}

function download(filename: string, body: string, type: string) {
	const blob = new Blob([body], { type })
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = filename
	a.click()
	URL.revokeObjectURL(url)
}

function NamedAddress({ address }: { address: string }) {
	const label = useWalletLabel(address, 8, 6)
	return <span title={label.title}>{label.label}</span>
}

export function ActivityPage() {
	const { address, isManualView } = useWalletAuth()
	const walletLabel = useWalletLabel(address, 8, 6)
	const [rows, setRows] = useState<ActivityTransaction[]>([])
	const [meta, setMeta] = useState<ActivitySyncMeta | null>(null)
	const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>(address ? 'loading' : 'idle')
	const [error, setError] = useState<string | null>(null)
	const [backfill, setBackfill] = useState<'idle' | 'running' | 'paused'>('idle')
	const [selected, setSelected] = useState<string | null>(null)
	const [query, setQuery] = useState('')
	const [fromDate, setFromDate] = useState('')
	const [toDate, setToDate] = useState('')
	const [category, setCategory] = useState<ActivityKind | 'all'>('all')
	const [protocol, setProtocol] = useState('all')
	const [status, setStatus] = useState<'all' | 'success' | 'failure' | 'unknown'>('all')
	const [hideSuspicious, setHideSuspicious] = useState(true)
	const [showHidden, setShowHidden] = useState(false)
	const [prices, setPrices] = useState<Record<string, HistoricalPriceNote>>({})
	const [cacheWarning, setCacheWarning] = useState<string | null>(null)
	const gen = useRef(0)
	const pauseRef = useRef(false)
	const flight = useRef(createSingleFlight())
	const seenRef = useRef<string[]>([])
	const rowsRef = useRef<ActivityTransaction[]>([])
	const metaRef = useRef<ActivitySyncMeta | null>(null)
	const exportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const scheduleActivityExport = useCallback((mergedRows: ActivityTransaction[], cov: ActivityExportCoverage) => {
		if (exportTimerRef.current != null) clearTimeout(exportTimerRef.current)
		exportTimerRef.current = setTimeout(() => {
			exportTimerRef.current = null
			void fetch('/api/activity/export', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: activityExportJson(mergedRows, cov),
			}).then((res) => {
				if (!res.ok) console.warn('[activity-export] HTTP', res.status)
			}).catch((err) => {
				console.warn('[activity-export]', err)
			})
		}, AUTO_EXPORT_DEBOUNCE_MS)
	}, [])

	useEffect(() => {
		return () => {
			if (exportTimerRef.current != null) clearTimeout(exportTimerRef.current)
		}
	}, [])
	const [cursor, setCursor] = useState<{ before: string | null; hasOlder: boolean }>({
		before: null,
		hasOlder: false,
	})
	const addressKey = address ?? ''
	const [boundAddress, setBoundAddress] = useState(addressKey)
	if (boundAddress !== addressKey) {
		setBoundAddress(addressKey)
		setRows([])
		setMeta(null)
		setError(null)
		setSelected(null)
		setPrices({})
		setCursor({ before: null, hasOlder: false })
		setPhase(addressKey ? 'loading' : 'idle')
		setBackfill('idle')
		setCacheWarning(null)
	}

	const applyPage = useCallback(
		async (wallet: string, before: string | null, generation: number) => {
			const page = await fetchActivityPage(wallet, { before, pageSize: PAGE_SIZE })
			if (!isCurrentGeneration(generation, gen.current)) return null
			const interpreted = page.transactions.map((raw) => interpretActivity(raw, wallet))
			const merged = upsertActivity(rowsRef.current, interpreted)
			const previous = metaRef.current
			const committed = commitPageProgress(
				{
					olderCursor: previous?.olderCursor ?? null,
					hasOlder: previous?.hasOlder ?? false,
					newestMs: previous?.newestMs ?? null,
					oldestMs: previous?.oldestMs ?? null,
					seenCursors: seenRef.current,
				},
				{
					mode: before == null ? 'refresh' : 'older',
					requestedCursor: before,
					olderCursor: page.olderCursor,
					hasOlder: page.hasOlder,
					count: page.transactions.length,
					timestamps: page.transactions
						.map((tx) => tx.timestampMs)
						.filter((ts): ts is number => ts != null),
				},
			)
			const nextMeta: ActivitySyncMeta = {
				id: activityMetaId(wallet),
				network: 'mainnet',
				address: wallet.toLowerCase(),
				provider: 'mysten-graphql',
				parserVersion: ACTIVITY_PARSER_VERSION,
				olderCursor: committed.progress.olderCursor,
				hasOlder: committed.progress.hasOlder,
				exhausted: !committed.progress.hasOlder,
				newestMs: committed.progress.newestMs,
				oldestMs: committed.progress.oldestMs,
				updatedAtMs: Date.now(),
			}
			if (!isCurrentGeneration(generation, gen.current)) return null
			setRows(merged)
			rowsRef.current = merged
			try {
				await saveActivityBatch(wallet, merged, page.transactions, nextMeta)
				if (!isCurrentGeneration(generation, gen.current)) return null
				setMeta(nextMeta)
				metaRef.current = nextMeta
				setCursor({ before: nextMeta.olderCursor, hasOlder: nextMeta.hasOlder })
				seenRef.current = committed.progress.seenCursors
				setCacheWarning(null)
				scheduleActivityExport(merged, coverageFromRows(merged, nextMeta, nextMeta.hasOlder))
			} catch (err) {
				if (!isCurrentGeneration(generation, gen.current)) return null
				setCacheWarning(err instanceof Error ? err.message : String(err))
				return { ...page, olderCursor: previous?.olderCursor ?? null, hasOlder: previous?.hasOlder ?? false, advanced: false }
			}
			return { ...page, olderCursor: nextMeta.olderCursor, hasOlder: nextMeta.hasOlder, advanced: committed.advanced }
		},
		[scheduleActivityExport],
	)

	useEffect(() => {
		seenRef.current = []
		rowsRef.current = []
		metaRef.current = null
		if (!address) {
			gen.current += 1
			return
		}
		const generation = ++gen.current
		pauseRef.current = true
		void flight.current(async () => {
			try {
				const cached = await loadActivityCache(address)
				if (!isCurrentGeneration(generation, gen.current)) return
				const loaded = cached.rows.length ? upsertActivity([], cached.rows) : []
				setRows(loaded)
				rowsRef.current = loaded
				setMeta(cached.meta)
				metaRef.current = cached.meta
				if (cached.meta) {
					setCursor({ before: cached.meta.olderCursor, hasOlder: cached.meta.hasOlder })
				}
				await applyPage(address, null, generation)
				if (!isCurrentGeneration(generation, gen.current)) return
				setPhase('ready')
			} catch (err) {
				if (!isCurrentGeneration(generation, gen.current)) return
				setPhase('error')
				setError(err instanceof Error ? err.message : String(err))
			}
		}, 'replace')
		return () => {
			gen.current += 1
		}
	}, [address, applyPage])

	const loadMore = useCallback(async () => {
		if (!address || !cursor.hasOlder || !cursor.before) return
		const generation = gen.current
		const result = await flight.current(async () => {
			setPhase('loading')
			try {
				await applyPage(address, cursor.before, generation)
				if (isCurrentGeneration(generation, gen.current)) setPhase('ready')
			} catch (err) {
				if (!isCurrentGeneration(generation, gen.current)) return
				setPhase('error')
				setError(err instanceof Error ? err.message : String(err))
			}
		})
		if (result === 'busy') setCacheWarning('Sync already running.')
	}, [address, cursor.before, cursor.hasOlder, applyPage])

	const refresh = useCallback(async () => {
		if (!address) return
		const generation = gen.current
		const result = await flight.current(async () => {
			setError(null)
			setPhase('loading')
			try {
				await applyPage(address, null, generation)
				if (isCurrentGeneration(generation, gen.current)) setPhase('ready')
			} catch (err) {
				if (!isCurrentGeneration(generation, gen.current)) return
				setPhase('error')
				setError(err instanceof Error ? err.message : String(err))
			}
		})
		if (result === 'busy') setCacheWarning('Sync already running.')
	}, [address, applyPage])

	const runBackfill = useCallback(async () => {
		if (!address) return
		const result = await flight.current(async () => {
			pauseRef.current = false
			setBackfill('running')
			const generation = gen.current
			let state = {
				before: cursor.before,
				hasOlder: cursor.hasOlder,
				pages: 0,
				paused: false,
			}
			let failed = false
			try {
				while (canBackfill(state, BACKFILL_CAP)) {
					if (pauseRef.current) {
						state = { ...state, paused: true }
						break
					}
					const page = await applyPage(address, state.before, generation)
					if (!isCurrentGeneration(generation, gen.current)) return
					state = advanceBackfill(
						state,
						page ? { olderCursor: page.olderCursor, hasOlder: page.hasOlder, advanced: page.advanced } : null,
					)
					if (state.paused || pauseRef.current) break
					await new Promise((r) => setTimeout(r, 400))
				}
			} catch (err) {
				failed = true
				if (isCurrentGeneration(generation, gen.current)) {
					setError(err instanceof Error ? err.message : String(err))
					setPhase('error')
				}
			} finally {
				if (isCurrentGeneration(generation, gen.current)) {
					const capped = state.pages >= BACKFILL_CAP && state.hasOlder
					setBackfill(pauseRef.current || state.paused || capped ? 'paused' : 'idle')
					if (!failed) setPhase('ready')
				}
			}
		})
		if (result === 'busy') setCacheWarning('Sync already running.')
	}, [address, applyPage, cursor.before, cursor.hasOlder])

	const protocols = useMemo(() => {
		const set = new Set<string>()
		for (const tx of rows) for (const a of tx.activities) if (a.protocol) set.add(a.protocol)
		return [...set].sort()
	}, [rows])

	const hiddenCount = useMemo(() => rows.filter(isSuspicious).length, [rows])

	const visible = useMemo(() => {
		const q = query.trim().toLowerCase()
		const from = fromDate ? Date.parse(`${fromDate}T00:00:00`) : null
		const to = toDate ? Date.parse(`${toDate}T23:59:59`) : null
		return rows.filter((tx) => {
			if (hideSuspicious && !showHidden && isSuspicious(tx)) return false
			if (status !== 'all' && tx.status !== status) return false
			if (category !== 'all' && !tx.activities.some((a) => a.kind === category)) return false
			if (protocol !== 'all' && !tx.activities.some((a) => a.protocol === protocol)) return false
			if (from != null && (tx.timestampMs == null || tx.timestampMs < from)) return false
			if (to != null && (tx.timestampMs == null || tx.timestampMs > to)) return false
			if (!q) return true
			const blob = [
				tx.digest,
				tx.sender ?? '',
				tx.feePayer ?? '',
				...txCoins(tx),
				...tx.activities.flatMap((a) => a.objectIds),
			]
				.join(' ')
				.toLowerCase()
			return blob.includes(q)
		})
	}, [rows, query, fromDate, toDate, category, protocol, status, hideSuspicious, showHidden])

	const oldest = rows.reduce<number | null>((m, t) => (t.timestampMs == null ? m : m == null ? t.timestampMs : Math.min(m, t.timestampMs)), null)
	const newest = rows.reduce<number | null>((m, t) => (t.timestampMs == null ? m : m == null ? t.timestampMs : Math.max(m, t.timestampMs)), null)
	const selectedTx = rows.find((t) => t.digest === selected) ?? null

	useEffect(() => {
		if (!selectedTx) return
		const coins = txCoins(selectedTx).slice(0, 4)
		const ts = selectedTx.timestampMs
		if (ts == null) return
		let cancelled = false
		for (const coin of coins) {
			const meta = coinLabel(coin)
			if (!HARDCODED_VERIFIED.some((c) => normalizeCoinTypeForMatch(c.type) === normalizeCoinTypeForMatch(coin))) continue
			const key = `${coin}|${Math.floor(ts / 1000)}`
			void getPythBenchmarkQuote(meta.symbol, Math.floor(ts / 1000)).then((quote) => {
				if (cancelled || !quote) return
				setPrices((prev) => ({
					...prev,
					[key]: historicalPriceNote(quote.usd, new Date(quote.publishTimeSec * 1000).toISOString()),
				}))
			})
		}
		return () => {
			cancelled = true
		}
	}, [selectedTx])

	const [hydrating, setHydrating] = useState(false)

	const hydrateSelected = useCallback(async () => {
		if (!address || !selectedTx) return
		const digest = selectedTx.digest
		const generation = gen.current
		const result = await flight.current(async () => {
			setHydrating(true)
			try {
				const cached = await loadActivityRaw(digest)
				const base = cached ?? (await fetchActivityDigest(digest))
				if (!base || !isCurrentGeneration(generation, gen.current)) return
				const fuller = await fetchNextActivitySlice(base)
				if (!isCurrentGeneration(generation, gen.current)) return
				const interpreted = interpretActivity(fuller, address)
				const merged = upsertActivity(rowsRef.current, [interpreted])
				if (!isCurrentGeneration(generation, gen.current)) return
				setRows(merged)
				rowsRef.current = merged
				if (metaRef.current) await saveActivityBatch(address, [interpreted], [fuller], metaRef.current)
			} finally {
				if (isCurrentGeneration(generation, gen.current)) setHydrating(false)
			}
		})
		if (result === 'busy') setCacheWarning('Sync already running.')
	}, [address, selectedTx])

	const coverage = coverageFromRows(rows, meta, cursor.hasOlder)

	return (
		<PageShell as="main" className="py-8">
			<div className="mb-4 flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2 className="text-section font-semibold text-slate-100">Activity</h2>
					<p className="mt-1 max-w-3xl text-sm text-slate-400">
						{isManualView ? 'Visiting address' : 'Connected wallet'} · read-only public history. Filters apply to loaded
						transactions only.
					</p>
				</div>
				<div className="text-xs text-slate-500" title={walletLabel.title}>
					{address ? walletLabel.label : 'No address'}
				</div>
			</div>

			<AppCard className="mb-4 space-y-3">
				<div className="flex flex-wrap gap-2">
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search loaded transactions"
						className="h-control min-w-[16rem] flex-1 rounded-control border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"
					/>
					<input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-control rounded-control border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200" />
					<input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-control rounded-control border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200" />
					<select value={category} onChange={(e) => setCategory(e.target.value as ActivityKind | 'all')} className="h-control rounded-control border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200">
						<option value="all">All actions</option>
						{Object.entries(ACTIVITY_LABEL).map(([id, label]) => (
							<option key={id} value={id}>{label}</option>
						))}
					</select>
					<select value={protocol} onChange={(e) => setProtocol(e.target.value)} className="h-control rounded-control border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200">
						<option value="all">All protocols</option>
						{protocols.map((p) => (
							<option key={p} value={p}>{p}</option>
						))}
					</select>
					<select value={status} onChange={(e) => setStatus(e.target.value as 'all' | 'success' | 'failure' | 'unknown')} className="h-control rounded-control border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200">
						<option value="all">All statuses</option>
						<option value="success">Success</option>
						<option value="failure">Failed</option>
						<option value="unknown">Unknown</option>
					</select>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<label className="flex items-center gap-2 text-xs text-slate-400">
						<input type="checkbox" checked={hideSuspicious} onChange={(e) => setHideSuspicious(e.target.checked)} />
						Hide suspicious assets
					</label>
					<Button size="compact" variant="secondary" onClick={() => void refresh()} disabled={!address || phase === 'loading'}>Refresh</Button>
					<Button size="compact" variant="secondary" onClick={() => void loadMore()} disabled={!address || !cursor.hasOlder}>Load more</Button>
					<Button size="compact" variant="secondary" onClick={() => void runBackfill()} disabled={!address || backfill === 'running' || !cursor.hasOlder}>
						{backfill === 'paused' ? 'Continue' : 'Backfill'}
					</Button>
					<Button size="compact" variant="ghost" onClick={() => { pauseRef.current = true; setBackfill('paused') }} disabled={backfill !== 'running'}>Pause</Button>
					<Button
						size="compact"
						variant="secondary"
						onClick={() => {
							if (!address) return
							const wallet = address
							const snapshot = rows
							const cov = coverage
							const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
							const priceSnapshot = prices
							window.setTimeout(() => {
								const csv = activityRowsToCsv(activityExportRows(snapshot, wallet, cov, zone, priceSnapshot))
								download(`activity-${wallet.slice(0, 8)}.csv`, csv, 'text/csv')
							}, 0)
						}}
						disabled={rows.length === 0}
					>
						Export CSV
					</Button>
					<Button
						size="compact"
						variant="ghost"
						onClick={() => {
							if (!address) return
							const wallet = address
							const snapshot = rows
							const cov = coverage
							window.setTimeout(() => {
								download(`activity-${wallet.slice(0, 8)}.json`, activityExportJson(snapshot, cov), 'application/json')
							}, 0)
						}}
						disabled={rows.length === 0}
					>
						Export JSON
					</Button>
					<Button
						size="compact"
						variant="danger"
						onClick={() => {
							if (!address) return
							if (!window.confirm('Clear saved activity for this address?')) return
							void clearActivityCache(address).then(() => {
								setRows([])
								rowsRef.current = []
								setMeta(null)
								metaRef.current = null
								setCursor({ before: null, hasOlder: false })
								seenRef.current = []
							})
						}}
						disabled={!address}
					>
						Clear saved activity
					</Button>
				</div>
				<p className="text-xs text-slate-500">
					{!address
						? 'Paste a visiting address or connect a wallet. Viewing history does not ask for a signature.'
						: phase === 'loading' && rows.length === 0
							? 'Loading recent activity…'
							: rows.length === 0 && phase === 'ready'
								? 'No activity in the loaded page.'
								: phase === 'error'
									? 'History request failed. Loaded rows are kept.'
									: `${rows.length} loaded · ${visible.length} shown. ${
											oldest ? new Date(oldest).toLocaleString('en-US') : '—'
										} → ${newest ? new Date(newest).toLocaleString('en-US') : '—'}. ${
											cursor.hasOlder
												? 'Older indexed pages remain. Search checks loaded transactions only.'
												: 'Indexer cursor exhausted for this filter. That does not prove every checkpoint.'
										}`}
					{hiddenCount > 0 ? ` ${hiddenCount} suspicious hidden.` : ''}{' '}
					{hiddenCount > 0 ? (
						<button type="button" className="text-sky-400 underline" onClick={() => setShowHidden((v) => !v)}>
							{showHidden ? 'Hide them' : 'Show hidden'}
						</button>
					) : null}
					{backfill === 'running' ? ' Backfill running.' : backfill === 'paused' ? ' Backfill batch paused. Continue loads the next batch.' : ''}
				</p>
				{cacheWarning ? <p className="text-sm text-amber-300">Loaded in memory, not saved. {cacheWarning}</p> : null}
				{error ? <p className="text-sm text-rose-400">{error}</p> : null}
			</AppCard>

			{!address ? null : phase === 'loading' && rows.length === 0 ? (
				<AppCard><p className="text-sm text-slate-400">Loading recent activity…</p></AppCard>
			) : phase === 'error' && rows.length === 0 ? (
				<AppCard><p className="text-sm text-rose-300">Could not load activity. {error}</p></AppCard>
			) : (
				<>
					<div className="hidden md:block">
						<table className="w-full border-collapse text-left text-sm">
							<thead>
								<tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
									<th className="px-2 py-2">Action</th>
									<th className="px-2 py-2">Time</th>
									<th className="px-2 py-2">Asset changes</th>
									<th className="px-2 py-2">Protocol / counterparty</th>
									<th className="px-2 py-2 text-right">Network fee</th>
									<th className="px-2 py-2">Status</th>
								</tr>
							</thead>
							<tbody>
								{visible.map((tx) => (
									<ActivityRow key={tx.digest} tx={tx} onOpen={() => setSelected(tx.digest)} />
								))}
							</tbody>
						</table>
					</div>
					<div className="space-y-3 md:hidden">
						{visible.map((tx) => (
							<button key={tx.digest} type="button" onClick={() => setSelected(tx.digest)} className="block w-full text-left">
								<AppCard density="compact" className="space-y-2">
									<div className="flex items-center justify-between gap-2">
										<span className="text-slate-100">{ACTIVITY_LABEL[tx.primaryKind]}</span>
										<span className={tx.status === 'failure' ? 'text-rose-400' : tx.status === 'unknown' ? 'text-amber-300' : 'text-emerald-400'}>{tx.status === 'failure' ? 'Failed' : tx.status === 'unknown' ? 'Unknown' : 'Success'}</span>
									</div>
									<AssetChanges tx={tx} />
									<div className="text-xs text-slate-500">{tx.timestampMs ? new Date(tx.timestampMs).toLocaleString('en-US') : '—'}</div>
								</AppCard>
							</button>
						))}
					</div>
				</>
			)}

			{selectedTx ? (
				<ActivityDrawer
					tx={selectedTx}
					prices={prices}
					onClose={() => setSelected(null)}
					hydrating={hydrating}
					onHydrate={() => void hydrateSelected()}
				/>
			) : null}
		</PageShell>
	)
}

function ActivityRow({ tx, onOpen }: { tx: ActivityTransaction; onOpen: () => void }) {
	const extra = Math.max(0, tx.activities.length - 1)
	return (
		<tr
			role="button"
			tabIndex={0}
			aria-label={`${ACTIVITY_LABEL[tx.primaryKind]} ${shortAddress(tx.digest, 8, 6)}`}
			className="cursor-pointer border-b border-slate-800/80 hover:bg-slate-900/40"
			onClick={onOpen}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault()
					onOpen()
				}
			}}
		>
			<td className="px-2 py-3 text-slate-100">
				{ACTIVITY_LABEL[tx.primaryKind]}
				{extra > 0 ? <span className="ml-2 text-xs text-slate-500">+{extra}</span> : null}
				{tx.completeness === 'partial' ? <span className="ml-2 text-xs text-amber-400">*</span> : null}
				<div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
					<span className="font-mono">{shortAddress(tx.digest, 8, 6)}</span>
					<button
						type="button"
						className="text-sky-400"
						onClick={(e) => {
							e.stopPropagation()
							void navigator.clipboard.writeText(tx.digest)
						}}
					>
						Copy
					</button>
					<a href={SUISCAN_TX(tx.digest)} target="_blank" rel="noreferrer" className="text-sky-400" onClick={(e) => e.stopPropagation()}>
						Explorer
					</a>
				</div>
			</td>
			<td className="px-2 py-3 text-slate-300">{tx.timestampMs ? new Date(tx.timestampMs).toLocaleString('en-US') : '—'}</td>
			<td className="px-2 py-3"><AssetChanges tx={tx} /></td>
			<td className="px-2 py-3 text-slate-300">
				{tx.activities.find((a) => a.protocol)?.protocol ??
					(tx.activities[0]?.counterparty ? (
						<NamedAddress address={tx.activities[0].counterparty} />
					) : (
						'—'
					))}
			</td>
			<td className="px-2 py-3 text-right font-mono text-slate-300">
				{tx.feePaidByWallet && tx.netFeeRaw ? humanRaw(tx.netFeeRaw.startsWith('-') ? tx.netFeeRaw : `-${tx.netFeeRaw}`, 9) + ' SUI' : '—'}
			</td>
			<td className={`px-2 py-3 ${tx.status === 'failure' ? 'text-rose-400' : tx.status === 'unknown' ? 'text-amber-300' : 'text-emerald-400'}`}>
				{tx.status === 'failure' ? 'Failed' : tx.status === 'unknown' ? 'Unknown' : 'Success'}
			</td>
		</tr>
	)
}

function AssetChanges({ tx }: { tx: ActivityTransaction }) {
	const lines = tx.walletChanges.filter(
		(c) => !walletSuiChangeIsNetworkFee(tx, c.coinType, c.amountRaw),
	)
	const shown = lines.slice(0, 2)
	if (shown.length === 0) return <span className="text-slate-500">Amount unavailable</span>
	return (
		<div className="space-y-1">
			{shown.map((line) => {
				const meta = coinLabel(line.coinType)
				const shownText = meta.decimals == null ? 'Amount unavailable' : displayAmount(line.amountRaw, meta.decimals)
				const neg = line.amountRaw.startsWith('-')
				return (
					<div key={line.coinType + line.amountRaw} className="flex items-center gap-2">
						<TokenIconOkx coinType={line.coinType} symbol={meta.symbol} />
						<span className={`font-mono text-sm ${meta.decimals == null ? 'text-slate-400' : neg ? 'text-rose-300' : 'text-emerald-300'}`}>
							{shownText}{meta.decimals != null ? ` ${meta.symbol}` : ''}
						</span>
					</div>
				)
			})}
			{lines.length > 2 ? <div className="text-xs text-slate-500">+{lines.length - 2}</div> : null}
		</div>
	)
}

function ActivityDrawer({
	tx,
	prices,
	hydrating,
	onHydrate,
	onClose,
}: {
	tx: ActivityTransaction
	prices: Record<string, HistoricalPriceNote>
	hydrating: boolean
	onHydrate: () => void
	onClose: () => void
}) {
	const [advanced, setAdvanced] = useState(false)
	return (
		<div className="fixed inset-0 z-drawer flex justify-end bg-black/40" onClick={onClose}>
			<div className="h-full w-full max-w-lg overflow-y-auto border-l border-slate-800 bg-slate-950 p-4" onClick={(e) => e.stopPropagation()}>
				<div className="mb-4 flex items-start justify-between gap-3">
					<div>
						<h3 className="text-lg text-slate-100">{ACTIVITY_LABEL[tx.primaryKind]}</h3>
						<p className="font-mono text-xs text-slate-500">{tx.digest}</p>
					</div>
					<Button size="compact" variant="ghost" onClick={onClose}>Close</Button>
				</div>
				<dl className="space-y-2 text-sm text-slate-300">
					<div className="flex justify-between gap-3"><dt>Time</dt><dd>{tx.timestampMs ? new Date(tx.timestampMs).toLocaleString('en-US') : '—'}</dd></div>
					<div className="flex justify-between gap-3"><dt>Checkpoint</dt><dd className="font-mono">{tx.checkpoint ?? '—'}</dd></div>
					<div className="flex justify-between gap-3"><dt>Sender</dt><dd className="font-mono">{tx.sender ? <NamedAddress address={tx.sender} /> : '—'}</dd></div>
					<div className="flex justify-between gap-3"><dt>Fee payer</dt><dd className="font-mono">{tx.feePayer ? <NamedAddress address={tx.feePayer} /> : '—'}</dd></div>
					<div className="flex justify-between gap-3"><dt>Gas budget</dt><dd className="font-mono">{tx.gasBudget ?? '—'}</dd></div>
					<div className="flex justify-between gap-3"><dt>Network fee</dt><dd className="font-mono">{tx.netFeeRaw ?? '—'} MIST</dd></div>
				</dl>
				<h4 className="mb-2 mt-4 text-sm text-slate-200">Actions</h4>
				<ul className="space-y-2">
					{tx.activities.map((a) => (
						<li key={a.id} className="rounded border border-slate-800 p-2 text-sm">
							<div className="text-slate-100">{ACTIVITY_LABEL[a.kind]}{a.protocol ? ` · ${a.protocol}` : ''}</div>
							{collectFeesExplicitlyZero(a) ? <div className="font-mono text-xs text-slate-400">No fees collected</div> : a.actionAmounts.length === 0 ? <div className="font-mono text-xs text-slate-400">Amount unavailable</div> : null}
							{collectFeesExplicitlyZero(a) ? null : a.actionAmounts.map((amt, i) => {
								const meta = amt.coinType ? coinLabel(amt.coinType) : null
								const shown =
									amt.amountRaw == null
										? 'Amount unavailable'
										: meta && meta.decimals != null
											? `${displayAmount(amt.amountRaw, meta.decimals)} ${meta.symbol}`
											: `raw units ${amt.amountRaw}${amt.unit === 'shares' ? ' shares' : ''}`
								return (
									<div key={amt.role + i} className="font-mono text-xs text-slate-400">
										{amt.role}: {shown}
									</div>
								)
							})}
							{a.completeness === 'partial' ? <div className="text-xs text-amber-400">{a.reasons.join(', ') || 'Partial'}</div> : null}
						</li>
					))}
				</ul>
				<h4 className="mb-2 mt-4 text-sm text-slate-200">Wallet changes</h4>
				<ul className="space-y-1 text-sm">
					{tx.walletChanges.map((c) => {
						const meta = coinLabel(c.coinType)
						const key = tx.timestampMs != null ? `${c.coinType}|${Math.floor(tx.timestampMs / 1000)}` : ''
						const price = key ? prices[key] : undefined
						return (
							<li key={c.coinType + c.amountRaw} className="flex items-center justify-between gap-2">
								<span className="inline-flex items-center gap-2">
									<TokenIconOkx coinType={c.coinType} symbol={meta.symbol} />
									{meta.symbol}
								</span>
								<span className="text-right font-mono text-xs text-slate-300">
									{meta.decimals != null ? displayAmount(c.amountRaw, meta.decimals) : 'Amount unavailable'}
									{meta.decimals == null ? <div className="text-slate-500">raw units {c.amountRaw}</div> : null}
									{walletSuiChangeIsNetworkFee(tx, c.coinType, c.amountRaw) ? (
										<div className="text-slate-500">{c.amountRaw.startsWith('-') ? 'Network fee' : 'Network fee refund'}</div>
									) : null}
									<div className="text-slate-500">
										{price && 'usd' in price
											? `Historical $${price.usd} · ${price.source}`
											: 'Historical USD unavailable'}
									</div>
								</span>
							</li>
						)
					})}
					{tx.suiDeltaIncludesFee ? <li className="text-xs text-slate-500">SUI change already includes the network fee paid by this address.</li> : null}
				</ul>
				{tx.balanceTruncated || tx.eventsTruncated || tx.objectsTruncated ? (
					<div className="mt-4 rounded border border-amber-900/60 p-2 text-xs text-amber-300">
						This transaction is partial. Indexed balance, event, or object pages are still truncated.
						<div className="mt-2">
							<Button size="compact" variant="secondary" onClick={onHydrate} disabled={hydrating}>
								{hydrating ? 'Loading details…' : 'Load remaining details'}
							</Button>
						</div>
					</div>
				) : null}
				<button type="button" className="mt-4 text-sm text-sky-400" onClick={() => setAdvanced((v) => !v)}>
					{advanced ? 'Hide advanced' : 'Advanced'}
				</button>
				{advanced ? (
					<pre className="mt-2 overflow-x-auto text-[11px] text-slate-500">{JSON.stringify({ activities: tx.activities, reasons: tx.reasons }, null, 2)}</pre>
				) : null}
			</div>
		</div>
	)
}
