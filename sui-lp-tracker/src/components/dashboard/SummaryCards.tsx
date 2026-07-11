import { useAppStore } from '@/store/appStore'
import { formatUSD } from '@/utils/formatting'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { AppCard } from '@/components/ui/AppCard'

/** Matches `computeNetWorth` (`totalNetUSD`). */
const TOTAL_VALUE_TOOLTIP =
	'Sum of Wallet balance, open LP and net balance of Credit/Borrow.'

const WALLET_TOOLTIP = 'Sum of priced wallet tokens on-chain. Includes Scallop sCoins / deposits counted in wallet.'
const LP_POSITIONS_TOOLTIP =
	'Sum of all open LP position values (liquidity + unclaimed fees and rewards at spot).'
const NET_LENDING_TOOLTIP = 'Net lending position: total supplied collateral minus total borrowed (AlphaLend / Bluefin Lend).'

export function SummaryCards() {
	const netWorth = useAppStore((s) => s.netWorth)
	const openN = useAppStore((s) => s.openPositions.length)
	const isRefreshing = useAppStore(
		(s) => s.isLoadingBalances || s.isLoadingPositions || s.isLoadingLending,
	)
	if (!netWorth) {
		return (
			<div
				className={
					'mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4' +
					(isRefreshing ? ' opacity-80 transition-opacity' : '')
				}
			>
				<Card label="Wallet Balance" value="—" tooltip={WALLET_TOOLTIP} />
				<Card
					label={`Liquidity Positions (${openN})`}
					value="—"
					tooltip={LP_POSITIONS_TOOLTIP}
				/>
				<Card label="Net Lending" value="—" tooltip={NET_LENDING_TOOLTIP} />
				<Card label="Total Value" value="—" tooltip={TOTAL_VALUE_TOOLTIP} />
			</div>
		)
	}
	return (
		<div
			className={
				'mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4' +
				(isRefreshing ? ' opacity-90 transition-opacity' : '')
			}
		>
			<Card label="Wallet Balance" value={formatUSD(netWorth.walletAssetsUSD)} tooltip={WALLET_TOOLTIP} />
			<Card
				label={`Liquidity Positions (${openN})`}
				value={formatUSD(netWorth.openLpUSD)}
				tooltip={LP_POSITIONS_TOOLTIP}
			/>
			<Card
				label="Net Lending"
				value={formatUSD(netWorth.netLendingUSD)}
				tooltip={NET_LENDING_TOOLTIP}
			/>
			<Card label="Total Value" value={formatUSD(netWorth.totalNetUSD)} tooltip={TOTAL_VALUE_TOOLTIP} />
		</div>
	)
}

function Card({
	label,
	value,
	tooltip,
}: {
	label: string
	value: string
	tooltip?: string
}) {
	return (
		<AppCard className="h-full">
			<p className="flex flex-wrap items-center text-xs font-medium uppercase tracking-wider text-slate-500">
				<span className="leading-snug">{label}</span>
				{tooltip ? (
					<TooltipIconButton tip={tooltip} aria-label={`About ${label}`} className="translate-y-px" />
				) : null}
			</p>
			<p className="mt-1 font-mono tabular-money text-xl text-slate-100">{value}</p>
		</AppCard>
	)
}
