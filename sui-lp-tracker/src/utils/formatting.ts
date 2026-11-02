import Decimal from 'decimal.js'

const STABLECOIN_SYMBOLS_UPPER = new Set(
	[
		'USDC',
		'USDT',
		'DAI',
		'BUSD',
		'TUSD',
		'USDD',
		'FDUSD',
		'USDP',
		'PYUSD',
		'USDE',
		'AUSD',
		'USDY',
		'USDX',
	].map((s) => s.toUpperCase()),
)

/** Display tickers treated as ~$1 stables (token qty shown to cents in lists). */
export function isStablecoinSymbol(symbol: string | null | undefined): boolean {
	if (symbol == null || symbol === '') return false
	return STABLECOIN_SYMBOLS_UPPER.has(symbol.trim().toUpperCase())
}

/**
 * Кількість токена в таблицях дешборду: стейбли — до сотих, інше — до `maxVolatileDecimals`.
 */
export function formatDashboardTokenQty(symbol: string, qty: number, maxVolatileDecimals = 4): string {
	const stable = isStablecoinSymbol(symbol)
	const maxFrac = stable ? 2 : maxVolatileDecimals
	return qty.toLocaleString('en-US', {
		minimumFractionDigits: stable ? 2 : 0,
		maximumFractionDigits: maxFrac,
	})
}

/** Finite number for display; rejects NaN/±Infinity. Collapses -0 to 0. */
export function asFiniteNumber(n: number | null | undefined): number | null {
	if (n == null || !Number.isFinite(n)) return null
	return Object.is(n, -0) ? 0 : n
}

/**
 * Fiat USD displays (en-US). Missing/nonfinite → em dash.
 * Tiny non-zero amounts → `<$0.01` / `>-$0.01` so they are not rounded to $0.00.
 */
export function formatUSD(n: number | null | undefined, digits = 2): string {
	const v = asFiniteNumber(n)
	if (v == null) return '—'
	if (v !== 0 && Math.abs(v) < 0.01 && digits >= 2) return v < 0 ? '>-$0.01' : '<$0.01'
	const normalized = Object.is(v, -0) ? 0 : v
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	}).format(normalized)
}

/** Large dashboard USD: ≥$1,000 without cents; smaller with cents. */
export function formatUSDAdaptive(n: number | null | undefined): string {
	const v = asFiniteNumber(n)
	if (v == null) return '—'
	return formatUSD(v, Math.abs(v) >= 1_000 ? 0 : 2)
}

/** A balance with no spot price is unpriced, not a silent $0. A real zero balance stays $0. */
export function formatHoldingUsd(holding: {
	humanBalance: number
	priceUSD: number | null
	valueUSD: number | null
}): string {
	const priced =
		holding.priceUSD != null && Number.isFinite(holding.priceUSD) && holding.priceUSD > 0
	if (holding.humanBalance > 0 && !priced) return 'unpriced'
	return formatUSD(holding.valueUSD)
}

/** Format a decimal APR/APY fraction (e.g. 0.0512 → "5.12%"). */
export function formatPct(n: number | null | undefined, digits = 2): string {
	const v = asFiniteNumber(n)
	if (v == null) return '—'
	return (v * 100).toFixed(digits) + '%'
}

export function formatTokenAmount(
	raw: bigint | string,
	decimals: number,
	displayDecimals = 4,
): string {
	const d = new Decimal(typeof raw === 'bigint' ? raw.toString() : raw)
		.div(new Decimal(10).pow(decimals))
	if (d.abs().lt(0.0001) && !d.isZero()) return d.toSignificantDigits(4).toString()
	return d.toFixed(displayDecimals).replace(/\.?0+$/, '') || '0'
}

export function shortAddress(addr: string, start = 6, end = 4): string {
	if (addr.length <= start + end) return addr
	return `${addr.slice(0, start)}…${addr.slice(-end)}`
}

/** ISO UTC без літери T (підпис: «... UTC»). */
export function formatUtcNoT(timestampSec: number): string {
	if (!Number.isFinite(timestampSec) || timestampSec <= 0) return '—'
	const s = new Date(timestampSec * 1000).toISOString()
	return s.replace('T', ' ').slice(0, 19) + ' UTC'
}

/**
 * Кількість десяткових у кількості токена, щоб крок ~$0.01 (ціна 1 токена в USD).
 * Дорогі активи (ETH) → більше дробу; дешеві (SUI) → менше.
 */
export function decimalsForCentEquivalent(usdPerToken: number | null | undefined): number {
	if (usdPerToken == null || !Number.isFinite(usdPerToken) || usdPerToken <= 0) return 4
	const d = Math.log10(usdPerToken / 0.01)
	return Math.max(0, Math.min(8, Math.round(d)))
}

/**
 * Кількість токенів з округленням «до ~1 цента в еквіваленті».
 */
export function formatTokenAmountForCentStep(
	amount: number,
	usdPerToken: number | null | undefined,
): string {
	if (!Number.isFinite(amount) || amount === 0) return '—'
	const d = decimalsForCentEquivalent(usdPerToken)
	const s = amount.toFixed(d)
	// Only strip zeros after the decimal point. An optional dot would turn 200000 into 2.
	if (!s.includes('.')) return s
	return s.replace(/0+$/, '').replace(/\.$/, '') || '0'
}

/** Дата/час для історії (UTC), як на реф-скріні: 25/04/2026, 10:01:27 */
export function formatUtcEnGbHistory(timestampSec: number): string {
	if (!Number.isFinite(timestampSec) || timestampSec <= 0) return '—'
	return new Date(timestampSec * 1000).toLocaleString('en-GB', {
		timeZone: 'UTC',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	})
}

/**
 * Скорочення package id з coin type (рядок `0x…::module::TYP`), як у гаманці.
 */
export function shortCoinTypePackage(coinType: string, start = 6, end = 4): string {
	const i = coinType.indexOf('::')
	if (i <= 0) return shortAddress(coinType, start, end)
	return shortAddress(coinType.slice(0, i), start, end)
}
