import { buildAdvisorState, type AdvisorState } from '@/services/server/advisorState'

/**
 * Stale-while-revalidate wrapper for /api/advisor/state.
 * Serves the last built state instantly and refreshes in the background (deduped),
 * so a slow gRPC read (~16–30 s) never blocks the caller after the first build.
 */
type Entry = { state: AdvisorState; at: number }

const FRESH_MS = Number(process.env.SUI_LP_ADVISOR_SWR_FRESH_MS) || 30_000
const MAX_SERVE_MS = 3 * 60_000 // older than this: block on a fresh build rather than serve an old "live" snapshot
const REFRESH_EVERY_MS = Number(process.env.SUI_LP_ADVISOR_REFRESH_MS) || 75_000

const cache = new Map<string, Entry>()
const inFlight = new Map<string, Promise<AdvisorState>>()
const timers = new Map<string, ReturnType<typeof setInterval>>()

function rebuild(wallet: string): Promise<AdvisorState> {
	const running = inFlight.get(wallet)
	if (running) return running
	const p = buildAdvisorState({ wallet })
		.then((state) => {
			cache.set(wallet, { state, at: Date.now() })
			return state
		})
		.finally(() => inFlight.delete(wallet))
	inFlight.set(wallet, p)
	return p
}

function ensureTimer(wallet: string): void {
	if (timers.has(wallet) || process.env.VITEST) return
	const t = setInterval(() => void rebuild(wallet).catch(() => {}), REFRESH_EVERY_MS)
	t.unref?.()
	timers.set(wallet, t)
}

export async function getAdvisorStateSwr(wallet: string): Promise<AdvisorState> {
	ensureTimer(wallet)
	const hit = cache.get(wallet)
	const age = hit ? Date.now() - hit.at : Infinity
	if (hit && age <= MAX_SERVE_MS) {
		if (age > FRESH_MS) void rebuild(wallet).catch(() => {})
		return hit.state
	}
	return rebuild(wallet)
}

export function _resetAdvisorStateSwrForTests(): void {
	cache.clear()
	inFlight.clear()
	for (const t of timers.values()) clearInterval(t)
	timers.clear()
}
