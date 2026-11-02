import { clamp, parseLocaleNumber, roundTo } from './decimal'

export function OverlapControl({
	value,
	onChange,
	disabled,
}: {
	value: number
	onChange: (next: number) => void
	disabled?: boolean
}) {
	function set(next: number) {
		onChange(clamp(roundTo(next, 0), 0, 90))
	}

	return (
		<div className={`field overlap-control ${disabled ? 'is-disabled' : ''}`}>
			<span className="label-row">LP overlap</span>
			<div className="stepper-row">
				<button type="button" className="step-btn" disabled={disabled || value <= 0} onClick={() => set(value - 5)}>
					−
				</button>
				<input
					value={String(value)}
					disabled={disabled}
					inputMode="numeric"
					aria-label="Overlap %"
					onChange={(e) => {
						const n = parseLocaleNumber(e.target.value)
						if (n != null) set(n)
					}}
				/>
				<button type="button" className="step-btn" disabled={disabled || value >= 90} onClick={() => set(value + 5)}>
					+
				</button>
				<span className="step-suffix">%</span>
			</div>
			<input
				type="range"
				min={0}
				max={90}
				step={5}
				value={value}
				disabled={disabled}
				aria-label="Overlap slider"
				onChange={(e) => set(Number(e.target.value))}
				className="overlap-slider"
			/>
		</div>
	)
}
