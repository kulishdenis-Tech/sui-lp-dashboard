import { useMemo, useRef, useState } from 'react'
import { priceAtAnchoredBin, type ConstructorLp, type PoolBinAnchor } from '@autopilot/engine'
import { snapPriceToBin } from './binPriceStep'
import { formatMoney, formatPrice } from './format'

type HoverInfo = { x: number; y: number; title: string; lines: string[] }

type Est = {
	lpId: string
	estimatedTarget: number
	averagePrice: number | null
	activeNow: boolean
	bins: { binId: number; priceUsdcPerSui: number; amount: number }[]
}

type DragState = {
	lpId: string
	edge: 'lower' | 'upper'
	pointerId: number
}

export function PriceChart({
	slot,
	lps,
	spot,
	hardPrice,
	estimates,
	showBins,
	/** DLMM discrete strips; off for CLMM (ticks ≠ bins, wrong stride/price formula). */
	showConcentration = true,
	/** When false (CLMM/Bluefin), chart is read-only — no drag handles. */
	editable = true,
	/** Single-range: keep height ~240–300px. */
	compact = false,
	unitLabel = 'Bins',
	selectedLpId,
	onSelectLp,
	onRangeChange,
	onRangeDragStart,
	pool,
	invalidLpIds,
	invalidReasons,
}: {
	slot: 'BUY' | 'SELL'
	lps: ConstructorLp[]
	spot: number
	hardPrice: number
	estimates: Est[]
	showBins: boolean
	showConcentration?: boolean
	editable?: boolean
	compact?: boolean
	unitLabel?: string
	selectedLpId: string | null
	onSelectLp: (id: string | null) => void
	onRangeChange: (lpId: string, next: { lowerPrice: number; upperPrice: number }) => void
	onRangeDragStart?: () => void
	pool: PoolBinAnchor
	invalidLpIds?: Set<string>
	invalidReasons?: Map<string, string>
}) {
	const [hover, setHover] = useState<HoverInfo | null>(null)
	const [drag, setDrag] = useState<DragState | null>(null)
	const [dragPrice, setDragPrice] = useState<number | null>(null)
	const svgRef = useRef<SVGSVGElement | null>(null)

	const n = Math.max(lps.length, 1)
	const width = Math.max(360, Math.min(720, 100 + n * 100))
	const padL = 64
	const padR = 108
	const padT = 22
	const padB = 36
	const height = compact
		? Math.max(240, Math.min(300, 220 + Math.min(n, 2) * 20))
		: Math.max(240, Math.min(340, 200 + n * 32))

	const { minP, maxP } = useMemo(() => {
		const prices = [spot, hardPrice, ...lps.flatMap((l) => [l.roundedLowerPrice, l.roundedUpperPrice])]
		const lo = Math.min(...prices)
		const hi = Math.max(...prices)
		const span = Math.max(hi - lo, spot * 0.015, 0.008)
		return { minP: lo - span * 0.05, maxP: hi + span * 0.05 }
	}, [lps, spot, hardPrice])

	/** Higher price → higher on screen (top). */
	const y = (p: number) => padT + ((maxP - p) / (maxP - minP)) * (height - padT - padB)
	const priceAtY = (py: number) => maxP - ((py - padT) / (height - padT - padB)) * (maxP - minP)

	const plotW = width - padL - padR
	const colGap = 10
	const colW = Math.max(36, (plotW - colGap * (n + 1)) / n)

	function colX(i: number): number {
		return padL + colGap + i * (colW + colGap)
	}

	const ticks = useMemo(() => {
		const count = 6
		return Array.from({ length: count }, (_, i) => minP + ((maxP - minP) * i) / (count - 1))
	}, [minP, maxP])

	const coverage = useMemo(() => {
		if (!showConcentration) return new Map<number, number>()
		const map = new Map<number, number>()
		const MAX_IDS = 50_000
		let counted = 0
		for (const lp of lps) {
			const lo = Math.min(lp.lowerBinId, lp.upperBinId)
			const hi = Math.max(lp.lowerBinId, lp.upperBinId)
			for (let id = lo; id <= hi; id++) {
				if (counted >= MAX_IDS) break
				map.set(id, (map.get(id) ?? 0) + 1)
				counted++
			}
			if (counted >= MAX_IDS) break
		}
		return map
	}, [lps, showConcentration])

	const maxCover = useMemo(() => {
		if (!showConcentration || coverage.size === 0) return 1
		let m = 1
		for (const v of coverage.values()) if (v > m) m = v
		return m
	}, [coverage, showConcentration])

	const buy = slot === 'BUY'
	const fill = buy ? 'rgba(46, 160, 110, 0.34)' : 'rgba(196, 92, 74, 0.34)'
	const stroke = buy ? '#2ea06e' : '#c45c4a'
	const selectedFill = buy ? 'rgba(46, 160, 110, 0.55)' : 'rgba(196, 92, 74, 0.55)'
	const invalidFill = 'rgba(224, 168, 84, 0.42)'
	const invalidStroke = '#e07040'

	const spotY = y(spot)
	const hardY = y(hardPrice)
	const labelsClose = Math.abs(spotY - hardY) < 18
	/**
	 * When lines are close: higher price (smaller Y) label goes further up;
	 * lower price (larger Y) goes further down — never reverse Spot/Limit order.
	 */
	const spotAboveHard = spotY <= hardY
	const spotLabelY = labelsClose ? (spotAboveHard ? spotY - 10 : spotY + 14) : spotY - 4
	const hardLabelY = labelsClose ? (spotAboveHard ? hardY + 14 : hardY - 10) : hardY - 4

	function clientToSvgY(clientY: number): number {
		const svg = svgRef.current
		if (!svg) return clientY
		const rect = svg.getBoundingClientRect()
		const scale = height / rect.height
		return (clientY - rect.top) * scale
	}

	function applyDrag(clientY: number, state: DragState) {
		const lp = lps.find((l) => l.id === state.lpId)
		if (!lp) return
		const py = clientToSvgY(clientY)
		const raw = priceAtY(py)
		const snapped = snapPriceToBin(raw, pool, state.edge)
		setDragPrice(snapped)
		if (state.edge === 'lower') {
			const lower = Math.min(snapped, lp.roundedUpperPrice - 1e-9)
			if (lower >= lp.roundedUpperPrice) return
			onRangeChange(state.lpId, { lowerPrice: lower, upperPrice: lp.roundedUpperPrice })
		} else {
			const upper = Math.max(snapped, lp.roundedLowerPrice + 1e-9)
			if (upper <= lp.roundedLowerPrice) return
			onRangeChange(state.lpId, { lowerPrice: lp.roundedLowerPrice, upperPrice: upper })
		}
	}

	return (
		<section className="ladder-chart">
			<div className="ladder-legend">
				<span className="leg">
					<i className="swatch" style={{ background: fill, borderColor: stroke }} />
					{buy ? 'BUY · buying SUI' : 'SELL · selling SUI'}
				</span>
				<span className="leg">
					<i className="line solid" /> Spot
				</span>
				<span className="leg">
					<i className="line dash" /> Limit
				</span>
				{/* Keep legend order Spot above Limit when spot > hard (BUY); reverse label is avoided via leader lines */}
				<span className="leg mode">
					{editable ? 'Drag LP edges · click to select' : 'Read-only chart · click LP to select'}
				</span>
			</div>
			<div className={lps.length > 6 ? 'ladder-scroll' : undefined}>
				<svg
					ref={svgRef}
					viewBox={`0 0 ${width} ${height}`}
					role="img"
					aria-label="Interactive LP ladder"
					className="ladder-svg"
					onMouseLeave={() => {
						if (!drag) setHover(null)
					}}
					onPointerMove={(e) => {
						if (!drag) return
						applyDrag(e.clientY, drag)
					}}
					onPointerUp={() => {
						setDrag(null)
						setDragPrice(null)
					}}
					onPointerCancel={() => {
						setDrag(null)
						setDragPrice(null)
					}}
				>
					{/* Price grid (horizontal) */}
					{ticks.map((p) => (
						<g key={p}>
							<line
								x1={padL}
								x2={width - padR}
								y1={y(p)}
								y2={y(p)}
								stroke="#243044"
								strokeWidth={1}
							/>
							<text x={padL - 8} y={y(p) + 4} textAnchor="end" fill="#8b9bb0" fontSize={11}>
								{formatPrice(p)}
							</text>
						</g>
					))}

					{lps.map((lp, i) => {
						const x0 = colX(i)
						const top = y(lp.roundedUpperPrice)
						const bottom = y(lp.roundedLowerPrice)
						const barTop = Math.min(top, bottom)
						const barH = Math.max(4, Math.abs(bottom - top))
						const selected = selectedLpId === lp.id
						const invalid = invalidLpIds?.has(lp.id) ?? false
						const reason = invalidReasons?.get(lp.id)
						const est = estimates.find((e) => e.lpId === lp.id)
						const barFill = invalid ? invalidFill : selected ? selectedFill : fill
						const barStroke = invalid ? invalidStroke : selected ? '#e8eef7' : stroke
						return (
							<g key={lp.id}>
								<text
									x={x0 + colW / 2}
									y={height - padB + 18}
									textAnchor="middle"
									fill={invalid ? '#ffb070' : selected ? '#e8eef7' : '#c5d0e0'}
									fontSize={12}
									fontWeight={600}
								>
									{lp.id}
								</text>
								<text
									x={x0 + colW / 2}
									y={barTop - 8}
									textAnchor="middle"
									fill="#8b9bb0"
									fontSize={11}
								>
									{formatMoney(lp.budget, 0)}
								</text>
								<rect
									x={x0}
									y={barTop}
									width={colW}
									height={barH}
									rx={5}
									fill={barFill}
									stroke={barStroke}
									strokeWidth={selected || invalid ? 2 : 1.4}
									style={{ cursor: 'pointer' }}
									tabIndex={0}
									role="button"
									aria-label={`${lp.id} range ${formatPrice(lp.roundedLowerPrice)} to ${formatPrice(lp.roundedUpperPrice)}`}
									onClick={() => onSelectLp(selected ? null : lp.id)}
									onKeyDown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault()
											onSelectLp(selected ? null : lp.id)
										}
									}}
									onMouseMove={(e) => {
										if (drag) return
										const rect = svgRef.current?.getBoundingClientRect()
										setHover({
											x: e.clientX - (rect?.left ?? 0),
											y: e.clientY - (rect?.top ?? 0),
											title: lp.id,
											lines: [
												`${formatPrice(lp.roundedLowerPrice)} – ${formatPrice(lp.roundedUpperPrice)}`,
												`Budget ${formatMoney(lp.budget)}`,
												`${unitLabel} ${lp.binCount}`,
												lp.overlapBinsWithPrev
													? `Overlap ${lp.overlapBinsWithPrev}`
													: 'No overlap',
												`Est. ${formatMoney(est?.estimatedTarget ?? 0, 2)}`,
												`Avg ${est?.averagePrice == null ? '—' : formatPrice(est.averagePrice)}`,
												...(reason ? [`⚠ ${reason}`] : []),
											],
										})
									}}
								/>
								{showConcentration
									? Array.from({ length: lp.binCount }, (_, k) => {
											const binId = lp.lowerBinId + k
											const cy = y(priceAtAnchoredBin(binId, pool))
											const dens = (coverage.get(binId) ?? 1) / maxCover
											if (dens <= 1 / maxCover) return null
											if (cy < barTop || cy > barTop + barH) return null
											return (
												<rect
													key={`${lp.id}-c-${binId}`}
													x={x0 + 3}
													y={cy - 1.2}
													width={colW - 6}
													height={2.4}
													fill={`rgba(232,238,247,${0.12 + dens * 0.35})`}
													pointerEvents="none"
												/>
											)
										})
									: null}
								{showBins &&
									est?.bins.map((b) => (
										<rect
											key={`${lp.id}-${b.binId}`}
											x={x0 + 4}
											y={y(b.priceUsdcPerSui) - 1.4}
											width={colW - 8}
											height={2.8}
											fill="rgba(232,238,247,0.65)"
											onMouseMove={(e) => {
												e.stopPropagation()
												const rect = svgRef.current?.getBoundingClientRect()
												setHover({
													x: e.clientX - (rect?.left ?? 0),
													y: e.clientY - (rect?.top ?? 0),
													title: `Bin ${b.binId}`,
													lines: [
														`Price ${formatPrice(b.priceUsdcPerSui)}`,
														`Alloc ${formatMoney(b.amount, 4)}`,
													],
												})
											}}
										/>
									))}
								{editable
									? [
											{ edge: 'upper' as const, cy: top },
											{ edge: 'lower' as const, cy: bottom },
										].map((h) => (
									<g key={h.edge}>
										<rect
											x={x0 - 2}
											y={h.cy - 5}
											width={colW + 4}
											height={10}
											rx={3}
											fill={selected ? '#e8eef7' : stroke}
											opacity={selected ? 0.95 : 0.55}
											style={{ cursor: 'ns-resize' }}
											onPointerDown={(e) => {
												e.preventDefault()
												e.stopPropagation()
												onSelectLp(lp.id)
												onRangeDragStart?.()
												;(e.target as Element).setPointerCapture?.(e.pointerId)
												setDrag({ lpId: lp.id, edge: h.edge, pointerId: e.pointerId })
												setDragPrice(
													h.edge === 'lower' ? lp.roundedLowerPrice : lp.roundedUpperPrice,
												)
											}}
										/>
										{drag?.lpId === lp.id && drag.edge === h.edge && dragPrice != null ? (
											<text
												x={x0 + colW / 2}
												y={h.cy - 8}
												textAnchor="middle"
												fill="#e8eef7"
												fontSize={11}
												fontWeight={700}
											>
												{formatPrice(dragPrice)}
											</text>
										) : null}
									</g>
								))
									: null}
							</g>
						)
					})}

					{/* Spot + hard as horizontal lines; labels on the right, staggered if close */}
					<line
						x1={padL}
						x2={width - padR}
						y1={spotY}
						y2={spotY}
						stroke="#0ea5e9"
						strokeWidth={2}
					/>
					{labelsClose ? (
						<line
							x1={width - padR}
							x2={width - padR + 6}
							y1={spotY}
							y2={spotLabelY}
							stroke="#0ea5e9"
							strokeWidth={1}
						/>
					) : null}
					<text x={width - padR + 8} y={spotLabelY} fill="#0ea5e9" fontSize={11} fontWeight={700}>
						Spot {formatPrice(spot)}
					</text>
					<line
						x1={padL}
						x2={width - padR}
						y1={hardY}
						y2={hardY}
						stroke="#e0a854"
						strokeWidth={1.8}
						strokeDasharray="7 5"
					/>
					{labelsClose ? (
						<line
							x1={width - padR}
							x2={width - padR + 6}
							y1={hardY}
							y2={hardLabelY}
							stroke="#e0a854"
							strokeWidth={1}
						/>
					) : null}
					<text x={width - padR + 8} y={hardLabelY} fill="#e0a854" fontSize={11} fontWeight={700}>
						Limit {formatPrice(hardPrice)}
					</text>
				</svg>
			</div>
			{hover && !drag ? (
				<div
					className="chart-tooltip"
					style={{ left: Math.min(hover.x + 12, 520), top: Math.max(8, hover.y - 8) }}
				>
					<strong>{hover.title}</strong>
					{hover.lines.map((line) => (
						<div key={line}>{line}</div>
					))}
				</div>
			) : null}
		</section>
	)
}
