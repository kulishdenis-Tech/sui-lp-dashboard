import { useState } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import type { OpenPosition } from '@/types'
import { isEmptyLpPosition } from '@/utils/lpLifecycle'
import { PreviewDrawer } from '@/pages/autopilot/PreviewDrawer'
import { manageActionsForPosition, type ManageActionId } from '@/pages/autopilot/manageProtocol'
import {
	autopilotProtocol,
	canManagePosition,
	buildManagePreviewBody,
	manageActionToRun,
	manageProtocolLabel,
	shortPosId,
} from '@/pages/autopilot/manageBodies'
import { AutoWithdrawManageSection } from '@/pages/autopilot/AutoWithdrawManageSection'
import '@/pages/autopilot/autopilot.css'
import { Sheet } from './Sheet'

/**
 * Mobile manage flow: action sheet → the same PreviewDrawer (build, simulate, sign) as desktop.
 * Works read-only for a watched address (preview only; signing needs the owner wallet).
 */
export function ManageActions({ position, unclaimedUsd }: { position: OpenPosition; unclaimedUsd: number }) {
	const account = useCurrentAccount()
	const { address } = useWalletAuth()
	const [sheet, setSheet] = useState(false)
	const [bodies, setBodies] = useState<Record<string, unknown>[] | null>(null)

	const owner = account?.address ?? address ?? ''
	const viewingOwn = !!account?.address && !!address && account.address.toLowerCase() === address.toLowerCase()
	const protocol = autopilotProtocol(position)
	const actions = manageActionsForPosition(protocol, position)
	const collect = actions.find((a) => a.id === 'collect_fee')

	if (!canManagePosition(position) || !owner) return null

	function run(id: ManageActionId) {
		const def = actions.find((a) => a.id === id)
		if (!def || def.disabledReason) return
		const r = manageActionToRun(protocol, def, id)
		setSheet(false)
		setBodies([buildManagePreviewBody(position, owner, r.kind, r.extra)])
	}

	const canCollect = !!collect && !collect.disabledReason && unclaimedUsd > 0

	return (
		<>
			<div className="grid grid-cols-2 gap-2">
				<button
					type="button"
					disabled={!canCollect}
					onClick={() => run('collect_fee')}
					className="h-11 rounded-xl bg-emerald-500/20 text-sm font-medium text-emerald-200 active:bg-emerald-500/30 disabled:opacity-40"
				>
					Collect
				</button>
				<button
					type="button"
					onClick={() => setSheet(true)}
					className="h-11 rounded-xl border border-slate-700 bg-slate-900/60 text-sm font-medium text-slate-100 active:bg-slate-800"
				>
					Manage ▾
				</button>
			</div>

			<Sheet open={sheet} onClose={() => setSheet(false)} title="Manage position">
				<p className="px-1 pb-2 text-xs text-slate-400">
					{position.tokenA}/{position.tokenB} · {manageProtocolLabel(protocol)}
					{isEmptyLpPosition(position) ? ' · Empty' : ''} · {shortPosId(position.id)}
				</p>
				{!viewingOwn ? (
					<p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
						View only: connect the owner wallet to send.
					</p>
				) : null}
				<div className="space-y-1.5 pb-2">
					{actions.map((a) => {
						const disabled = !!a.disabledReason
						return (
							<button
								key={a.id}
								type="button"
								disabled={disabled}
								onClick={() => run(a.id)}
								className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-left active:bg-slate-800 disabled:opacity-45"
							>
								<span className="block text-sm font-medium text-slate-100">{a.title}</span>
								<span className="mt-0.5 block text-xs leading-snug text-slate-400">
									{disabled ? (a.disabledShort ?? a.disabledReason) : a.description}
								</span>
							</button>
						)
					})}
				</div>
				<div className="autopilot-root pb-2">
					<AutoWithdrawManageSection
						position={position}
						owner={owner}
						canConfigure={viewingOwn}
						onReviewWithdrawAll={(previewBody) => {
							setSheet(false)
							setBodies([
								{
									...buildManagePreviewBody(position, owner, 'remove'),
									removePercent: 1,
									fromAutoWithdraw: true,
									positionStaysOpenAndEmpty: true,
									...previewBody,
								},
							])
						}}
					/>
				</div>
			</Sheet>

			{bodies ? <PreviewDrawer openBodies={bodies} onClose={() => setBodies(null)} /> : null}
		</>
	)
}
