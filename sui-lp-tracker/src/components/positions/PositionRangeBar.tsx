import { useMemo } from 'react'
import {
	clmmRangeFromOpenPosition,
	rangeEdgePctVsCurrent,
	rangePriceToVisualPercent,
} from '@/utils/tickPriceRange'
import type { OpenPosition } from '@/types'
import { Tooltip } from '@/components/ui/Tooltip'
import { rangeBarToneForPosition, type RangeBarTone } from '@/utils/rangeBarTone'

function fmtNum(n: number) {
	if (!Number.isFinite(n) || n <= 0) return '—'
	if (n >= 1) {
		return n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
	}
	if (n >= 0.0001) {
		return n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
	}
	return n.toExponential(2)
}

function fmtSignedPct(x: number) {
	const s = x >= 0 ? '+' : ''
	return `${s}${x.toFixed(2)}%`
}

const fallbackTitle =
	'Price B per A vs range; markers near 13% / 87%; out-of-band squeezed into side bands.'

/** Ті самі градієнти, що й у смузі в комірці — для тултіпу. */
const TRACK_GRADIENT_IN =
	'linear-gradient(90deg, rgba(99,102,241,0.26) 0%, rgba(129,140,248,0.52) 16%, rgba(147,173,246,0.82) 22%, rgba(165,180,252,0.88) 50%, rgba(147,173,246,0.82) 78%, rgba(129,140,248,0.52) 84%, rgba(99,102,241,0.26) 100%)'
const TRACK_GRADIENT_OUT =
	'linear-gradient(90deg, rgba(185,28,28,0.28) 0%, rgba(220,38,38,0.5) 16%, rgba(239,68,68,0.78) 22%, rgba(248,145,154,0.88) 50%, rgba(239,68,68,0.78) 78%, rgba(220,38,38,0.52) 84%, rgba(185,28,28,0.28) 100%)'
const TRACK_GRADIENT_EMPTY =
	'linear-gradient(90deg, rgba(71,85,105,0.35) 0%, rgba(100,116,139,0.55) 16%, rgba(148,163,184,0.72) 22%, rgba(203,213,225,0.78) 50%, rgba(148,163,184,0.72) 78%, rgba(100,116,139,0.55) 84%, rgba(71,85,105,0.35) 100%)'

const toneIn = {
	cssTracks: TRACK_GRADIENT_IN,
	tickCls: 'bg-indigo-400/92 shadow-[0_0_8px_rgb(165,180,252)]',
	thumbRing: 'shadow-[0_0_12px_rgb(165,180,252),0_0_4px_rgb(255,255,255)]',
} as const

const toneOut = {
	cssTracks: TRACK_GRADIENT_OUT,
	tickCls: 'bg-red-400/90 shadow-[0_0_8px_rgb(254,169,173)]',
	thumbRing: 'shadow-[0_0_12px_rgb(248,113,113),0_0_4px_rgb(255,255,255)]',
} as const

const toneEmpty = {
	cssTracks: TRACK_GRADIENT_EMPTY,
	tickCls: 'bg-slate-400/90 shadow-[0_0_8px_rgb(148,163,184)]',
	thumbRing: 'shadow-[0_0_12px_rgb(148,163,184),0_0_4px_rgb(255,255,255)]',
} as const

function rangeBarVisualTone(tone: RangeBarTone) {
	if (tone === 'active') return toneIn
	if (tone === 'empty') return toneEmpty
	return toneOut
}

function rangeBarStatusLabel(tone: RangeBarTone): { label: string; cls: string } {
	if (tone === 'active') return { label: 'In range', cls: 'text-indigo-300' }
	if (tone === 'empty') return { label: 'Empty', cls: 'text-slate-400' }
	return { label: 'Out of range', cls: 'text-red-400' }
}

/**
 * Earn / Haedal vault: no single CLMM tick band — show the same in-range strip
 * with the thumb centered (auto multi-leg always active).
 */
export function VaultAutoRangeBar() {
	const tip = (
		<div className="space-y-1.5 text-[0.72rem] text-slate-100">
			<div className="mb-1 border-b border-slate-700/55 pb-2">
				<p className="text-center text-[11px] font-semibold uppercase tracking-wide text-indigo-300">
					Auto · in range
				</p>
				<p className="mt-0.5 text-center text-[10px] text-slate-500">
					Multi-leg vault — ranges managed automatically
				</p>
			</div>
		</div>
	)
	return (
		<div className="w-full min-w-0 overflow-visible">
			<Tooltip tip={tip} className="relative block w-full">
				<div
					className="cursor-default"
					tabIndex={0}
					role="img"
					aria-label="Vault auto range: always active multi-leg strategy"
				>
					<div className="mx-auto flex w-[90%] justify-center overflow-visible pt-px">
						<div className="relative h-[7px] w-full overflow-visible rounded-full bg-slate-950/98 ring-1 ring-slate-700/45">
							<div
								className="pointer-events-none absolute inset-0 rounded-full opacity-[0.94]"
								style={{ background: toneIn.cssTracks }}
								aria-hidden
							/>
							<div
								className={
									'pointer-events-none absolute top-1/2 z-[1] h-3 w-px -translate-x-1/2 -translate-y-1/2 rounded-full ' +
									toneIn.tickCls
								}
								style={{ left: '13%' }}
								aria-hidden
							/>
							<div
								className={
									'pointer-events-none absolute top-1/2 z-[1] h-3 w-px -translate-x-1/2 -translate-y-1/2 rounded-full ' +
									toneIn.tickCls
								}
								style={{ left: '87%' }}
								aria-hidden
							/>
							<div
								className={
									'pointer-events-none absolute top-1/2 z-[2] h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-2 ring-white/90 ' +
									toneIn.thumbRing
								}
								style={{ left: '50%' }}
								aria-hidden
							/>
						</div>
					</div>
				</div>
			</Tooltip>
		</div>
	)
}

function ClmmPositionRangeBar({ p }: { p: OpenPosition }) {
	const barTone = useMemo(() => rangeBarToneForPosition(p), [p])
	const range = useMemo(
		() =>
			clmmRangeFromOpenPosition({
				tickLower: p.tickLower,
				tickUpper: p.tickUpper,
				currentTick: p.currentTick,
				currentSqrtPrice: p.currentSqrtPrice,
				tokenA: p.tokenA,
				tokenB: p.tokenB,
				tokenADecimals: p.tokenADecimals,
				tokenBDecimals: p.tokenBDecimals,
				status: p.status,
				liquidity: p.liquidity,
				lifecycleStatus: p.lifecycleStatus,
				priceCurrentOverride: p.priceCurrentOverride,
				priceRangeOverride: p.priceRangeOverride,
			}),
		[
			p.tickLower,
			p.tickUpper,
			p.currentTick,
			p.currentSqrtPrice,
			p.tokenA,
			p.tokenB,
			p.tokenADecimals,
			p.tokenBDecimals,
			p.status,
			p.liquidity,
			p.lifecycleStatus,
			p.priceCurrentOverride,
			p.priceRangeOverride,
		],
	)

	const tooltipContent = useMemo(() => {
		if (!range) return null
		const { pctMinVsCurrent, pctMaxVsCurrent } = rangeEdgePctVsCurrent(range)
		const { label: statusLabel, cls: statusCls } = rangeBarStatusLabel(barTone)
		return (
			<div className="space-y-1.5 text-[0.72rem] text-slate-100">
				<div className="mb-1 border-b border-slate-700/55 pb-2">
					<p className={`text-center text-[11px] font-semibold uppercase tracking-wide ${statusCls}`}>
						{statusLabel}
					</p>
					<p className="mt-0.5 text-center text-[10px] text-slate-500">
						price in <span className="text-slate-400">{range.priceLabel}</span>
					</p>
				</div>
				<div>
					<span className="text-slate-400">Current: </span>
					<span className="font-mono tabular-nums text-white">{fmtNum(range.priceCurrent)}</span>
				</div>
				<div>
					<span className="text-slate-400">Min: </span>
					<span className="font-mono tabular-nums font-medium text-white">{fmtNum(range.priceMin)}</span>{' '}
					<span className="font-mono text-slate-400">({fmtSignedPct(pctMinVsCurrent)})</span>
				</div>
				<div>
					<span className="text-slate-400">Max: </span>
					<span className="font-mono tabular-nums font-medium text-white">{fmtNum(range.priceMax)}</span>{' '}
					<span className="font-mono text-slate-400">({fmtSignedPct(pctMaxVsCurrent)})</span>
				</div>
			</div>
		)
	}, [range, barTone])

	if (!range) {
		return (
			<span className="text-slate-500" title={fallbackTitle}>
				—
			</span>
		)
	}

	const thumbLeftPct = rangePriceToVisualPercent(range.priceMin, range.priceMax, range.priceCurrent)
	const tone = rangeBarVisualTone(barTone)
	const ariaStatus =
		barTone === 'active'
			? `In range. Current ${fmtNum(range.priceCurrent)} between min ${fmtNum(range.priceMin)} and max ${fmtNum(range.priceMax)}`
			: barTone === 'empty'
				? `Empty — no liquidity. Current ${fmtNum(range.priceCurrent)}; band ${fmtNum(range.priceMin)}–${fmtNum(range.priceMax)}`
				: `Out of range. Current ${fmtNum(range.priceCurrent)}; band ${fmtNum(range.priceMin)}–${fmtNum(range.priceMax)}`

	return (
		<div className="w-full min-w-0 overflow-visible">
			<Tooltip tip={tooltipContent} className="relative block w-full">
				<div
					className="cursor-default"
					tabIndex={0}
					title=""
					role="img"
					aria-label={ariaStatus}
				>
					<div className="mx-auto flex w-[90%] justify-center overflow-visible pt-px">
						<div className="relative h-[7px] w-full overflow-visible rounded-full bg-slate-950/98 ring-1 ring-slate-700/45">
							<div
								className="pointer-events-none absolute inset-0 rounded-full opacity-[0.94]"
								style={{ background: tone.cssTracks }}
								aria-hidden
							/>
							<div
								className={
									'pointer-events-none absolute top-1/2 z-[1] h-3 w-px -translate-x-1/2 -translate-y-1/2 rounded-full ' +
									tone.tickCls
								}
								style={{ left: '13%' }}
								aria-hidden
							/>
							<div
								className={
									'pointer-events-none absolute top-1/2 z-[1] h-3 w-px -translate-x-1/2 -translate-y-1/2 rounded-full ' +
									tone.tickCls
								}
								style={{ left: '87%' }}
								aria-hidden
							/>
							<div
								className={
									'pointer-events-none absolute top-1/2 z-[2] h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-2 ring-white/90 ' +
									tone.thumbRing
								}
								style={{ left: `${thumbLeftPct}%` }}
								aria-hidden
							/>
						</div>
					</div>
				</div>
			</Tooltip>
		</div>
	)
}

/** CLMM tick range bar; Earn vaults get the auto in-range strip. */
export function PositionRangeBar({ p }: { p: OpenPosition }) {
	if (p.cetusVault != null) return <VaultAutoRangeBar />
	return <ClmmPositionRangeBar p={p} />
}
