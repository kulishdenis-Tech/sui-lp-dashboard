/**
 * Analytics tab — portfolio value over time.
 *
 * Layout:
 *  ┌──────────────────────────────────────────────────┐
 *  │  Stat cards: Current · 24h Δ · 7d Δ · 30d Δ      │
 *  ├──────────────────────────────────────────────────┤
 *  │  Time-range selector: 24h · 7d · 30d · All       │
 *  ├──────────────────────────────────────────────────┤
 *  │  Area chart (lightweight-charts v5)               │
 *  ├──────────────────────────────────────────────────┤
 *  │  Breakdown stacked bars (LP · Aftermath · Lend · Wallet) │
 *  └──────────────────────────────────────────────────┘
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import {
	createChart,
	AreaSeries,
	type IChartApi,
	type ISeriesApi,
	type AreaSeriesOptions,
	type UTCTimestamp,
	type MouseEventParams,
} from 'lightweight-charts'
import { AppCard } from '@/components/ui/AppCard'
import { formatUSD } from '@/utils/formatting'
import { usePortfolioHistory, type TimeRange } from '@/hooks/usePortfolioHistory'
import type { PortfolioSnapshot } from '@/services/portfolioSnapshotIdb'

// ─── helpers ─────────────────────────────────────────────────────────────────

function deltaColor(v: number | null) {
	if (v == null) return 'text-slate-500'
	if (v > 0) return 'text-emerald-400'
	if (v < 0) return 'text-red-400'
	return 'text-slate-400'
}

function formatDelta(v: number | null): string {
	if (v == null || !Number.isFinite(v)) return '—'
	const sign = v >= 0 ? '+' : ''
	return `${sign}${formatUSD(v)}`
}

function formatPctDelta(v: number | null): string {
	if (v == null || !Number.isFinite(v)) return ''
	const sign = v >= 0 ? '+' : ''
	return ` (${sign}${v.toFixed(2)}%)`
}

/** Return the closest snapshot to `targetMs` within `windowMs`. */
function closestSnap(
	snaps: PortfolioSnapshot[],
	targetMs: number,
	windowMs = 3 * 3_600_000,
): PortfolioSnapshot | null {
	let best: PortfolioSnapshot | null = null
	let bestDiff = Infinity
	for (const s of snaps) {
		const diff = Math.abs(s.ts - targetMs)
		if (diff < bestDiff && diff <= windowMs) {
			bestDiff = diff
			best = s
		}
	}
	return best
}

/** Compute absolute + pct delta vs `agoMs` hours ago. */
function computeDelta(
	snaps: PortfolioSnapshot[],
	current: number,
	agoMs: number,
): { abs: number; pct: number } | null {
	if (snaps.length === 0) return null
	const target = Date.now() - agoMs
	const ref = closestSnap(snaps, target)
	if (!ref || ref.totalUSD <= 0) return null
	const abs = current - ref.totalUSD
	const pct = (abs / ref.totalUSD) * 100
	return { abs, pct }
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
	label,
	value,
	delta,
}: {
	label: string
	value?: string
	delta?: { abs: number | null; pct: number | null }
}) {
	return (
		<AppCard density="compact" className="h-full">
			<p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
			{value !== undefined ? (
				<p className="mt-0.5 font-mono text-lg text-slate-200 tabular-nums">{value}</p>
			) : (
				<p className="mt-0.5 h-6 w-24 animate-pulse rounded bg-slate-700" />
			)}
			{delta && (
				<p className={`mt-0.5 text-xs tabular-nums ${deltaColor(delta.abs)}`}>
					<span className="text-[11px] opacity-75">{formatPctDelta(delta.pct)}</span>
				</p>
			)}
		</AppCard>
	)
}

// ─── Range selector ───────────────────────────────────────────────────────────

const RANGES: { id: TimeRange; label: string }[] = [
	{ id: '24h', label: '24h' },
	{ id: '7d', label: '7d' },
	{ id: '30d', label: '30d' },
	{ id: 'all', label: 'All' },
]

function RangeSelector({
	value,
	onChange,
}: {
	value: TimeRange
	onChange: (r: TimeRange) => void
}) {
	return (
		<div className="flex gap-1">
			{RANGES.map((r) => (
				<button
					key={r.id}
					type="button"
					onClick={() => onChange(r.id)}
					className={[
						'rounded px-3 py-1 text-xs font-medium transition-colors',
						value === r.id
							? 'bg-sky-500/20 text-sky-400'
							: 'text-slate-500 hover:bg-slate-700/50 hover:text-slate-300',
					].join(' ')}
				>
					{r.label}
				</button>
			))}
		</div>
	)
}

// ─── Breakdown bar ────────────────────────────────────────────────────────────

type Segment = { label: string; value: number; color: string }

function BreakdownBar({ segments }: { segments: Segment[] }) {
	const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0)
	if (total <= 0) return null

	return (
		<div className="space-y-2">
			<div className="flex h-3 overflow-hidden rounded-full bg-slate-800">
				{segments.map((seg) => {
					const pct = total > 0 ? (Math.max(0, seg.value) / total) * 100 : 0
					if (pct < 0.5) return null
					return (
						<div
							key={seg.label}
							className="h-full transition-all"
							style={{ width: `${pct}%`, backgroundColor: seg.color }}
						/>
					)
				})}
			</div>
			<div className="flex flex-wrap gap-x-4 gap-y-1">
				{segments.map((seg) => (
					<div key={seg.label} className="flex items-center gap-1.5 text-xs">
						<span
							className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
							style={{ backgroundColor: seg.color }}
						/>
						<span className="text-slate-400">{seg.label}</span>
						<span className="tabular-nums text-slate-300">{formatUSD(seg.value)}</span>
					</div>
				))}
			</div>
		</div>
	)
}

// ─── Chart ────────────────────────────────────────────────────────────────────

function PortfolioChart({
	snapshots,
	range,
}: {
	snapshots: PortfolioSnapshot[]
	range: TimeRange
}) {
	const containerRef = useRef<HTMLDivElement>(null)
	const chartRef = useRef<IChartApi | null>(null)
	const seriesRef = useRef<ISeriesApi<'Area'> | null>(null)
	/** Floating tooltip element — updated directly via DOM (avoids setState on every mouse move). */
	const tooltipRef = useRef<HTMLDivElement>(null)

	// Create chart once
	useLayoutEffect(() => {
		if (!containerRef.current) return

		// Hardcoded dark-theme hex — lightweight-charts cannot parse oklch()
		// values that Tailwind v4 emits for CSS variables.
		const textColor = '#94a3b8'   // slate-400
		const gridColor = '#1e293b'   // slate-800
		const borderColor = '#1e293b' // app-border ≈ slate-800

		const chart = createChart(containerRef.current, {
			width: containerRef.current.clientWidth,
			height: 260,
			layout: {
				background: { color: 'transparent' },
				textColor,
			},
			grid: {
				vertLines: { color: gridColor },
				horzLines: { color: gridColor },
			},
			rightPriceScale: {
				borderColor,
				scaleMargins: { top: 0.1, bottom: 0.1 },
			},
			timeScale: {
				borderColor,
				timeVisible: true,
				secondsVisible: false,
				// Format axis tick labels in the browser's local timezone.
				// lightweight-charts passes UTC seconds; without this, tick
				// labels are UTC which causes a visible offset for non-UTC users.
				tickMarkFormatter: (time: number, tickMarkType: number) => {
					const d = new Date(time * 1000)
					// tickMarkType: 0=Year 1=Month 2=DayOfMonth 3=Time 4=TimeWithSeconds
					if (tickMarkType <= 2) {
						// Day/month boundary — show "May 20"
						return d.toLocaleString(undefined, { month: 'short', day: 'numeric' })
					}
					// Intra-day time mark — show "14:00"
					const hh = String(d.getHours()).padStart(2, '0')
					const mm = String(d.getMinutes()).padStart(2, '0')
					return `${hh}:${mm}`
				},
			},
			crosshair: {
				horzLine: { visible: true, labelVisible: true },
				vertLine: { visible: true, labelVisible: true },
			},
			localization: {
				priceFormatter: (p: number) => formatUSD(p, 0),
				// Show local time — lightweight-charts passes Unix seconds (UTC).
				// We format it in the browser's local timezone so the hour marks
				// (10:00, 11:00 …) match what the user sees on their clock.
				timeFormatter: (ts: number) => {
					const d = new Date(ts * 1000)
					const month = d.toLocaleString(undefined, { month: 'short' })
					const day = d.getDate()
					const hh = String(d.getHours()).padStart(2, '0')
					const mm = String(d.getMinutes()).padStart(2, '0')
					return `${month} ${day}, ${hh}:${mm}`
				},
			},
			handleScroll: true,
			handleScale: true,
		})

		const areaOpts: Partial<AreaSeriesOptions> = {
			lineColor: '#38bdf8', // sky-400
			topColor: 'rgba(56, 189, 248, 0.25)',
			bottomColor: 'rgba(56, 189, 248, 0.02)',
			lineWidth: 2,
			crosshairMarkerVisible: true,
			crosshairMarkerRadius: 4,
			priceLineVisible: false,
		}

		const series = chart.addSeries(AreaSeries, areaOpts)
		chartRef.current = chart
		seriesRef.current = series

		// ── Floating tooltip ──────────────────────────────────────────────────
		// `container` captured once — stable for the lifetime of this effect
		const container = containerRef.current

		const hideTooltip = () => {
			if (tooltipRef.current) tooltipRef.current.style.display = 'none'
		}

		const onCrosshairMove = (param: MouseEventParams) => {
			const tooltip = tooltipRef.current
			if (!tooltip || !container) return

			if (
				!param.point ||
				!param.time ||
				param.point.x < 0 ||
				param.point.x > container.clientWidth ||
				param.point.y < 0 ||
				param.point.y > container.clientHeight
			) {
				hideTooltip()
				return
			}

			const raw = param.seriesData.get(series)
			if (!raw) { hideTooltip(); return }
			const value = (raw as { value: number }).value
			const ts = param.time as number // UTC seconds

			// Format in local timezone
			const d = new Date(ts * 1000)
			const dateStr = d.toLocaleString(undefined, {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
			})

			tooltip.innerHTML = `
				<div class="text-[10px] text-slate-400 leading-tight mb-0.5">${dateStr}</div>
				<div class="font-mono text-sm font-semibold text-sky-300 tabular-nums">${formatUSD(value)}</div>
			`

			// Position: right of cursor, flip left if too close to right edge
			const TOOLTIP_W = 148
			const TOOLTIP_H = 52
			const x = param.point.x
			const y = param.point.y
			const left = x + 14 + TOOLTIP_W > container.clientWidth ? x - TOOLTIP_W - 10 : x + 14
			const top = Math.max(4, Math.min(y - TOOLTIP_H / 2, container.clientHeight - TOOLTIP_H - 4))

			tooltip.style.display = 'block'
			tooltip.style.left = `${left}px`
			tooltip.style.top = `${top}px`
		}

		chart.subscribeCrosshairMove(onCrosshairMove)

		// Hide when mouse leaves the chart area
		container.addEventListener('mouseleave', hideTooltip)

		// Resize observer
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width
			if (w && chartRef.current) chartRef.current.resize(w, 260)
		})
		ro.observe(container)

		return () => {
			ro.disconnect()
			container.removeEventListener('mouseleave', hideTooltip)
			// Unsubscribe explicitly before chart.remove() to avoid stale closure leaks
			chart.unsubscribeCrosshairMove(onCrosshairMove)
			chart.remove()
			chartRef.current = null
			seriesRef.current = null
		}
	}, [])

	// Update data when snapshots/range change
	useEffect(() => {
		if (!seriesRef.current || snapshots.length === 0) {
			seriesRef.current?.setData([])
			return
		}

		const data = snapshots
			.map((s) => ({
				// Use hourBucket so every point sits on a clean hour mark (10:00, 11:00 …).
				// ts == hourBucket now (set in the hook), but fall back gracefully.
				time: Math.floor((s.hourBucket || s.ts) / 1000) as UTCTimestamp,
				value: s.totalUSD,
			}))
			// lightweight-charts requires strictly ascending time
			.filter((d, i, arr) => i === 0 || d.time > arr[i - 1]!.time)

		seriesRef.current.setData(data)
		chartRef.current?.timeScale().fitContent()
	}, [snapshots, range])

	if (snapshots.length === 0) {
		return (
			<div className="flex h-[260px] items-center justify-center rounded-lg border border-app-border bg-app-card">
				<p className="text-sm text-slate-500">No history yet — data accumulates hourly</p>
			</div>
		)
	}

	return (
		<div className="relative h-[260px] w-full overflow-hidden rounded-lg border border-app-border bg-app-card">
			{/* Chart canvas */}
			<div ref={containerRef} className="h-full w-full" />
			{/* Floating tooltip — updated via direct DOM writes to avoid re-renders on every mouse move */}
			<div
				ref={tooltipRef}
				className="pointer-events-none absolute z-10 hidden rounded-lg border border-slate-700/80 bg-slate-900/95 px-3 py-2 shadow-xl backdrop-blur-sm"
				style={{ minWidth: '140px' }}
			/>
		</div>
	)
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AnalyticsModule() {
	const { snapshots, allSnapshots, isLoading, range, setRange } = usePortfolioHistory()

	// Use the latest snapshot from the full set (not just the visible range).
	const latest = allSnapshots.at(-1) ?? snapshots.at(-1)
	const currentTotal = latest?.totalUSD ?? null

	// Delta cards always use allSnapshots (full 90-day store) so the reference
	// point is never cut off by the chart's range filter. Without this fix the
	// 24h delta card always showed '—' when the chart was on the 24h view.
	const delta24h = currentTotal != null ? computeDelta(allSnapshots, currentTotal, 24 * 60 * 60 * 1000) : null
	const delta7d = currentTotal != null ? computeDelta(allSnapshots, currentTotal, 7 * 24 * 60 * 60 * 1000) : null
	const delta30d = currentTotal != null ? computeDelta(allSnapshots, currentTotal, 30 * 24 * 60 * 60 * 1000) : null

	const breakdownSegments: Segment[] = latest
		? [
				{ label: 'LP Positions', value: latest.lpUSD, color: '#38bdf8' },
				{ label: 'Aftermath', value: latest.aftermathUSD, color: '#818cf8' },
				{ label: 'Lending Net', value: latest.lendingNetUSD, color: '#34d399' },
				{ label: 'Wallet', value: latest.walletUSD, color: '#fb923c' },
			]
		: []

	return (
		<div className="space-y-4">
			{/* Stat cards */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<StatCard
					label="Portfolio Value"
					value={currentTotal != null ? formatUSD(currentTotal) : undefined}
				/>
				<StatCard
					label="24h Change"
					value={delta24h ? formatDelta(delta24h.abs) : '—'}
					delta={delta24h ? { abs: delta24h.abs, pct: delta24h.pct } : undefined}
				/>
				<StatCard
					label="7d Change"
					value={delta7d ? formatDelta(delta7d.abs) : '—'}
					delta={delta7d ? { abs: delta7d.abs, pct: delta7d.pct } : undefined}
				/>
				<StatCard
					label="30d Change"
					value={delta30d ? formatDelta(delta30d.abs) : '—'}
					delta={delta30d ? { abs: delta30d.abs, pct: delta30d.pct } : undefined}
				/>
			</div>

			{/* Chart section */}
			<AppCard density="compact" className="space-y-3">
				<div className="flex items-center justify-between">
					<p className="text-sm font-medium text-slate-300">Portfolio Value Over Time</p>
					<RangeSelector value={range} onChange={setRange} />
				</div>

				{isLoading ? (
					<div className="h-[260px] animate-pulse rounded-lg bg-slate-800/50" />
				) : (
					<PortfolioChart snapshots={snapshots} range={range} />
				)}
			</AppCard>

			{/* Breakdown */}
			{latest && (
				<AppCard density="compact" className="space-y-3">
					<p className="text-sm font-medium text-slate-300">Current Breakdown</p>
					<BreakdownBar segments={breakdownSegments} />
				</AppCard>
			)}

			{/* Data notice */}
			<p className="text-center text-[11px] text-slate-600">
				Snapshots saved every 15 min · up to 90 days (server for watchlist wallets, else local)
			</p>
		</div>
	)
}
