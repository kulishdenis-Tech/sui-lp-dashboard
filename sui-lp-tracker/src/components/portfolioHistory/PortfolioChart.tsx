/**
 * Portfolio history chart — stable host lifecycle, viewport persistence, Total/Breakdown.
 * Reset lives in the parent toolbar via {@link PortfolioChartHandle}; canvas stays clear.
 */
import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import {
	createChart,
	AreaSeries,
	LineSeries,
	type IChartApi,
	type ISeriesApi,
	type AreaSeriesOptions,
	type LineData,
	type UTCTimestamp,
	type MouseEventParams,
	type LogicalRange,
	type Time,
} from 'lightweight-charts'
import type { PortfolioSnapshot } from '@/services/portfolioSnapshotIdb'
import type { TimeRange } from '@/hooks/usePortfolioHistory'
import { formatUSDAdaptive } from '@/utils/formatting'
import { isChartableSnapshot } from '@/utils/snapshotCompleteness'
import { chartFitKey, shouldRefitViewport } from '@/components/portfolioHistory/portfolioChartViewport'
import { PortfolioHistoryMeta } from '@/components/portfolioHistory/PortfolioHistoryMeta'

export type ChartMode = 'total' | 'components'

export type PortfolioChartHandle = {
	resetView: () => void
}

const COLORS = {
	total: '#38bdf8',
	wallet: '#fb923c',
	lp: '#38bdf8',
	lending: '#34d399',
} as const

const RANGE_MS: Record<TimeRange, number> = {
	'24h': 24 * 60 * 60 * 1000,
	'7d': 7 * 24 * 60 * 60 * 1000,
	'30d': 30 * 24 * 60 * 60 * 1000,
	all: 0,
}

type Props = {
	snapshots: PortfolioSnapshot[]
	range: TimeRange
	hasAnyHistory: boolean
	mode: ChartMode
	viewKey: string
	componentsAvailable: boolean
	hideAmounts?: boolean
	/** When false, parent renders {@link PortfolioHistoryMeta} beside controls. */
	showMeta?: boolean
	/** Fires when manual pan/zoom arms Reset, and when Reset / programmatic fit clears it. */
	onViewportModifiedChange?: (modified: boolean) => void
}

function fmtTs(ts: number | null | undefined): string {
	if (ts == null || !Number.isFinite(ts) || ts <= 0) return 'unavailable'
	return new Date(ts).toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZoneName: 'short',
	})
}

function dedupeAscending(rows: LineData[]): LineData[] {
	const out: LineData[] = []
	for (const row of rows) {
		const prev = out[out.length - 1]
		if (prev && prev.time === row.time) {
			out[out.length - 1] = row
			continue
		}
		out.push(row)
	}
	return out
}

function toLine(
	snaps: PortfolioSnapshot[],
	pick: (s: PortfolioSnapshot) => number | null,
): LineData[] {
	const rows: LineData[] = []
	for (const s of snaps) {
		if (!isChartableSnapshot(s)) continue
		const v = pick(s)
		if (v == null || !Number.isFinite(v)) continue
		const t = Math.floor((s.hourBucket || s.ts) / 1000) as UTCTimestamp
		rows.push({ time: t, value: v })
	}
	return dedupeAscending(rows.sort((a, b) => (a.time as number) - (b.time as number)))
}

/** DEV-only harness for viewport persistence QA (never writes IDB). */
export type AnalyticsChartTestApi = {
	getVisibleLogicalRange: () => LogicalRange | null
	getVisibleTimeRange: () => { from: Time; to: Time } | null
	markUserInteracted: () => void
	appendFixtureSnapshot: (snap: PortfolioSnapshot) => void
	clearFixtures: () => void
	resetView: () => void
	getFitKey: () => string | null
	getShowReset: () => boolean
}

declare global {
	interface Window {
		__analyticsChartTest?: AnalyticsChartTestApi
	}
}

export const PortfolioChart = forwardRef<PortfolioChartHandle, Props>(function PortfolioChart(
	{
		snapshots,
		range,
		hasAnyHistory,
		mode,
		viewKey,
		componentsAvailable,
		hideAmounts = false,
		showMeta = true,
		onViewportModifiedChange,
	},
	ref,
) {
	const hostRef = useRef<HTMLDivElement>(null)
	const tooltipRef = useRef<HTMLDivElement>(null)
	const chartRef = useRef<IChartApi | null>(null)
	const totalSeriesRef = useRef<ISeriesApi<'Area'> | null>(null)
	const walletSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
	const lpSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
	const lendingSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
	const fitKeyRef = useRef<string | null>(null)
	const userInteractedRef = useRef(false)
	/** Ignore logical-range events from fit / resize / setData — not user pan/zoom. */
	const suppressRangeNotifyRef = useRef(0)
	const modeRef = useRef(mode)
	modeRef.current = mode
	const componentsAvailRef = useRef(componentsAvailable)
	componentsAvailRef.current = componentsAvailable
	const hideRef = useRef(hideAmounts)
	hideRef.current = hideAmounts
	const onViewportModifiedChangeRef = useRef(onViewportModifiedChange)
	onViewportModifiedChangeRef.current = onViewportModifiedChange
	const rafIdsRef = useRef<number[]>([])
	const [ready, setReady] = useState(false)
	const [viewportModified, setViewportModified] = useState(false)
	const [fixtures, setFixtures] = useState<PortfolioSnapshot[]>([])

	const merged = useMemo(() => {
		if (fixtures.length === 0) return snapshots
		const byId = new Map<string, PortfolioSnapshot>()
		for (const s of snapshots) byId.set(s.id, s)
		for (const s of fixtures) byId.set(s.id, s)
		return [...byId.values()].sort((a, b) => a.ts - b.ts)
	}, [snapshots, fixtures])

	const chartable = useMemo(
		() => merged.filter((s) => isChartableSnapshot(s)).slice().sort((a, b) => a.ts - b.ts),
		[merged],
	)
	const latestObs = chartable.at(-1)?.observedAtMs ?? chartable.at(-1)?.ts ?? null

	const empty = chartable.length === 0
	const summaryText = empty
		? hasAnyHistory
			? 'No data in this period.'
			: 'No history yet.'
		: `Portfolio value history. Latest ${fmtTs(latestObs)}.`

	const cancelRafs = () => {
		for (const id of rafIdsRef.current) cancelAnimationFrame(id)
		rafIdsRef.current = []
	}

	const beginSuppressRangeNotify = () => {
		suppressRangeNotifyRef.current += 1
	}
	const endSuppressRangeNotify = () => {
		const id = requestAnimationFrame(() => {
			const id2 = requestAnimationFrame(() => {
				suppressRangeNotifyRef.current = Math.max(0, suppressRangeNotifyRef.current - 1)
			})
			rafIdsRef.current.push(id2)
		})
		rafIdsRef.current.push(id)
	}

	const setModified = (modified: boolean) => {
		userInteractedRef.current = modified
		setViewportModified(modified)
		onViewportModifiedChangeRef.current?.(modified)
	}

	const fitIfNeeded = (force = false) => {
		const chart = chartRef.current
		const el = hostRef.current
		if (!chart || !el || el.clientWidth < 32) return
		const nextKey = chartFitKey({
			viewKey,
			range,
			hasData: chartable.length > 0,
		})
		if (!shouldRefitViewport({ force, nextKey, prevKey: fitKeyRef.current })) {
			return
		}
		beginSuppressRangeNotify()
		if (range === 'all' || RANGE_MS[range] <= 0) {
			chart.timeScale().fitContent()
		} else {
			const to = Math.floor(Date.now() / 1000) as UTCTimestamp
			const from = Math.floor((Date.now() - RANGE_MS[range]) / 1000) as UTCTimestamp
			try {
				chart.timeScale().setVisibleRange({ from, to })
			} catch {
				chart.timeScale().fitContent()
			}
		}
		endSuppressRangeNotify()
		fitKeyRef.current = nextKey
		setModified(false)
	}

	const resetView = () => {
		fitKeyRef.current = null
		fitIfNeeded(true)
	}

	useImperativeHandle(ref, () => ({ resetView }), [viewKey, range, chartable.length, ready])

	useLayoutEffect(() => {
		const el = hostRef.current
		if (!el) return

		const chart = createChart(el, {
			width: Math.max(el.clientWidth, 320),
			height: 280,
			layout: {
				background: { color: 'transparent' },
				textColor: '#94a3b8',
				attributionLogo: false,
			},
			grid: {
				vertLines: { visible: false },
				horzLines: { color: 'rgba(51,65,85,0.45)' },
			},
			rightPriceScale: {
				borderVisible: false,
				scaleMargins: { top: 0.12, bottom: 0.08 },
			},
			timeScale: {
				borderColor: '#1e293b',
				borderVisible: true,
				timeVisible: true,
				secondsVisible: false,
				ticksVisible: false,
				tickMarkFormatter: (time: number, tickMarkType: number) => {
					const d = new Date(time * 1000)
					if (tickMarkType <= 2) {
						return d.toLocaleString(undefined, { month: 'short', day: 'numeric' })
					}
					const hh = String(d.getHours()).padStart(2, '0')
					const mm = String(d.getMinutes()).padStart(2, '0')
					return `${hh}:${mm}`
				},
			},
			crosshair: {
				vertLine: {
					visible: true,
					labelVisible: false,
					color: 'rgba(148,163,184,0.35)',
					width: 1,
					style: 3,
				},
				horzLine: {
					visible: true,
					labelVisible: true,
					color: 'rgba(148,163,184,0.35)',
					width: 1,
					style: 3,
				},
			},
			localization: {
				priceFormatter: (p: number) => (hideRef.current ? '••••' : formatUSDAdaptive(p)),
				timeFormatter: (ts: number) => {
					const d = new Date(ts * 1000)
					return d.toLocaleString(undefined, {
						month: 'short',
						day: 'numeric',
						hour: '2-digit',
						minute: '2-digit',
					})
				},
			},
			handleScroll: true,
			handleScale: true,
		})

		const total = chart.addSeries(AreaSeries, {
			lineColor: COLORS.total,
			topColor: 'rgba(56,189,248,0.25)',
			bottomColor: 'rgba(56,189,248,0.02)',
			lineWidth: 2,
			priceLineVisible: false,
			lastValueVisible: false,
		} satisfies Partial<AreaSeriesOptions>)
		const wallet = chart.addSeries(LineSeries, {
			color: COLORS.wallet,
			lineWidth: 2,
			priceLineVisible: false,
			lastValueVisible: false,
			visible: false,
		})
		const lp = chart.addSeries(LineSeries, {
			color: COLORS.lp,
			lineWidth: 2,
			priceLineVisible: false,
			lastValueVisible: false,
			visible: false,
		})
		const lending = chart.addSeries(LineSeries, {
			color: COLORS.lending,
			lineWidth: 2,
			priceLineVisible: false,
			lastValueVisible: false,
			visible: false,
		})

		chartRef.current = chart
		totalSeriesRef.current = total
		walletSeriesRef.current = wallet
		lpSeriesRef.current = lp
		lendingSeriesRef.current = lending
		setReady(true)

		const onVisibleLogicalRangeChange = () => {
			if (suppressRangeNotifyRef.current > 0) return
			setModified(true)
		}
		chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange)

		const tip = tooltipRef.current
		const hideTip = () => {
			if (tip) tip.style.display = 'none'
		}
		const fmtMoney = (v: number) => (hideRef.current ? '••••' : formatUSDAdaptive(v))
		const onMove = (param: MouseEventParams) => {
			if (!tip || !param.point || !param.time) {
				hideTip()
				return
			}
			const ts = (param.time as number) * 1000
			const when = fmtTs(ts)
			const lines: string[] = [`<div class="text-[10px] text-slate-400">${when}</div>`]
			const showComponents = modeRef.current === 'components' && componentsAvailRef.current
			const tVal = param.seriesData.get(total) as { value?: number } | undefined
			const wVal = param.seriesData.get(wallet) as { value?: number } | undefined
			const lVal = param.seriesData.get(lp) as { value?: number } | undefined
			const nVal = param.seriesData.get(lending) as { value?: number } | undefined
			if (!showComponents && tVal?.value != null) {
				lines.push(`<div class="tabular-nums text-sky-300">Total ${fmtMoney(tVal.value)}</div>`)
			}
			if (showComponents && wVal?.value != null) {
				lines.push(
					`<div class="tabular-nums text-orange-300">Wallet ${fmtMoney(wVal.value)}</div>`,
				)
			}
			if (showComponents && lVal?.value != null) {
				lines.push(`<div class="tabular-nums text-sky-200">LP ${fmtMoney(lVal.value)}</div>`)
			}
			if (showComponents && nVal?.value != null) {
				lines.push(
					`<div class="tabular-nums text-emerald-300">Net Lending ${fmtMoney(nVal.value)}</div>`,
				)
			}
			if (lines.length <= 1) {
				hideTip()
				return
			}
			tip.innerHTML = lines.join('')
			tip.style.display = 'block'
			const tw = 168
			const left =
				param.point.x + 14 + tw > el.clientWidth ? param.point.x - tw - 8 : param.point.x + 14
			tip.style.left = `${Math.max(4, left)}px`
			tip.style.top = `${Math.max(4, param.point.y - 40)}px`
		}
		chart.subscribeCrosshairMove(onMove)
		el.addEventListener('mouseleave', hideTip)

		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width
			if (!w || !chartRef.current) return
			beginSuppressRangeNotify()
			chartRef.current.applyOptions({ width: w })
			endSuppressRangeNotify()
		})
		ro.observe(el)

		return () => {
			cancelRafs()
			ro.disconnect()
			el.removeEventListener('mouseleave', hideTip)
			chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange)
			chart.unsubscribeCrosshairMove(onMove)
			chart.remove()
			chartRef.current = null
			totalSeriesRef.current = null
			walletSeriesRef.current = null
			lpSeriesRef.current = null
			lendingSeriesRef.current = null
			fitKeyRef.current = null
			userInteractedRef.current = false
			suppressRangeNotifyRef.current = 0
			setReady(false)
			setViewportModified(false)
			if (import.meta.env.DEV) delete window.__analyticsChartTest
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	useEffect(() => {
		userInteractedRef.current = false
		fitKeyRef.current = null
		setViewportModified(false)
		onViewportModifiedChangeRef.current?.(false)
		setFixtures([])
		if (tooltipRef.current) tooltipRef.current.style.display = 'none'
	}, [viewKey])

	useEffect(() => {
		if (!ready) return
		const total = totalSeriesRef.current
		const wallet = walletSeriesRef.current
		const lp = lpSeriesRef.current
		const lending = lendingSeriesRef.current
		if (!total || !wallet || !lp || !lending) return

		const showComponents = mode === 'components' && componentsAvailable
		total.applyOptions({ visible: !showComponents })
		wallet.applyOptions({ visible: showComponents })
		lp.applyOptions({ visible: showComponents })
		lending.applyOptions({ visible: showComponents })

		beginSuppressRangeNotify()
		if (showComponents) {
			total.setData([])
			wallet.setData(toLine(chartable, (s) => (Number.isFinite(s.walletUSD) ? s.walletUSD : null)))
			lp.setData(
				toLine(chartable, (s) => {
					const v =
						(Number.isFinite(s.lpUSD) ? s.lpUSD : 0) +
						(Number.isFinite(s.aftermathUSD) ? s.aftermathUSD : 0)
					return Number.isFinite(v) ? v : null
				}),
			)
			lending.setData(
				toLine(chartable, (s) =>
					Number.isFinite(s.lendingNetUSD) ? s.lendingNetUSD : null,
				),
			)
		} else {
			wallet.setData([])
			lp.setData([])
			lending.setData([])
			total.setData(toLine(chartable, (s) => (Number.isFinite(s.totalUSD) ? s.totalUSD : null)))
		}
		endSuppressRangeNotify()

		cancelRafs()
		const id = requestAnimationFrame(() => {
			const id2 = requestAnimationFrame(() => fitIfNeeded(false))
			rafIdsRef.current.push(id2)
		})
		rafIdsRef.current.push(id)
		// mode intentionally omitted from fit key — Total↔Breakdown keeps viewport
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [chartable, mode, componentsAvailable, range, viewKey, ready])

	useEffect(() => {
		const chart = chartRef.current
		if (!chart || !ready) return
		chart.applyOptions({
			localization: {
				priceFormatter: (p: number) => (hideAmounts ? '••••' : formatUSDAdaptive(p)),
			},
			rightPriceScale: { visible: !hideAmounts },
			crosshair: {
				horzLine: { labelVisible: !hideAmounts },
			},
		})
		if (tooltipRef.current) tooltipRef.current.style.display = 'none'
	}, [hideAmounts, ready])

	useEffect(() => {
		if (!import.meta.env.DEV || !ready) return
		window.__analyticsChartTest = {
			getVisibleLogicalRange: () =>
				chartRef.current?.timeScale().getVisibleLogicalRange() ?? null,
			getVisibleTimeRange: () => chartRef.current?.timeScale().getVisibleRange() ?? null,
			markUserInteracted: () => {
				const cur = chartRef.current?.timeScale().getVisibleLogicalRange()
				if (cur) {
					chartRef.current?.timeScale().setVisibleLogicalRange({
						from: cur.from + 2,
						to: cur.to - 2,
					})
				}
				setModified(true)
			},
			appendFixtureSnapshot: (snap) => {
				setFixtures((prev) => [...prev.filter((p) => p.id !== snap.id), snap])
			},
			clearFixtures: () => setFixtures([]),
			resetView,
			getFitKey: () => fitKeyRef.current,
			getShowReset: () => viewportModified,
		}
		return () => {
			delete window.__analyticsChartTest
		}
	}, [ready, viewportModified, viewKey, range])

	return (
		<div className="space-y-2">
			{showMeta ? (
				<PortfolioHistoryMeta snapshots={merged} range={range} hideAmounts={hideAmounts} />
			) : null}

			<div className="relative h-[280px] w-full min-w-0 rounded-lg border border-app-border bg-app-card">
				<div className="absolute inset-0 overflow-hidden rounded-[inherit]">
					<div ref={hostRef} className="h-full w-full" role="img" aria-label={summaryText} />
				</div>
				<div
					ref={tooltipRef}
					className="pointer-events-none absolute z-10 hidden min-w-[140px] rounded-lg border border-slate-700/80 bg-slate-900/95 px-3 py-2 text-xs shadow-xl"
				/>
				{empty ? (
					<div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center rounded-[inherit] bg-app-card/80 px-4 text-center text-sm text-slate-500">
						{hasAnyHistory ? 'No data in this period' : 'No history yet'}
					</div>
				) : null}
			</div>

			{mode === 'components' && componentsAvailable ? (
				<div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
					<span className="inline-flex items-center gap-1.5">
						<span className="h-2 w-2 rounded-sm" style={{ background: COLORS.wallet }} /> Wallet
					</span>
					<span className="inline-flex items-center gap-1.5">
						<span className="h-2 w-2 rounded-sm" style={{ background: COLORS.lp }} /> LP incl.
						Aftermath
					</span>
					<span className="inline-flex items-center gap-1.5">
						<span className="h-2 w-2 rounded-sm" style={{ background: COLORS.lending }} /> Net
						Lending
					</span>
				</div>
			) : null}
		</div>
	)
})
