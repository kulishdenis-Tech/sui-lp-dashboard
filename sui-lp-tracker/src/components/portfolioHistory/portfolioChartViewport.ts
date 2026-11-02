/**
 * Pure viewport fit contract for PortfolioChart.
 * New snapshot points must not change fitKey when context is unchanged.
 */
export type ChartFitContext = {
	viewKey: string
	range: string
	/** Intentionally excluded from fit key so Total↔Components keeps pan/zoom. */
	hasData: boolean
}

export function chartFitKey(ctx: ChartFitContext): string {
	return `${ctx.viewKey}|${ctx.range}|${ctx.hasData ? 'data' : 'empty'}`
}

/**
 * Whether to re-apply fitContent / setVisibleRange.
 * - force (Reset View / address change) → always
 * - fit key changed (range / address / empty↔data) → yes
 * - same key (incl. new points, mode toggle, resize) → no
 */
export function shouldRefitViewport(opts: {
	force: boolean
	nextKey: string
	prevKey: string | null
}): boolean {
	if (opts.force) return true
	return opts.prevKey !== opts.nextKey
}
