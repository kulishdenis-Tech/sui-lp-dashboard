import { useEffect, useId, useRef, useState } from 'react'
import { formatPoolDetailsMetrics, formatPoolSelectLabel } from './marketFlags'
import { RewardIcons } from './RewardIcons'
import type { PoolRow } from './types'

export function PoolPicker({
	pools,
	value,
	disabled,
	loading,
	onChange,
	protocol,
}: {
	pools: PoolRow[]
	value: string
	disabled?: boolean
	loading?: boolean
	onChange: (poolId: string) => void
	protocol?: import('./types').ProtocolId
}) {
	const [open, setOpen] = useState(false)
	const [activeIndex, setActiveIndex] = useState(0)
	const rootRef = useRef<HTMLDivElement | null>(null)
	const listId = useId()
	const selected = pools.find((p) => p.poolId === value) ?? null

	useEffect(() => {
		if (!open) return
		function onDoc(e: MouseEvent) {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
		}
		document.addEventListener('mousedown', onDoc)
		return () => document.removeEventListener('mousedown', onDoc)
	}, [open])

	const triggerLabel = loading
		? 'Loading pools…'
		: pools.length === 0
			? 'No pools'
			: selected
				? formatPoolSelectLabel(selected, protocol)
				: 'Select pool'

	function selectAt(index: number) {
		const row = pools[index]
		if (!row) return
		onChange(row.poolId)
		setOpen(false)
	}

	function onTriggerKeyDown(e: React.KeyboardEvent) {
		if (disabled || loading || pools.length === 0) return
		if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			const idx = pools.findIndex((p) => p.poolId === value)
			setActiveIndex(idx >= 0 ? idx : 0)
			setOpen(true)
		}
	}

	function onListKeyDown(e: React.KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault()
			setOpen(false)
			return
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault()
			setActiveIndex((i) => Math.min(pools.length - 1, i + 1))
			return
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault()
			setActiveIndex((i) => Math.max(0, i - 1))
			return
		}
		if (e.key === 'Home') {
			e.preventDefault()
			setActiveIndex(0)
			return
		}
		if (e.key === 'End') {
			e.preventDefault()
			setActiveIndex(Math.max(0, pools.length - 1))
			return
		}
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			selectAt(activeIndex)
		}
	}

	return (
		<div className={`pool-picker ${open ? 'is-open' : ''}`} ref={rootRef}>
			<button
				type="button"
				className="pool-picker-trigger"
				disabled={disabled || loading || pools.length === 0}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={listId}
				onClick={() => {
					const next = !open
					if (next) {
						const idx = pools.findIndex((p) => p.poolId === value)
						setActiveIndex(idx >= 0 ? idx : 0)
					}
					setOpen(next)
				}}
				onKeyDown={onTriggerKeyDown}
			>
				<span className="pool-picker-trigger-main">
					<span className="pool-picker-trigger-text">{triggerLabel}</span>
					{selected && (selected.rewarders?.length ?? 0) > 0 ? (
						<RewardIcons rewarders={selected.rewarders} />
					) : null}
				</span>
				<span className="pool-picker-caret" aria-hidden>
					▾
				</span>
			</button>
			{open ? (
				<ul
					id={listId}
					className="pool-picker-menu"
					role="listbox"
					aria-label="Pools"
					tabIndex={-1}
					onKeyDown={onListKeyDown}
					ref={(el) => {
						el?.focus()
					}}
				>
					{pools.map((p, i) => {
						const active = p.poolId === value
						const focused = i === activeIndex
						const hasRewards = (p.rewarders?.length ?? 0) > 0
						return (
							<li key={p.poolId} role="option" aria-selected={active}>
								<button
									type="button"
									className={`pool-picker-item ${active ? 'is-active' : ''} ${focused ? 'is-focused' : ''}`}
									onMouseEnter={() => setActiveIndex(i)}
									onClick={() => selectAt(i)}
								>
									<span
										className="pool-picker-item-text"
										title={formatPoolDetailsMetrics(p)}
									>
										{formatPoolSelectLabel(p, protocol)}
									</span>
									{hasRewards ? (
										<RewardIcons rewarders={p.rewarders} />
									) : (
										<span className="pool-picker-no-reward" aria-hidden />
									)}
								</button>
							</li>
						)
					})}
				</ul>
			) : null}
		</div>
	)
}
