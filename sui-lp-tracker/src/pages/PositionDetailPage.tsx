import { useState } from 'react'
import { BackButton } from '@/components/ui/BackButton'
import { usePositionDetailData } from '@/components/positions/usePositionDetailData'
import { SUISCAN_OBJECT } from '@/utils/constants'
import { shortAddress } from '@/utils/formatting'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'
import { Spinner } from '@/components/ui/Spinner'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'
import { BluefinEventHistoryCards } from '@/components/positions/BluefinEventHistoryCards'
import { PositionPoolChart } from '@/components/positions/PositionPoolChart'
import { PositionRangeBar } from '@/components/positions/PositionRangeBar'
import { AppCard } from '@/components/ui/AppCard'
import { CopyPoolAddressButton } from '@/components/ui/CopyPoolAddressButton'
import {
	PositionValueCard,
	PositionLifecycleIndexerCard,
	PositionPerformanceCard,
	PositionVaultInventoryCard,
	PositionEarningsCard,
} from '@/components/positions/PositionDetailCards'
import { lpProtocolUsesOnChainHistory } from '@/utils/lpPositionHistoryUi'
import { isCetusVaultPosition } from '@/utils/cetusVault'
import { isHaedalLendingVaultPosition } from '@/utils/haedalLendingVault'
import { isCurrentMultiplyVaultPosition } from '@/utils/currentMultiplyVault'
import { CurrentMultiplyDetailSection } from '@/components/positions/CurrentMultiplyDetailSection'

function protocolLabel(protocol: string) {
	const t = protocol.trim()
	if (!t) return protocol
	const lower = t.toLowerCase()
	return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/** Округлений вік позиції в днях для показу в шапці. */
function daysOpenRounded(days: number): number {
	if (!Number.isFinite(days)) return 0
	return Math.max(0, Math.round(days))
}

function ExploreObjectIconLink({ poolId }: { poolId: string }) {
	const href = SUISCAN_OBJECT(poolId)
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer noopener"
			className="inline-flex shrink-0 rounded p-1 text-slate-500 hover:bg-slate-800/70 hover:text-sky-400"
			title="Open pool on Suiscan"
			aria-label="Open pool on Suiscan"
		>
			<svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
				<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
				<polyline points="15 3 21 3 21 9" />
				<line x1="10" x2="21" y1="14" y2="3" />
			</svg>
		</a>
	)
}

export function PositionDetailPage() {
	const {
		navigate,
		isConnected,
		walletAddress,
		setActiveTab,
		openPositions,
		closedPositions,
		isLoadingPositions,
		loadAll,
		closedRec,
		detailFromClosed,
		indexerExtras,
		position,
		showMetrics,
		enrichmentPending,
		showHodlLiquidity,
		depositsUsd,
		withdrawsUsd,
		evsVisible,
		claimedFeeRewardAgg,
		settledEmpty,
		valueCardCapitalLegs,
		valueCardPosition,
		totalMarkValueUsd,
		hodlTotalUsd,
		earnAprPct,
		vaultAprPct,
		dailyEarningsUsd,
		ilPctVsHodl,
		vsHodlRoiPct,
		liquidityLegUsd,
	} = usePositionDetailData()
	// Chart: collapsed by default, lazy-mount on first open (iframe only loads when expanded)
	const [chartOpen, setChartOpen] = useState(false)
	const [chartMounted, setChartMounted] = useState(false)

	if (!isConnected) {
		return (
			<div className="mx-auto max-w-2xl px-4 py-16 text-center">
				<p className="text-slate-400">Connect a wallet or paste an address in the header.</p>
			</div>
		)
	}

	/** Показуємо спінер лише до першого ненульового списку позицій (stale-while-revalidate при refresh). */
	if (isLoadingPositions && !position && openPositions.length === 0 && closedPositions.length === 0) {
		return (
			<div className="flex items-center justify-center py-24">
				<Spinner className="h-8 w-8 text-slate-500" />
			</div>
		)
	}

	if (!position) {
		return (
			<main className="mx-auto max-w-6xl px-4 py-8">
				<p className="text-slate-300">Position not found.</p>
				<BackButton
					label="LP"
					onClick={() => {
						setActiveTab('lp')
						navigate('/home', { state: { lpView: 'open' } })
					}}
				/>
			</main>
		)
	}

	const poolShort = position.poolId ? shortAddress(position.poolId, 6, 4) : '—'
	const daysLabel = Number.isFinite(position.daysOpen) ? `${daysOpenRounded(position.daysOpen)}d` : '—'
	const lendingVault = isHaedalLendingVaultPosition(position)

	if (isCurrentMultiplyVaultPosition(position)) {
		return (
			<main className="mx-auto max-w-6xl px-4 py-6">
				<BackButton
					label="Vaults"
					onClick={() => {
						setActiveTab('lp')
						navigate('/home', { state: { lpView: 'vaults' } })
					}}
				/>
				<CurrentMultiplyDetailSection
					position={position}
					onRefresh={
						walletAddress
							? () => {
									void loadAll(walletAddress, { forceRefreshPrices: true })
								}
							: undefined
					}
				/>
			</main>
		)
	}

	return (
		<main className="mx-auto max-w-6xl px-4 py-6">
			<div className="mb-6">
				<BackButton
					label="LP"
					onClick={() => {
						setActiveTab('lp')
						navigate('/home', {
							state: {
								lpView: detailFromClosed
									? 'closed'
									: isCetusVaultPosition(position)
										? 'vaults'
										: 'open',
							},
						})
					}}
				/>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-start sm:gap-x-[2cm] sm:gap-y-3">
					<div className="grid min-w-0 max-w-full shrink grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
						<div className="relative col-start-1 row-start-1 flex shrink-0 items-center -space-x-1.5 self-center">
							<TokenIconOkx
								coinType={position.tokenAAddress}
								symbol={position.tokenA}
								title={position.tokenA}
								chainIconUrl={position.tokenAIconUrl}
							/>
							{lendingVault ? null : (
							<TokenIconOkx
								coinType={position.tokenBAddress}
								symbol={position.tokenB}
								title={position.tokenB}
								chainIconUrl={position.tokenBIconUrl}
							/>
							)}
						</div>
						<div className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
							<span className="text-xl leading-7 font-semibold tracking-tight text-slate-100">
								{lendingVault ? position.tokenA : `${position.tokenA}/${position.tokenB}`}
							</span>
							{isCetusVaultPosition(position) ? (
								<span className="rounded-full bg-slate-800/95 px-2 py-0.5 text-xs leading-5 font-medium text-slate-200">
									{position.cetusVault?.feeLabel ?? 'Earn'}
								</span>
							) : (
								<span className="rounded-full bg-slate-800/95 px-2 py-0.5 text-xs leading-5 font-medium tabular-nums text-slate-200">
									{(position.fee * 100).toFixed(3)}%
								</span>
							)}
							{detailFromClosed ? (
								<span className="rounded-full bg-amber-900/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200/95">
									Closed
								</span>
							) : null}
							{isCetusVaultPosition(position) ? (
								<span className="rounded-full bg-sky-900/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200/95">
									{position.cetusVault?.provider === 'Haedal' ? 'Haedal Vault' : 'Vault'}
								</span>
							) : null}
							{position.poolId ? <ExploreObjectIconLink poolId={position.poolId} /> : null}
						</div>
						<div className="col-start-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-5 text-slate-400">
							<ProtocolIcon protocol={position.protocol} size={16} />
							<span className="inline-flex items-center">
								{isCetusVaultPosition(position)
									? position.cetusVault?.provider === 'Haedal'
										? 'Haedal Vault'
										: 'Cetus Vault'
									: protocolLabel(position.protocol)}
							</span>
							{position.cetusVault?.lpTokenAmount ? (
								<>
									<span className="inline-flex items-center text-slate-600" aria-hidden>
										·
									</span>
									<span className="tabular-nums text-slate-400">
										{position.cetusVault.lpTokenAmount.toLocaleString('en-US', {
											maximumFractionDigits: 2,
										})}{' '}
										LP
										{position.cetusVault.stakedLpTokenRaw ? ' staked' : ''}
									</span>
								</>
							) : null}
							<span className="inline-flex items-center text-slate-600" aria-hidden>
								·
							</span>
							<span className="tabular-nums">{daysLabel}</span>
							<span className="inline-flex items-center text-slate-600" aria-hidden>
								·
							</span>
							<span
								className="min-w-0 truncate font-mono text-[11px] text-slate-400"
								title={position.poolId}
							>
								{poolShort}
							</span>
							<span className="inline-flex shrink-0 items-center">
								{position.poolId ? <CopyPoolAddressButton address={position.poolId} /> : null}
							</span>
							{position.historyPartial ? (
								<>
									<span className="inline-flex items-center text-slate-600" aria-hidden>
										·
									</span>
									<span
										className="inline-flex items-center text-amber-500/90"
										title="History truncated by RPC page limits — deposit/PnL basis may be incomplete."
									>
										partial history
									</span>
								</>
							) : null}
						</div>
					</div>
					{isCetusVaultPosition(position) ? null : (
						<div className="w-full min-w-0 shrink-0 pt-1 sm:w-[min(100%,17rem)] sm:max-w-[20rem] sm:flex-initial sm:basis-auto sm:pt-0 md:w-64 lg:w-72 xl:w-[19rem]">
							{detailFromClosed && closedRec?.tickLower == null ? (
								<p className="rounded-lg border border-slate-700/75 bg-slate-900/40 px-3 py-2 text-center text-[11px] leading-snug text-slate-500">
									Tick range unavailable — NFT burned on close; will appear after next scan.
								</p>
							) : (
								<PositionRangeBar p={position} />
							)}
						</div>
					)}
				</div>
			</div>

			{isCetusVaultPosition(position) ? (
				<div className="mb-6 grid min-h-0 gap-6 lg:grid-cols-2 lg:items-stretch">
					<PositionValueCard
						position={valueCardPosition ?? position}
						totalMarkValueUsd={totalMarkValueUsd}
						depositsUsd={depositsUsd}
						withdrawsUsd={withdrawsUsd}
						netDepositLegs={valueCardCapitalLegs}
						showHodlLiquidity={showHodlLiquidity}
						liquidityLegUsd={liquidityLegUsd}
						hodlTotalUsd={hodlTotalUsd}
						vaultAprPct={vaultAprPct}
						closedDetail={detailFromClosed || settledEmpty}
					/>
					<PositionEarningsCard
						position={position}
						showMetrics={showMetrics}
						dailyEarningsUsd={dailyEarningsUsd}
						earnAprPct={earnAprPct}
						claimedFeeRewardAgg={claimedFeeRewardAgg}
					/>
					<PositionPerformanceCard
						position={position}
						showMetrics={showMetrics}
						vsHodlRoiPct={vsHodlRoiPct}
						ilPctVsHodl={ilPctVsHodl}
					/>
					<PositionVaultInventoryCard position={position} showMetrics={showMetrics} />
					{indexerExtras ? (
						<div className="lg:col-span-2">
							<PositionLifecycleIndexerCard indexerExtras={indexerExtras} />
						</div>
					) : null}
				</div>
			) : (
				<div className="mb-6 grid min-h-0 gap-6 lg:grid-cols-2 lg:items-stretch">
					<div className="flex h-full min-h-0 min-w-0 flex-col gap-6">
						<PositionValueCard
							position={valueCardPosition ?? position}
							totalMarkValueUsd={totalMarkValueUsd}
							depositsUsd={depositsUsd}
							withdrawsUsd={withdrawsUsd}
							netDepositLegs={valueCardCapitalLegs}
							showHodlLiquidity={showHodlLiquidity}
							liquidityLegUsd={liquidityLegUsd}
							hodlTotalUsd={hodlTotalUsd}
							closedDetail={detailFromClosed || settledEmpty}
						/>

						{indexerExtras ? (
							<PositionLifecycleIndexerCard indexerExtras={indexerExtras} />
						) : null}

						<div className="flex min-h-0 flex-1 flex-col">
							<PositionPerformanceCard
								position={position}
								showMetrics={showMetrics}
								vsHodlRoiPct={vsHodlRoiPct}
								ilPctVsHodl={ilPctVsHodl}
							/>
						</div>
					</div>

					<div className="flex h-full min-h-0 min-w-0 flex-col">
						<PositionEarningsCard
							position={position}
							showMetrics={showMetrics}
							dailyEarningsUsd={dailyEarningsUsd}
							earnAprPct={earnAprPct}
							claimedFeeRewardAgg={claimedFeeRewardAgg}
						/>
					</div>
				</div>
			)}

			{detailFromClosed || isCetusVaultPosition(position) ? null : (
				<AppCard className="mb-6">
					{/* Collapsible header — chart only mounts on first expand */}
					<button
						type="button"
						onClick={() => {
							if (!chartMounted) setChartMounted(true)
							setChartOpen((v) => !v)
						}}
						className="flex w-full items-center justify-between text-sm font-medium text-app-fg"
						aria-expanded={chartOpen}
					>
						<span>Pool chart</span>
						<svg
							className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 ${chartOpen ? 'rotate-180' : ''}`}
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							aria-hidden
						>
							<polyline points="6 9 12 15 18 9" />
						</svg>
					</button>
					{chartMounted ? (
						<div className={chartOpen ? 'mt-4' : 'hidden'}>
							<PositionPoolChart position={position} pairLabel={`${position.tokenA} / ${position.tokenB}`} />
						</div>
					) : null}
				</AppCard>
			)}

			{lpProtocolUsesOnChainHistory(position.protocol) && evsVisible.length > 0 ? (
				<div className="relative z-10 isolate">
					<BluefinEventHistoryCards
						position={position}
						events={evsVisible}
					/>
				</div>
			) : (
				<p className="text-sm text-app-fg-muted">
					{!lpProtocolUsesOnChainHistory(position.protocol)
						? 'Event history is not available for this protocol in the dashboard yet.'
						: enrichmentPending
							? 'Scanning wallet history for vault deposit / withdraw events…'
							: isCetusVaultPosition(position)
								? 'No vault deposit/withdraw events found for this wallet yet (or older activity is past the scan limit).'
								: 'No indexed LP events for this position from this wallet yet (or older activity is past the scan limit).'}
				</p>
			)}
		</main>
	)
}
