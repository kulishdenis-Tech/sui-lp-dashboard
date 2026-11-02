import { useEffect, useState } from 'react'
import type { PoolBinAnchor } from '@autopilot/engine'
import { shiftPriceByBins, snapPriceToBin } from './binPriceStep'
import { PARSE_NUMBER_HINT, parseLocaleNumber } from './decimal'

export function PriceBinStepper({
	label,
	value,
	onChange,
	pool,
	edge,
	disabled,
	min,
	max,
}: {
	label: string
	value: number
	onChange: (next: number) => void
	pool: PoolBinAnchor
	edge: 'lower' | 'upper'
	disabled?: boolean
	min?: number
	max?: number
}) {
	const [draft, setDraft] = useState(() => (value > 0 ? value.toFixed(6) : ''))
	const [parseHint, setParseHint] = useState<string | null>(null)

	useEffect(() => {
		setDraft(value > 0 ? value.toFixed(6) : '')
		setParseHint(null)
	}, [value])

	function commit(raw: string) {
		const trimmed = raw.trim()
		if (!trimmed) {
			onChange(0)
			setDraft('')
			setParseHint(null)
			return
		}
		const parsed = parseLocaleNumber(trimmed)
		if (parsed == null || !(parsed > 0)) {
			setDraft(value > 0 ? value.toFixed(6) : '')
			setParseHint(parsed == null && trimmed ? PARSE_NUMBER_HINT : null)
			return
		}
		setParseHint(null)
		let next = snapPriceToBin(parsed, pool, edge)
		if (min != null && min > 0) next = Math.max(min, next)
		if (max != null && max > 0) next = Math.min(max, next)
		onChange(next)
	}

	function nudge(dir: 1 | -1) {
		const base = value > 0 ? value : pool.spotUsdcPerSui
		if (!(base > 0)) return
		setParseHint(null)
		let next = shiftPriceByBins(base, dir, pool, edge)
		if (min != null && min > 0) next = Math.max(min, next)
		if (max != null && max > 0) next = Math.min(max, next)
		onChange(next)
	}

	return (
		<label className={`field stepper ${disabled ? 'is-disabled' : ''}`}>
			<span className="label-row">{label}</span>
			<div className="stepper-row">
				<button type="button" className="step-btn" disabled={disabled} aria-label={`${label}: −1 bin`} onClick={() => nudge(-1)}>
					−
				</button>
				<input
					value={draft}
					disabled={disabled}
					inputMode="decimal"
					placeholder="0"
					aria-label={label}
					title={PARSE_NUMBER_HINT}
					aria-invalid={parseHint != null}
					onChange={(e) => {
						setDraft(e.target.value)
						setParseHint(null)
					}}
					onBlur={() => commit(draft)}
					onKeyDown={(e) => {
						if (e.key === 'Enter') e.currentTarget.blur()
						if (e.key === 'ArrowUp') {
							e.preventDefault()
							nudge(1)
						}
						if (e.key === 'ArrowDown') {
							e.preventDefault()
							nudge(-1)
						}
					}}
				/>
				<button type="button" className="step-btn" disabled={disabled} aria-label={`${label}: +1 bin`} onClick={() => nudge(1)}>
					+
				</button>
			</div>
			{parseHint ? (
				<span className="field-error" role="alert">
					{parseHint}
				</span>
			) : null}
		</label>
	)
}
