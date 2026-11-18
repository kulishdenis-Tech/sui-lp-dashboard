import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { MobileBottomNav } from '@/components/layout/MobileBottomNav'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import { PortfolioDataLoader } from '@/components/PortfolioDataLoader'
import { ToastHost } from '@/components/ui/ToastHost'
import { PriceSpikeWatcher } from '@/components/PriceSpikeWatcher'
import { AppVisitLogger } from '@/components/AppVisitLogger'
import { usePortfolioSnapshotWriter } from '@/hooks/usePortfolioSnapshotWriter'
import { useAppStore } from '@/store/appStore'
import { useWalletLabel } from '@/config/walletNicknameStore'
import { isNativeSuiCoinType } from '@/utils/suiCoinType'
import { deriveOverviewSyncLabel } from '@/pages/overviewLab/overviewSourceStatus'
import { useOverviewRefreshing, useOverviewSources } from '@/pages/overviewLab/useOverviewSources'
import { WalletSheet } from '@/mobile/ui/WalletSheet'

function SnapshotWriter() {
	usePortfolioSnapshotWriter()
	return null
}

function suiText(n: number | null): string {
	if (n == null || !Number.isFinite(n)) return '—'
	return `$${n.toFixed(n >= 0.01 ? 4 : 6)}`
}

const dot: Record<string, string> = {
	Synced: 'bg-emerald-400',
	'Updating…': 'bg-sky-400 animate-pulse',
	Stale: 'bg-yellow-400',
	Partial: 'bg-yellow-400',
	Error: 'bg-red-400',
}

/** Компактна шапка: гаманець (шторка), статус синхронізації, ціна SUI. */
function MobileHeader({ onOpenWallet }: { onOpenWallet: () => void }) {
	const { address } = useWalletAuth()
	const who = useWalletLabel(address)
	const sources = useOverviewSources()
	const refreshing = useOverviewRefreshing()
	const sync = deriveOverviewSyncLabel(sources, refreshing)
	const sui = useAppStore((s) => {
		const t =
			s.tokenBalances.find((x) => isNativeSuiCoinType(x.coinType)) ??
			s.tokenBalances.find((x) => x.symbol.trim().toUpperCase() === 'SUI')
		return t?.priceUSD ?? t?.priceUSDC ?? null
	})

	return (
		<header className="safe-top safe-x sticky top-0 z-30 border-b border-slate-800/80 bg-[#060b15]/95 backdrop-blur">
			<div className="flex h-12 items-center justify-between gap-2 px-3">
				<button
					type="button"
					onClick={onOpenWallet}
					className="flex min-w-0 items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 py-1.5 pl-2.5 pr-3 text-sm text-slate-100 active:bg-slate-800"
					aria-label="Wallet and data"
				>
					<span className={`h-2 w-2 shrink-0 rounded-full ${dot[sync] ?? 'bg-slate-500'}`} />
					<span className="truncate font-medium">{address ? who.label : 'Connect'}</span>
					<span className="text-slate-500" aria-hidden>
						▾
					</span>
				</button>
				<div className="flex shrink-0 items-center gap-2 text-xs">
					<span className="text-slate-500">{sync}</span>
					<span className="rounded-full border border-slate-700 bg-slate-900/70 px-2.5 py-1 font-mono tabular-nums text-slate-100">
						SUI {suiText(sui)}
					</span>
				</div>
			</div>
		</header>
	)
}

export function MobileLayout() {
	const { isConnected } = useWalletAuth()
	const [walletOpen, setWalletOpen] = useState(false)
	return (
		<div
			className={`min-h-[100dvh] bg-app-bg ${
				isConnected ? 'pb-[calc(3.5rem+env(safe-area-inset-bottom))]' : ''
			}`}
		>
			<MobileHeader onOpenWallet={() => setWalletOpen(true)} />
			<PortfolioDataLoader />
			<SnapshotWriter />
			<PriceSpikeWatcher />
			<AppVisitLogger />
			<ToastHost />
			<Outlet />
			{isConnected ? <MobileBottomNav /> : null}
			<WalletSheet open={walletOpen} onClose={() => setWalletOpen(false)} />
		</div>
	)
}
