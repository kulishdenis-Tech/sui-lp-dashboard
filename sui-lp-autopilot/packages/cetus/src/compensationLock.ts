import { normalizeSuiAddress } from '@mysten/sui/utils'
import { getClmmSdk } from './sdkClmm.js'

/** Official Cetus pool abort: cannot burn NFT used as post-hack compensation certificate. */
export const CETUS_CANNOT_CLOSE_ATTACKED_ABORT = 23

export const CETUS_CLOSE_LOCKED_MESSAGE =
	'This Cetus position received post-incident compensation. The NFT is a recovery certificate and cannot be closed or burned. You can still Add, Withdraw, and Collect on it.'

function normId(id: string): string {
	try {
		return normalizeSuiAddress(id)
	} catch {
		return id.toLowerCase()
	}
}

/**
 * True when the pool's PositionLiquiditySnapshot still lists this position.
 * Official Cetus docs: compensated positions can no longer be closed.
 * Contract: `pool::close_position` → `ECannotCloseAttackedPosition` (23).
 */
export async function isCetusCompensationLockedPosition(
	poolId: string,
	positionId: string,
): Promise<boolean> {
	const sdk = getClmmSdk()
	const pos = normId(positionId)
	try {
		const snap = await sdk.Pool.getPoolLiquiditySnapshot(poolId, false)
		const tableId = snap?.snapshots?.id
		if (!tableId) return false
		const rows = await sdk.Pool.getPositionSnapshot(tableId, [positionId])
		if (!Array.isArray(rows) || rows.length === 0) return false
		return rows.some((r) => {
			const id = (r as { position_id?: string; positionId?: string }).position_id
				?? (r as { positionId?: string }).positionId
			return id != null && normId(String(id)) === pos
		})
	} catch {
		// Missing snapshot DOF / parse noise for non-listed positions → not locked.
		return false
	}
}
