import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import { useAppStore } from '@/store/appStore'
import { WalletConnect } from '@/components/auth/WalletConnect'
import { TabNav } from '@/components/layout/TabNav'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'
import { Spinner } from '@/components/ui/Spinner'
import { NATIVE_SUI_COIN_TYPE, isNativeSuiCoinType } from '@/utils/suiCoinType'
import { clearAllLocalCaches } from '@/services/clearLocalCaches'
import {
	appHeaderChip,
	appHeaderControlShell,
	appHeaderSegAction,
	appHeaderSurface,
} from '@/design/appPrimitives'
import { OverviewSyncStatus } from '@/pages/overviewLab/OverviewSyncStatus'
import { appBuildDateTooltip, formatAppVersionLabel } from '@/config/appBuildInfo'

/**
 * Two-row header aligned with MainContent (`max-w-6xl` + `px-4`).
 *
 * Row 1 — brand · SUI quote · wallet
 * Row 2 — section tabs · Refresh Data / Reload History / Clear Local Cache
 */
export function Header() {
	const { isConnected, address } = useWalletAuth()
	const manualViewAddress = useAppStore((s) => s.manualViewAddress)
	const isLoading = useAppStore(
		(s) => s.isLoadingBalances || s.isLoadingPositions || s.isLoadingLending,
	)
	const showSyncStatus = Boolean(isConnected || address || manualViewAddress)

	const refreshPrices = useCallback(() => {
		if (address) {
			void useAppStore.getState().loadAll(address, { forceRefreshPrices: true })
		}
	}, [address])

	const forceRescanLp = useCallback(() => {
		if (address) {
			void useAppStore.getState().loadAll(address, {
				forceRefreshPrices: true,
				forceRescanLpHistory: true,
			})
		}
	}, [address])

	const clearCacheAndReload = useCallback(() => {
		void clearAllLocalCaches()
	}, [])

	const actionsDisabled = !address || isLoading

	return (
		<header className={appHeaderSurface}>
			<div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-2 px-4 py-3">
				{/* Row 1: brand + quote + wallet */}
				<div className="flex min-w-0 items-start justify-between gap-3">
					<div className="min-w-0 shrink">
						<div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
							<h1 className="whitespace-nowrap text-base font-semibold tracking-tight text-slate-100 sm:text-lg">
								Sui LP &amp; Lending
							</h1>
							<Link
								to="/design-system"
								className="whitespace-nowrap text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
							>
								Style Guide
							</Link>
							{showSyncStatus ? (
								<span className="inline-flex items-center gap-1.5">
									<OverviewSyncStatus />
									{isLoading ? (
										<Spinner className="h-3 w-3 flex-shrink-0 text-sky-400" />
									) : null}
								</span>
							) : null}
						</div>
					</div>

					<div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
						{isConnected ? <HeaderSuiUsdcQuote /> : null}
						<div className="min-w-0 max-w-full">
							<WalletConnect />
						</div>
					</div>
				</div>

				{/* Row 2: nav + portfolio actions */}
				{isConnected ? (
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
							<TabNav />
						</div>
						<div
							className={`${appHeaderControlShell} shrink-0`}
							role="group"
						aria-label="Portfolio refresh actions"
					>
						<span
							className="shrink-0 px-1.5 text-xs tabular-nums text-slate-500"
							title={appBuildDateTooltip()}
						>
							{formatAppVersionLabel()}
						</span>
						<button
								type="button"
								className={appHeaderSegAction}
								onClick={refreshPrices}
								disabled={actionsDisabled}
								title="Refetch spot prices and balances (uses server LP history when warm)"
							>
								Refresh Data
							</button>
							<button
								type="button"
								className={appHeaderSegAction}
								onClick={forceRescanLp}
								disabled={actionsDisabled}
								title="Re-scan LP events on-chain from scratch, bypassing server history cache"
							>
								Reload History
							</button>
							<button
								type="button"
								className={appHeaderSegAction}
								onClick={clearCacheAndReload}
								title="Delete locally cached events and price data, then reload"
							>
								Clear Local Cache
							</button>
						</div>
					</div>
				) : null}
			</div>
		</header>
	)
}

function formatSuiInUsdc(n: number): string {
	if (n >= 1) return n.toFixed(4)
	if (n >= 0.0001) return n.toFixed(6)
	return n.toFixed(8)
}

/** Spot SUI quoted in USDC, from the same balance prices as the token table. */
function HeaderSuiUsdcQuote() {
	const sui = useAppStore((s) => {
		const native = s.tokenBalances.find((t) => isNativeSuiCoinType(t.coinType))
		if (native) return native
		return s.tokenBalances.find((t) => t.symbol.trim().toUpperCase() === 'SUI') ?? null
	})
	const px = sui?.priceUSDC ?? sui?.priceUSD ?? null
	const text = px != null && Number.isFinite(px) ? formatSuiInUsdc(px) : '—'

	return (
		<div
			className={appHeaderChip}
			title="Current SUI price in USDC"
			aria-label={`SUI price ${text} USDC`}
		>
			<TokenIconOkx coinType={NATIVE_SUI_COIN_TYPE} symbol="SUI" chainIconUrl={sui?.iconUrl} />
			<span className="font-mono tabular-nums text-slate-100">{text}</span>
			<span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">USDC</span>
		</div>
	)
}
