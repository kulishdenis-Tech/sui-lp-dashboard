import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import { useAppStore } from '@/store/appStore'
import { WalletConnect } from '@/components/auth/WalletConnect'
import { TabNav } from '@/components/layout/TabNav'
import { Spinner } from '@/components/ui/Spinner'
import { clearAllLocalCaches } from '@/services/clearLocalCaches'
import {
	appBtnDisabled,
	appBtnSecondaryCompact,
	appHeaderActionCluster,
	appHeaderSurface,
} from '@/design/appPrimitives'
import { appBuildDateTooltip, formatAppVersionLabel } from '@/config/appBuildInfo'

export function Header() {
	const { isConnected, address } = useWalletAuth()
	const isLoading = useAppStore(
		(s) => s.isLoadingBalances || s.isLoadingPositions || s.isLoadingLending,
	)

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

	return (
		<header className={appHeaderSurface}>
			<div className="mx-auto flex max-w-7xl flex-nowrap items-center justify-center gap-2.5 overflow-x-auto px-4 py-3">
				<div className="min-w-0 shrink-0">
					<div className="flex items-baseline gap-x-2.5">
						<h1 className="whitespace-nowrap text-base font-semibold tracking-tight text-slate-100 sm:text-lg">
							Sui LP &amp; Lending
						</h1>
						<Link
							to="/design-system"
							className="hidden whitespace-nowrap text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline sm:inline"
						>
							Гайд стилів
						</Link>
					</div>
					{isConnected && isLoading ? (
						<p className="mt-0.5 flex items-center gap-2 font-mono text-xs text-slate-400">
							<Spinner className="h-3 w-3 flex-shrink-0" />
							<span>Updating…</span>
						</p>
					) : null}
				</div>

				{isConnected ? (
					<>
						<TabNav />
						<div
							className={appHeaderActionCluster}
							role="group"
							aria-label="Portfolio refresh actions"
						>
							<span
								className="shrink-0 text-xs tabular-nums text-slate-500"
								title={appBuildDateTooltip()}
							>
								{formatAppVersionLabel()}
							</span>
							<button
								type="button"
								className={`${appBtnSecondaryCompact} ${appBtnDisabled} shrink-0`}
								onClick={refreshPrices}
								disabled={!address || isLoading}
								title="Refetch spot prices and balances (uses server LP history when warm)"
							>
								Refresh
							</button>
							<button
								type="button"
								className={`${appBtnSecondaryCompact} ${appBtnDisabled} shrink-0`}
								onClick={forceRescanLp}
								disabled={!address || isLoading}
								title="Cold-scan LP events on-chain (skip server history cache)"
							>
								Force rescan
							</button>
							<button
								type="button"
								className={`${appBtnSecondaryCompact} shrink-0`}
								onClick={clearCacheAndReload}
								title="Clear local event cache and reload"
							>
								Clear cache
							</button>
						</div>
						<WalletConnect />
					</>
				) : (
					<WalletConnect />
				)}
			</div>
		</header>
	)
}
