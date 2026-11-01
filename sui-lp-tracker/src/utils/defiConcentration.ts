/** Soft concentration warning threshold (DeFi net portfolio share). */
export const CONCENTRATION_LIMIT_PCT = 15

/** Allowed rounding error when segment shares should sum to 100%. */
export const CONCENTRATION_SUM_TOLERANCE_PCT = 0.1

export type ConcentrationSegment = {
	key: string
	label: string
	valueUsd: number
	/** Null when net ≤ 0 (debt exceeds deposit). */
	sharePct: number | null
	overLimit: boolean
	debtExceedsDeposit?: boolean
	/** Informational only — no 15% limit (e.g. total Current share). */
	referenceOnly?: boolean
}

export type DefiConcentrationInput = {
	lpByProtocol: Array<{ protocol: string; valueUsd: number | null | undefined }>
	currentVenues: Array<{ key: string; label: string; netUsd: number | null | undefined }>
	otherLending?: Array<{ key: string; label: string; netUsd: number | null | undefined }>
}

export type DefiConcentrationResult = {
	baseUsd: number
	segments: ConcentrationSegment[]
	sumSharePct: number
}

function finitePositive(n: number | null | undefined): number | null {
	if (n == null || !Number.isFinite(n)) return null
	return n
}

export function computeDefiConcentration(input: DefiConcentrationInput): DefiConcentrationResult {
	const segments: ConcentrationSegment[] = []
	let baseUsd = 0

	for (const lp of input.lpByProtocol) {
		const v = finitePositive(lp.valueUsd)
		if (v == null || v <= 0) continue
		baseUsd += v
		segments.push({
			key: `lp:${lp.protocol}`,
			label: lp.protocol,
			valueUsd: v,
			sharePct: 0,
			overLimit: false,
		})
	}

	for (const v of input.currentVenues) {
		const net = finitePositive(v.netUsd)
		if (net == null) continue
		if (net <= 0) {
			segments.push({
				key: `current:${v.key}`,
				label: v.label,
				valueUsd: net,
				sharePct: null,
				overLimit: false,
				debtExceedsDeposit: true,
			})
			continue
		}
		baseUsd += net
		segments.push({
			key: `current:${v.key}`,
			label: v.label,
			valueUsd: net,
			sharePct: 0,
			overLimit: false,
		})
	}

	for (const o of input.otherLending ?? []) {
		const net = finitePositive(o.netUsd)
		if (net == null || net <= 0) continue
		baseUsd += net
		segments.push({
			key: o.key,
			label: o.label,
			valueUsd: net,
			sharePct: 0,
			overLimit: false,
		})
	}

	let sumSharePct = 0
	for (const s of segments) {
		if (s.sharePct === null || s.debtExceedsDeposit) continue
		if (baseUsd <= 0) {
			s.sharePct = null
			continue
		}
		const pct = (s.valueUsd / baseUsd) * 100
		s.sharePct = pct
		sumSharePct += pct
		s.overLimit = pct > CONCENTRATION_LIMIT_PCT + 1e-9
	}

	return { baseUsd, segments, sumSharePct }
}

export function concentrationSumWithinTolerance(sumSharePct: number): boolean {
	return Math.abs(sumSharePct - 100) <= CONCENTRATION_SUM_TOLERANCE_PCT + 1e-9
}

/** Total Current net share (reference, no limit). */
export function currentAggregateReferenceSegment(
	currentVenues: Array<{ netUsd: number | null | undefined }>,
	baseUsd: number,
): ConcentrationSegment | null {
	let total = 0
	for (const v of currentVenues) {
		const n = finitePositive(v.netUsd)
		if (n != null && n > 0) total += n
	}
	if (baseUsd <= 0 || total <= 0) return null
	const pct = (total / baseUsd) * 100
	return {
		key: 'current:all',
		label: 'Current (усі ринки)',
		valueUsd: total,
		sharePct: pct,
		overLimit: false,
		referenceOnly: true,
	}
}
