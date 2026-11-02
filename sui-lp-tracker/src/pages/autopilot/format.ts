/** en-US number formatting. No invented precision. */

export function formatMoney(value: number, fractionDigits = 2): string {
	if (!Number.isFinite(value)) return '—'
	return new Intl.NumberFormat('en-US', {
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: fractionDigits,
	}).format(value)
}

export function formatPrice(value: number): string {
	if (!Number.isFinite(value)) return '—'
	const digits = value >= 1 ? 4 : value >= 0.1 ? 5 : 6
	return new Intl.NumberFormat('en-US', {
		minimumFractionDigits: Math.min(digits, 4),
		maximumFractionDigits: digits,
	}).format(value)
}

export function formatPct(value: number, fractionDigits = 0): string {
	if (!Number.isFinite(value)) return '—'
	return `${formatMoney(value, fractionDigits)}%`
}

/**
 * Pool fee % — keep meaningful decimals (0.175 → "0.175%", not "0.18%").
 * Up to 3 fraction digits; trailing zeros trimmed.
 */
export function formatFeePct(value: number): string {
	if (!Number.isFinite(value)) return '—'
	const fixed = value.toFixed(3)
	const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
	return `${trimmed}%`
}

export function formatUsdCompact(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(value)) return '—'
	if (value >= 1_000_000) return `$${formatMoney(value / 1_000_000, 2)}M`
	if (value >= 1_000) return `$${formatMoney(value / 1_000, 1)}k`
	if (value >= 1) return `$${formatMoney(value, 0)}`
	return `$${formatMoney(value, 2)}`
}

export function formatRawBalance(raw: string, decimals: number, maxFrac = 4): string {
	if (!/^\d+$/.test(raw)) return '—'
	try {
		const scale = 10n ** BigInt(decimals)
		const v = BigInt(raw)
		const whole = v / scale
		const frac = (v % scale).toString().padStart(decimals, '0').replace(/0+$/, '').slice(0, maxFrac)
		const base = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
		return frac ? `${base}.${frac}` : base
	} catch {
		return '—'
	}
}

export const SUI_DECIMALS = 9
export const USDC_DECIMALS = 6
