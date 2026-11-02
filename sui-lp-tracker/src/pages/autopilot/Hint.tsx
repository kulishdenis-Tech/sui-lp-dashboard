import { useId, useState, type ReactNode } from 'react'

export function Hint({ label, children }: { label: string; children: ReactNode }) {
	const id = useId()
	const [open, setOpen] = useState(false)

	return (
		<span className="hint">
			<button
				type="button"
				className="hint-btn"
				aria-label={label}
				aria-describedby={open ? id : undefined}
				aria-expanded={open}
				onMouseEnter={() => setOpen(true)}
				onMouseLeave={() => setOpen(false)}
				onFocus={() => setOpen(true)}
				onBlur={() => setOpen(false)}
				onClick={() => setOpen((v) => !v)}
			>
				?
			</button>
			{open ? (
				<span role="tooltip" id={id} className="hint-pop">
					{children}
				</span>
			) : null}
		</span>
	)
}
