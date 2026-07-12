import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import { useAppStore } from '@/store/appStore'
import { WalletConnect, connectBtnClass } from '@/components/auth/WalletConnect'
import { TabNav } from '@/components/layout/TabNav'
import { Spinner } from '@/components/ui/Spinner'
import { clearAllLocalCaches } from '@/services/clearLocalCaches'
import { appHeaderSurface } from '@/design/appPrimitives'

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
			<div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
				<div>
					<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<h1 className="text-lg font-semibold tracking-tight text-slate-100">
							Sui LP &amp; Lending
						</h1>
						<Link
							to="/design-system"
							className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
						>
							Гайд стилів
						</Link>
					</div>
					{isConnected && isLoading ? (
						<p className="mt-0.5 flex items-center gap-2 font-mono text-sm text-slate-400">
							<Spinner className="h-3.5 w-3.5 flex-shrink-0" />
							<span>Updating…</span>
						</p>
					) : null}
				</div>
				<div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
					{isConnected ? <TabNav /> : null}
					{isConnected ? (
						<button
							type="button"
							className={
								connectBtnClass +
								' shrink-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-sky-600'
							}
							onClick={refreshPrices}
							disabled={!address || isLoading}
							title="Refetch spot prices and balances (uses server LP history when warm)"
						>
							Refresh
						</button>
					) : null}
					{isConnected ? (
						<button
							type="button"
							className="shrink-0 rounded px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors disabled:opacity-50"
							onClick={forceRescanLp}
							disabled={!address || isLoading}
							title="Cold-scan LP events on-chain (skip server history cache)"
						>
							Force rescan
						</button>
					) : null}
					{isConnected ? (
						<button
							type="button"
							className="shrink-0 rounded px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors"
							onClick={clearCacheAndReload}
							title="Clear local event cache and reload (fixes stale token names / symbols)"
						>
							Clear cache
						</button>
					) : null}
					<WalletConnect />
				</div>
			</div>
		</header>
	)
}
