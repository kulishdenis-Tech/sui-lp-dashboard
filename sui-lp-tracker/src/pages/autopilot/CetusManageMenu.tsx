import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useCurrentAccount } from '@mysten/dapp-kit'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import type { OpenPosition } from '@/types'
import { Button } from '@/components/ui/Button'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { isEmptyLpPosition } from '@/utils/lpLifecycle'
import { PreviewDrawer } from './PreviewDrawer'
import {
	manageActionsForPosition,
	type ManageActionId,
	type ManageProtocol,
} from './manageProtocol'
import { AutoWithdrawManageSection } from './AutoWithdrawManageSection'
import './autopilot.css'

function autopilotProtocol(p: OpenPosition): ManageProtocol {
	if (p.protocol === 'bluefin') return 'bluefin'
	return p.cetusDlmm ? 'dlmm' : 'clmm'
}

function shortPosId(id: string): string {
	if (id.length < 12) return id
	return `${id.slice(0, 6)}…${id.slice(-4)}`
}

/** Manage actions for Cetus / Bluefin LP rows — opens PreviewDrawer. */
export function CetusManageMenu({ position }: { position: OpenPosition }) {
	const account = useCurrentAccount()
	const { address } = useWalletAuth()
	const [open, setOpen] = useState(false)
	const [previewBodies, setPreviewBodies] = useState<Record<string, unknown>[] | null>(null)
	const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
	const rootRef = useRef<HTMLDivElement>(null)
	const btnRef = useRef<HTMLButtonElement>(null)
	const menuRef = useRef<HTMLDivElement>(null)
	const firstItemRef = useRef<HTMLButtonElement>(null)

	/** Prefer connected wallet; fall back to viewed address so preview/simulation works read-only. */
	const owner = account?.address ?? address ?? ''
	const viewingOwn =
		!!account?.address &&
		!!address &&
		account.address.toLowerCase() === address.toLowerCase()
	const canOpenManage = !!owner
	const protocol = autopilotProtocol(position)
	const empty = isEmptyLpPosition(position)
	const actions = manageActionsForPosition(protocol, position)
	const protocolLabel =
		protocol === 'bluefin' ? 'Bluefin' : protocol === 'dlmm' ? 'Cetus DLMM' : 'Cetus'

	useLayoutEffect(() => {
		if (!open || !btnRef.current) {
			setMenuStyle(null)
			return
		}
		const place = () => {
			const r = btnRef.current!.getBoundingClientRect()
			const approxH = 280
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
	}, [open, protocol])

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

	function run(kind: string, extra?: Record<string, unknown>) {
		if (!owner) return
		setOpen(false)
		setPreviewBodies([
			{
				kind,
				protocol,
				owner,
				poolId: position.poolId,
				positionId: position.id,
				liquidity: position.liquidity,
				lifecycleStatus: empty ? 'empty' : 'active',
				positionHint: {
					tokenA: position.tokenA,
					tokenB: position.tokenB,
					tokenAAddress: position.tokenAAddress,
					tokenBAddress: position.tokenBAddress,
					tokenADecimals: position.tokenADecimals,
					tokenBDecimals: position.tokenBDecimals,
					tokenAAmount: position.tokenAAmount,
					tokenBAmount: position.tokenBAmount,
					currentPriceA_USD: position.currentPriceA_USD,
					currentPriceB_USD: position.currentPriceB_USD,
					unclaimedFeeA: position.unclaimedFeeA,
					unclaimedFeeB: position.unclaimedFeeB,
					unclaimedFeeUSD: position.unclaimedFeeUSD,
					unclaimedRewardUSD: position.unclaimedRewardUSD,
					unclaimedRewardRows: position.unclaimedRewardRows,
					tickLower: position.tickLower,
					tickUpper: position.tickUpper,
					currentTick: position.currentTick,
					currentSqrtPrice: position.currentSqrtPrice,
					status: position.status,
				},
				/** Cetus may swap display to crypto/stable; builder needs pool-native A/B. */
				cetusSwapped: position.cetusSwapped === true,
				tokenAAddress: position.tokenAAddress,
				tokenBAddress: position.tokenBAddress,
				positionLabel: `${position.tokenA}/${position.tokenB}`,
				protocolLabel,
				positionShortId: shortPosId(position.id),
				...extra,
			},
		])
	}

	function onAction(id: ManageActionId) {
		const def = actions.find((a) => a.id === id)
		if (!def || def.disabledReason) return
		if (id === 'add_liquidity') {
			run('add', {
				showAddControls: true,
				fixCoin: 'A',
				amountHuman: null,
				/** Refill/top-up must not sweep fees — Collect is a separate action. */
				collectFee: false,
			})
			return
		}
		if (id === 'remove_partial') {
			if (protocol === 'dlmm') {
				run('remove_converted', {
					slot: 'BUY',
					percent: 0.5,
					showPercentControls: true,
				})
				return
			}
			run('remove', { removePercent: 0.5, showPercentControls: true })
			return
		}
		run(def.kind, def.defaultExtra)
	}

	const menu = open && menuStyle ? (
		<div
			ref={menuRef}
			className="rounded-lg border border-slate-700 p-2 shadow-xl"
			style={{ ...menuStyle, backgroundColor: '#020617' }}
			role="menu"
			aria-label="Manage position"
			onClick={(e) => e.stopPropagation()}
		>
			<p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-slate-400">
				{position.tokenA}/{position.tokenB} · {protocolLabel}
				{empty ? ' · Empty' : ''} · {shortPosId(position.id)}
			</p>
			{actions.map((a, i) => {
				const disabled = !!a.disabledReason
				const tip = a.disabledReason ?? a.description
				return (
					<div
						key={a.id}
						role="none"
						className={`flex items-center gap-0.5 rounded ${
							disabled ? 'opacity-45' : 'hover:bg-slate-800'
						}`}
					>
						<button
							ref={i === 0 ? firstItemRef : undefined}
							type="button"
							role="menuitem"
							disabled={disabled}
							aria-disabled={disabled || undefined}
							className={`min-w-0 flex-1 rounded px-2 py-2 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500 ${
								disabled ? 'cursor-not-allowed' : 'focus:bg-slate-800'
							}`}
							onClick={() => onAction(a.id)}
						>
							<span className="block text-sm font-medium text-slate-100">{a.title}</span>
							{disabled && a.disabledShort ? (
								<span className="mt-0.5 block text-xs leading-snug text-slate-400">
									{a.disabledShort}
								</span>
							) : null}
						</button>
						<TooltipIconButton tip={tip} aria-label={`About ${a.title}`} leadingClassName="mr-1" />
					</div>
				)
			})}
			<AutoWithdrawManageSection
				position={position}
				owner={owner}
				canConfigure={viewingOwn}
				onReviewWithdrawAll={(previewBody) => {
					setOpen(false)
					setPreviewBodies([
						{
							kind: 'remove',
							protocol,
							owner,
							poolId: position.poolId,
							positionId: position.id,
							liquidity: position.liquidity,
							lifecycleStatus: empty ? 'empty' : 'active',
							positionLabel: `${position.tokenA}/${position.tokenB}`,
							protocolLabel,
							positionShortId: shortPosId(position.id),
							removePercent: 1,
							fromAutoWithdraw: true,
							positionStaysOpenAndEmpty: true,
							...previewBody,
						},
					])
				}}
			/>
		</div>
	) : null

	const manageTitle = !canOpenManage
		? 'Connect a wallet or paste an address first'
		: viewingOwn
			? `Manage ${protocolLabel} position`
			: `Preview ${protocolLabel} actions (connect owner wallet to sign)`

	return (
		<div className="autopilot-root relative" ref={rootRef} data-manage-menu onClick={(e) => e.stopPropagation()}>
			<Button
				ref={btnRef}
				type="button"
				variant="secondary"
				size="compact"
				disabled={!canOpenManage}
				title={manageTitle}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
			>
				Manage ▾
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
