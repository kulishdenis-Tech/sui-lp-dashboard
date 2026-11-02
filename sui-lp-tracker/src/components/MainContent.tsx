import { useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import { useAppStore, type AppTab } from '@/store/appStore'
import { SummaryCards } from '@/components/dashboard/SummaryCards'
import { BalanceDashboard } from '@/components/balance/BalanceDashboard'
import { LpModule } from '@/components/positions/LpModule'
import { LendingModule } from '@/components/lending/LendingModule'
import { PageShell } from '@/components/ui/PageShell'

export function MainContent() {
	const { isConnected } = useWalletAuth()
	const tab = useAppStore((s) => s.activeTab)
	const setActiveTab = useAppStore((s) => s.setActiveTab)
	const lastLoadError = useAppStore((s) => s.lastLoadError)
	const navigate = useNavigate()

	// Legacy in-memory / HMR state: analytics → Overview (no empty panel).
	useEffect(() => {
		if ((tab as string) === 'analytics') {
			setActiveTab('balance')
			navigate('/', { replace: true })
		}
	}, [tab, setActiveTab, navigate])

	if (!isConnected) {
		return (
			<PageShell className="max-w-2xl py-16 text-center">
				<p className="text-slate-400">
					Connect a wallet, or paste a Sui address in the header (read-only) — for browsers without
					an extension, e.g. Cursor Simple Browser.
				</p>
			</PageShell>
		)
	}

	return <ConnectedMain tab={tab} lastLoadError={lastLoadError} />
}

type ConnectedMainProps = {
	tab: AppTab
	lastLoadError: string | null
}

/** Split from `MainContent` so the "not connected" branch doesn't mount tab panels. */
function ConnectedMain({ tab, lastLoadError }: ConnectedMainProps) {
	const tabPanel = (id: AppTab, node: ReactNode) => (
		<div
			id={`tab-panel-${id}`}
			role="tabpanel"
			aria-labelledby={`tab-${id}`}
			hidden={tab !== id}
			aria-hidden={tab !== id}
			className="min-w-0"
		>
			{node}
		</div>
	)

	return (
		<PageShell as="main" className="py-8">
			{lastLoadError ? (
				<div
					role="alert"
					className="mb-4 rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-sm text-amber-100"
				>
					<strong className="text-amber-200">Part of the data failed to load</strong> — you may
					see empty sections. {lastLoadError}
				</div>
			) : null}
			<SummaryCards />
			{tabPanel('balance', <BalanceDashboard />)}
			{tabPanel('lp', <LpModule />)}
			{tabPanel('lending', <LendingModule />)}
		</PageShell>
	)
}
