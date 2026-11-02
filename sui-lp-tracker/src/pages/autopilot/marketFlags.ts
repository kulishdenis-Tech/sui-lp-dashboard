import { formatFeePct, formatPct, formatPrice, formatUsdCompact } from './format'
import { poolFeePercent, type PoolRow, type ProtocolId } from './types'

/** Same bar as Markets dust filter — real liquidity, not empty fee tiers. */
export const LIQUID_TVL_USD_MIN = 500

export function isLiquidPool(p: PoolRow): boolean {
	if (p.tvlUsd != null && Number.isFinite(p.tvlUsd) && p.tvlUsd >= LIQUID_TVL_USD_MIN) return true
	if (p.volume24hUsd != null && Number.isFinite(p.volume24hUsd) && p.volume24hUsd > 0) return true
	return false
}

/** Prefer liquid list; if none qualify, keep all so UI is never empty. */
export function filterPoolsForPicker(pools: PoolRow[], showDust: boolean): PoolRow[] {
	if (showDust) return pools
	const liquid = pools.filter(isLiquidPool)
	return liquid.length > 0 ? liquid : pools
}

export function sortPoolsByLiquidity(pools: PoolRow[]): PoolRow[] {
	return [...pools].sort((a, b) => (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1))
}

/**
 * Compact pool picker line: pair · fee · price (no APR/TVL/volume — those stay in Details).
 */
export function formatPoolSelectLabel(p: PoolRow, protocol?: ProtocolId): string {
	const fee = poolFeePercent(p)
	const feePart = fee == null ? 'fee —' : formatFeePct(fee)
	const proto =
		protocol === 'dlmm' ? 'DLMM' : protocol === 'bluefin' ? 'Bluefin' : protocol === 'clmm' ? 'CLMM' : null
	const parts = ['SUI/USDC', proto, feePart]
	if (p.priceUsdcPerSui > 0) parts.push(formatPrice(p.priceUsdcPerSui))
	if (!isLiquidPool(p)) parts.push('low liq.')
	return parts.filter(Boolean).join(' · ')
}

/** Extra metrics for tooltip / Details — not the selector label. */
export function formatPoolDetailsMetrics(p: PoolRow): string {
	const parts = [`TVL ${formatUsdCompact(p.tvlUsd)}`, `Vol ${formatUsdCompact(p.volume24hUsd)}`]
	if (p.aprPercent != null && Number.isFinite(p.aprPercent) && p.aprPercent > 0) {
		parts.push(`Pool APR ${formatPct(p.aprPercent, 0)}`)
	}
	return parts.join(' · ')
}

/** Drop junk vs anchor, then median — fallback when external market mark is missing. */
export function liquidMedianPrice(pools: PoolRow[], preFilterPct = 0.5): number | null {
	const ranked = [...pools]
		.filter((p) => p.priceUsdcPerSui > 0 && Number.isFinite(p.priceUsdcPerSui))
		.sort((a, b) => (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1))
	const anchor = ranked[0]?.priceUsdcPerSui
	if (!(anchor! > 0)) return null
	const sane = ranked
		.map((p) => p.priceUsdcPerSui)
		.filter((px) => Math.abs(px / anchor! - 1) <= preFilterPct)
		.sort((a, b) => a - b)
	if (!sane.length) return anchor!
	return sane[Math.floor(sane.length / 2)] ?? null
}

export function flags(p: PoolRow, ref: number | null, maxDeviation = 0.35): string[] {
	const out: string[] = []
	const ageMin = (Date.now() - p.fetchedAtMs) / 60_000
	if (ageMin > 5) out.push('stale data')
	if (ref != null && ref > 0 && Number.isFinite(p.priceUsdcPerSui) && p.priceUsdcPerSui > 0) {
		if (Math.abs(p.priceUsdcPerSui / ref - 1) > maxDeviation) out.push('suspicious price')
	}
	// Prefer TVL from Cetus stats — raw balances alone misfire when missing/zero-parsed.
	if (p.tvlUsd != null && Number.isFinite(p.tvlUsd)) {
		if (p.tvlUsd > 0 && p.tvlUsd < LIQUID_TVL_USD_MIN) out.push('low liquidity')
	} else {
		try {
			const thin = BigInt(p.balanceA || '0') + BigInt(p.balanceB || '0') < 1_000_000n
			if (thin) out.push('low liquidity')
		} catch {
			/* ignore */
		}
	}
	return out
}
