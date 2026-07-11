import type { BluefinUnclaimedSnapshot } from '@/types'

/** Увімкнути: `VITE_DEBUG_BLUEFIN=1`. */
export function logBluefinUnclaimedDebug(s: BluefinUnclaimedSnapshot): void {
	if (import.meta.env.VITE_DEBUG_BLUEFIN !== '1') return
	// eslint-disable-next-line no-console
	console.log('[bluefin unclaimed]', {
		position_id: s.position_id,
		pool_id: s.pool_id,
		source: s.source,
		sdk: s.source === 'bluefin_sdk',
		sdkMethod: s.sdkReferenceMethod,
		api_ok: s.source === 'bluefin_api',
		unclaimed_fees: s.unclaimed_fees,
		unclaimed_rewards: s.unclaimed_rewards,
		unclaimed_fees_usd: s.unclaimed_fees_usd,
		unclaimed_rewards_usd: s.unclaimed_rewards_usd,
		unclaimed_total_usd: s.unclaimed_total_usd,
		fetched_at: s.fetched_at,
	})
}
