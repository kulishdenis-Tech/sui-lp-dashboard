import type { StrategySlot } from '@autopilot/engine'

/**
 * High-level intent for MANUAL_SIGN / Vault entry — never a raw unrestricted PTB.
 * Live builders wire `@cetusprotocol/dlmm-sdk` direct pool calls (not router transfer-to-sender).
 */
export type OpenLevelIntent = {
	kind: 'open_level'
	slot: StrategySlot
	levelId: string
	poolId: string
	lowerBinId: number
	upperBinId: number
	amountsA: string[]
	amountsB: string[]
	bins: number[]
	/** Must be vault entry target in AUTO_GUARDED */
	custody: 'vault' | 'owner_wallet'
}

export type CloseLevelIntent = {
	kind: 'close_level'
	slot: StrategySlot
	levelId: string
	poolId: string
	positionId: string
	custody: 'vault' | 'owner_wallet'
}

export type TxIntent = OpenLevelIntent | CloseLevelIntent

export function describeIntent(intent: TxIntent): string {
	if (intent.kind === 'open_level') {
		return `open ${intent.slot}/${intent.levelId} bins ${intent.lowerBinId}..${intent.upperBinId} → ${intent.custody}`
	}
	return `close ${intent.slot}/${intent.levelId} position ${intent.positionId} → ${intent.custody}`
}
