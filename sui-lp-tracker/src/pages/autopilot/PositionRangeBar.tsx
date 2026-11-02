import { formatPct, formatPrice } from './format'
import {
	normalizeUsdcPerSuiBounds,
	rangeEdgePercents,
	rangeVisualPercent,
} from './portfolioMetrics'

type Props = {
	lower: number
	upper: number
	current: number | null
	inRange: boolean
	compact?: boolean
}

export function PositionRangeBar({ lower, upper, current, inRange, compact }: Props) {
	const { min, max } = normalizeUsdcPerSuiBounds(lower, upper)
	if (!(min > 0) || !(max > 0)) {
		return <span className="mode">—</span>
	}
	const cur = current != null && current > 0 ? current : null
	const thumb = cur != null ? rangeVisualPercent(min, max, cur) : 50
	const edges = cur != null ? rangeEdgePercents(min, max, cur) : null
	const status = inRange ? 'In range' : 'Out of range'
	const tone = inRange ? 'in' : 'out'

	return (
		<div className={`range-bar range-bar-${tone}${compact ? ' range-bar-compact' : ''}`} title={status}>
			<div className="range-bar-prices">
				<span>{formatPrice(min)}</span>
				<span className={`range-bar-status tag ${inRange ? 'ok' : ''}`}>{status}</span>
				<span>{formatPrice(max)}</span>
			</div>
			<div className="range-bar-track" role="img" aria-label={`${status}: ${formatPrice(min)}–${formatPrice(max)}`}>
				<div className="range-bar-fill" aria-hidden />
				<span className="range-bar-edge" style={{ left: '13%' }} aria-hidden />
				<span className="range-bar-edge" style={{ left: '87%' }} aria-hidden />
				{cur != null ? (
					<span className="range-bar-thumb" style={{ left: `${thumb}%` }} aria-hidden />
				) : null}
			</div>
			{!compact && edges && cur != null ? (
				<div className="range-bar-meta">
					<span>now {formatPrice(cur)}</span>
					<span>
						{formatPct(edges.fromMinPct, 2)} / {formatPct(edges.toMaxPct, 2)}
					</span>
				</div>
			) : null}
		</div>
	)
}
