import type { OpenPosition } from '@/types'
import { clmmTickBand } from '@/utils/clmmTickBounds'
import { isEmptyLpPosition } from '@/utils/lpLifecycle'

/** Visual tone for the CLMM price-range strip. */
export type RangeBarTone = 'active' | 'empty' | 'out'

type RangeTick = Pick<OpenPosition, 'tickLower' | 'tickUpper' | 'currentTick' | 'status'> & {
	protocol?: string
	cetusSwapped?: boolean
}

/** CLMM half-open band: tick ∈ [lower, upper). */
export function tickInClmmRange(tick: number, lower: number, upper: number): boolean {
	return clmmTickBand({ currentTick: tick, tickLower: lower, tickUpper: upper }) === 'in'
}

function memberCoversTick(m: RangeTick, tick: number): boolean {
	const band = clmmTickBand({
		protocol: m.protocol,
		currentTick: tick,
		tickLower: m.tickLower,
		tickUpper: m.tickUpper,
		cetusSwapped: m.cetusSwapped,
	})
	if (band) return band === 'in'
	return m.status === 'in_range'
}

/**
 * Single LP strip:
 * - active + in band → blue
 * - empty + in band → gray (no principal liquidity)
 * - out of band → red
 */
export function rangeBarToneForPosition(
	p: RangeTick & Pick<OpenPosition, 'liquidity' | 'lifecycleStatus'>,
): RangeBarTone {
	const inBand = memberCoversTick(p, p.currentTick)
	if (!inBand) return 'out'
	return isEmptyLpPosition(p) ? 'empty' : 'active'
}

/**
 * Cascade strip (union of all member bands for the visual width):
 * 1. blue  — price in any funded (working) LP
 * 2. gray  — price only in Empty LP band(s)
 * 3. red   — price outside every member band
 */
export function rangeBarToneForCascade(
	members: Array<
		RangeTick & Pick<OpenPosition, 'liquidity' | 'lifecycleStatus'>
	>,
): RangeBarTone {
	if (members.length === 0) return 'out'
	const tick = members.find((m) => Number.isFinite(m.currentTick))?.currentTick ?? Number.NaN
	let inEmpty = false
	for (const m of members) {
		if (!memberCoversTick(m, tick)) continue
		if (!isEmptyLpPosition(m)) return 'active'
		inEmpty = true
	}
	return inEmpty ? 'empty' : 'out'
}
