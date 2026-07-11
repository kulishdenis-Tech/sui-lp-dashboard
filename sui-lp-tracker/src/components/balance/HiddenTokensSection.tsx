import { useState } from 'react'
import type { ClassifiedTokenBalance } from '@/types'
import { formatUSD } from '@/utils/formatting'
import { SUISCAN_COIN } from '@/utils/constants'
import Decimal from 'decimal.js'
import { HIDE_BALANCE_VALUE_BELOW_USD, MIN_UNVERIFIED_VALUE_USD } from '@/utils/constants'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'

function fmtBal(t: ClassifiedTokenBalance) {
	return new Decimal(t.humanBalance).toFixed(4).replace(/\.?0+$/, '')
}

function hiddenLabel(t: ClassifiedTokenBalance): string {
	if (t.classification.status === 'spam') return 'spam'
	const hasPrice = t.priceUSD != null && Number.isFinite(t.priceUSD)
	if (!hasPrice) return 'No quote (on-chain)'
	const v = t.valueUSD ?? 0
	if (v < MIN_UNVERIFIED_VALUE_USD) return 'dust'
	if (v < HIDE_BALANCE_VALUE_BELOW_USD) return `< $${HIDE_BALANCE_VALUE_BELOW_USD}`
	return '—'
}

type HiddenTokensSectionProps = {
	tokens: ClassifiedTokenBalance[]
	/** Extra rows (e.g. micro balances hidden by filter) */
	extraTokens?: ClassifiedTokenBalance[]
	extraLabel?: string
}

export function HiddenTokensSection({
	tokens,
	extraTokens = [],
	extraLabel,
}: HiddenTokensSectionProps) {
	const [open, setOpen] = useState(false)
	const all = [...tokens, ...extraTokens]
	if (all.length === 0) return null
	return (
		<div className="rounded border border-slate-800 bg-slate-900/50">
			<button
				type="button"
				className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-800/50"
				onClick={() => setOpen((o) => !o)}
			>
				<span>
					{open ? '▼' : '▶'} Hidden tokens ({all.length}): spam, dust, no quote…
				</span>
			</button>
			{open ? (
				<div className="space-y-2 border-t border-slate-800 px-3 py-2 text-xs text-slate-500">
					<p className="text-slate-500">
						Blocklist or spam heuristics; unverified below ${MIN_UNVERIFIED_VALUE_USD}; balances with no
						spot quote (on-chain only). {extraLabel}
					</p>
					<table className="w-full min-w-[400px] border-collapse">
						<thead>
							<tr className="border-b border-slate-800 text-left text-slate-600">
								<th className="py-1 pr-2">Token</th>
								<th className="py-1">Kind</th>
								<th className="py-1 text-right">Balance</th>
								<th className="py-1 text-right">USD</th>
								<th className="max-w-[120px] py-1 pl-1">Note</th>
							</tr>
						</thead>
						<tbody>
							{all.map((t) => (
								<tr key={t.coinType} className="border-b border-slate-800/60">
									<td className="py-1 pr-2 text-slate-300">
										<div className="flex items-center gap-2">
											<TokenIconOkx coinType={t.coinType} symbol={t.symbol} chainIconUrl={t.iconUrl} />
											<a
												href={SUISCAN_COIN(t.coinType)}
												target="_blank"
												rel="noreferrer"
												className="text-sky-400 hover:underline"
											>
												{t.symbol}
											</a>
										</div>
									</td>
									<td className="py-1 text-slate-500">{hiddenLabel(t)}</td>
									<td className="py-1 text-right font-mono text-slate-400">
										{fmtBal(t)} {t.symbol}
									</td>
									<td className="py-1 pl-2 text-right font-mono text-slate-500">
										{formatUSD(t.valueUSD)}
									</td>
									<td
										className="max-w-[140px] truncate py-1 pl-1 text-slate-600"
										title={t.classification.reason}
									>
										{t.classification.reason ?? '—'}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : null}
		</div>
	)
}
