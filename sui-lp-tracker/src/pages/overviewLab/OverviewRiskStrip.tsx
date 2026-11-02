import { CURRENT_LENDING_HF_THRESHOLDS, healthFactorColorClass } from '@/config/lendingHealthFactorThresholds'
import { formatUSDAdaptive } from '@/utils/formatting'
import { stableLoopColorClass, type OverviewRiskRow } from '@/pages/overviewLab/overviewRisk'

function healthClass(row: OverviewRiskRow): string {
	const hf = row.healthFactor
	if (hf == null) return 'text-slate-400'
	if (hf <= 0) return row.verified ? 'text-red-400' : 'text-slate-400'
	return healthFactorColorClass(hf, CURRENT_LENDING_HF_THRESHOLDS)
}

function priceText(row: OverviewRiskRow, hideAmounts: boolean): string {
	if (hideAmounts) return '••••'
	if (row.suiLiquidationPriceUSD == null) return '—'
	return formatUSDAdaptive(row.suiLiquidationPriceUSD)
}

/** Isolated Current markets with debt, then each Multiplier vault. */
export function OverviewRiskStrip({
	rows,
	hideAmounts,
}: {
	rows: readonly OverviewRiskRow[]
	hideAmounts: boolean
}) {
	if (rows.length === 0) return null
	return (
		<section
			aria-label="Lending risk"
			className="overview-lab__panel overview-lab__panel--quiet px-3 py-2.5"
		>
			<p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">Risk</p>
			<ul className="flex flex-col gap-1.5">
				{rows.map((row) => {
					if (row.stableLoop) {
						const rate =
							row.pegRate != null && Number.isFinite(row.pegRate) ? row.pegRate.toFixed(4) : '—'
						const distance =
							row.pegDistancePct != null && Number.isFinite(row.pegDistancePct)
								? `${row.pegDistancePct.toFixed(1)}% to 0.8825`
								: '—'
						return (
							<li key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
								<span className="font-medium text-slate-200">{row.title}</span>
								<span className={`tabular-nums font-semibold ${stableLoopColorClass(row.pegAlert)}`}>
									USDSUI/USDC {rate}
								</span>
								<span className={`text-xs tabular-nums ${stableLoopColorClass(row.pegAlert)}`}>
									{distance}
								</span>
							</li>
						)
					}
					const hfText =
						row.healthFactor != null && Number.isFinite(row.healthFactor)
							? row.healthFactor.toFixed(2)
							: '—'
					const estimate =
						row.verified
							? null
							: 'Spot estimate: liquidation LTV ÷ current LTV. Not a protocol health factor.'
					return (
						<li key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
							<span className="font-medium text-slate-200">{row.title}</span>
							<span className={`tabular-nums font-semibold ${healthClass(row)}`} title={estimate ?? undefined}>
								HF {hfText}
								{row.verified ? null : (
									<span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-200/90">
										UNVERIFIED
									</span>
								)}
							</span>
							{row.suiCollateral ? (
								<span className="text-xs text-slate-400">
									SUI liq {priceText(row, hideAmounts)}
									{row.verified ? null : (
										<span className="ml-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200/80">
											UNVERIFIED
										</span>
									)}
								</span>
							) : null}
						</li>
					)
				})}
			</ul>
		</section>
	)
}
