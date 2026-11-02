/** Avoid classic float drift when stepping money / prices. */

export function roundTo(value: number, decimals: number): number {
	const scale = 10 ** decimals
	return Math.round((value + Number.EPSILON) * scale) / scale
}

export function addScaled(value: number, delta: number, decimals: number): number {
	const scale = 10 ** decimals
	return (Math.round(value * scale) + Math.round(delta * scale)) / scale
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

export const PARSE_NUMBER_HINT =
	'Use a clear decimal (0.895 or 0,895). For thousands write 1,500.00 or 1500.'

/**
 * Parse user number input with an unambiguous separator policy.
 *
 * - Both `,` and `.` → last separator is decimal; the other is thousands (`1,500.00`, `1.500,00`).
 * - Only `.` → decimal point (`0.895`, `1500.25`).
 * - Only `,`:
 *   - fractional length ≠ 3 → decimal comma (`1,5`, `0,25`).
 *   - integer part `0` → decimal comma even with 3 digits (`0,895`, `0,001`).
 *   - otherwise 3-digit group alone is ambiguous (`1,500` vs `1.500`) → reject.
 * - Multiple commas without a dot: accept only strict thousands groups (`1,500,000`).
 */
export function parseLocaleNumber(raw: string): number | null {
	let s = raw.trim().replace(/\s/g, '').replace(/_/g, '')
	if (!s || s === '-' || s === '.' || s === ',') return null
	const hasComma = s.includes(',')
	const hasDot = s.includes('.')

	if (hasComma && hasDot) {
		const lastComma = s.lastIndexOf(',')
		const lastDot = s.lastIndexOf('.')
		if (lastComma > lastDot) {
			s = s.replace(/\./g, '').replace(',', '.')
		} else {
			s = s.replace(/,/g, '')
		}
	} else if (hasComma && !hasDot) {
		const parts = s.split(',')
		if (parts.length > 2) {
			// Strict thousands: 1,500,000
			const intPart = parts[0]!
			if (!/^-?\d+$/.test(intPart)) return null
			for (let i = 1; i < parts.length; i++) {
				if (!/^\d{3}$/.test(parts[i]!)) return null
			}
			s = parts.join('')
		} else if (parts.length === 2) {
			const [left, right] = parts as [string, string]
			if (!/^-?\d+$/.test(left) || !/^\d+$/.test(right)) return null
			if (right.length !== 3) {
				s = `${left}.${right}`
			} else if (/^-?0$/.test(left)) {
				// Price-scale decimals: 0,895 → 0.895 (never 895)
				s = `${left}.${right}`
			} else {
				// Ambiguous: 1,500 could be 1500 or 1.500
				return null
			}
		} else {
			return null
		}
	}

	if (!/^-?\d+(\.\d+)?$/.test(s)) return null
	const n = Number(s)
	return Number.isFinite(n) ? n : null
}
