import type { OpenPosition } from '@/types'
import { isEmptyLpPosition } from '@/utils/lpLifecycle'
import type { ManageActionDef, ManageActionId, ManageProtocol } from './manageProtocol'

export function autopilotProtocol(p: OpenPosition): ManageProtocol {
	if (p.protocol === 'bluefin') return 'bluefin'
	return p.cetusDlmm ? 'dlmm' : 'clmm'
}

export function shortPosId(id: string): string {
	if (id.length < 12) return id
	return `${id.slice(0, 6)}…${id.slice(-4)}`
}

export function manageProtocolLabel(protocol: ManageProtocol): string {
	return protocol === 'bluefin' ? 'Bluefin' : protocol === 'dlmm' ? 'Cetus DLMM' : 'Cetus'
}

/** Preview body for PreviewDrawer (shared by desktop menu and mobile sheet). */
export function buildManagePreviewBody(
	position: OpenPosition,
	owner: string,
	kind: string,
	extra?: Record<string, unknown>,
): Record<string, unknown> {
	const protocol = autopilotProtocol(position)
	const empty = isEmptyLpPosition(position)
	const protocolLabel = manageProtocolLabel(protocol)
	return (
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
		}
	)
}

/** Maps a menu action to preview kind + extras (shared). */
export function manageActionToRun(
	protocol: ManageProtocol,
	def: ManageActionDef,
	id: ManageActionId,
): { kind: string; extra?: Record<string, unknown> } {
	if (id === 'add_liquidity') {
		return { kind: 'add', extra: { showAddControls: true, fixCoin: 'A', amountHuman: null, collectFee: false } }
	}
	if (id === 'remove_partial') {
		if (protocol === 'dlmm') {
			return { kind: 'remove_converted', extra: { slot: 'BUY', percent: 0.5, showPercentControls: true } }
		}
		return { kind: 'remove', extra: { removePercent: 0.5, showPercentControls: true } }
	}
	return { kind: def.kind, extra: def.defaultExtra }
}

/** Manage/Collect are wired for Cetus (CLMM/DLMM) and Bluefin only. */
export function canManagePosition(p: OpenPosition): boolean {
	return p.protocol === 'bluefin' || p.protocol === 'cetus'
}
