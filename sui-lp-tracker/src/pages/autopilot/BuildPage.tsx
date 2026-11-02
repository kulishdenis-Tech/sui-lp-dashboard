import { useCallback, useState } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { ConstructorPage } from './ConstructorPage'
import { PreviewDrawer } from './PreviewDrawer'
import { deleteConfig, loadConfigs, renameConfig } from './storage'
import type { ProtocolId, SavedConfiguration } from './types'
import './autopilot.css'

export function BuildPage() {
	const account = useCurrentAccount()
	const [previewBodies, setPreviewBodies] = useState<Record<string, unknown>[] | null>(null)
	const [toast, setToast] = useState<string | null>(null)
	const [drafts, setDrafts] = useState<SavedConfiguration[]>(() => loadConfigs())
	const [openConfig, setOpenConfig] = useState<SavedConfiguration | null>(null)

	const refreshDrafts = useCallback(() => setDrafts(loadConfigs()), [])

	return (
		<div className="autopilot-root mx-auto min-w-0 max-w-6xl px-4 py-8">
			<div className="mb-3">
				<h2 className="text-lg font-semibold tracking-tight text-slate-100">Build · LP Constructor</h2>
			</div>

			{drafts.length > 0 ? (
				<section className="mb-4 rounded-lg border border-slate-700/70 bg-slate-900/40 p-3">
					<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
						Saved drafts
					</h3>
					<ul className="space-y-2">
						{drafts.slice(0, 8).map((d) => (
							<li
								key={d.id}
								className="flex flex-wrap items-center gap-2 text-sm text-slate-300"
							>
								<span className="min-w-0 flex-1 truncate font-medium text-slate-100">{d.name}</span>
								<span className="text-xs text-slate-500">
									{d.slot} · {d.layout} · {new Date(d.createdAtMs).toLocaleString('en-US')}
								</span>
								<button
									type="button"
									className="linkish"
									onClick={() => setOpenConfig(d)}
								>
									Load
								</button>
								<button
									type="button"
									className="linkish"
									onClick={() => {
										const next = window.prompt('Rename draft', d.name)
										if (!next) return
										renameConfig(d.id, next)
										refreshDrafts()
									}}
								>
									Rename
								</button>
								<button
									type="button"
									className="linkish"
									onClick={() => {
										if (!window.confirm(`Delete draft “${d.name}”?`)) return
										deleteConfig(d.id)
										refreshDrafts()
									}}
								>
									Delete
								</button>
							</li>
						))}
					</ul>
				</section>
			) : null}

			<ConstructorPage
				openConfig={openConfig}
				onOpenConfigConsumed={() => {
					setOpenConfig(null)
					refreshDrafts()
				}}
				onDraftSaved={refreshDrafts}
				onOpenPreview={(draft) => {
					const owner = account?.address ?? ''
					const totalBudget = draft.lps.reduce((s, lp) => s + lp.budget, 0)
					setPreviewBodies([
						{
							kind: 'open',
							protocol: draft.protocol as ProtocolId,
							owner,
							poolId: draft.poolId,
							slot: draft.slot,
							hardPrice: draft.hardPrice,
							binStrategy: draft.binStrategy,
							lps: draft.lps.map((lp) => ({
								id: lp.id,
								lowerPrice: lp.lowerPrice,
								upperPrice: lp.upperPrice,
								budget: lp.budget,
								binStrategy: lp.binStrategy ?? draft.binStrategy,
							})),
							lpCount: draft.lps.length,
							totalBudget,
							levelId:
								draft.lps.length > 1
									? `CASCADE · ${draft.lps.length} LP`
									: (draft.lps[0]?.id ?? 'OPEN'),
							review: draft.review,
						},
					])
				}}
			/>

			{toast ? (
				<div className="toast" role="status">
					{toast}
					<button type="button" className="linkish" onClick={() => setToast(null)}>
						OK
					</button>
				</div>
			) : null}

			{previewBodies ? (
				<PreviewDrawer
					openBodies={previewBodies}
					onClose={() => setPreviewBodies(null)}
					onSubmitted={({ digest, kind, index }) => {
						setToast(
							`Sent ${kind} #${index + 1}: ${digest.slice(0, 10)}… · see LP / Refresh`,
						)
						window.setTimeout(() => setToast(null), 12_000)
					}}
				/>
			) : null}
		</div>
	)
}
