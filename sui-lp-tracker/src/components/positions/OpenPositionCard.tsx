import type { OpenPosition } from '@/types'
import { AppCard } from '@/components/ui/AppCard'
import { PROTOCOL_COLORS } from '@/utils/constants'
import { formatUSD } from '@/utils/formatting'
import { isBluefinUnclaimedUnavailable } from '@/utils/bluefinUnclaimedUi'
import { positionValueUsd } from '@/utils/positionDerivedMetrics'
import { Badge } from '@/components/ui/Badge'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'

function fmtTokenAmt(n: number) {
	if (!Number.isFinite(n)) return '0'
	if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 3 })
	if (n >= 0.0001) return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
	return n.toExponential(2)
}

export function OpenPositionCard({ p, filter }: { p: OpenPosition; filter: string }) {
	const unclaimedQueryFailed = isBluefinUnclaimedUnavailable(p)
	if (filter !== 'all' && p.protocol !== filter) return null
	const color = PROTOCOL_COLORS[p.protocol] ?? '#94a3b8'
	return (
		<AppCard className="mb-3">
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<ProtocolIcon protocol={p.protocol} size={18} />
					<Badge color={color}>{p.protocol.toUpperCase()}</Badge>
					<span className="font-medium text-slate-200">{p.pair}</span>
				</div>
				<div className="text-right text-sm text-slate-200">
					<div className="text-lg font-mono text-slate-100">{formatUSD(positionValueUsd(p))}</div>
					<div className="text-[10px] uppercase text-slate-500">Value (Liquidity + unclaimed)</div>
				</div>
			</div>
			<div className="mb-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
				<div>
					<div className="text-[10px] uppercase text-slate-500">Pool balance</div>
					<div className="mt-0.5 space-y-0.5 font-mono text-slate-300">
						<div>
							{fmtTokenAmt(p.tokenAAmount)} <span className="text-slate-500">{p.tokenA}</span>
						</div>
						<div>
							{fmtTokenAmt(p.tokenBAmount)} <span className="text-slate-500">{p.tokenB}</span>
						</div>
					</div>
				</div>
				<div>
					<div className="text-[10px] uppercase text-slate-500">Unclaimed (fee + rewards, USD)</div>
					<div className="mt-0.5 space-y-0.5 font-mono text-slate-300">
						{unclaimedQueryFailed ? (
							<div className="text-slate-500" title="devInspect unavailable for this position (see VITE_DEBUG_BLUEFIN=1).">
								—
							</div>
						) : (
							<>
								<div>
									{fmtTokenAmt(p.unclaimedFeeA)} <span className="text-emerald-400/90">{p.tokenA}</span>
								</div>
								<div>
									{fmtTokenAmt(p.unclaimedFeeB)} <span className="text-emerald-400/90">{p.tokenB}</span>
								</div>
								<div className="text-[11px] text-slate-500">
									≈ {formatUSD(p.unclaimedFeeUSD + p.unclaimedRewardUSD)}
								</div>
							</>
						)}
					</div>
				</div>
			</div>
			<div className="border-t border-slate-800 pt-2 text-xs text-slate-500">
				<span>Fee tier {(p.fee * 100).toFixed(2)}%</span>
				<span className="mx-2">·</span>
				<span>Pool {p.poolId.slice(0, 10)}…{p.poolId.slice(-6)}</span>
			</div>
		</AppCard>
	)
}
