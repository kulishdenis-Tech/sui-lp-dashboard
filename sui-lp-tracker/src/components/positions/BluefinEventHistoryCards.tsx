import { useEffect, useMemo, useState } from 'react'
import type { EventType, HistoricalEventPriceSource, OpenPosition, PositionEvent } from '@/types'
import { SUISCAN_TX } from '@/utils/constants'
import { primeOkxTokenIconUrls } from '@/services/spotPrice/okxTokenIcon'
import {
	formatTokenAmountForCentStep,
	formatUSD,
	formatUtcEnGbHistory,
	shortAddress,
} from '@/utils/formatting'
import { NATIVE_SUI_COIN_TYPE, normalizeCoinTypeForMatch } from '@/utils/suiCoinType'
import { resolveLpRewardCoinType } from '@/utils/resolveLpRewardCoinType'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'

const PAGE_SIZE = 10

const EVENT_LABELS: Record<EventType, string> = {
	open_position: 'Opened',
	add_liquidity: 'Deposit',
	remove_liquidity: 'Withdraw',
	collect_fee: 'Fee',
	collect_reward: 'Reward',
	close_position: 'Closed',
}

// Order in which filter buttons are shown
const EVENT_TYPE_ORDER: EventType[] = [
	'open_position',
	'add_liquidity',
	'remove_liquidity',
	'collect_fee',
	'collect_reward',
	'close_position',
]

const SOURCE_LABEL_UK: Record<HistoricalEventPriceSource, string> = {
	okx_wallet_hist: 'OKX Wallet (історія цін)',
	okx_dex_candles: 'OKX DEX OHLC',
	pyth: 'Pyth benchmark на секунду tx',
	geckoterminal: 'GeckoTerminal (OHLCV пулу)',
	okx_dex_spot_current: 'поточний OKX spot (~ не дата tx)',
	cache: 'локальний кеш',
}

function formatQuoteSkewVsTx(txUnixSec: number, quoteUnixSec: number | null | undefined): string {
	if (
		quoteUnixSec == null ||
		!Number.isFinite(quoteUnixSec) ||
		txUnixSec <= 0 ||
		!Number.isFinite(txUnixSec)
	) {
		return 'зміщення невідоме'
	}
	const d = quoteUnixSec - txUnixSec
	const abs = Math.abs(d)
	const sign = d >= 0 ? '+' : '−'
	if (abs < 60) return `${sign}${abs} с від часу tx`
	if (abs < 3600) return `${sign}${Math.round(abs / 60)} хв від часу tx`
	if (abs < 86400) return `${sign}${(abs / 3600).toFixed(1)} год від часу tx`
	return `${sign}${(abs / 86400).toFixed(1)} доб від часу tx`
}

function formatUsdPerOneToken(n: number): string {
	const abs = Math.abs(n)
	if (abs >= 1000 || abs === 0) return formatUSD(n, 2)
	if (abs >= 1) return formatUSD(n, 4)
	if (abs >= 0.01) return formatUSD(n, 6)
	return formatUSD(n, 8)
}

/** Підказка на Total USD: час tx, час котирування й курс до USD по кожній назі. */
function historyTotalUsdDetailTitle(ev: PositionEvent, p: OpenPosition): string {
	const lines: string[] = []
	lines.push(`Час події (tx): ${formatUtcEnGbHistory(ev.timestamp)} UTC`)
	const src = ev.priceSource != null ? SOURCE_LABEL_UK[ev.priceSource] ?? String(ev.priceSource) : '—'
	lines.push(`Джерело рядка (визначальне): ${src}`)

	const leg = (
		sym: string,
		quoteSec: number | null | undefined,
		unitUsd: number | null | undefined,
	) => {
		const chunks: string[] = []
		if (quoteSec != null && quoteSec > 0) {
			const when = formatUtcEnGbHistory(quoteSec) + ' UTC'
			const skew = formatQuoteSkewVsTx(ev.timestamp, quoteSec)
			chunks.push(`знімок цін ≈ ${when} (${skew}; для OHLC OKX — час відкриття свічки)`)
		}
		if (unitUsd != null && Number.isFinite(unitUsd) && unitUsd > 0) {
			chunks.push(`курс до USD: ${formatUsdPerOneToken(unitUsd)} за 1 ${sym}`)
		}
		if (chunks.length === 0) return null
		return `${sym}: ${chunks.join('; ')}`
	}

	if (ev.type === 'add_liquidity' || ev.type === 'remove_liquidity') {
		const a = leg(p.tokenA, ev.quoteAsOfUnixSecA, ev.priceA_USD)
		const b = leg(p.tokenB, ev.quoteAsOfUnixSecB, ev.priceB_USD)
		if (a) lines.push(a)
		if (b) lines.push(b)
	} else if (ev.type === 'collect_fee') {
		if (ev.feeAmountA > 0) {
			const a = leg(p.tokenA, ev.quoteAsOfUnixSecA, ev.priceA_USD)
			if (a) lines.push(a)
		}
		if (ev.feeAmountB > 0) {
			const b = leg(p.tokenB, ev.quoteAsOfUnixSecB, ev.priceB_USD)
			if (b) lines.push(b)
		}
	} else if (ev.type === 'collect_reward' && ev.rewardAmount > 0) {
		const unitR =
			ev.valueUsdReward != null && ev.valueUsdReward > 0
				? ev.valueUsdReward / ev.rewardAmount
				: null
		const r = leg((ev.rewardToken || '?').trim(), ev.quoteAsOfUnixSecReward, unitR)
		if (r) lines.push(r)
	}

	if (ev.priceAtTxApproximate) {
		lines.push(
			'Увага: сума містить поточний OKX spot для хоча б однієї ноги — це не повноцінний «курс на дату tx».',
		)
	}
	return lines.join('\n')
}

type Leg = {
	sym: string
	coinType: string | null
	qty: number
	usd: number | null
	unitUsd: number | null
}

function coinTypeForSymbol(sym: string, p: OpenPosition): string | null {
	const t = sym.trim()
	if (!t) return null
	if (t.includes('::')) return normalizeCoinTypeForMatch(t)
	const u = t.toUpperCase()
	if (u === p.tokenA.trim().toUpperCase()) return p.tokenAAddress
	if (u === p.tokenB.trim().toUpperCase()) return p.tokenBAddress
	return null
}

function legResolvedCoinType(leg: Leg, p: OpenPosition): string | null {
	if (leg.coinType?.trim()) return normalizeCoinTypeForMatch(leg.coinType.trim())
	if (leg.sym?.trim().includes('::')) return normalizeCoinTypeForMatch(leg.sym.trim())
	const fromPair = coinTypeForSymbol(leg.sym, p)
	if (fromPair?.trim()) return normalizeCoinTypeForMatch(fromPair.trim())
	if ((leg.sym || '').trim().toUpperCase() === 'SUI') return NATIVE_SUI_COIN_TYPE
	return null
}

function chainIconUrlForLeg(leg: Leg, p: OpenPosition): string | null | undefined {
	const resolved = legResolvedCoinType(leg, p)
	if (!resolved) return undefined
	let rNorm: string
	try {
		rNorm = normalizeCoinTypeForMatch(resolved)
	} catch {
		return undefined
	}
	const matchIcon = (addr: string | null | undefined, icon: string | null | undefined) => {
		if (!addr?.trim()) return null
		try {
			if (normalizeCoinTypeForMatch(addr.trim()) !== rNorm) return null
		} catch {
			return null
		}
		const u = icon?.trim()
		return u && /^https?:\/\//i.test(u) ? u : null
	}
	return matchIcon(p.tokenAAddress, p.tokenAIconUrl) ?? matchIcon(p.tokenBAddress, p.tokenBIconUrl) ?? undefined
}

function unitUsd(ev: PositionEvent, leg: 'a' | 'b', qty: number): number | null {
	if (qty <= 0) return null
	if (leg === 'a') {
		if (ev.priceA_USD != null && ev.priceA_USD > 0) return ev.priceA_USD
		if (ev.valueUsdA != null && ev.valueUsdA > 0) return ev.valueUsdA / qty
	}
	if (leg === 'b') {
		if (ev.priceB_USD != null && ev.priceB_USD > 0) return ev.priceB_USD
		if (ev.valueUsdB != null && ev.valueUsdB > 0) return ev.valueUsdB / qty
	}
	return null
}

function CopyTxButton({ digest }: { digest: string }) {
	const onCopy = async (e: { preventDefault: () => void }) => {
		e.preventDefault()
		try {
			await navigator.clipboard.writeText(digest)
		} catch {
			/* ignore */
		}
	}
	return (
		<button
			type="button"
			onClick={onCopy}
			className="ml-0.5 inline-flex rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
			title="Copy tx digest"
			aria-label="Copy transaction digest"
		>
			<svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
				<rect x="9" y="9" width="13" height="13" rx="2" />
				<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
			</svg>
		</button>
	)
}

function legsForEvent(ev: PositionEvent, p: OpenPosition): Leg[] {
	const out: Leg[] = []
	if (ev.type === 'add_liquidity' || ev.type === 'remove_liquidity') {
		const qa = ev.tokenAAmount
		const qb = ev.tokenBAmount
		if (qa > 0) {
			out.push({
				sym: p.tokenA,
				coinType: p.tokenAAddress,
				qty: qa,
				usd: ev.valueUsdA,
				unitUsd: unitUsd(ev, 'a', qa),
			})
		}
		if (qb > 0) {
			out.push({
				sym: p.tokenB,
				coinType: p.tokenBAddress,
				qty: qb,
				usd: ev.valueUsdB,
				unitUsd: unitUsd(ev, 'b', qb),
			})
		}
	} else if (ev.type === 'collect_fee') {
		if (ev.feeAmountA > 0) {
			out.push({
				sym: p.tokenA,
				coinType: p.tokenAAddress,
				qty: ev.feeAmountA,
				usd: ev.valueUsdA,
				unitUsd: unitUsd(ev, 'a', ev.feeAmountA),
			})
		}
		if (ev.feeAmountB > 0) {
			out.push({
				sym: p.tokenB,
				coinType: p.tokenBAddress,
				qty: ev.feeAmountB,
				usd: ev.valueUsdB,
				unitUsd: unitUsd(ev, 'b', ev.feeAmountB),
			})
		}
	} else if (ev.type === 'collect_reward' && ev.rewardAmount > 0) {
		const rt = (ev.rewardToken || '').trim() || '?'
		const ct = resolveLpRewardCoinType(ev, p)
		out.push({
			sym: rt,
			coinType: ct,
			qty: ev.rewardAmount,
			usd: ev.valueUsdReward,
			unitUsd:
				ev.valueUsdReward != null && ev.rewardAmount > 0
					? ev.valueUsdReward / ev.rewardAmount
					: null,
		})
	}
	return out
}

function collectCoinTypesForIcons(p: OpenPosition, events: PositionEvent[]): string[] {
	const s = new Set<string>()
	if (p.tokenAAddress) s.add(p.tokenAAddress)
	if (p.tokenBAddress) s.add(p.tokenBAddress)
	if (p.tokenA.trim().toUpperCase() === 'SUI' || p.tokenB.trim().toUpperCase() === 'SUI') {
		s.add(NATIVE_SUI_COIN_TYPE)
	}
	for (const e of events) {
		if (e.type === 'collect_reward' && e.rewardAmount > 0) {
			const ct = resolveLpRewardCoinType(e, p)
			if (ct) s.add(ct)
		}
	}
	return [...s]
}

/** Returns true if this event has enough data to show a row (used for filter counting too). */
function isRowVisible(ev: PositionEvent, p: OpenPosition): boolean {
	const isLifecycle = ev.type === 'open_position' || ev.type === 'close_position'
	const hasLegs = legsForEvent(ev, p).length > 0
	const hasTotal = ev.totalValueUSD != null && ev.totalValueUSD > 0
	return isLifecycle || hasLegs || hasTotal
}

// ─── Pagination control ───────────────────────────────────────────────────────

function Pagination({
	page,
	totalPages,
	onPage,
}: {
	page: number
	totalPages: number
	onPage: (p: number) => void
}) {
	if (totalPages <= 1) return null

	const btnBase =
		'min-w-[2rem] rounded px-2 py-1 text-xs font-mono border transition-colors'
	const btnNormal = `${btnBase} border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200`
	const btnActive = `${btnBase} border-sky-500 bg-sky-500/20 text-sky-200`
	const btnDisabled = `${btnBase} border-slate-800 text-slate-700 cursor-not-allowed`

	// Build page numbers to show: always show first, last, current, and 1 around current
	const pages: (number | '…')[] = []
	const add = (n: number) => {
		if (!pages.includes(n)) pages.push(n)
	}
	add(0)
	if (page > 2) pages.push('…')
	for (let i = Math.max(1, page - 1); i <= Math.min(totalPages - 2, page + 1); i++) add(i)
	if (page < totalPages - 3) pages.push('…')
	add(totalPages - 1)

	return (
		<div className="flex items-center justify-center gap-1 px-3 py-2">
			<button
				type="button"
				className={page === 0 ? btnDisabled : btnNormal}
				disabled={page === 0}
				onClick={() => onPage(page - 1)}
				aria-label="Previous page"
			>
				←
			</button>
			{pages.map((p, i) =>
				p === '…' ? (
					<span key={`ellipsis-${i}`} className="px-1 text-xs text-slate-600">
						…
					</span>
				) : (
					<button
						key={p}
						type="button"
						className={p === page ? btnActive : btnNormal}
						onClick={() => onPage(p as number)}
						aria-current={p === page ? 'page' : undefined}
					>
						{(p as number) + 1}
					</button>
				),
			)}
			<button
				type="button"
				className={page === totalPages - 1 ? btnDisabled : btnNormal}
				disabled={page === totalPages - 1}
				onClick={() => onPage(page + 1)}
				aria-label="Next page"
			>
				→
			</button>
		</div>
	)
}

// ─── Main component ───────────────────────────────────────────────────────────

export function BluefinEventHistoryCards({
	position: p,
	events,
}: {
	position: OpenPosition
	events: PositionEvent[]
}) {
	const [page, setPage] = useState(0)
	const [activeFilter, setActiveFilter] = useState<EventType | 'all'>('all')

	const sorted = useMemo(
		() => [...events].sort((a, b) => b.timestamp - a.timestamp),
		[events],
	)

	const coinTypesForPrime = useMemo(
		() => collectCoinTypesForIcons(p, events),
		[p, events],
	)

	useEffect(() => {
		primeOkxTokenIconUrls(coinTypesForPrime)
	}, [coinTypesForPrime])

	// Which event types actually have visible rows
	const availableTypes = useMemo(() => {
		const s = new Set<EventType>()
		for (const ev of sorted) {
			if (isRowVisible(ev, p)) s.add(ev.type)
		}
		return s
	}, [sorted, p])

	// Total visible rows with no filter applied (used for header count)
	const totalVisible = useMemo(
		() => sorted.filter((ev) => isRowVisible(ev, p)).length,
		[sorted, p],
	)

	// Filtered list (respects empty-row hiding + type filter)
	const filtered = useMemo(() => {
		return sorted.filter((ev) => {
			if (!isRowVisible(ev, p)) return false
			if (activeFilter !== 'all' && ev.type !== activeFilter) return false
			return true
		})
	}, [sorted, p, activeFilter])

	// Reset to page 0 when filter changes
	const setFilter = (f: EventType | 'all') => {
		setActiveFilter(f)
		setPage(0)
	}

	const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
	const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

	if (sorted.length === 0) return null

	const filterBtnBase =
		'rounded border px-2 py-0.5 text-[11px] font-medium transition-colors'
	const filterBtnNormal =
		`${filterBtnBase} border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200`
	const filterBtnActive =
		`${filterBtnBase} border-sky-500 bg-sky-500/20 text-sky-200`

	return (
		<div className="rounded-lg border border-slate-800/90 bg-slate-950/40">
			{/* Header + filter row */}
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
				<span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
					History
					{filtered.length !== totalVisible
						? ` · ${filtered.length} / ${totalVisible}`
						: ` · ${filtered.length}`}
				</span>
				<div className="flex flex-wrap items-center gap-1">
					<button
						type="button"
						className={activeFilter === 'all' ? filterBtnActive : filterBtnNormal}
						onClick={() => setFilter('all')}
					>
						All
					</button>
					{EVENT_TYPE_ORDER.filter((t) => availableTypes.has(t)).map((t) => (
						<button
							key={t}
							type="button"
							className={activeFilter === t ? filterBtnActive : filterBtnNormal}
							onClick={() => setFilter(t)}
						>
							{EVENT_LABELS[t]}
						</button>
					))}
				</div>
			</div>

			{/* Table */}
			<div className="overflow-x-auto">
				<table className="w-full min-w-[56rem] table-fixed border-collapse text-left text-xs">
					<colgroup>
						<col style={{ width: '9.5rem' }} />
						<col style={{ width: '5.5rem' }} />
						<col />
						<col style={{ width: '8.25rem' }} />
						<col style={{ width: '12.5rem' }} />
					</colgroup>
					<thead className="bg-slate-950/95 backdrop-blur-[2px]">
						<tr className="border-b border-slate-800/80 text-[10px] font-medium uppercase tracking-wide text-slate-500">
							<th scope="col" className="px-3 py-1.5 text-left font-medium align-bottom">
								Date (UTC)
							</th>
							<th scope="col" className="py-1.5 pl-0 pr-2 text-left font-medium align-bottom">
								Type
							</th>
							<th scope="col" className="min-w-0 py-1.5 px-2 text-left font-medium align-bottom">
								Changes
							</th>
							<th
								scope="col"
								className="box-border border-r border-slate-800/50 py-1.5 pl-1 pr-5 text-right font-medium align-bottom whitespace-nowrap"
							>
								Total USD
							</th>
							<th scope="col" className="py-1.5 pl-4 pr-3 text-right font-medium align-bottom">
								Transaction
							</th>
						</tr>
					</thead>
					<tbody className="text-slate-300">
						{paged.length === 0 ? (
							<tr>
								<td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
									No events for this filter.
								</td>
							</tr>
						) : (
							paged.map((ev) => {
								const approx = ev.priceAtTxApproximate
								const isDeposit = ev.type === 'add_liquidity'
								const isRemove = ev.type === 'remove_liquidity'
								const legList = legsForEvent(ev, p)
								const hasLegs = legList.length > 0
								const hasTotal = ev.totalValueUSD != null && ev.totalValueUSD > 0
								return (
									<tr key={ev.id} className="align-top border-b border-slate-800/90">
										<td className="px-3 py-2.5 text-[11px] text-slate-400 sm:text-slate-500">
											{formatUtcEnGbHistory(ev.timestamp)}
										</td>
										<td
											className={
												'py-2.5 pr-2 text-left text-xs font-medium ' +
												(isDeposit ? 'text-emerald-400/95' : 'text-slate-200')
											}
										>
											{EVENT_LABELS[ev.type]}
										</td>
										<td className="min-w-0 py-2.5 px-2">
											{hasLegs ? (
												<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
													{legList.map((leg, i) => (
														<div key={i} className="flex min-w-0 items-center gap-1.5">
															<TokenIconOkx
																coinType={legResolvedCoinType(leg, p) ?? leg.sym}
																symbol={leg.sym}
																title={leg.sym}
																chainIconUrl={chainIconUrlForLeg(leg, p)}
															/>
															<span
																className={
																	'font-mono ' +
																	(isDeposit && leg.qty > 0
																		? 'text-emerald-400'
																		: isRemove && leg.qty > 0
																			? 'text-rose-400/90'
																			: 'text-slate-100')
																}
															>
																{isDeposit && leg.qty > 0 ? '+' : null}
																{isRemove && leg.qty > 0 ? '−' : null}
																{formatTokenAmountForCentStep(Math.abs(leg.qty), leg.unitUsd)}{' '}
																{leg.sym}
															</span>
															{leg.usd != null && leg.usd > 0 ? (
																<span className="whitespace-nowrap font-mono text-[11px] text-slate-500">
																	{formatUSD(leg.usd)}
																</span>
															) : null}
														</div>
													))}
												</div>
											) : (
												<div className="text-slate-500">—</div>
											)}
										</td>
										<td
											className="box-border border-r border-slate-800/50 py-2.5 pl-1 pr-5 text-right font-mono align-top tabular-nums"
											title={hasTotal ? historyTotalUsdDetailTitle(ev, p) : undefined}
										>
											{hasTotal ? (
												<span className="text-slate-200">
													{formatUSD(ev.totalValueUSD!)}
													{approx ? (
														<span className="ml-0.5 text-amber-400/90" aria-hidden>
															~
														</span>
													) : null}
												</span>
											) : (
												<span className="text-slate-600">—</span>
											)}
										</td>
										<td className="py-2.5 pl-4 pr-3 text-right align-top">
											<div className="inline-flex max-w-full flex-nowrap items-center justify-end gap-0.5 whitespace-nowrap">
												<a
													href={SUISCAN_TX(ev.txDigest)}
													target="_blank"
													rel="noreferrer"
													className="font-mono text-sky-400/95 hover:underline"
													title="Open in Suiscan"
												>
													{shortAddress(ev.txDigest, 5, 5)}
												</a>
												<a
													href={SUISCAN_TX(ev.txDigest)}
													target="_blank"
													rel="noreferrer"
													className="inline-flex shrink-0 rounded p-0.5 text-slate-500 hover:text-slate-300"
													title="Suiscan"
													aria-label="Open in explorer"
												>
													<svg
														className="h-3.5 w-3.5"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														strokeWidth="2"
													>
														<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
													</svg>
												</a>
												<CopyTxButton digest={ev.txDigest} />
											</div>
										</td>
									</tr>
								)
							})
						)}
					</tbody>
				</table>
			</div>

			{/* Pagination */}
			{totalPages > 1 && (
				<div className="border-t border-slate-800/80">
					<Pagination page={page} totalPages={totalPages} onPage={setPage} />
				</div>
			)}
		</div>
	)
}
