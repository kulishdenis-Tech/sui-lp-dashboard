import { useAppStore } from '@/store/appStore'
import { formatUSD } from '@/utils/formatting'
import { SummaryMetricCard } from '@/components/ui/SummaryMetricCard'

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
				<SummaryMetricCard label="Wallet Balance" value="—" tip={WALLET_TOOLTIP} />
				<SummaryMetricCard
					label={`Liquidity Positions (${openN})`}
					value="—"
					tip={LP_POSITIONS_TOOLTIP}
				/>
				<SummaryMetricCard label="Net Lending" value="—" tip={NET_LENDING_TOOLTIP} />
				<SummaryMetricCard label="Total Value" value="—" tip={TOTAL_VALUE_TOOLTIP} />
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
			<SummaryMetricCard label="Wallet Balance" value={formatUSD(netWorth.walletAssetsUSD)} tip={WALLET_TOOLTIP} />
			<SummaryMetricCard
				label={`Liquidity Positions (${openN})`}
				value={formatUSD(netWorth.openLpUSD)}
				tip={LP_POSITIONS_TOOLTIP}
			/>
			<SummaryMetricCard
				label="Net Lending"
				value={formatUSD(netWorth.netLendingUSD)}
				tip={NET_LENDING_TOOLTIP}
			/>
			<SummaryMetricCard label="Total Value" value={formatUSD(netWorth.totalNetUSD)} tip={TOTAL_VALUE_TOOLTIP} />
		</div>
	)
}
