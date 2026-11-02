/**
 * Exact on-chain reads for Auto Withdraw monitor / rule upsert.
 * Never signs. Failures surface as check_failed / 400 — not silent completion.
 */
import { getProvider, type ProtocolId } from '@autopilot/cetus'
import type { AwExactPositionRead } from './autoWithdrawMonitor.js'

const POSITION_ID_RE = /^0x[0-9a-fA-F]{64}$/

export function requireFullPositionId(positionId: string): string {
	const id = String(positionId ?? '')
	if (!POSITION_ID_RE.test(id)) {
		throw new Error('positionId must be a 32-byte Sui object id (0x + 64 hex)')
	}
	return id
}

/**
 * Confirm the authenticated owner currently holds this LP (list + pool match).
 */
export async function assertPositionOwnedBy(input: {
	owner: string
	protocol: ProtocolId
	poolId: string
	positionId: string
}): Promise<void> {
	const positionId = requireFullPositionId(input.positionId)
	const poolId = input.poolId.toLowerCase()
	const rows = await getProvider(input.protocol).listOwnerPositions(input.owner)
	const pos = rows.find((p) => p.positionId.toLowerCase() === positionId.toLowerCase())
	if (!pos) {
		throw new Error('Position not found under the authenticated wallet for this protocol.')
	}
	if (pos.poolId.toLowerCase() !== poolId) {
		throw new Error('Position poolId does not match the rule poolId.')
	}
}

/**
 * Exact position object read when the owner list omits an id.
 * Uses protocol SDK position fetch — not the paginated owner list.
 */
export async function readPositionExactDefault(
	positionId: string,
	protocol: ProtocolId,
): Promise<AwExactPositionRead> {
	const id = requireFullPositionId(positionId)
	try {
		const provider = getProvider(protocol)
		// Prefer a direct get when the adapter exposes it via list of one — fall back to
		// scanning all owner lists is wrong here. Use provider.readPosition if present.
		const reader = provider as {
			readPosition?: (positionId: string) => Promise<{
				positionId: string
				poolId: string
				owner?: string
				liquidityRaw?: string
				amountSui?: number
				amountUsdc?: number
			} | null>
			getPosition?: (positionId: string) => Promise<{
				positionId: string
				poolId: string
				owner?: string
				liquidityRaw?: string
				amountSui?: number
				amountUsdc?: number
			} | null>
		}
		const direct = reader.readPosition ?? reader.getPosition
		if (direct) {
			const row = await direct.call(provider, id)
			if (!row) {
				return { exists: false, owner: null, poolId: null, liquidityRaw: null, source: 'exact-miss' }
			}
			const liq =
				row.liquidityRaw && /^\d+$/.test(row.liquidityRaw)
					? row.liquidityRaw
					: (row.amountSui ?? 0) > 0 || (row.amountUsdc ?? 0) > 0
						? '1'
						: '0'
			return {
				exists: true,
				owner: row.owner ?? null,
				poolId: row.poolId,
				liquidityRaw: liq,
				source: 'exact-provider',
			}
		}
		// No direct reader — cannot prove empty from list omission alone.
		return {
			exists: true,
			owner: null,
			poolId: null,
			liquidityRaw: 'unknown',
			source: 'exact-unavailable',
		}
	} catch {
		return { exists: false, owner: null, poolId: null, liquidityRaw: null, source: 'exact-error' }
	}
}
