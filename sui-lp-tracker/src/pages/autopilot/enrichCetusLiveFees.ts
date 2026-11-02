import type { OpenPosition } from '@/types'
import { isNativeSuiCoinType } from '@/utils/suiCoinType'

type AutopilotPos = {
	positionId?: string
	protocol?: string
	feeUsdEstimate?: number
	feeSui?: number | null
	feeUsdc?: number | null
	unclaimedFeeAprPercent?: number | null
	openTxDigest?: string | null
	ageDays?: number | null
}

function finiteOrNull(n: unknown): number | null {
	const v = typeof n === 'number' ? n : Number(n)
	return Number.isFinite(v) && v >= 0 ? v : null
}

/**
 * Map bot SUI/USDC fee legs onto tracker A/B after stablecoin normalization
 * (crypto as tokenA, USDC as tokenB when one leg is stable).
 */
function feeLegsForTracker(
	p: OpenPosition,
	feeSui: number | null,
	feeUsdc: number | null,
): { unclaimedFeeA: number; unclaimedFeeB: number } | null {
	if (feeSui == null && feeUsdc == null) return null
	const sui = feeSui ?? 0
	const usdc = feeUsdc ?? 0
	const aIsSui =
		isNativeSuiCoinType(p.tokenAAddress) || p.tokenA.trim().toUpperCase() === 'SUI'
	const bIsSui =
		isNativeSuiCoinType(p.tokenBAddress) || p.tokenB.trim().toUpperCase() === 'SUI'
	if (aIsSui && !bIsSui) return { unclaimedFeeA: sui, unclaimedFeeB: usdc }
	if (bIsSui && !aIsSui) return { unclaimedFeeA: usdc, unclaimedFeeB: sui }
	// Fallback: assume A=SUI orientation used by bot legs.
	return { unclaimedFeeA: sui, unclaimedFeeB: usdc }
}

/**
 * Merge live Cetus fees from Autopilot bot (`fetchPosFeeAmount` path on 5191)
 * into tracker open rows. Updates USD total and per-token fee legs when present.
 */
export async function enrichCetusLiveFeesFromBot(
	owner: string,
	positions: OpenPosition[],
): Promise<OpenPosition[]> {
	const cetus = positions.filter((p) => p.protocol === 'cetus' && !p.cetusVault)
	if (!owner.startsWith('0x') || cetus.length === 0) return positions

	try {
		const r = await fetch(
			`/api/autopilot/positions?owner=${encodeURIComponent(owner)}&protocol=all`,
		)
		if (!r.ok) return positions
		const j = (await r.json()) as { positions?: AutopilotPos[] }
		const rows = Array.isArray(j.positions) ? j.positions : []
		if (rows.length === 0) return positions

		const byId = new Map<string, AutopilotPos>()
		for (const row of rows) {
			if (!row.positionId) continue
			byId.set(row.positionId, row)
			byId.set(row.positionId.toLowerCase(), row)
		}

		return positions.map((p) => {
			if (p.protocol !== 'cetus' || p.cetusVault) return p
			const live = byId.get(p.id) ?? byId.get(p.id.toLowerCase())
			if (!live) return p
			const fee = Number(live.feeUsdEstimate)
			if (!Number.isFinite(fee) || fee < 0) return p
			const currentUnclaimed = Number.isFinite(p.unclaimedFeeUSD) ? p.unclaimedFeeUSD : 0
			const currentRewards = Number.isFinite(p.unclaimedRewardUSD) ? p.unclaimedRewardUSD : 0
			const feeSui = finiteOrNull(live.feeSui)
			const feeUsdc = finiteOrNull(live.feeUsdc)
			const legs = feeLegsForTracker(p, feeSui, feeUsdc)
			const legsMissing =
				!(Number.isFinite(p.unclaimedFeeA) && p.unclaimedFeeA > 0) &&
				!(Number.isFinite(p.unclaimedFeeB) && p.unclaimedFeeB > 0)
			// Prefer bot live quote when tracker unclaimed fee is still ~0, or legs are empty.
			if (fee <= 0.0001 && currentUnclaimed + currentRewards > 0.0001 && !legsMissing) return p
			const nextUsd =
				fee > 0.0001 || currentUnclaimed <= 0.0001 ? fee : currentUnclaimed
			const next: OpenPosition = {
				...p,
				unclaimedFeeUSD: nextUsd,
			}
			if (legs && (legsMissing || fee > 0.0001)) {
				next.unclaimedFeeA = legs.unclaimedFeeA
				next.unclaimedFeeB = legs.unclaimedFeeB
				// Recompute USD from legs × spot when both prices known (keeps detail table in sync).
				const pxA = Number.isFinite(p.currentPriceA_USD) ? p.currentPriceA_USD : null
				const pxB = Number.isFinite(p.currentPriceB_USD) ? p.currentPriceB_USD : null
				if (pxA != null && pxB != null) {
					const fromLegs = legs.unclaimedFeeA * pxA + legs.unclaimedFeeB * pxB
					if (Number.isFinite(fromLegs) && fromLegs >= 0) {
						next.unclaimedFeeUSD = fromLegs > 0.0001 ? fromLegs : nextUsd
					}
				}
			}
			return next
		})
	} catch {
		return positions
	}
}

/** Digests from bot positions — used to bind Build cascade records. */
export async function fetchAutopilotOpenDigests(
	owner: string,
): Promise<Map<string, string>> {
	const out = new Map<string, string>()
	if (!owner.startsWith('0x')) return out
	try {
		const r = await fetch(
			`/api/autopilot/positions?owner=${encodeURIComponent(owner)}&protocol=all`,
		)
		if (!r.ok) return out
		const j = (await r.json()) as { positions?: AutopilotPos[] }
		for (const row of Array.isArray(j.positions) ? j.positions : []) {
			if (row.positionId && row.openTxDigest) {
				out.set(row.positionId, row.openTxDigest)
				out.set(row.positionId.toLowerCase(), row.openTxDigest)
			}
		}
	} catch {
		/* ignore */
	}
	return out
}
