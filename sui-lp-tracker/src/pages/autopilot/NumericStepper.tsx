import { useEffect, useRef, useState } from 'react'
import { PARSE_NUMBER_HINT, addScaled, clamp, parseLocaleNumber, roundTo } from './decimal'

type Props = {
	label: string
	value: number
	onChange: (next: number) => void
	step: number
	min?: number
	max?: number
	decimals?: number
	disabled?: boolean
	suffix?: string
	format?: (n: number) => string
}

export function NumericStepper({
	label,
	value,
	onChange,
	step,
	min = Number.NEGATIVE_INFINITY,
	max = Number.POSITIVE_INFINITY,
	decimals = 2,
	disabled,
	suffix,
}: Props) {
	const [draft, setDraft] = useState(() => String(roundTo(value, decimals)))
	const [parseHint, setParseHint] = useState<string | null>(null)
	const holdRef = useRef<number | null>(null)
	const delayRef = useRef<number | null>(null)
	const valueRef = useRef(value)
	valueRef.current = value

	useEffect(() => {
		setDraft(String(roundTo(value, decimals)))
		setParseHint(null)
	}, [value, decimals])

	function commit(raw: string) {
		const trimmed = raw.trim()
		if (!trimmed) {
			const next = clamp(roundTo(0, decimals), min, max)
			onChange(next)
			setDraft(String(next))
			setParseHint(null)
			return
		}
		const parsed = parseLocaleNumber(trimmed)
		if (parsed == null) {
			setDraft(String(roundTo(valueRef.current, decimals)))
			setParseHint(PARSE_NUMBER_HINT)
			return
		}
		setParseHint(null)
		const next = clamp(roundTo(parsed, decimals), min, max)
		onChange(next)
		setDraft(String(next))
	}

	function nudge(dir: 1 | -1) {
		if (disabled) return
		setParseHint(null)
		const next = clamp(addScaled(valueRef.current, dir * step, decimals), min, max)
		onChange(next)
	}

	function startHold(dir: 1 | -1) {
		nudge(dir)
		delayRef.current = window.setTimeout(() => {
			holdRef.current = window.setInterval(() => nudge(dir), 80)
		}, 380)
	}

	function stopHold() {
		if (delayRef.current != null) window.clearTimeout(delayRef.current)
		if (holdRef.current != null) window.clearInterval(holdRef.current)
		delayRef.current = null
		holdRef.current = null
	}

	useEffect(() => () => stopHold(), [])

	return (
		<label className={`field stepper ${disabled ? 'is-disabled' : ''}`}>
			<span className="label-row">{label}</span>
			<div className="stepper-row">
				<button
					type="button"
					className="step-btn"
					aria-label={`${label}: decrease`}
					disabled={disabled || value <= min}
					onPointerDown={(e) => {
						e.preventDefault()
						startHold(-1)
					}}
					onPointerUp={stopHold}
					onPointerLeave={stopHold}
					onPointerCancel={stopHold}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault()
							nudge(-1)
						}
					}}
				>
					−
				</button>
				<input
					value={draft}
					disabled={disabled}
					inputMode="decimal"
					aria-label={label}
					title={PARSE_NUMBER_HINT}
					aria-invalid={parseHint != null}
					onChange={(e) => {
						setDraft(e.target.value)
						setParseHint(null)
					}}
					onBlur={() => commit(draft)}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							e.currentTarget.blur()
						} else if (e.key === 'ArrowUp') {
							e.preventDefault()
							nudge(1)
						} else if (e.key === 'ArrowDown') {
							e.preventDefault()
							nudge(-1)
						}
					}}
				/>
				<button
					type="button"
					className="step-btn"
					aria-label={`${label}: increase`}
					disabled={disabled || value >= max}
					onPointerDown={(e) => {
						e.preventDefault()
						startHold(1)
					}}
					onPointerUp={stopHold}
					onPointerLeave={stopHold}
					onPointerCancel={stopHold}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault()
							nudge(1)
						}
					}}
				>
					+
				</button>
				{suffix ? <span className="step-suffix">{suffix}</span> : null}
			</div>
			{parseHint ? (
				<span className="field-error" role="alert">
					{parseHint}
				</span>
			) : null}
		</label>
	)
}
