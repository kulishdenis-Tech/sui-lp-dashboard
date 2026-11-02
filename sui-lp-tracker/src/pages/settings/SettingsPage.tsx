import { useCallback, useEffect, useState } from 'react'
import { AppCard } from '@/components/ui/AppCard'
import { PageShell } from '@/components/ui/PageShell'
import { normalizeNickname, type WalletNickname } from '@/config/walletNicknames'
import { useWalletNicknames } from '@/config/walletNicknameStore'
import { shortAddress } from '@/utils/formatting'

function AccountRow({ row }: { row: WalletNickname }) {
	const { save } = useWalletNicknames()
	const [draft, setDraft] = useState(row.nickname)
	const [focused, setFocused] = useState(false)
	const [note, setNote] = useState<string | null>(null)
	const tail = shortAddress(row.address)
	const invalid = draft.trim().length > 0 && normalizeNickname(draft) == null

	useEffect(() => {
		if (!focused) setDraft(row.nickname)
	}, [focused, row.nickname])

	const persist = useCallback(
		async (value: string) => {
			const name = normalizeNickname(value)
			if (!name || name === row.nickname) return
			setNote('Saving')
			try {
				await save(row.address, name)
				setNote('Saved')
			} catch {
				setNote('Could not save — still showing the previous name')
			}
		},
		[row.address, row.nickname, save],
	)

	useEffect(() => {
		if (!focused) return
		const handle = window.setTimeout(() => {
			void persist(draft)
		}, 400)
		return () => window.clearTimeout(handle)
	}, [draft, focused, persist])

	return (
		<div className="flex flex-wrap items-center gap-3 py-3">
			<span className="w-28 shrink-0 font-mono text-xs text-slate-400" title={tail}>
				{tail}
			</span>
			<input
				aria-label={`Nickname for ${tail}`}
				value={draft}
				spellCheck={false}
				autoComplete="off"
				maxLength={24}
				onFocus={() => setFocused(true)}
				onBlur={() => {
					setFocused(false)
					void persist(draft)
				}}
				onChange={(event) => {
					setNote(null)
					setDraft(event.target.value)
				}}
				className="h-control w-48 rounded-control border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
			/>
			<span className={`text-xs ${invalid ? 'text-amber-300' : 'text-slate-500'}`}>
				{invalid ? 'Use 1–24 letters or numbers' : note}
			</span>
		</div>
	)
}

export function SettingsPage() {
	const { wallets } = useWalletNicknames()
	return (
		<PageShell as="main" className="py-8">
			<h2 className="text-section font-semibold text-slate-100">Settings</h2>
			<p className="mt-1 max-w-2xl text-sm text-slate-400">
				Nicknames for the two monitored accounts. A change here updates the risk card and every other
				label, from this browser and from any other device that opens this dashboard.
			</p>
			<AppCard className="mt-4 divide-y divide-slate-800 px-4">
				{wallets.map((row) => (
					<AccountRow key={row.address} row={row} />
				))}
			</AppCard>
		</PageShell>
	)
}
