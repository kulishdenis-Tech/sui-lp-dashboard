import { useMemo } from 'react'
import type { OpenPosition } from '@/types'
import { PositionRangeBar } from '@/components/positions/PositionRangeBar'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'

type Props = {
	positions: OpenPosition[]
	protocolFilter: string
}

export function EmptyLpPositionsSection({ positions, protocolFilter }: Props) {
	const filtered = useMemo(
		() =>
			positions.filter((p) => protocolFilter === 'all' || p.protocol === protocolFilter),
		[positions, protocolFilter],
	)

	if (filtered.length === 0) return null

	return (
		<details className="mt-8 rounded-lg border border-slate-700/60 bg-slate-900/40">
			<summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-slate-300 hover:text-slate-100">
				Без ліквідності ({filtered.length})
			</summary>
			<div className="overflow-x-auto border-t border-slate-700/50 px-2 pb-3 pt-2">
				<table className="min-w-full text-sm">
					<thead>
						<tr className="text-left text-xs uppercase tracking-wide text-slate-500">
							<th className="px-2 py-2">Pool</th>
							<th className="px-2 py-2">Price range</th>
							<th className="px-2 py-2">Range</th>
						</tr>
					</thead>
					<tbody>
						{filtered.map((p) => (
							<tr key={p.id} className="border-t border-slate-800/80 text-slate-300">
								<td className="px-2 py-2">
									<span className="inline-flex items-center gap-2">
										<ProtocolIcon protocol={p.protocol} size={16} />
										<span>{p.pair}</span>
									</span>
								</td>
								<td className="px-2 py-2">
									<PositionRangeBar p={p} />
								</td>
								<td className="px-2 py-2 text-slate-400">
									{p.status === 'in_range' ? 'In range' : 'Out of range'}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</details>
	)
}
