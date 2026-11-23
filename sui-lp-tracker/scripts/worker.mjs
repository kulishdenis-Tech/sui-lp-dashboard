/**
 * Background overview worker for mobile Home.
 * Run: npm run worker (vite-node). Writes `_local/overview-cache.json`.
 * Read-only: never signs, never talks to the autopilot bot.
 */
import {
	overviewCachePath,
	readOverviewCache,
	writeOverviewCache,
} from '../src/services/server/overviewCache.ts'
import { buildWalletOverview } from '../src/services/server/buildWalletOverview.ts'
import { resolveWorkerAddresses } from '../src/services/server/overviewWallets.ts'
import { OVERVIEW_MIN_CYCLE_MS } from '../src/services/server/overviewTypes.ts'
import { hydrateViteServerEnv } from '../vite-server-env.ts'

hydrateViteServerEnv('production')

// Background reads (SWR refresh, SDK internals) must never take the whole server down.
process.on('unhandledRejection', (reason) => {
	console.error('[unhandledRejection]', reason instanceof Error ? reason.message : reason)
})
process.on('uncaughtException', (err) => {
	console.error('[uncaughtException]', err instanceof Error ? err.stack ?? err.message : err)
})


const cacheFile = overviewCachePath()
const minCycleMs = Math.max(
	OVERVIEW_MIN_CYCLE_MS,
	Number(process.env.WORKER_INTERVAL_MS) || 90_000,
)

/** @type {Set<string>} */
const inFlight = new Set()
let backoffMs = 0

function short(addr) {
	return `${addr.slice(0, 8)}…${addr.slice(-4)}`
}

function isRateLimitError(e) {
	const msg = e instanceof Error ? e.message : String(e)
	return /\b429\b|rate.?limit|too many requests/i.test(msg)
}

async function refreshWallet(wallet, cache) {
	if (inFlight.has(wallet)) {
		console.log(`[worker] skip ${short(wallet)} already in flight`)
		return
	}
	inFlight.add(wallet)
	try {
		const previous = cache.wallets[wallet] ?? null
		const overview = await buildWalletOverview(wallet, previous)
		cache.wallets[wallet] = overview
		cache.updatedAt = Date.now()
		writeOverviewCache(cacheFile, cache)
		console.log(
			`[worker] ${short(wallet)} net=$${overview.net.toFixed(2)} ` +
				`lp=$${overview.lpUSD.toFixed(2)} lend=$${overview.lendingNetUSD.toFixed(2)} ` +
				`partial=[${overview.partial.join(',')}]`,
		)
		backoffMs = 0
	} catch (e) {
		console.error(`[worker] ${short(wallet)} failed:`, e instanceof Error ? e.message : e)
		if (isRateLimitError(e)) {
			backoffMs = backoffMs === 0 ? 30_000 : Math.min(backoffMs * 2, 15 * 60_000)
			console.warn(`[worker] 429 backoff ${backoffMs}ms`)
		}
	} finally {
		inFlight.delete(wallet)
	}
}

async function cycle() {
	const addresses = resolveWorkerAddresses()
	if (addresses.length === 0) {
		console.warn('[worker] no addresses (set WORKER_ADDRESSES or nicknames file)')
		return
	}
	const cache = readOverviewCache(cacheFile)
	console.log(`[worker] cycle ${addresses.length} wallet(s) → ${cacheFile}`)
	for (const wallet of addresses) {
		await refreshWallet(wallet, cache)
		if (backoffMs > 0) {
			await new Promise((r) => setTimeout(r, backoffMs))
		}
	}
}

async function main() {
	const once = process.env.WORKER_ONCE === '1' || process.env.WORKER_ONCE === 'true'
	console.log(`[worker] start interval=${minCycleMs}ms cache=${cacheFile}${once ? ' (once)' : ''}`)
	for (;;) {
		const started = Date.now()
		try {
			await cycle()
		} catch (e) {
			console.error('[worker] cycle error:', e instanceof Error ? e.message : e)
		}
		if (once) {
			console.log('[worker] done')
			return
		}
		const elapsed = Date.now() - started
		const wait = Math.max(minCycleMs, backoffMs) - elapsed
		if (wait > 0) await new Promise((r) => setTimeout(r, wait))
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
