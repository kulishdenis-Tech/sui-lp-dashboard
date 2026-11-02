import type { StrategyConfig, StrategySlot } from './types.js'

/** Minimum unclaimed fee (USD) before a standalone collect_fees is emitted. */
const COLLECT_MIN_FEE_USD = 0.5

export type Recommendation = {
	slot: StrategySlot
	levelId: string
	kind: 'open_level' | 'close_level' | 'collect_fees' | 'hold'
	reason: string
	lowerPrice: number
	upperPrice: number
	/** Prepared for MANUAL_SIGN. Never a signature. */
	requiresOwnerSignature: boolean
	conversionPct: number | null
	/** Alias for rangeProgressPct. */
	rangeProgressPct: number | null
	/** Confirmed converted principal fraction from on-chain balances. */
	convertedPrincipalPct: number | null
	unclaimedFeeUsd: number | null
	/** Budget versus leftover principal. Null when the position does not support the estimate. */
	estimatedExecutionPrice: number | null
}

export type LevelObservation = {
	levelId: string
	open: boolean
	/**
	 * 0..1 share of the configured range the mark has already crossed in the strategy direction.
	 * Kept for display and backward compat. Do NOT use alone to trigger close.
	 */
	conversionPct: number
	/** Alias for conversionPct — same value, preferred name going forward. */
	rangeProgressPct: number
	/**
	 * 0..1 confirmed converted principal derived from on-chain balances
	 * (budget − remaining start-asset) / budget. Use this for close-level decisions.
	 */
	convertedPrincipalPct: number
	unclaimedFeeUsd: number
	estimatedExecutionPrice: number | null
	/**
	 * closed = no overlapping position (open_level is allowed).
	 * unknown = ambiguous or a missing pin — must not become open_level.
	 * unverified = a single geometry overlap without a confirmed settlement binding.
	 *   Not ownership, and not a reason to recommend open_level.
	 */
	matchStatus?: 'open' | 'closed' | 'unknown' | 'unverified'
	positionId?: string | null
}

/**
 * STATIC recommendations only.
 * Existing level prices are never moved up (BUY) or down (SELL).
 * The caller must not apply a regrid from this result.
 */
export function recommendOperations(
	config: StrategyConfig,
	levels: LevelObservation[],
): Recommendation[] {
	if (config.regridMode !== 'STATIC_GRID') {
		const lv = config.levels[0]
		return [
			{
				slot: config.slot,
				levelId: lv?.id ?? config.slot,
				kind: 'hold',
				reason: 'Only STATIC_GRID recommendations are enabled. Ranges stay fixed.',
				lowerPrice: lv?.lowerPrice ?? 0,
				upperPrice: lv?.upperPrice ?? 0,
				requiresOwnerSignature: false,
				conversionPct: null,
				rangeProgressPct: null,
				convertedPrincipalPct: null,
				unclaimedFeeUsd: null,
				estimatedExecutionPrice: null,
			},
		]
	}
	const byId = new Map(levels.map((l) => [l.levelId, l]))
	const out: Recommendation[] = []
	for (const lv of config.levels) {
		const obs = byId.get(lv.id)
		const metrics = {
			conversionPct: obs?.conversionPct ?? null,
			rangeProgressPct: obs?.rangeProgressPct ?? null,
			convertedPrincipalPct: obs?.convertedPrincipalPct ?? null,
			unclaimedFeeUsd: obs?.unclaimedFeeUsd ?? null,
			estimatedExecutionPrice: obs?.estimatedExecutionPrice ?? null,
		}
		if (obs?.matchStatus === 'unknown' || obs?.matchStatus === 'unverified') {
			out.push({
				slot: config.slot,
				levelId: lv.id,
				kind: 'hold',
				reason:
					obs.matchStatus === 'unverified'
						? 'Geometry overlap is unverified. It is not a confirmed strategy position and open is not recommended.'
						: 'Position match is unknown. Not recommending open until the position is verified.',
				lowerPrice: lv.lowerPrice,
				upperPrice: lv.upperPrice,
				requiresOwnerSignature: false,
				...metrics,
			})
			continue
		}
		if (!obs || !obs.open) {
			out.push({
				slot: config.slot,
				levelId: lv.id,
				kind: 'open_level',
				reason: 'Level is not open. Range stays at the configured prices.',
				lowerPrice: lv.lowerPrice,
				upperPrice: lv.upperPrice,
				requiresOwnerSignature: true,
				...metrics,
			})
			continue
		}
		// close_level: use confirmed converted principal — not range progress alone.
		const willClose =
			config.autoExitOnFullConversion && (obs.convertedPrincipalPct ?? 0) >= 0.98
		// collect_fees: gate on minFeeUsd; skip separate collect when close is planned (close collects).
		if (!willClose && obs.unclaimedFeeUsd >= COLLECT_MIN_FEE_USD) {
			out.push({
				slot: config.slot,
				levelId: lv.id,
				kind: 'collect_fees',
				reason: `Unclaimed fees ≥ $${COLLECT_MIN_FEE_USD}. The unsigned collect transaction pays the signing OWNER.`,
				lowerPrice: lv.lowerPrice,
				upperPrice: lv.upperPrice,
				requiresOwnerSignature: true,
				...metrics,
			})
		}
		if (willClose) {
			out.push({
				slot: config.slot,
				levelId: lv.id,
				kind: 'close_level',
				reason:
					'Principal is fully converted (convertedPrincipalPct ≥ 0.98). Close collects fees and withdraws.',
				lowerPrice: lv.lowerPrice,
				upperPrice: lv.upperPrice,
				requiresOwnerSignature: true,
				...metrics,
			})
			continue
		}
		const px =
			obs.estimatedExecutionPrice != null
				? ` Estimated execution ${obs.estimatedExecutionPrice.toFixed(4)} USDC per SUI from budget and leftover principal.`
				: ''
		out.push({
			slot: config.slot,
			levelId: lv.id,
			kind: 'hold',
			reason: `In place. Configured range is unchanged.${px}`,
			lowerPrice: lv.lowerPrice,
			upperPrice: lv.upperPrice,
			requiresOwnerSignature: false,
			...metrics,
		})
	}
	return out
}
