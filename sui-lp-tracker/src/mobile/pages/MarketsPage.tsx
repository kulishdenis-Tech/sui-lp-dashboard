import { useMemo, useState } from 'react'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'
import {
	dexMeta,
	feesToTvlPct,
	poolBalances,
	poolTickValue,
	useMarketPools,
} from '@/pages/autopilot/marketsData'
import { filterPoolsForPicker, flags, liquidMedianPrice } from '@/pages/autopilot/marketFlags'
import { RewardIcons } from '@/pages/autopilot/RewardIcons'
import { formatFeePct, formatPct, formatPrice, formatUsdCompact } from '@/pages/autopilot/format'
import { poolFeePercent, type PoolRow, type ProtocolId } from '@/pages/autopilot/types'

type SortKey = 'apr' | 'tvl' | 'feesTvl' | 'vol'

const SORTS: Array<{ key: SortKey; label: string }> = [
	{ key: 'apr', label: 'APR' },
	{ key: 'tvl', label: 'TVL' },
	{ key: 'feesTvl', label: 'Fees/TVL' },
	{ key: 'vol', label: 'Vol 24h' },
]

function num(v: number | null | undefined): number | null {
	return v == null || !Number.isFinite(v) ? null : v
}

function sortValue(p: PoolRow, key: SortKey): number | null {
	if (key === 'apr') return num(p.aprPercent)
	if (key === 'tvl') return num(p.tvlUsd)
	if (key === 'vol') return num(p.volume24hUsd)
	return feesToTvlPct(p)
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0">
			<div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
			<div className="truncate font-mono text-sm text-slate-200">{value}</div>
		</div>
	)
}

function PoolCard({ p, refPrice }: { p: PoolRow; refPrice: number | null }) {
	const protocol: ProtocolId =
		p.protocol === 'dlmm' || p.protocol === 'bluefin' || p.protocol === 'clmm' ? p.protocol : 'clmm'
	const d = dexMeta(protocol)
	const fee = poolFeePercent(p)
	const tick = poolTickValue(p)
	const feesTvl = feesToTvlPct(p)
	const bal = poolBalances(p)
	const notes = flags(p, refPrice)
	const apr = num(p.aprPercent)
	return (
		<li className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3">
			<div className="flex items-center gap-2">
				<ProtocolIcon protocol={d.lpProtocol} size={22} />
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-medium text-slate-100">
						{d.title} · SUI / USDC
					</div>
					<div className="text-xs text-slate-500">
						Fee {fee != null ? formatFeePct(fee) : '—'} · {protocol === 'dlmm' ? 'bin' : 'tick'}{' '}
						{tick != null ? tick : '—'}
					</div>
				</div>
				<div className="text-right">
					<div className="text-[10px] uppercase tracking-wide text-slate-500">APR</div>
					<div className="font-mono text-base font-semibold text-emerald-300">
						{apr == null ? '—' : formatPct(apr, 1)}
					</div>
				</div>
			</div>
			<div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
				<Stat label="TVL" value={formatUsdCompact(p.tvlUsd)} />
				<Stat label="Vol 24h" value={formatUsdCompact(p.volume24hUsd)} />
				<Stat label="Fees 24h" value={formatUsdCompact(p.fees24hUsd)} />
				<Stat label="Price" value={p.priceUsdcPerSui != null ? formatPrice(p.priceUsdcPerSui) : '—'} />
				<Stat label="Fees/TVL" value={feesTvl == null ? '—' : formatPct(feesTvl, 2)} />
				<Stat label="SUI / USDC" value={`${bal.sui} / ${bal.usdc}`} />
			</div>
			{(p.rewarders ?? []).length > 0 || notes.length > 0 ? (
				<div className="mt-2 flex flex-wrap items-center gap-2">
					<RewardIcons rewarders={p.rewarders} showApr />
					{notes.map((n) => (
						<span key={n} className={`status-chip ${n.includes('price') ? 'warn' : ''}`}>
							{n}
						</span>
					))}
				</div>
			) : null}
		</li>
	)
}

/** Mobile Markets: cards instead of the 1100px table. Read-only. */
export function MarketsPage() {
	const { allPools, loading, error } = useMarketPools()
	const [sort, setSort] = useState<SortKey>('apr')
	const [showDust, setShowDust] = useState(false)

	const refPrice = useMemo(() => (allPools.length ? liquidMedianPrice(allPools) : null), [allPools])
	const visible = useMemo(() => filterPoolsForPicker(allPools, showDust), [allPools, showDust])
	const sorted = useMemo(
		() =>
			[...visible].sort((a, b) => {
				const av = sortValue(a, sort)
				const bv = sortValue(b, sort)
				if (av == null && bv == null) return 0
				if (av == null) return 1
				if (bv == null) return -1
				return bv - av
			}),
		[visible, sort],
	)
	const hidden = Math.max(0, allPools.length - visible.length)

	return (
		<div className="px-3 py-4">
			<h2 className="text-lg font-semibold tracking-tight text-slate-100">Markets · SUI/USDC</h2>
			<p className="mt-0.5 text-xs text-slate-500">
				{visible.length} pools{hidden > 0 ? ` · ${hidden} low-liquidity hidden` : ''}
			</p>

			<div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Sort by">
				{SORTS.map((s) => (
					<button
						key={s.key}
						type="button"
						role="tab"
						aria-selected={sort === s.key}
						onClick={() => setSort(s.key)}
						className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${
							sort === s.key
								? 'border-sky-500 bg-sky-500/15 text-sky-200'
								: 'border-slate-700 text-slate-400'
						}`}
					>
						{s.label}
					</button>
				))}
				<label className="ml-auto inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-slate-400">
					<input
						type="checkbox"
						checked={showDust}
						onChange={(e) => setShowDust(e.target.checked)}
						className="rounded border-slate-600"
					/>
					Low-liq
				</label>
			</div>

			{error ? <p className="mt-3 text-sm text-amber-200/90">{error}</p> : null}
			{loading && allPools.length === 0 ? (
				<p className="mt-3 text-sm text-slate-500">Loading pools…</p>
			) : null}
			{sorted.length > 0 ? (
				<ul className="mt-3 space-y-2">
					{sorted.map((p) => (
						<PoolCard key={`${p.protocol}-${p.poolId}`} p={p} refPrice={refPrice} />
					))}
				</ul>
			) : !loading ? (
				<p className="mt-3 text-sm text-slate-500">No pools found.</p>
			) : null}
		</div>
	)
}
