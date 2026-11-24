import { useEffect, useRef, useState } from 'react'
import {
	CandlestickSeries,
	LineStyle,
	createChart,
	type IChartApi,
	type UTCTimestamp,
} from 'lightweight-charts'
import type { PoolCandleTimeframeId } from '@/lib/geckoPoolOhlcvCore'
import { loadPoolCandlesForChart } from '@/services/poolCandlesClient'
import { GECKO_NETWORK } from '@/utils/constants'
import { LpRangeBandPrimitive } from '@/components/positions/LpChartRangeBandPrimitive'
import { alignCandlesToRange, normalizeCandles } from '@/components/positions/positionRangeChartData'

const TIMEFRAMES: PoolCandleTimeframeId[] = ['15m', '1h', '4h', '1d']

function fmt(n: number): string {
	if (n >= 100) return n.toFixed(2)
	if (n >= 1) return n.toFixed(4)
	return n.toPrecision(4)
}

/** Pool candles with this LP's Lower / Upper bounds drawn as lines and a shaded corridor. */
export function PositionRangeChart({
	poolId,
	priceMin,
	priceMax,
	priceCurrent,
	priceLabel,
	onUnavailable,
}: {
	poolId: string
	priceMin: number
	priceMax: number
	priceCurrent: number
	priceLabel: string
	/** Called when no candles could be loaded, so the parent can fall back to the embed. */
	onUnavailable?: () => void
}) {
	const hostRef = useRef<HTMLDivElement | null>(null)
	const chartRef = useRef<IChartApi | null>(null)
	const [tf, setTf] = useState<PoolCandleTimeframeId>('1h')
	const [status, setStatus] = useState<'loading' | 'ready' | 'empty'>('loading')

	useEffect(() => {
		const el = hostRef.current
		if (!el) return
		let cancelled = false
		setStatus('loading')

		const chart = createChart(el, {
			width: Math.max(el.clientWidth, 280),
			height: 420,
			layout: {
				background: { color: 'transparent' },
				textColor: '#94a3b8',
				attributionLogo: false,
			},
			grid: {
				vertLines: { color: 'rgba(51,65,85,0.25)' },
				horzLines: { color: 'rgba(51,65,85,0.25)' },
			},
			rightPriceScale: { borderColor: 'rgba(51,65,85,0.6)' },
			timeScale: {
				borderColor: 'rgba(51,65,85,0.6)',
				timeVisible: true,
				secondsVisible: false,
			},
		})
		chartRef.current = chart
		const series = chart.addSeries(CandlestickSeries, {
			upColor: '#34d399',
			downColor: '#f87171',
			borderVisible: false,
			wickUpColor: '#34d399',
			wickDownColor: '#f87171',
			priceLineVisible: false,
			// Keep both bounds on screen even when candles stay inside a narrow slice of the range.
			autoscaleInfoProvider: (
				original: () => {
					priceRange: { minValue: number; maxValue: number } | null
				} | null,
			) => {
				const res = original()
				if (!res || !res.priceRange) return res
				return {
					...res,
					priceRange: {
						minValue: Math.min(res.priceRange.minValue, priceMin),
						maxValue: Math.max(res.priceRange.maxValue, priceMax),
					},
				}
			},
		} as never)
		series.createPriceLine({
			price: priceMax,
			color: '#fbbf24',
			lineWidth: 2,
			lineStyle: LineStyle.Solid,
			axisLabelVisible: true,
			title: 'Upper',
		})
		series.createPriceLine({
			price: priceMin,
			color: '#fbbf24',
			lineWidth: 2,
			lineStyle: LineStyle.Solid,
			axisLabelVisible: true,
			title: 'Lower',
		})
		series.createPriceLine({
			price: priceCurrent,
			color: '#94a3b8',
			lineWidth: 1,
			lineStyle: LineStyle.Dashed,
			axisLabelVisible: true,
			title: 'Now',
		})

		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width
			if (w && chartRef.current) chartRef.current.applyOptions({ width: Math.max(w, 280) })
		})
		ro.observe(el)

		void (async () => {
			try {
				const rows = await loadPoolCandlesForChart(poolId, tf, GECKO_NETWORK, {
					currency: 'token',
					limit: 500,
				})
				if (cancelled) return
				const { candles } = alignCandlesToRange(normalizeCandles(rows), priceCurrent)
				if (candles.length === 0) {
					setStatus('empty')
					onUnavailable?.()
					return
				}
				series.setData(
					candles.map((c) => ({
						time: c.time as UTCTimestamp,
						open: c.open,
						high: c.high,
						low: c.low,
						close: c.close,
					})),
				)
				series.attachPrimitive(
					new LpRangeBandPrimitive(
						priceMin,
						priceMax,
						candles[0].time as UTCTimestamp,
						candles[candles.length - 1].time as UTCTimestamp,
						'rgba(251,191,36,0.08)',
					),
				)
				chart.timeScale().fitContent()
				setStatus('ready')
			} catch {
				if (cancelled) return
				setStatus('empty')
				onUnavailable?.()
			}
		})()

		return () => {
			cancelled = true
			ro.disconnect()
			chart.remove()
			chartRef.current = null
		}
	}, [poolId, tf, priceMin, priceMax, priceCurrent, onUnavailable])

	return (
		<div className="w-full">
			<div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
				<span>
					{priceLabel} · range {fmt(priceMin)} – {fmt(priceMax)}
				</span>
				<div className="flex gap-1">
					{TIMEFRAMES.map((id) => (
						<button
							key={id}
							type="button"
							onClick={() => setTf(id)}
							className={`rounded px-2 py-0.5 ${
								tf === id
									? 'bg-sky-500/20 text-sky-300'
									: 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
							}`}
						>
							{id}
						</button>
					))}
				</div>
			</div>
			<div className="relative w-full overflow-hidden rounded-lg border border-slate-800/90 bg-slate-950/50">
				<div ref={hostRef} className="h-[420px] w-full" />
				{status !== 'ready' ? (
					<div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
						{status === 'loading' ? 'Loading candles…' : 'No candles for this pool.'}
					</div>
				) : null}
			</div>
		</div>
	)
}
