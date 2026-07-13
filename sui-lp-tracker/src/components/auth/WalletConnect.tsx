import { ConnectModal, useCurrentAccount, useDisconnectWallet } from '@mysten/dapp-kit'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import { shortAddress } from '@/utils/formatting'
import { useAppStore } from '@/store/appStore'
import { useState, type FormEvent } from 'react'
import { isClientWatchWallet } from '@/config/watchWallets'
import { VisitsPanel } from '@/components/admin/VisitsPanel'

function PastedAddressBar() {
	const { address, clearManualView } = useWalletAuth()
	const [visitsOpen, setVisitsOpen] = useState(false)
	if (!address) return null
	const canOpenVisits = isClientWatchWallet(address)
	return (
		<div className="flex flex-nowrap items-center gap-2">
			{canOpenVisits ? (
				<>
					<button
						type="button"
						className="shrink-0 rounded border border-violet-500/40 bg-violet-950/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-200 hover:border-violet-400/60 hover:text-violet-100"
						title="Visits"
						aria-label="Open visits"
						onClick={() => setVisitsOpen(true)}
					>
						Read-only
					</button>
					<VisitsPanel viewer={address} open={visitsOpen} onClose={() => setVisitsOpen(false)} />
				</>
			) : (
				<span className="rounded border border-violet-500/40 bg-violet-950/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-200">
					Read-only
				</span>
			)}
			<span className="whitespace-nowrap font-mono text-sm text-sky-200">{shortAddress(address)}</span>
			<button
				type="button"
				className="whitespace-nowrap text-xs text-slate-500 underline hover:text-slate-300"
				onClick={() => clearManualView()}
			>
				Clear address
			</button>
		</div>
	)
}

import { appBtnPrimary } from '@/design/appPrimitives'

/** Primary header CTA — alias на `appBtnPrimary` (Connect / Refresh). */
export const connectBtnClass = appBtnPrimary

function WalletOrPaste() {
	const setManualViewAddress = useAppStore((s) => s.setManualViewAddress)
	const [draft, setDraft] = useState('')
	const [err, setErr] = useState<string | null>(null)
	/* ConnectModal + useWallets() can cause "Maximum update depth" if mounted on every paint; mount only when user wants wallet UI. */
	const [mountConnectModal, setMountConnectModal] = useState(false)

	function onPasteSubmit(e: FormEvent) {
		e.preventDefault()
		setErr(null)
		const r = setManualViewAddress(draft)
		if (!r.ok) {
			setErr(r.error)
			return
		}
		setDraft('')
	}

	return (
		<div className="flex w-full max-w-xl flex-col gap-3 sm:max-w-none sm:flex-row sm:flex-wrap sm:items-end">
			{mountConnectModal ? (
				<ConnectModal
					trigger={
						<button type="button" className={connectBtnClass}>
							Connect Wallet
						</button>
					}
				/>
			) : (
				<button type="button" className={connectBtnClass} onClick={() => setMountConnectModal(true)}>
					Connect Wallet
				</button>
			)}
			<div className="hidden text-slate-500 sm:block sm:pb-2">or</div>
			<form
				className="flex flex-1 flex-col gap-1 sm:min-w-[280px]"
				onSubmit={onPasteSubmit}
			>
				<label className="text-xs text-slate-500" htmlFor="manual-addr">
					Paste Sui address (read-only, no extension)
				</label>
				<div className="flex gap-2">
					<input
						id="manual-addr"
						type="text"
						autoComplete="off"
						spellCheck={false}
						placeholder="0x…"
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-900/80 px-2 py-1.5 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
					/>
					<button
						type="submit"
						className="shrink-0 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-700"
					>
						View
					</button>
				</div>
				{err ? <p className="text-xs text-red-400">{err}</p> : null}
			</form>
		</div>
	)
}

/** Tiny dormant chip — opens visits log only for watchlist connected wallets. */
function HiddenVisitsChip({ address }: { address: string }) {
	const [open, setOpen] = useState(false)
	if (!isClientWatchWallet(address)) return null
	return (
		<>
			<button
				type="button"
				className="shrink-0 rounded border border-slate-700/80 bg-slate-900/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-600 hover:border-slate-600 hover:text-slate-400"
				title="Visits"
				aria-label="Open visits"
				onClick={() => setOpen(true)}
			>
				Read-only
			</button>
			<VisitsPanel viewer={address} open={open} onClose={() => setOpen(false)} />
		</>
	)
}

/** `useDisconnectWallet` only in this branch — not in `useWalletAuth` (avoids React 19 + useMutation max-depth). */
function ConnectedWalletRow() {
	const { mutate: disconnectFromKit } = useDisconnectWallet()
	const acc = useCurrentAccount()
	const address = acc?.address
	if (!address) return null
	return (
		<div className="flex items-center gap-2">
			<HiddenVisitsChip address={address} />
			<span className="font-mono text-sm text-sky-200">{shortAddress(address)}</span>
			<button
				type="button"
				className="text-xs text-slate-500 underline hover:text-slate-300"
				onClick={() => {
					useAppStore.getState().clearPortfolio()
					disconnectFromKit()
				}}
			>
				Disconnect
			</button>
		</div>
	)
}

function WalletBlock() {
	const { address, isManualView } = useWalletAuth()
	const acc = useCurrentAccount()

	if (!address) {
		return <WalletOrPaste />
	}
	if (isManualView) {
		return <PastedAddressBar />
	}
	/* address from connected wallet; should have account */
	if (!acc) {
		return <WalletOrPaste />
	}

	return <ConnectedWalletRow />
}

export function WalletConnect() {
	return (
		<div className="flex items-center">
			<WalletBlock />
		</div>
	)
}
