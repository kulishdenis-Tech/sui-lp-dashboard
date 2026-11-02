import { useCallback, useEffect, useState } from 'react'
import { useWalletLabel } from '@/config/walletNicknameStore'
import { shortAddress } from '@/utils/formatting'
import { fetchAppVisits, type AppVisitRow } from '@/services/serverVisitsApi'

function formatVisitTime(iso: string): string {
	const d = new Date(iso)
	if (Number.isNaN(d.getTime())) return iso
	return d.toLocaleString(undefined, {
		year: 'numeric',
		month: 'short',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	})
}

type Props = {
	viewer: string
	open: boolean
	onClose: () => void
}

function VisitWallet({ address }: { address: string }) {
	const label = useWalletLabel(address)
	return (
		<td className="px-3 py-1.5 font-mono text-sky-200" title={label.title ?? shortAddress(address)}>
			{label.label}
		</td>
	)
}

export function VisitsPanel({ viewer, open, onClose }: Props) {
	const [rows, setRows] = useState<AppVisitRow[] | null>(null)
	const [loading, setLoading] = useState(false)
	const [err, setErr] = useState<string | null>(null)

	const load = useCallback(async () => {
		setLoading(true)
		setErr(null)
		const data = await fetchAppVisits(viewer)
		if (data == null) {
			setErr('Could not load visits')
			setRows([])
		} else {
			setRows(data)
		}
		setLoading(false)
	}, [viewer])

	useEffect(() => {
		if (!open) return
		void load()
	}, [open, load])

	useEffect(() => {
		if (!open) return
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') onClose()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [open, onClose])

	if (!open) return null

	return (
		<div
			className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh]"
			role="presentation"
			onClick={onClose}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="App visits"
				className="max-h-[70vh] w-full max-w-lg overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
					<h2 className="text-sm font-medium text-slate-200">Visits</h2>
					<div className="flex items-center gap-2">
						<button
							type="button"
							className="text-xs text-slate-500 underline hover:text-slate-300"
							onClick={() => void load()}
							disabled={loading}
						>
							Refresh
						</button>
						<button
							type="button"
							className="text-xs text-slate-500 underline hover:text-slate-300"
							onClick={onClose}
						>
							Close
						</button>
					</div>
				</div>
				<div className="max-h-[calc(70vh-2.5rem)] overflow-y-auto">
					{loading && rows == null ? (
						<p className="px-3 py-4 text-xs text-slate-500">Loading…</p>
					) : err ? (
						<p className="px-3 py-4 text-xs text-red-400">{err}</p>
					) : !rows || rows.length === 0 ? (
						<p className="px-3 py-4 text-xs text-slate-500">No visits yet.</p>
					) : (
						<table className="w-full text-left text-xs">
							<thead className="sticky top-0 bg-slate-950 text-slate-500">
								<tr>
									<th className="px-3 py-2 font-medium">When</th>
									<th className="px-3 py-2 font-medium">Wallet</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-800/80">
								{rows.map((r) => (
									<tr key={r.id} className="text-slate-300">
										<td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-400">
											{formatVisitTime(r.visitedAt)}
										</td>
										<VisitWallet address={r.walletAddr} />
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			</div>
		</div>
	)
}
