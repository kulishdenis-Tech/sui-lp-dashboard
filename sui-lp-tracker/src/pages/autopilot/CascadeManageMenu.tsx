import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useCurrentAccount } from '@mysten/dapp-kit'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import type { OpenPosition } from '@/types'
import { Button } from '@/components/ui/Button'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { PreviewDrawer } from './PreviewDrawer'
import {
	cascadeMembershipTrusted,
	confirmCascadeMembership,
	type CascadeRecord,
} from './cascadeGroups'
import {
	cascadeAppliesPhrase,
	cascadeManageActionsFor,
	cascadeManageConsequence,
	planCascadeManage,
	type CascadeManageActionId,
} from './cascadeManage'
import './autopilot.css'

type Props = {
	/** Display members — financial actions only when membershipTrusted. */
	members: OpenPosition[]
	record: CascadeRecord
	membershipTrusted?: boolean
	suggestedMembers?: OpenPosition[]
	/** Called after user confirms composition so the table can regroup. */
	onMembershipConfirmed?: () => void
}

/** Manage all LPs in a remembered cascade — sequential PreviewDrawer steps. */
export function CascadeManageMenu({
	members,
	record,
	membershipTrusted: membershipTrustedProp,
	suggestedMembers = [],
	onMembershipConfirmed,
}: Props) {
	const account = useCurrentAccount()
	const { address } = useWalletAuth()
	const [open, setOpen] = useState(false)
	const [previewBodies, setPreviewBodies] = useState<Record<string, unknown>[] | null>(null)
	const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
	const [planError, setPlanError] = useState<string | null>(null)
	const rootRef = useRef<HTMLDivElement>(null)
	const btnRef = useRef<HTMLButtonElement>(null)
	const menuRef = useRef<HTMLDivElement>(null)
	const firstItemRef = useRef<HTMLButtonElement>(null)

	const owner = account?.address ?? address ?? ''
	const canOpenManage = !!owner
	const viewingOwn =
		!!account?.address &&
		!!address &&
		account.address.toLowerCase() === address.toLowerCase()
	const membershipTrusted =
		membershipTrustedProp === true || cascadeMembershipTrusted(record)
	const protocol = record.protocol
	const actions = cascadeManageActionsFor(protocol)
	const n = members.length
	const protocolLabel =
		protocol === 'bluefin' ? 'Bluefin' : protocol === 'dlmm' ? 'Cetus DLMM' : 'Cetus'
	const pair =
		members[0] != null ? `${members[0].tokenA}/${members[0].tokenB}` : 'Cascade'

	useLayoutEffect(() => {
		if (!open || !btnRef.current) {
			setMenuStyle(null)
			return
		}
		const place = () => {
			const r = btnRef.current!.getBoundingClientRect()
			const approxH = 220
			const gap = 4
			const width = Math.min(300, Math.max(248, window.innerWidth - 16))
			const spaceBelow = window.innerHeight - r.bottom
			const openUp = spaceBelow < approxH && r.top > spaceBelow
			let left = r.right - width
			left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
			let top = openUp ? r.top - gap : r.bottom + gap
			if (openUp) top = Math.max(8, r.top - gap)
			else top = Math.min(top, window.innerHeight - 8)
			setMenuStyle({
				position: 'fixed',
				top,
				left,
				width,
				transform: openUp ? 'translateY(-100%)' : undefined,
				zIndex: 80,
				maxHeight: Math.min(approxH + 80, window.innerHeight - 16),
				overflowY: 'auto',
			})
		}
		place()
		window.addEventListener('scroll', place, true)
		window.addEventListener('resize', place)
		return () => {
			window.removeEventListener('scroll', place, true)
			window.removeEventListener('resize', place)
		}
	}, [open])

	useEffect(() => {
		if (!open) return
		function onDoc(e: MouseEvent) {
			const t = e.target as Node
			if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return
			setOpen(false)
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.stopPropagation()
				setOpen(false)
				btnRef.current?.focus()
			}
		}
		document.addEventListener('mousedown', onDoc)
		document.addEventListener('keydown', onKey)
		queueMicrotask(() => firstItemRef.current?.focus())
		return () => {
			document.removeEventListener('mousedown', onDoc)
			document.removeEventListener('keydown', onKey)
		}
	}, [open])

	function onAction(id: CascadeManageActionId) {
		if (!owner) return
		if (!membershipTrusted) {
			setPlanError('Confirm cascade membership before Manage actions.')
			return
		}
		setPlanError(null)
		const plan = planCascadeManage({
			members,
			record,
			actionId: id,
			owner,
			membershipTrusted: true,
			uiNetwork: 'mainnet',
		})
		if (plan.bodies.length === 0) {
			setPlanError(
				plan.skipped.length
					? `No eligible positions. ${plan.skipped.map((s) => `${s.shortId}: ${s.reasonShort}`).join(' · ')}`
					: 'No eligible positions in this cascade.',
			)
			return
		}
		setOpen(false)
		setPreviewBodies(
			plan.bodies.map((b) => ({
				...b,
				cascadeConsequence: cascadeManageConsequence(id, protocol),
			})),
		)
	}

	function onConfirmMembership() {
		if (!owner || !viewingOwn) return
		confirmCascadeMembership({
			digest: record.digest,
			positionIds: members.map((m) => m.id),
			owner,
			// Explicit UI network — do not invent scope from a missing record field.
			network: 'mainnet',
		})
		setPlanError(null)
		setOpen(false)
		onMembershipConfirmed?.()
	}

	const menu = open && menuStyle ? (
		<div
			ref={menuRef}
			className="rounded-lg border border-slate-700 p-2 shadow-xl"
			style={{ ...menuStyle, backgroundColor: '#020617' }}
			role="menu"
			aria-label="Manage cascade"
			onClick={(e) => e.stopPropagation()}
		>
			<p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-slate-400">
				{pair} · {protocolLabel} · Cascade · {n}
			</p>
			{!membershipTrusted ? (
				<div className="space-y-2 px-2 pb-2">
					<p className="text-xs text-amber-200/90">
						Membership is unconfirmed (legacy or incomplete proof). Group actions stay
						blocked until you confirm these {n} LP
						{suggestedMembers.length
							? ` · ${suggestedMembers.length} same-pool suggestion${suggestedMembers.length === 1 ? '' : 's'} not included`
							: ''}
						.
					</p>
					<ul className="max-h-28 overflow-y-auto text-[11px] text-slate-400">
						{members.map((m) => (
							<li key={m.id} className="font-mono">
								{m.tokenA}/{m.tokenB} · {m.id.slice(0, 8)}…
							</li>
						))}
					</ul>
					<button
						type="button"
						className="w-full rounded-md border border-sky-600/60 bg-sky-500/15 px-2 py-1.5 text-sm text-sky-100 disabled:opacity-40"
						disabled={!viewingOwn}
						onClick={onConfirmMembership}
					>
						Confirm these {n} LP for Manage
					</button>
				</div>
			) : (
				<>
					<p className="px-2 pb-2 text-xs text-slate-300">{cascadeAppliesPhrase(n)}</p>
					{actions.map((a, i) => (
						<div
							key={a.id}
							role="none"
							className="flex items-center gap-0.5 rounded hover:bg-slate-800"
						>
							<button
								ref={i === 0 ? firstItemRef : undefined}
								type="button"
								role="menuitem"
								className="min-w-0 flex-1 rounded px-2 py-2 text-left text-sm font-medium text-slate-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500 focus:bg-slate-800"
								onClick={() => onAction(a.id as CascadeManageActionId)}
							>
								{a.title}
							</button>
							<TooltipIconButton
								tip={a.description}
								aria-label={`About ${a.title}`}
								leadingClassName="mr-1"
							/>
						</div>
					))}
				</>
			)}
			{planError ? <p className="mt-2 px-2 text-xs text-amber-200">{planError}</p> : null}
			{!viewingOwn && canOpenManage ? (
				<p className="mt-2 px-2 text-xs text-amber-200/90">
					Connect the owner wallet to change settings.
				</p>
			) : null}
		</div>
	) : null

	const manageTitle = !canOpenManage
		? 'Connect a wallet or paste an address first'
		: !membershipTrusted
			? 'Confirm cascade membership before Manage'
			: viewingOwn
				? `Manage cascade · ${n} positions`
				: `Preview cascade actions (connect owner wallet to sign)`

	return (
		<div
			className="autopilot-root relative"
			ref={rootRef}
			data-manage-menu
			data-cascade-manage
			onClick={(e) => e.stopPropagation()}
		>
			<Button
				ref={btnRef}
				type="button"
				variant="secondary"
				size="compact"
				disabled={!canOpenManage || n < 1}
				title={manageTitle}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => {
					setPlanError(null)
					setOpen((v) => !v)
				}}
			>
				{membershipTrusted ? 'Manage ▾' : 'Confirm ▾'}
			</Button>
			{menu ? createPortal(menu, document.body) : null}
			{previewBodies ? (
				<PreviewDrawer
					openBodies={previewBodies}
					onClose={() => setPreviewBodies(null)}
					returnFocusRef={btnRef}
				/>
			) : null}
		</div>
	)
}
