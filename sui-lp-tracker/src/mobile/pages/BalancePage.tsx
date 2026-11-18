import { useMemo, useState } from 'react'
import { useWalletBalance } from '@/hooks/useWalletBalance'
import { useTokenClassification } from '@/hooks/useTokenClassification'
import type { ClassifiedTokenBalance } from '@/types'
import { HiddenTokensSection } from '@/components/balance/HiddenTokensSection'
import { TokenSpotChart } from '@/components/balance/TokenSpotChart'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'
import { Spinner } from '@/components/ui/Spinner'
import { HIDE_BALANCE_VALUE_BELOW_USD } from '@/utils/constants'
import { formatHoldingUsd, formatUSDAdaptive } from '@/utils/formatting'
import { sortClassifiedBalances, type BalanceSortCol } from '@/utils/sortClassifiedBalances'

const card = 'rounded-2xl border border-slate-800 bg-slate-900/60'

const SORTS: { col: BalanceSortCol; label: string }[] = [
	{ col: 'value', label: 'Value' },
	{ col: 'change24h', label: '24h' },
	{ col: 'token', label: 'A–Z' },
]

function fmtAmount(n: number): string {
	if (!Number.isFinite(n)) return '0'
	if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
	if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 3 })
	if (n >= 0.0001) return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
	return n.toExponential(2)
}

function fmtPrice(n: number | null | undefined): string {
	if (n == null || !Number.isFinite(n)) return '—'
	if (n >= 1) return `$${n.toFixed(2)}`
	if (n >= 0.01) return `$${n.toFixed(4)}`
	return `$${n.toPrecision(3)}`
}

function Change({ pct }: { pct: number | null | undefined }) {
	if (pct == null || !Number.isFinite(pct)) return null
	return (
		<span className={`text-xs tabular-nums ${pct >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
			{pct >= 0 ? '+' : ''}
			{pct.toFixed(1)}%
		</span>
	)
}

function TokenItem({
	t,
	open,
	onToggle,
}: {
	t: ClassifiedTokenBalance
	open: boolean
	onToggle: () => void
}) {
	return (
		<div>
			<button
				type="button"
				onClick={onToggle}
				className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2.5 text-left active:bg-slate-800/70"
			>
				<span className="flex min-w-0 items-center gap-2">
					<TokenIconOkx coinType={t.coinType} symbol={t.symbol} chainIconUrl={t.iconUrl ?? undefined} />
					<span className="truncate text-sm font-medium text-slate-100">{t.symbol}</span>
					<Change pct={t.change24h} />
				</span>
				<span className="text-right text-base font-semibold tabular-nums text-slate-100">
					{formatHoldingUsd(t)}
				</span>
				<span className="text-xs tabular-nums text-slate-400">{fmtAmount(t.humanBalance)}</span>
				<span className="text-right text-xs tabular-nums text-slate-400">{fmtPrice(t.priceUSD)}</span>
			</button>
			{open ? (
				<div className="px-2 pb-2">
					<TokenSpotChart coinType={t.coinType} symbol={t.symbol} />
				</div>
			) : null}
		</div>
	)
}

/** Мобільний Balance: рядок на токен (символ · 24h · вартість · кількість · ціна), тап — графік. */
export function BalancePage() {
	const { tokenBalances, isLoading } = useWalletBalance()
	const { bucket, isClassifying } = useTokenClassification(tokenBalances)
	const [sortCol, setSortCol] = useState<BalanceSortCol>('value')
	const [chartCoin, setChartCoin] = useState<string | null>(null)

	const { shown, micro, hidden } = useMemo(() => {
		if (!bucket) return { shown: [], micro: [], hidden: [] as ClassifiedTokenBalance[] }
		const priced = [...bucket.mainVerified, ...bucket.otherUnverifiedPriced]
		const shown: ClassifiedTokenBalance[] = []
		const micro: ClassifiedTokenBalance[] = []
		for (const t of priced) {
			const v = t.valueUSD
			if (v != null && Number.isFinite(v) && v < HIDE_BALANCE_VALUE_BELOW_USD) micro.push(t)
			else shown.push(t)
		}
		return { shown, micro, hidden: bucket.hidden }
	}, [bucket])

	const sorted = useMemo(
		() => sortClassifiedBalances(shown, sortCol, sortCol === 'token' ? 'asc' : 'desc'),
		[shown, sortCol],
	)
	const total = shown.reduce((s, t) => s + (Number.isFinite(t.valueUSD ?? NaN) ? (t.valueUSD as number) : 0), 0)

	if ((isLoading || isClassifying) && tokenBalances.length === 0) {
		return (
			<div className="flex justify-center py-16">
				<Spinner className="h-6 w-6" />
			</div>
		)
	}
	if (tokenBalances.length === 0) {
		return <p className="px-4 pt-4 text-sm text-slate-500">Токенів не знайдено (або ще не завантажено).</p>
	}

	return (
		<main className="space-y-3 px-4 pb-6 pt-4">
			<div className="flex items-end justify-between px-1">
				<div>
					<p className="text-xs text-slate-400">Wallet</p>
					<p className="text-2xl font-semibold tabular-nums text-slate-50">{formatUSDAdaptive(total)}</p>
				</div>
				<div className="flex gap-1">
					{SORTS.map((s) => (
						<button
							key={s.col}
							type="button"
							onClick={() => setSortCol(s.col)}
							className={`rounded-full px-3 py-1.5 text-xs ${
								sortCol === s.col ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 active:bg-slate-800'
							}`}
						>
							{s.label}
						</button>
					))}
				</div>
			</div>

			{sorted.length > 0 ? (
				<div className={`${card} divide-y divide-slate-800 overflow-hidden`}>
					{sorted.map((t) => (
						<TokenItem
							key={t.coinType}
							t={t}
							open={chartCoin === t.coinType}
							onToggle={() => setChartCoin((c) => (c === t.coinType ? null : t.coinType))}
						/>
					))}
				</div>
			) : (
				<p className="px-1 text-sm text-slate-500">Немає токенів з ціною вище ${HIDE_BALANCE_VALUE_BELOW_USD}.</p>
			)}

			<HiddenTokensSection tokens={hidden} extraTokens={micro} />
		</main>
	)
}
