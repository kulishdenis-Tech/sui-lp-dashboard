import { useWalletBalance } from '@/hooks/useWalletBalance'
import { useTokenClassification } from '@/hooks/useTokenClassification'
import { TokenRow } from '@/components/balance/TokenRow'
import { HiddenTokensSection } from '@/components/balance/HiddenTokensSection'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { HIDE_BALANCE_VALUE_BELOW_USD } from '@/utils/constants'
import { appTableShell } from '@/design/appPrimitives'
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
		<col style={{ width: '22%' }} />
		<col style={{ width: '20%' }} />
		<col style={{ width: '13%' }} />
		<col style={{ width: '9%' }} />
		<col style={{ width: '15%' }} />
		<col style={{ width: '11%' }} />
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
		) : null

	const thBtn =
		'min-w-0 text-left font-normal normal-case tracking-normal text-slate-500 hover:text-slate-300'
	const thNum =
		'min-w-0 text-right font-normal normal-case tracking-normal text-slate-500 hover:text-slate-300'

	return (
		<thead>
			<tr className="border-b border-slate-700 text-xs text-slate-500">
				<th
					scope="col"
					className="py-2 pr-3 text-left"
					aria-sort={
						sort.col === 'token'
							? sort.dir === 'asc'
								? 'ascending'
								: 'descending'
							: undefined
					}
				>
					<div className="flex justify-start">
						<span className="inline-flex items-start">
							<button type="button" className={thBtn} onClick={() => onSort('token')}>
								Token <span className="inline-block w-3">{arrow('token')}</span>
							</button>
							<TooltipIconButton
								tip="Symbol, verification state, and coin type link (Suiscan)."
								aria-label="About Token column"
								className="translate-y-px"
							/>
						</span>
					</div>
				</th>
				<th scope="col" className="px-2 py-2 text-left">
					<span className="inline-flex items-center text-slate-500">
						<span>Name</span>
						<TooltipIconButton
							tip="Display name from coin metadata when available."
							aria-label="About Name column"
						/>
					</span>
				</th>
				<th
					scope="col"
					className="px-2 py-2 text-right"
					aria-sort={
						sort.col === 'price'
							? sort.dir === 'asc'
								? 'ascending'
								: 'descending'
							: undefined
					}
				>
					<div className="flex justify-end">
						<span className="inline-flex items-start">
							<button type="button" className={thNum} onClick={() => onSort('price')}>
								Price (USD) <span className="inline-block w-3">{arrow('price')}</span>
							</button>
							<TooltipIconButton
								tip="Spot USD price from the app price pipeline (OKX DEX and fallbacks)."
								aria-label="About Price column"
								className="translate-y-px"
							/>
						</span>
					</div>
				</th>
				<th
					scope="col"
					className="px-2 py-2 text-right"
					aria-sort={
						sort.col === 'change24h'
							? sort.dir === 'asc'
								? 'ascending'
								: 'descending'
							: undefined
					}
				>
					<div className="flex justify-end">
						<span className="inline-flex items-start">
							<button type="button" className={thNum} onClick={() => onSort('change24h')}>
								24h <span className="inline-block w-3">{arrow('change24h')}</span>
							</button>
							<TooltipIconButton
								tip="Approximate 24h price change where the feed provides it."
								aria-label="About 24h column"
								className="translate-y-px"
							/>
						</span>
					</div>
				</th>
				<th
					scope="col"
					className="px-2 py-2 text-right"
					aria-sort={
						sort.col === 'balance'
							? sort.dir === 'asc'
								? 'ascending'
								: 'descending'
							: undefined
					}
				>
					<div className="flex justify-end">
						<span className="inline-flex items-start">
							<button type="button" className={thNum} onClick={() => onSort('balance')}>
								Balance <span className="inline-block w-3">{arrow('balance')}</span>
							</button>
							<TooltipIconButton
								tip="On-chain token balance in human-readable units."
								aria-label="About Balance column"
								className="translate-y-px"
							/>
						</span>
					</div>
				</th>
				<th
					scope="col"
					className="pl-2 py-2 text-right"
					aria-sort={
						sort.col === 'value'
							? sort.dir === 'asc'
								? 'ascending'
								: 'descending'
							: undefined
					}
				>
					<div className="flex justify-end">
						<span className="inline-flex items-start">
							<button type="button" className={thNum} onClick={() => onSort('value')}>
								USD <span className="inline-block w-3">{arrow('value')}</span>
							</button>
							<TooltipIconButton
								tip="USD value = balance × spot price (same price as Price column)."
								aria-label="About USD column"
								className="translate-y-px"
							/>
						</span>
					</div>
				</th>
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
						Hide Low Asset
					</label>
					<TooltipIconButton
						tip={`Hides token rows with USD value below $${HIDE_BALANCE_VALUE_BELOW_USD} in the tokens table (they stay in Hidden).`}
						aria-label="About Hide Low Asset"
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
								<table className="w-full min-w-[880px] table-fixed border-collapse text-left">
									{BALANCE_TABLE_COLS}
									<SortableTableHead sort={sort} onSort={onSort} />
									<tbody>
										{sortedPriced.map((t) => (
											<TokenRow key={t.coinType} t={t} mode="priced" showStatus />
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
								? 'All rows are &lt; $0.1 or in Hidden — turn off Hide Low Asset to show small balances in the table.'
								: 'No priced rows — check Hidden.'}
						</p>
					) : null}
				</div>
			)}
		</section>
	)
}
