import type { ClassifiedTokenBalance } from '@/types'
import { formatUSD, shortCoinTypePackage } from '@/utils/formatting'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { TokenStatusBadge } from '@/components/balance/TokenStatusBadge'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'
import { SUISCAN_COIN } from '@/utils/constants'
import Decimal from 'decimal.js'
import { useState } from 'react'

const cell =
	'border-b border-slate-800/60 bg-app-bg px-2 py-2 text-sm align-middle leading-tight transition-colors group-hover:bg-app-row-hover'

function CopyCoinTypeButton({ coinType }: { coinType: string }) {
	const [copied, setCopied] = useState(false)
	const copy = async (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		try {
			await navigator.clipboard.writeText(coinType)
			setCopied(true)
			window.setTimeout(() => setCopied(false), 1600)
		} catch {
			/* ignore */
		}
	}
	return (
		<button
			type="button"
			onClick={copy}
			className="ml-0.5 inline-flex shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
			title="Copy full coin type"
			aria-label="Copy coin type"
		>
			{copied ? (
				<span className="text-[10px] leading-none text-emerald-400">✓</span>
			) : (
				<svg
					className="h-3.5 w-3.5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					aria-hidden
				>
					<rect x="9" y="9" width="13" height="13" rx="2" />
					<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
				</svg>
			)}
		</button>
	)
}

function CoinTypeAddressCell({ coinType }: { coinType: string }) {
	const short = shortCoinTypePackage(coinType)
	const url = SUISCAN_COIN(coinType)
	return (
		<div className="flex max-w-[11rem] items-center gap-0.5">
			<a
				href={url}
				target="_blank"
				rel="noreferrer"
				className="min-w-0 truncate font-mono text-xs text-sky-400/90 hover:underline"
				title={coinType}
			>
				{short}
			</a>
			<CopyCoinTypeButton coinType={coinType} />
		</div>
	)
}

function fmtBalance(t: ClassifiedTokenBalance) {
	return new Decimal(t.humanBalance).toFixed(6).replace(/\.?0+$/, '')
}

function fmtUnitPrice(p: number | null) {
	if (p == null || !Number.isFinite(p)) return '—'
	if (p >= 100) return formatUSD(p, 2)
	if (p >= 1) return formatUSD(p, 4)
	if (p >= 0.0001) return formatUSD(p, 6)
	return formatUSD(p, 8)
}

/** 24h change column */
function change24hCell(ch: number | null) {
	if (ch == null || Number.isNaN(ch)) {
		return <span className="text-slate-500">—</span>
	}
	const cl = ch >= 0 ? 'text-emerald-400' : 'text-red-400'
	return (
		<span className={cl}>
			{ch >= 0 ? '+' : ''}
			{ch.toFixed(2)}%
		</span>
	)
}

export function TokenRow({
	t,
	mode,
	showStatus,
}: {
	t: ClassifiedTokenBalance
	mode: 'priced' | 'unpriced'
	showStatus?: boolean
}) {
	/** Symbol + shortened coin type (Suiscan link) and copy button. */
	const tokenAndAddressCell = (
		<td className={`${cell} min-w-0 pr-2`}>
			<div className="flex items-start gap-2">
				<TokenIconOkx
					coinType={t.coinType}
					symbol={t.symbol}
					title={t.name ?? t.symbol}
					chainIconUrl={t.iconUrl}
				/>
				<div className="min-w-0 flex-1">
					<div className="font-medium text-slate-200">
						{t.symbol}
						{showStatus ? <TokenStatusBadge t={t} /> : null}
						{t.scallopDeposit ? (
							<span className="ml-1 inline-flex items-center align-middle">
								<span className="text-[10px] font-medium text-amber-500/90">(s)</span>
								<TooltipIconButton
									tip="Scallop deposit (sToken) — counted in wallet; same funds shown in lending detail."
									aria-label="Scallop sToken deposit"
									className="text-amber-500/90 hover:text-amber-400/90"
								/>
							</span>
						) : null}
					</div>
					<div className="mt-0.5">
						<CoinTypeAddressCell coinType={t.coinType} />
					</div>
				</div>
			</div>
		</td>
	)
	const nameCell = (
		<td className={`${cell} min-w-0 max-w-[16rem]`}>
			<div className="truncate text-slate-300" title={t.name ?? undefined}>
				{t.name?.trim() ? t.name : '—'}
			</div>
		</td>
	)

	if (mode === 'unpriced') {
		return (
			<tr className="group text-sm">
				{tokenAndAddressCell}
				{nameCell}
				<td className={`${cell} whitespace-nowrap text-right font-mono text-slate-500`}>—</td>
				<td className={`${cell} whitespace-nowrap text-right font-mono text-slate-500`}>—</td>
				<td className={`${cell} whitespace-nowrap text-right font-mono text-slate-300`}>{fmtBalance(t)}</td>
				<td className={`${cell} whitespace-nowrap text-right font-mono text-slate-500`}>—</td>
			</tr>
		)
	}

	const ch = t.change24h
	return (
		<tr className="group text-sm">
			{tokenAndAddressCell}
			{nameCell}
			<td className={`${cell} whitespace-nowrap text-right font-mono text-slate-200`}>
				{fmtUnitPrice(t.priceUSD)}
			</td>
			<td className={`${cell} whitespace-nowrap text-right font-mono text-xs`}>
				{change24hCell(ch)}
			</td>
			<td className={`${cell} whitespace-nowrap text-right font-mono text-slate-300`}>{fmtBalance(t)}</td>
			<td className={`${cell} whitespace-nowrap text-right font-mono text-slate-200`}>
				{formatUSD(t.valueUSD)}
			</td>
		</tr>
	)
}
