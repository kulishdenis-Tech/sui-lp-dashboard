import { useCallback, useEffect, useState } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { ConstructorPage } from './ConstructorPage'
import { PreviewDrawer } from './PreviewDrawer'
import { deleteConfig, loadConfigs, renameConfig } from './storage'
import type { ProtocolId, SavedConfiguration } from './types'
import './autopilot.css'

type WizardStep = 1 | 2 | 3 | 4
const WIZARD_STEPS: Array<{ n: WizardStep; label: string }> = [
	{ n: 1, label: 'Налаштування' },
	{ n: 2, label: 'Параметри' },
	{ n: 3, label: 'Діапазони' },
	{ n: 4, label: 'Перевірка' },
]

/** Mobile wizard header: tappable steps (earlier ones only) + progress bar. */
function WizardHeader({ step, onStep }: { step: WizardStep; onStep: (n: WizardStep) => void }) {
	return (
		<div className="mb-3">
			<div className="flex items-center justify-between">
				<h2 className="text-base font-semibold tracking-tight text-slate-100">
					Build · {WIZARD_STEPS[step - 1]!.label}
				</h2>
				<span className="text-xs text-slate-500">Крок {step} з 4</span>
			</div>
			<ol className="mt-2 grid grid-cols-4 gap-1.5" aria-label="Кроки">
				{WIZARD_STEPS.map((s) => (
					<li key={s.n}>
						<button
							type="button"
							disabled={s.n > step}
							onClick={() => onStep(s.n)}
							aria-current={s.n === step ? 'step' : undefined}
							className={`h-1.5 w-full rounded-full border-0 p-0 ${
								s.n <= step ? 'bg-sky-500' : 'bg-slate-700'
							}`}
							title={s.label}
						/>
					</li>
				))}
			</ol>
		</div>
	)
}

export function BuildPage({ wizard = false }: { wizard?: boolean } = {}) {
	const [step, setStep] = useState<WizardStep>(1)
	const [status, setStatus] = useState({ hasPool: false, canPreview: false, blockReason: null as string | null })
	const onWizardStatus = useCallback(
		(s: { hasPool: boolean; canPreview: boolean; blockReason: string | null }) => setStatus(s),
		[],
	)
	useEffect(() => {
		if (wizard) window.scrollTo({ top: 0 })
	}, [wizard, step])
	const account = useCurrentAccount()
	const [previewBodies, setPreviewBodies] = useState<Record<string, unknown>[] | null>(null)
	const [toast, setToast] = useState<string | null>(null)
	const [drafts, setDrafts] = useState<SavedConfiguration[]>(() => loadConfigs())
	const [openConfig, setOpenConfig] = useState<SavedConfiguration | null>(null)

	const refreshDrafts = useCallback(() => setDrafts(loadConfigs()), [])

	return (
		<div className="autopilot-root mx-auto min-w-0 max-w-6xl px-3 py-4 md:px-4 md:py-8">
			{wizard ? (
				<WizardHeader step={step} onStep={setStep} />
			) : (
				<div className="mb-3">
					<h2 className="text-lg font-semibold tracking-tight text-slate-100">Build · LP Constructor</h2>
				</div>
			)}

			{drafts.length > 0 && (!wizard || step === 1) ? (
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
									onClick={() => {
										setOpenConfig(d)
										if (wizard) setStep(4)
									}}
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
				wizardStep={wizard ? step : undefined}
				onWizardStatus={wizard ? onWizardStatus : undefined}
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

			{wizard ? (
				<div className="wiz-nav">
					<button
						type="button"
						disabled={step === 1}
						onClick={() => setStep((s) => (s > 1 ? ((s - 1) as WizardStep) : s))}
					>
						← Назад
					</button>
					{step < 4 ? (
						<button
							type="button"
							className="primary"
							disabled={!status.hasPool}
							onClick={() => setStep((s) => (s < 4 ? ((s + 1) as WizardStep) : s))}
						>
							{status.hasPool ? 'Далі →' : 'Оберіть пул'}
						</button>
					) : (
						<span className="text-xs text-slate-500">
							{status.canPreview ? 'Готово до Preview' : (status.blockReason ?? 'Є помилки')}
						</span>
					)}
				</div>
			) : null}

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
