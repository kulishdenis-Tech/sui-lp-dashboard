import { useCallback, useState } from 'react'
import { okxLogClear, okxLogLines } from '@/wallet/okxDebugLog'
import { Link } from 'react-router-dom'
import { Sheet } from '@/mobile/ui/Sheet'
import { WalletConnect } from '@/components/auth/WalletConnect'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import { useWalletNicknames } from '@/config/walletNicknameStore'
import { useAppStore } from '@/store/appStore'
import { clearAllLocalCaches } from '@/services/clearLocalCaches'
import { appBuildDateTooltip, formatAppVersionLabel } from '@/config/appBuildInfo'

function short(a: string): string {
	return `${a.slice(0, 6)}…${a.slice(-4)}`
}

const row =
	'flex min-h-[3rem] w-full items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3 text-left text-sm text-slate-100 active:bg-slate-800'

/** Гаманці, оновлення даних і сервісні дії — усе, що в десктопі розкидано по шапці. */
export function WalletSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	const [okxLines, setOkxLines] = useState<string[]>([])
	const { address } = useWalletAuth()
	const { wallets } = useWalletNicknames()
	const isLoading = useAppStore(
		(s) => s.isLoadingBalances || s.isLoadingPositions || s.isLoadingLending,
	)

	const refresh = useCallback(() => {
		if (address) void useAppStore.getState().loadAll(address, { forceRefreshPrices: true })
		onClose()
	}, [address, onClose])

	const rescan = useCallback(() => {
		if (address) {
			void useAppStore
				.getState()
				.loadAll(address, { forceRefreshPrices: true, forceRescanLpHistory: true })
		}
		onClose()
	}, [address, onClose])

	const pick = (addr: string) => {
		useAppStore.getState().setManualViewAddress(addr)
		onClose()
	}

	return (
		<Sheet open={open} onClose={onClose} title="Wallet & data">
			<div className="space-y-5 pb-2">
				{wallets.length > 0 ? (
					<section className="space-y-2">
						<p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
							Watch wallets
						</p>
						{wallets.map((w) => {
							const active = address?.toLowerCase() === w.address
							return (
								<button
									key={w.address}
									type="button"
									className={`${row} ${active ? 'border-sky-500/60' : ''}`}
									onClick={() => pick(w.address)}
								>
									<span className="font-medium">{w.nickname || short(w.address)}</span>
									<span className="font-mono text-xs text-slate-500">{short(w.address)}</span>
								</button>
							)
						})}
					</section>
				) : null}

				<section className="space-y-2">
					<p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
						Connection
					</p>
					<div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
						<WalletConnect />
					</div>
				</section>

				<section className="space-y-2">
					<p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Data</p>
					<button type="button" className={row} disabled={!address || isLoading} onClick={refresh}>
						Refresh data
						<span className="text-xs text-slate-500">{isLoading ? 'updating…' : 'prices + all'}</span>
					</button>
					<button type="button" className={row} disabled={!address || isLoading} onClick={rescan}>
						Rescan LP history
						<span className="text-xs text-slate-500">slow</span>
					</button>
					<button
						type="button"
						className={row}
						onClick={() => {
							if (window.confirm('Clear local cache and reload this page?')) void clearAllLocalCaches()
						}}
					>
						Clear local cache
					</button>
					<Link to="/settings" className={row} onClick={onClose}>
						Settings
						<span aria-hidden>›</span>
					</Link>
				</section>

				<details
					className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-400"
					onToggle={(e) => {
						if ((e.currentTarget as HTMLDetailsElement).open) setOkxLines(okxLogLines())
					}}
				>
					<summary className="cursor-pointer select-none">OKX connection log</summary>
					<div className="mt-2 max-h-48 overflow-auto font-mono text-[10px] leading-4 text-slate-500">
						{okxLines.length === 0 ? <p>No events yet.</p> : okxLines.map((l, i) => <p key={i}>{l}</p>)}
					</div>
					<button
						type="button"
						className="mt-2 text-[11px] text-sky-400"
						onClick={() => {
							okxLogClear()
							setOkxLines([])
						}}
					>
						Clear log
					</button>
				</details>

				<p className="text-center text-[11px] text-slate-600" title={appBuildDateTooltip()}>
					{formatAppVersionLabel()}
				</p>
			</div>
		</Sheet>
	)
}
