import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { ConnectModal } from '@mysten/dapp-kit-react/ui'
import { useWalletSigner } from '@/wallet/useWalletSigner'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { clearAwAuth, getAwAuthAddress, revokeAwSession } from '@/pages/autopilot/autoWithdrawStore'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import { useWalletLabel } from '@/config/walletNicknameStore'
import { useAppStore } from '@/store/appStore'
import { isClientWatchWallet } from '@/config/watchWallets'
import { VisitsPanel } from '@/components/admin/VisitsPanel'
import {
	appBtnPrimary,
	appHeaderChip,
	appHeaderChipGhost,
} from '@/design/appPrimitives'

function AdminVisitsButton({ address }: { address: string }) {
	const [open, setOpen] = useState(false)
	if (!isClientWatchWallet(address)) return null
	return (
		<>
			<button
				type="button"
				className={appHeaderChipGhost}
				aria-label="Open visits log"
				onClick={() => setOpen(true)}
			>
				Visits
			</button>
			<VisitsPanel viewer={address} open={open} onClose={() => setOpen(false)} />
		</>
	)
}

function PastedAddressBar() {
	const { address, clearManualView } = useWalletAuth()
	const viewing = useWalletLabel(address)
	if (!address) return null
	return (
		<div className="flex max-w-full flex-wrap items-center justify-end gap-1.5">
			<span
				className={`${appHeaderChip} gap-2`}
				title="Viewing a pasted address without wallet signing"
			>
				<span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
					<span className="sm:hidden">Viewing</span>
					<span className="hidden sm:inline">Viewing Address</span>
				</span>
				<span
					className={
						viewing.title
							? 'font-medium text-slate-100'
							: 'font-mono font-normal tabular-nums text-slate-100'
					}
					title={viewing.title}
				>
					{viewing.label}
				</span>
			</span>
			<AdminVisitsButton address={address} />
			<button type="button" className={appHeaderChipGhost} onClick={() => clearManualView()}>
				Clear
			</button>
		</div>
	)
}

/** Primary header CTA — alias to `appBtnPrimary` (Connect / Refresh). */
// eslint-disable-next-line react-refresh/only-export-components
export const connectBtnClass = appBtnPrimary

function WalletOrPaste() {
	const setManualViewAddress = useAppStore((s) => s.setManualViewAddress)
	const [draft, setDraft] = useState('')
	const [err, setErr] = useState<string | null>(null)
	const [connectOpen, setConnectOpen] = useState(false)

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
			<button type="button" className={connectBtnClass} onClick={() => setConnectOpen(true)}>
				Connect Wallet
			</button>
			<ConnectModal
				ref={(node) => {
					const el = node as unknown as HTMLElement | null
					if (!el || el.dataset.bound === '1') return
					el.dataset.bound = '1'
					el.addEventListener('closed', () => setConnectOpen(false))
				}}
				open={connectOpen}
			/>
			<div className="hidden text-slate-500 sm:block sm:pb-2">or</div>
			<form
				className="flex flex-1 flex-col gap-1 sm:min-w-[280px]"
				onSubmit={onPasteSubmit}
			>
				<label className="text-xs text-slate-400" htmlFor="manual-addr">
					Paste Sui address (view only, no extension)
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

/** Connected wallet branch — Visits is admin-only, never labeled as capability status. */
function ConnectedWalletRow() {
	const { disconnectWallet } = useWalletSigner()
	const acc = useCurrentAccount()
	const address = acc?.address
	const viewing = useWalletLabel(address)
	if (!address) return null
	return (
		<div className="flex max-w-full flex-wrap items-center justify-end gap-1.5">
			<span className={`${appHeaderChip} gap-2`} title="Wallet connected for signing">
				<span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
					<span className="sm:hidden">Connected</span>
					<span className="hidden sm:inline">Connected Wallet</span>
				</span>
				<span
					className={
						viewing.title
							? 'font-medium text-slate-100'
							: 'font-mono font-normal tabular-nums text-slate-100'
					}
					title={viewing.title}
				>
					{viewing.label}
				</span>
			</span>
			<AdminVisitsButton address={address} />
			<button
				type="button"
				className={appHeaderChipGhost}
				onClick={() => {
					void revokeAwSession()
					useAppStore.getState().clearPortfolio()
					void disconnectWallet()
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
	const prevAddr = useRef<string | null>(null)
	useEffect(() => {
		const next = acc?.address?.toLowerCase() ?? null
		const prev = prevAddr.current
		prevAddr.current = next
		if (prev && next && prev !== next) {
			void revokeAwSession()
		} else if (prev && !next) {
			clearAwAuth()
		} else if (next) {
			const authed = getAwAuthAddress()?.toLowerCase() ?? null
			if (authed && authed !== next) void revokeAwSession()
		}
	}, [acc?.address])

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
