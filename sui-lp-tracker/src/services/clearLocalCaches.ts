import { clearCurrentSpotCache } from '@/services/spotPrice/currentSpotCache'
import { clearVerifiedListCache } from '@/services/verifiedTokenList'

const IDB_DATABASES = [
	'sui_lp_tracker',
	'sui_portfolio_analytics',
	'sui-lp-tracker-lp-indexer-v1',
	/** Closed LP rows + events — without this, Clear cache leaves divergent Closed totals per browser. */
	'sui_lp_closed_snapshot',
] as const

function deleteIdb(name: string): Promise<void> {
	return new Promise((resolve) => {
		if (typeof indexedDB === 'undefined') {
			resolve()
			return
		}
		const req = indexedDB.deleteDatabase(name)
		req.onsuccess = () => resolve()
		req.onerror = () => resolve()
		req.onblocked = () => resolve()
	})
}

/** Wipe local caches (IDB + spot + verified lists) then reload. */
export async function clearAllLocalCaches(): Promise<void> {
	clearCurrentSpotCache()
	clearVerifiedListCache()
	await Promise.allSettled(IDB_DATABASES.map((name) => deleteIdb(name)))
	location.reload()
}
