import { useWalletBalance } from '@/hooks/useWalletBalance'
import { useTokenClassification } from '@/hooks/useTokenClassification'
import { TokenRow } from '@/components/balance/TokenRow'
import { HiddenTokensSection } from '@/components/balance/HiddenTokensSection'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { Tooltip, TooltipIconButton } from '@/components/ui/Tooltip'
import { HIDE_BALANCE_VALUE_BELOW_USD } from '@/utils/constants'
import {
	appTableShell,
	appTableHeadRow,
	appTableHeadLabel,
	appTableHeadLabelSort,
} from '@/design/appPrimitives'
import type { ClassifiedTokenBalance } from '@/types'
import { useCallback, useMemo, useState } from 'react'
import {
	type BalanceSortCol,
	type SortDir,
	nextSort,
	sortClassifiedBalances,
} from '@/utils/sortClassifiedBalances'

const BALANCE_TABLE_COLS = (
	<colgroup>
		<col style={{ width: '18%' }} />
		<col style={{ width: '16%' }} />
		<col style={{ width: '12%' }} />
		<col style={{ width: '8%' }} />
		<col style={{ width: '8%' }} />
		<col style={{ width: '8%' }} />
		<col style={{ width: '14%' }} />
		<col style={{ width: '10%' }} />
	</colgroup>
)

type SortState = { col: BalanceSortCol; dir: SortDir }

function SortableTableHead({
	sort,
	onSort,
}: {
	sort: SortState
	onSort: (c: BalanceSortCol) => void
}) {
	const arrow = (c: BalanceSortCol) =>
		sort.col === c ? (
			<span className="text-sky-400/90" aria-hidden>
				{sort.dir === 'asc' ? '↑' : '↓'}
			</span>
		) : (
			<span className="inline-block w-3" aria-hidden />
		)

	const thClass = 'px-2 py-2 align-middle text-center'
	const headBtn = `${appTableHeadLabelSort} inline-flex items-center justify-center gap-0.5`

	const sortCol = (col: BalanceSortCol, label: string, tip: string) => (
		<th
			scope="col"
			className={thClass}
			aria-sort={
				sort.col === col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
			}
		>
			<div className="flex items-center justify-center">
				<Tooltip tip={tip} className="inline-flex items-center justify-center">
					<button type="button" className={headBtn} onClick={() => onSort(col)}>
						{label}
						{arrow(col)}
					</button>
				</Tooltip>
			</div>
		</th>
	)

	return (
		<thead>
			<tr className={appTableHeadRow}>
				{sortCol(
					'token',
					'Token',
					'Symbol, verification state, and coin type link (Suiscan).',
				)}
				<th scope="col" className={thClass}>
					<div className="flex items-center justify-center">
						<Tooltip
							tip="Display name from coin metadata when available."
							className="inline-flex items-center justify-center"
						>
							<span className={`${appTableHeadLabel} inline-flex items-center justify-center`}>
								Name
							</span>
						</Tooltip>
					</div>
				</th>
				{sortCol(
					'price',
					'Price (USD)',
					'Spot USD price from the app price pipeline (OKX DEX and fallbacks).',
				)}
				{sortCol(
					'change5m',
					'5m',
					'OKX price change over the last 5 minutes. Alert fires above +5%.',
				)}
				{sortCol(
					'change1h',
					'1h',
					'OKX price change over the last hour. Alert fires above +5%.',
				)}
				{sortCol(
					'change24h',
					'24h',
					'Approximate 24h price change (OKX or fallback feeds).',
				)}
				{sortCol('balance', 'Balance', 'On-chain token balance in human-readable units.')}
				{sortCol(
					'value',
					'USD',
					'USD value = balance × spot price (same price as Price column).',
				)}
			</tr>
		</thead>
	)
}

function takeUnderThreshold(
	arr: ClassifiedTokenBalance[],
): { show: ClassifiedTokenBalance[]; micro: ClassifiedTokenBalance[] } {
	const micro: ClassifiedTokenBalance[] = []
	const show: ClassifiedTokenBalance[] = []
	for (const t of arr) {
		const v = t.valueUSD
		if (v != null && Number.isFinite(v) && v < HIDE_BALANCE_VALUE_BELOW_USD) {
			micro.push(t)
		} else {
			show.push(t)
		}
	}
	return { show, micro }
}

export function BalanceDashboard() {
	const { tokenBalances, isLoading } = useWalletBalance()
	const { bucket, isClassifying, classifyError } = useTokenClassification(tokenBalances)
	/** When on, rows with value &lt; $0.1 go to Hidden (see section below) */
	const [hideBelow01, setHideBelow01] = useState(true)
	const [sort, setSort] = useState<SortState>({ col: 'change24h', dir: 'desc' })
	/** Expanded spot chart under a priced token row (click icon / symbol / name). */
	const [chartCoinType, setChartCoinType] = useState<string | null>(null)

	const { pricedShown, extraMicro, hiddenBase } = useMemo(() => {
		if (!bucket) {
			return {
				pricedShown: [] as ClassifiedTokenBalance[],
				extraMicro: [] as ClassifiedTokenBalance[],
				hiddenBase: [] as ClassifiedTokenBalance[],
			}
		}
		const priced = [...bucket.mainVerified, ...bucket.otherUnverifiedPriced]
		if (!hideBelow01) {
			return {
				pricedShown: priced,
				extraMicro: [],
				hiddenBase: bucket.hidden,
			}
		}
		const split = takeUnderThreshold(priced)
		return {
			pricedShown: split.show,
			extraMicro: split.micro,
			hiddenBase: bucket.hidden,
		}
	}, [bucket, hideBelow01])

	const sortedPriced = useMemo(
		() => sortClassifiedBalances(pricedShown, sort.col, sort.dir),
		[pricedShown, sort],
	)

	const onSort = useCallback((c: BalanceSortCol) => {
		setSort((s) => nextSort(s, c))
	}, [])

	const onToggleTokenChart = useCallback((coinType: string) => {
		setChartCoinType((prev) => (prev === coinType ? null : coinType))
	}, [])

	const loadingState = (isLoading || isClassifying) && tokenBalances.length > 0
	const nPriced = pricedShown.length

	return (
		<section>
			<div className="mb-2 flex flex-wrap items-center justify-end gap-3 text-xs text-slate-400">
				<div className="inline-flex items-center">
					<label className="inline-flex cursor-pointer items-center gap-1.5">
						<input
							type="checkbox"
							checked={hideBelow01}
							onChange={(e) => setHideBelow01(e.target.checked)}
							className="rounded border-slate-600"
						/>
						Hide Assets Below ${HIDE_BALANCE_VALUE_BELOW_USD}
					</label>
					<TooltipIconButton
						tip={`Hides token rows with USD value below $${HIDE_BALANCE_VALUE_BELOW_USD} in the tokens table (spam/dust/no-price stay under Hidden). Totals still include visible portfolio policy.`}
						aria-label="About Hide Assets Below threshold"
						className="text-slate-500"
					/>
				</div>
			</div>
			{classifyError ? (
				<p className="mb-2 text-xs text-amber-200/80">
					Classification (Suiet list / blocklist): {classifyError} — showing without allowlist.
				</p>
			) : null}
			{isLoading && tokenBalances.length === 0 ? (
				<SkeletonCard />
			) : tokenBalances.length === 0 ? (
				<p className="text-sm text-slate-500">No token balances (or not loaded).</p>
			) : !bucket ? (
				<SkeletonCard />
			) : (
				<div className="space-y-6 overflow-x-auto">
					{pricedShown.length > 0 ? (
						<div>
							<p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
								Tokens ({pricedShown.length})
							</p>
							<div className={appTableShell}>
								<table className="w-full min-w-[1040px] table-fixed border-collapse text-left">
									{BALANCE_TABLE_COLS}
									<SortableTableHead sort={sort} onSort={onSort} />
									<tbody>
										{sortedPriced.map((t) => (
											<TokenRow
												key={t.coinType}
												t={t}
												mode="priced"
												showStatus
												chartOpen={chartCoinType === t.coinType}
												onToggleChart={() => onToggleTokenChart(t.coinType)}
											/>
										))}
									</tbody>
								</table>
							</div>
						</div>
					) : null}
					<HiddenTokensSection
						tokens={hiddenBase}
						extraTokens={extraMicro}
						extraLabel={
							hideBelow01
								? ` Positions with USD value &lt; $${HIDE_BALANCE_VALUE_BELOW_USD} are listed below.`
								: ''
						}
					/>
					{bucket && nPriced === 0 && tokenBalances.length > 0 && !loadingState ? (
						<p className="text-sm text-amber-200/90">
							{hideBelow01
								? 'All rows are below $0.10 or in Hidden — turn off Hide Assets Below $0.10 to show small balances in the table.'
								: 'No priced rows — check Hidden.'}
						</p>
					) : null}
				</div>
			)}
		</section>
	)
}
