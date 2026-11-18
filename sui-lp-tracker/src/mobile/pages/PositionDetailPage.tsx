import { useState, type ReactNode } from 'react'
import { usePositionDetailData } from '@/components/positions/usePositionDetailData'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'
import { Spinner } from '@/components/ui/Spinner'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'
import { PositionRangeBar } from '@/components/positions/PositionRangeBar'
import { PositionPoolChart } from '@/components/positions/PositionPoolChart'
import { BluefinEventHistoryCards } from '@/components/positions/BluefinEventHistoryCards'
import { CurrentMultiplyDetailSection } from '@/components/positions/CurrentMultiplyDetailSection'
import { isCetusVaultPosition } from '@/utils/cetusVault'
import { isHaedalLendingVaultPosition } from '@/utils/haedalLendingVault'
import { isCurrentMultiplyVaultPosition } from '@/utils/currentMultiplyVault'
import { lpProtocolUsesOnChainHistory } from '@/utils/lpPositionHistoryUi'
import { formatUSDAdaptive } from '@/utils/formatting'
import { totalLifetimeEarningsUsd, claimedEarningsUsd } from '@/utils/positionDerivedMetrics'

const card = 'rounded-2xl border border-slate-800 bg-slate-900/60'

const pct = (v: number | null | undefined, d = 1) =>
	v != null && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(d)}%` : '—'
const tone = (v: number | null | undefined) =>
	v == null || !Number.isFinite(v) ? 'text-slate-400' : v >= 0 ? 'text-emerald-300' : 'text-red-300'
const qty = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 2 : 4 })

function Tile({ label, value, cls = 'text-slate-100' }: { label: string; value: string; cls?: string }) {
	return (
		<div className={`${card} px-3 py-2.5`}>
			<div className="text-[11px] text-slate-400">{label}</div>
			<div className={`mt-0.5 truncate text-lg font-semibold tabular-nums ${cls}`}>{value}</div>
		</div>
	)
}

function Row({ k, v, cls = 'text-slate-100' }: { k: string; v: string; cls?: string }) {
	return (
		<div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
			<span className="text-slate-400">{k}</span>
			<span className={`tabular-nums ${cls}`}>{v}</span>
		</div>
	)
}

function Fold({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
	return (
		<section className={card}>
			<button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between px-3 py-3 text-sm font-medium text-slate-200">
				<span>{title}</span>
				<span className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
			</button>
			{open ? <div className="border-t border-slate-800 p-3">{children}</div> : null}
		</section>
	)
}

export function PositionDetailPage() {
	const d = usePositionDetailData()
	const [chartOpen, setChartOpen] = useState(false)
	const [eventsOpen, setEventsOpen] = useState(false)
	const p = d.position

	const back = (label = 'LP') => {
		d.setActiveTab('lp')
		d.navigate('/home', {
			state: { lpView: d.detailFromClosed ? 'closed' : p && isCetusVaultPosition(p) ? 'vaults' : 'open' },
		})
		void label
	}

	if (!d.isConnected) {
		return <p className="px-4 py-16 text-center text-slate-400">Connect a wallet or paste an address.</p>
	}
	if (d.isLoadingPositions && !p && d.openPositions.length === 0 && d.closedPositions.length === 0) {
		return (
			<div className="flex justify-center py-24">
				<Spinner className="h-8 w-8 text-slate-500" />
			</div>
		)
	}
	if (!p) {
		return (
			<div className="px-4 py-8">
				<p className="text-slate-300">Position not found.</p>
				<button type="button" className="mt-3 text-sky-400" onClick={() => back()}>
					← LP
				</button>
			</div>
		)
	}

	const BackBtn = (
		<button type="button" onClick={() => back()} className="mb-2 text-sm text-sky-400 active:opacity-70">
			← LP
		</button>
	)

	if (isCurrentMultiplyVaultPosition(p)) {
		return (
			<main className="px-3 py-3">
				{BackBtn}
				<CurrentMultiplyDetailSection
					position={p}
					onRefresh={d.walletAddress ? () => void d.loadAll(d.walletAddress!, { forceRefreshPrices: true }) : undefined}
				/>
			</main>
		)
	}

	const lendingVault = isHaedalLendingVaultPosition(p)
	const vault = isCetusVaultPosition(p)
	const closed = d.detailFromClosed || d.settledEmpty
	const vp = d.valueCardPosition ?? p
	const unclaimed = (p.unclaimedFeeUSD || 0) + (p.unclaimedRewardUSD || 0)
	const claimed = claimedEarningsUsd(p)
	const totalEarn = totalLifetimeEarningsUsd(p)
	const apr = vault ? d.vaultAprPct : d.earnAprPct
	const days = Number.isFinite(p.daysOpen) ? `${Math.max(0, Math.round(p.daysOpen))}d` : '—'
	const showPnl = Number.isFinite(p.pnlUSD) && p.depositedUSD > 0
	const liq = d.liquidityLegUsd

	return (
		<main className="space-y-3 px-3 py-3">
			<div>
				{BackBtn}
				<div className="flex items-center gap-3">
					<div className="flex shrink-0 -space-x-1.5">
						<TokenIconOkx coinType={p.tokenAAddress} symbol={p.tokenA} title={p.tokenA} chainIconUrl={p.tokenAIconUrl} />
						{lendingVault ? null : (
							<TokenIconOkx coinType={p.tokenBAddress} symbol={p.tokenB} title={p.tokenB} chainIconUrl={p.tokenBIconUrl} />
						)}
					</div>
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-1.5">
							<span className="text-lg font-semibold text-slate-100">{lendingVault ? p.tokenA : `${p.tokenA}/${p.tokenB}`}</span>
							<span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] tabular-nums text-slate-200">
								{vault ? (p.cetusVault?.feeLabel ?? 'Earn') : `${(p.fee * 100).toFixed(3)}%`}
							</span>
							{d.detailFromClosed ? (
								<span className="rounded-full bg-amber-900/55 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-200">Closed</span>
							) : null}
						</div>
						<div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
							<ProtocolIcon protocol={p.protocol} size={14} />
							<span className="capitalize">{vault ? (p.cetusVault?.provider === 'Haedal' ? 'Haedal Vault' : 'Cetus Vault') : p.protocol.toLowerCase()}</span>
							<span className="text-slate-600">·</span>
							<span className="tabular-nums">{days}</span>
							{p.historyPartial ? <span className="text-amber-400">· partial history</span> : null}
						</div>
					</div>
				</div>
				{vault ? null : (
					<div className="mt-3">
						{d.detailFromClosed && d.closedRec?.tickLower == null ? (
							<p className="text-center text-xs text-slate-500">Range unavailable (NFT burned)</p>
						) : (
							<PositionRangeBar p={p} />
						)}
					</div>
				)}
			</div>

			<div className="grid grid-cols-2 gap-2">
				<Tile label="Value" value={formatUSDAdaptive(d.totalMarkValueUsd)} />
				<Tile label="Unclaimed" value={formatUSDAdaptive(unclaimed)} cls={unclaimed > 0 ? 'text-emerald-300' : 'text-slate-300'} />
				<Tile
					label={showPnl ? `PnL ${p.pnlUSD >= 0 ? '+' : ''}${formatUSDAdaptive(p.pnlUSD)}` : 'PnL'}
					value={showPnl ? pct(p.pnlPct, 1) : '—'}
					cls={showPnl ? tone(p.pnlUSD) : 'text-slate-400'}
				/>
				<Tile label="APR" value={apr != null && Number.isFinite(apr) ? `${apr.toFixed(0)}%` : '—'} />
			</div>

			<section className={`${card} divide-y divide-slate-800/70`}>
				<div className="px-3 py-2 text-[11px] uppercase tracking-wide text-slate-500">{closed ? 'Withdrawn' : 'Liquidity'}</div>
				{[
					{ sym: p.tokenA, amt: vp.tokenAAmount, usd: liq?.currA },
					...(lendingVault ? [] : [{ sym: p.tokenB, amt: vp.tokenBAmount, usd: liq?.currB }]),
				].map((r) => (
					<div key={r.sym} className="flex items-center justify-between px-3 py-2 text-sm">
						<span className="text-slate-200">{r.sym}</span>
						<span className="tabular-nums text-slate-300">
							{qty(r.amt)}
							<span className="ml-2 text-slate-400">{r.usd != null ? formatUSDAdaptive(r.usd) : ''}</span>
						</span>
					</div>
				))}
			</section>

			<section className={`${card} divide-y divide-slate-800/70`}>
				<Row k={closed ? 'Deposited' : 'Net deposit'} v={formatUSDAdaptive(closed ? d.depositsUsd : (d.depositsUsd - d.withdrawsUsd) || p.depositedUSD)} />
				<Row k="Claimed" v={formatUSDAdaptive(claimed)} />
				<Row k="Total earned" v={formatUSDAdaptive(totalEarn)} cls="text-emerald-300" />
				{d.dailyEarningsUsd != null ? <Row k="Per day" v={formatUSDAdaptive(d.dailyEarningsUsd)} /> : null}
				{d.ilPctVsHodl != null ? <Row k="IL vs HODL" v={pct(d.ilPctVsHodl, 2)} cls={tone(d.ilPctVsHodl)} /> : null}
				{d.vsHodlRoiPct != null ? <Row k="vs HODL" v={pct(d.vsHodlRoiPct, 2)} cls={tone(d.vsHodlRoiPct)} /> : null}
			</section>

			{d.detailFromClosed || vault ? null : (
				<Fold title="Pool chart" open={chartOpen} onToggle={() => setChartOpen((v) => !v)}>
					<PositionPoolChart position={p} pairLabel={`${p.tokenA} / ${p.tokenB}`} />
				</Fold>
			)}

			{lpProtocolUsesOnChainHistory(p.protocol) && d.evsVisible.length > 0 ? (
				<Fold title={`Events (${d.evsVisible.length})`} open={eventsOpen} onToggle={() => setEventsOpen((v) => !v)}>
					<BluefinEventHistoryCards position={p} events={d.evsVisible} />
				</Fold>
			) : d.enrichmentPending ? (
				<p className="px-1 text-xs text-slate-500">Scanning history…</p>
			) : null}
		</main>
	)
}
