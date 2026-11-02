import { formatHealthFactor } from '@/config/lendingHealthFactorThresholds'
import {
	lowestCurrentHealthFactor,
	riskRowFigures,
	type OverviewRiskRow,
} from '@/pages/overviewLab/overviewRisk'

export interface RiskSummaryLine {
	supplied: string
	borrowed: string
	vault: string
	lowestText: string | null
}

/** Isolated Current markets with debt, then each Multiplier vault. */
export function OverviewRiskStrip({
	rows,
	suiPriceUsd,
	summary,
}: {
	rows: readonly OverviewRiskRow[]
	suiPriceUsd: number | null
	summary: RiskSummaryLine
}) {
	const lowest = lowestCurrentHealthFactor(rows)
	const lowestText = summary.lowestText ?? (lowest ? `${formatHealthFactor(lowest.hf)} ${lowest.label}` : null)
	return (
		<section aria-label="Lending risk" className="overview-lab__panel overview-lab__panel--quiet px-3 py-2.5">
			<p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">Risk</p>
			{rows.length === 0 ? (
				<p className="text-xs text-slate-500">No open lending positions.</p>
			) : (
				<div className="overview-lab__risk-scroll">
					<table className="overview-lab__risk-table">
						<thead>
							<tr>
								<th>Wallet</th>
								<th>Protocol</th>
								<th>Position</th>
								<th className="num">HF</th>
								<th className="num">SUI liq</th>
								<th className="num" title="SUI drop to liquidation">
									SUI drop to liq
								</th>
								<th>Status</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((row) => {
								const figures = riskRowFigures(row, suiPriceUsd)
								const hfTitle = row.stableLoop
									? 'USDSUI/USDC rate. Warning below 0.97, P0 below 0.93. Not a health factor.'
									: row.verified
										? undefined
										: 'Spot estimate: liquidation LTV ÷ current LTV. Not a protocol health factor.'
								return (
									<tr key={row.id} className={`overview-lab__risk-row overview-lab__risk-row--${figures.tone}`}>
										<td title={row.walletLabel}>{row.walletLabel}</td>
										<td>{row.protocolLabel}</td>
										<td title={row.positionLabel}>{row.positionLabel}</td>
										<td className={`num tabular-nums font-semibold ${figures.primaryClass}`} title={hfTitle}>
											{figures.primaryText}
										</td>
										<td className={`num tabular-nums ${figures.statusClass}`}>{figures.suiLiqText}</td>
										<td className={`num tabular-nums ${figures.statusClass}`}>{figures.toLiqText}</td>
										<td className={figures.statusClass}>{figures.status}</td>
									</tr>
								)
							})}
						</tbody>
					</table>
				</div>
			)}
			<p className="mt-1.5 text-[11px] text-slate-500">
				Supplied <span className="overview-lab__money tabular-nums text-slate-300">{summary.supplied}</span>
				{' · '}
				Borrowed <span className="overview-lab__money tabular-nums text-slate-300">{summary.borrowed}</span>
				{' · '}
				Vault <span className="overview-lab__money tabular-nums text-slate-300">{summary.vault}</span>
				{lowestText ? (
					<>
						{' · '}
						Lowest HF <span className="tabular-nums text-slate-200">{lowestText}</span>
					</>
				) : null}
				<span> (Current lending, all wallets)</span>
			</p>
		</section>
	)
}
