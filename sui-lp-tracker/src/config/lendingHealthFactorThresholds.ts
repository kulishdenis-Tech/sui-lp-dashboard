/** UI bands for lending health factor (HF). */

export type LendingHealthFactorThresholds = {
	/** Green when HF ≥ safeMin. */
	safeMin: number
	/** Yellow when warningMin ≤ HF < safeMin; red when HF < warningMin (P0). */
	warningMin: number
}

/** AlphaLend / Navi and other non-Current lending cards. */
export const DEFAULT_LENDING_HF_THRESHOLDS: LendingHealthFactorThresholds = {
	safeMin: 1.8,
	warningMin: 1.2,
}

/** Current Finance isolated markets (per obligation). */
export const CURRENT_LENDING_HF_THRESHOLDS: LendingHealthFactorThresholds = {
	safeMin: 1.2,
	warningMin: 1.15,
}

export function lendingHealthFactorThresholds(protocol: string): LendingHealthFactorThresholds {
	return protocol === 'Current' ? CURRENT_LENDING_HF_THRESHOLDS : DEFAULT_LENDING_HF_THRESHOLDS
}

export function healthFactorColorClass(
	hf: number,
	thresholds: LendingHealthFactorThresholds = DEFAULT_LENDING_HF_THRESHOLDS,
	options?: { metricsLive?: boolean },
): string {
	if (options?.metricsLive === false) return 'text-slate-500'
	if (hf <= 0) return 'text-slate-500'
	if (hf >= thresholds.safeMin) return 'text-emerald-400'
	if (hf >= thresholds.warningMin) return 'text-yellow-400'
	return 'text-red-400'
}

/** P0 alert (HF below warningMin) — only when on-chain metrics are live, not STALE cache. */
export function isHealthFactorP0Alert(
	hf: number,
	thresholds: LendingHealthFactorThresholds = DEFAULT_LENDING_HF_THRESHOLDS,
	options?: { metricsLive?: boolean },
): boolean {
	if (options?.metricsLive === false) return false
	return hf > 0 && hf < thresholds.warningMin
}

export function healthFactorStatTip(protocol: string): string {
	if (protocol === 'Current') {
		return 'Risk debt vs liquidation capacity (isolated market). Попередження при HF < 1.2, P0 при HF < 1.15.'
	}
	return 'Liquidation threshold / total debt. Target ≥1.8, alert <1.2, liquidation risk below 1.'
}
