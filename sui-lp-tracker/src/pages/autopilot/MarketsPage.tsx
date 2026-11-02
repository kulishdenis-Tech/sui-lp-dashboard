import { useCallback, useEffect, useMemo, useState } from 'react'
import {
	formatFeePct,
	formatPct,
	formatPrice,
	formatRawBalance,
	formatUsdCompact,
	SUI_DECIMALS,
	USDC_DECIMALS,
} from './format'
import { poolFeePercent, priceRisesWithBinId, type PoolRow, type ProtocolId } from './types'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'
import { filterPoolsForPicker, flags, liquidMedianPrice } from './marketFlags'
import { RewardIcons } from './RewardIcons'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import {
	appTableHeadCellDefault,
	appTableHeadCellInner,
	appTableHeadLabel,
	appTableHeadLabelSort,
	appTableHeadRow,
	appTableShell,
} from '@/design/appPrimitives'

function poolBalances(p: PoolRow): { sui: string; usdc: string } {
	const aIsSui = priceRisesWithBinId(p.coinTypeA)
	return {
		sui: formatRawBalance(aIsSui ? p.balanceA : p.balanceB, SUI_DECIMALS, 2),
		usdc: formatRawBalance(aIsSui ? p.balanceB : p.balanceA, USDC_DECIMALS, 2),
	}
}

/** Same brand icons as LP table (`PROTOCOL_BRAND_ICON_URL` / ProtocolIcon). */
function dexMeta(protocol: ProtocolId): {
	lpProtocol: 'cetus' | 'bluefin'
	amm: 'CLMM' | 'DLMM'
	title: string
} {
	if (protocol === 'dlmm') return { lpProtocol: 'cetus', amm: 'DLMM', title: 'Cetus DLMM' }
	if (protocol === 'bluefin') return { lpProtocol: 'bluefin', amm: 'CLMM', title: 'Bluefin Spot' }
	return { lpProtocol: 'cetus', amm: 'CLMM', title: 'Cetus CLMM' }
}

function DexCell({ protocol }: { protocol: ProtocolId }) {
	const d = dexMeta(protocol)
	return (
		<span className="inline-flex items-center gap-2 whitespace-nowrap" title={d.title}>
			<ProtocolIcon protocol={d.lpProtocol} size={20} />
			<span className="text-xs font-medium tracking-wide text-slate-300">{d.amm}</span>
		</span>
	)
}

/** Module cache — survives StrictMode remount; avoids blank "Loading…" forever. */
type MarketsCache = {
	clmm: PoolRow[]
	dlmm: PoolRow[]
	bluefin: PoolRow[]
	atMs: number
}
let marketsCache: MarketsCache | null = null
let marketsInflight: Promise<void> | null = null

const CACHE_TTL_MS = 60_000

function patchMarketsCache( partial: Partial<Omit<MarketsCache, 'atMs'>>): void {
	marketsCache = {
		clmm: marketsCache?.clmm ?? [],
		dlmm: marketsCache?.dlmm ?? [],
		bluefin: marketsCache?.bluefin ?? [],
		...partial,
		atMs: Date.now(),
	}
}

async function fetchProtocolPools(protocol: ProtocolId): Promise<PoolRow[]> {
	const r = await fetch(`/api/autopilot/market?protocol=${protocol}`)
	const j = (await r.json()) as { pools?: PoolRow[]; error?: string }
	if (!r.ok) throw new Error(j.error ?? `market ${protocol} failed`)
	return Array.isArray(j.pools) ? j.pools : []
}

/** Shared fetch — progressive; writes module cache even if a subscriber unmounted. */
function ensureMarketsLoaded(
	onPatch: (c: MarketsCache) => void,
	onError: (msg: string) => void,
): Promise<void> {
	const fresh = marketsCache && Date.now() - marketsCache.atMs < CACHE_TTL_MS
	if (fresh && marketsCache) {
		onPatch(marketsCache)
		return Promise.resolve()
	}
	if (marketsInflight) {
		return marketsInflight.then(() => {
			if (marketsCache) onPatch(marketsCache)
		})
	}
	marketsInflight = (async () => {
		const errors: string[] = []
		await Promise.all(
			(['clmm', 'dlmm', 'bluefin'] as const).map(async (protocol) => {
				try {
					const rows = await fetchProtocolPools(protocol)
					patchMarketsCache({ [protocol]: rows })
					if (marketsCache) onPatch({ ...marketsCache })
				} catch (e) {
					errors.push(e instanceof Error ? e.message : String(e))
				}
			}),
		)
		if (errors.length && !marketsCache?.clmm.length && !marketsCache?.dlmm.length && !marketsCache?.bluefin.length) {
			onError(errors.join(' · '))
		}
	})().finally(() => {
		marketsInflight = null
	})
	return marketsInflight
}

export function MarketsPage({
	marketPriceUsdcPerSui,
}: {
	pools?: PoolRow[] | null
	loading?: boolean
	error?: string | null
	marketPriceUsdcPerSui?: number | null
	/** Kept for callers; header SUI price replaces on-page Anchor display. */
	marketPriceSource?: string | null
}) {
	const [clmmPools, setClmmPools] = useState<PoolRow[] | null>(() => marketsCache?.clmm ?? null)
	const [dlmmPools, setDlmmPools] = useState<PoolRow[] | null>(() => marketsCache?.dlmm ?? null)
	const [bluefinPools, setBluefinPools] = useState<PoolRow[] | null>(
		() => marketsCache?.bluefin ?? null,
	)
	const [loading, setLoading] = useState(() => {
		const fresh = marketsCache && Date.now() - marketsCache.atMs < CACHE_TTL_MS
		return !fresh
	})
	const [error, setError] = useState<string | null>(null)
	const [showDust, setShowDust] = useState(false)

	useEffect(() => {
		let cancelled = false
		const apply = (c: MarketsCache) => {
			if (cancelled) return
			setClmmPools(c.clmm)
			setDlmmPools(c.dlmm)
			setBluefinPools(c.bluefin)
			setError(null)
		}
		setLoading(!(marketsCache && Date.now() - marketsCache.atMs < CACHE_TTL_MS))
		void ensureMarketsLoaded(apply, (msg) => {
			if (!cancelled) setError(msg)
		}).finally(() => {
			if (!cancelled) setLoading(false)
		})
		return () => {
			cancelled = true
		}
	}, [])

	const allPools = useMemo(() => {
		const rows: PoolRow[] = []
		for (const p of clmmPools ?? []) rows.push({ ...p, protocol: p.protocol ?? 'clmm' })
		for (const p of dlmmPools ?? []) rows.push({ ...p, protocol: p.protocol ?? 'dlmm' })
		for (const p of bluefinPools ?? []) rows.push({ ...p, protocol: p.protocol ?? 'bluefin' })
		rows.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))
		return rows
	}, [clmmPools, dlmmPools, bluefinPools])

	const ref =
		marketPriceUsdcPerSui != null && marketPriceUsdcPerSui > 0
			? marketPriceUsdcPerSui
			: allPools.length
				? liquidMedianPrice(allPools)
				: null

	const visiblePools = useMemo(
		() => filterPoolsForPicker(allPools, showDust),
		[allPools, showDust],
	)
	const dustHidden = Math.max(0, allPools.length - visiblePools.length)

	return (
		<section>
			<div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
				<h2 className="text-lg font-semibold tracking-tight text-slate-100">
					Markets · SUI/USDC pools
				</h2>
				<div className="flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-2">
					{visiblePools.length > 0 || dustHidden > 0 ? (
						<p className="text-xs font-medium uppercase tracking-wider text-slate-500">
							Pools ({visiblePools.length})
							{dustHidden > 0 ? ` · ${dustHidden} low-liquidity hidden` : ''}
						</p>
					) : null}
					<label className="inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap text-xs text-slate-400">
						<span>Show Low-Liquidity Pools</span>
						<input
							type="checkbox"
							checked={showDust}
							onChange={(e) => setShowDust(e.target.checked)}
							className="rounded border-slate-600"
						/>
					</label>
				</div>
			</div>

			{error ? <p className="mb-2 text-sm text-amber-200/90">{error}</p> : null}
			{loading && allPools.length === 0 ? (
				<p className="text-sm text-slate-500">Loading pools…</p>
			) : null}

			{visiblePools.length > 0 ? (
				<div className="space-y-2 overflow-x-auto">
					<PoolTable pools={visiblePools} refPrice={ref} />
				</div>
			) : !loading ? (
				<p className="text-sm text-slate-500">No pools found.</p>
			) : null}
		</section>
	)
}

type MarketsSortKey =
	| 'fee'
	| 'tick'
	| 'price'
	| 'tvl'
	| 'vol'
	| 'fees'
	| 'feesTvl'
	| 'apr'
type SortDir = 'asc' | 'desc'
type MarketsSortState = { col: MarketsSortKey; dir: SortDir }

const marketsTd =
	'bg-app-bg px-2 py-2 text-sm align-middle transition-colors group-hover:bg-app-row-hover'
const marketsTdNum = `${marketsTd} whitespace-nowrap text-right font-mono text-slate-200`

function feesToTvlPct(p: PoolRow): number | null {
	const tvl = p.tvlUsd
	const fees = p.fees24hUsd
	if (tvl == null || fees == null || !Number.isFinite(tvl) || !Number.isFinite(fees) || tvl <= 0) {
		return null
	}
	return (fees / tvl) * 100
}

function poolTickValue(p: PoolRow): number | null {
	const protocol = p.protocol
	const v = protocol === 'dlmm' ? p.binStep : p.tickSpacing
	return v == null || !Number.isFinite(v) ? null : v
}

function sortValue(p: PoolRow, key: MarketsSortKey): number | null {
	const v =
		key === 'fee'
			? poolFeePercent(p)
			: key === 'tick'
				? poolTickValue(p)
				: key === 'price'
					? p.priceUsdcPerSui
					: key === 'tvl'
						? p.tvlUsd
						: key === 'vol'
							? p.volume24hUsd
							: key === 'fees'
								? p.fees24hUsd
								: key === 'feesTvl'
									? feesToTvlPct(p)
									: p.aprPercent
	return v == null || !Number.isFinite(v) ? null : v
}

function defaultDirForCol(_col: MarketsSortKey): SortDir {
	return 'desc'
}

function nextMarketsSort(current: MarketsSortState, clicked: MarketsSortKey): MarketsSortState {
	if (current.col !== clicked) return { col: clicked, dir: defaultDirForCol(clicked) }
	return { col: clicked, dir: current.dir === 'asc' ? 'desc' : 'asc' }
}

// Markets uses px-2 on both sides to match its body cells (which also use px-2).
// appTableHeadCellDefault (pr-1.5 only) is correct for sticky/LP tables; Markets has
// no sticky column so we keep symmetric horizontal padding here.
const marketsThText = `${appTableHeadCellDefault} pl-2 text-left`
const marketsThNum = `${appTableHeadCellDefault} pl-2 text-right`

function MarketsSortHead({
	sort,
	onSort,
}: {
	sort: MarketsSortState
	onSort: (c: MarketsSortKey) => void
}) {
	const arrow = (c: MarketsSortKey) =>
		sort.col === c ? (
			<span className="inline-block w-3 text-sky-400/90" aria-hidden>
				{sort.dir === 'asc' ? '↑' : '↓'}
			</span>
		) : (
			<span className="inline-block w-3" aria-hidden />
		)

	const textCol = (label: string, tip?: string, aria?: string) => (
		<th scope="col" className={marketsThText}>
			<div className="flex w-full justify-start">
				<span className={appTableHeadCellInner}>
					<span className={appTableHeadLabel}>{label}</span>
					{tip && aria ? <TooltipIconButton tip={tip} aria-label={aria} /> : null}
				</span>
			</div>
		</th>
	)

	const numCol = (col: MarketsSortKey, label: string, tip: string, aria: string) => (
		<th
			scope="col"
			className={marketsThNum}
			aria-sort={
				sort.col === col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
			}
		>
			<div className="flex w-full justify-end">
				<span className={appTableHeadCellInner}>
					<button type="button" className={appTableHeadLabelSort} onClick={() => onSort(col)}>
						{label}
						{arrow(col)}
					</button>
					<TooltipIconButton tip={tip} aria-label={aria} />
				</span>
			</div>
		</th>
	)

	return (
		<thead>
			<tr className={appTableHeadRow}>
				{textCol('DEX')}
				{textCol('Pool')}
				{numCol('fee', 'Fee', 'Pool swap fee tier.', 'About Fee column')}
				{numCol(
					'tick',
					'Tick',
					'CLMM / Bluefin tick spacing, or DLMM bin step.',
					'About Tick column',
				)}
				{numCol('price', 'Price', 'Pool mid price in USDC per SUI.', 'About Price column')}
				{numCol(
					'tvl',
					'TVL',
					'Total value locked (USD). Hover cell for SUI / USDC balances.',
					'About TVL column',
				)}
				{numCol('vol', 'Vol 24h', '24h trading volume (USD).', 'About Vol 24h column')}
				{numCol(
					'fees',
					'Fees 24h',
					'Estimated fees earned by the pool in 24h (USD).',
					'About Fees 24h column',
				)}
				{numCol('feesTvl', 'Fees/TVL', 'Fees 24h ÷ TVL.', 'About Fees/TVL column')}
				{textCol(
					'Rewards',
					'Incentive reward tokens and estimated reward APR when available.',
					'About Rewards column',
				)}
				{numCol(
					'apr',
					'APR',
					'Combined fee + reward APR. CLMM from Cetus stats; DLMM = volume×fee + on-chain reward emissions.',
					'About APR column',
				)}
				{textCol('Status')}
			</tr>
		</thead>
	)
}

function PoolTable({ pools, refPrice }: { pools: PoolRow[]; refPrice: number | null }) {
	const [sort, setSort] = useState<MarketsSortState>({ col: 'tvl', dir: 'desc' })
	const onSort = useCallback((c: MarketsSortKey) => {
		setSort((s) => nextMarketsSort(s, c))
	}, [])

	const sorted = useMemo(() => {
		const dir = sort.dir === 'asc' ? 1 : -1
		return [...pools].sort((a, b) => {
			const av = sortValue(a, sort.col)
			const bv = sortValue(b, sort.col)
			if (av == null && bv == null) return 0
			if (av == null) return 1
			if (bv == null) return -1
			if (av === bv) return (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0)
			return (av - bv) * dir
		})
	}, [pools, sort])

	return (
		<div className={`${appTableShell} markets-balance-table`}>
			<table className="w-full min-w-[1100px] table-fixed border-collapse text-left">
				<MarketsSortHead sort={sort} onSort={onSort} />
				<tbody>
					{sorted.map((p) => {
						const protocol: ProtocolId =
							p.protocol === 'dlmm' || p.protocol === 'bluefin' || p.protocol === 'clmm'
								? p.protocol
								: 'clmm'
						const bal = poolBalances(p)
						const fee = poolFeePercent(p)
						const note = flags(p, refPrice)
						const rewarders = p.rewarders ?? []
						const tick = poolTickValue(p)
						const tvlTip = `SUI ${bal.sui}\nUSDC ${bal.usdc}`
						const feesTvl = feesToTvlPct(p)
						return (
							<tr key={`${protocol}-${p.poolId}`} className="group border-b border-slate-800/80 text-sm">
								<td className={`${marketsTd} pr-2`}>
									<DexCell protocol={protocol} />
								</td>
								<td className={`${marketsTd} px-2`} title={p.poolId}>
									<span className="font-medium text-slate-100">SUI / USDC</span>
								</td>
								<td className={marketsTdNum}>{fee != null ? formatFeePct(fee) : '—'}</td>
								<td
									className={marketsTdNum}
									title={protocol === 'dlmm' ? 'bin step' : 'tick spacing'}
								>
									{tick != null ? String(tick) : '—'}
								</td>
								<td className={marketsTdNum}>{formatPrice(p.priceUsdcPerSui)}</td>
								<td className={marketsTdNum} title={tvlTip}>
									{formatUsdCompact(p.tvlUsd)}
								</td>
								<td className={marketsTdNum}>{formatUsdCompact(p.volume24hUsd)}</td>
								<td className={marketsTdNum}>{formatUsdCompact(p.fees24hUsd)}</td>
								<td className={marketsTdNum} title="Fees 24h ÷ TVL">
									{feesTvl == null ? '—' : formatPct(feesTvl, 2)}
								</td>
								<td className={`${marketsTd} px-2`}>
									<RewardIcons
										rewarders={rewarders}
										showApr
										empty={<span className="text-slate-500">—</span>}
									/>
								</td>
								<td className={marketsTdNum}>
									{p.aprPercent == null || !Number.isFinite(p.aprPercent)
										? '—'
										: formatPct(p.aprPercent, 2)}
								</td>
								<td className={`${marketsTd} px-2`}>
									{note.length ? (
										<span className="flex flex-wrap gap-1">
											{note.map((n) => (
												<span
													key={n}
													className={`status-chip ${n.includes('price') ? 'warn' : ''}`}
												>
													{n}
												</span>
											))}
										</span>
									) : (
										<span className="text-slate-500">—</span>
									)}
								</td>
							</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}

// Re-exported for existing imports. Fast Refresh wants component-only modules.
// eslint-disable-next-line react-refresh/only-export-components
export { flags, liquidMedianPrice } from './marketFlags'
