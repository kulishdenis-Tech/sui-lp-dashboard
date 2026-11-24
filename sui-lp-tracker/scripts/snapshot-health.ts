/**
 * Exit 1 when any watched wallet has no snapshot newer than MAX_AGE_MS.
 * Used by the systemd timer (ExecStartPost) so a stale or broken scheduler is noticed.
 */
import { ensureWatchedWallets, getNewestSnapshotTsForWallet } from '../api/_lib/supabaseSnapshots'

const MAX_AGE_MS = Number(process.env.SNAPSHOT_MAX_AGE_MIN ?? 90) * 60_000

async function main() {
	if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
		console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
		process.exit(1)
	}
	const wallets = await ensureWatchedWallets()
	let bad = 0
	for (const w of wallets) {
		const newest = await getNewestSnapshotTsForWallet(w)
		const ageMin = newest == null ? null : Math.round((Date.now() - newest) / 60_000)
		const stale = newest == null || Date.now() - newest > MAX_AGE_MS
		console.log(`[snapshot-health] ${w.slice(0, 10)}… age=${ageMin == null ? 'none' : `${ageMin}m`} ${stale ? 'STALE' : 'ok'}`)
		if (stale) bad += 1
	}
	process.exit(bad > 0 ? 1 : 0)
}

void main().catch((e) => {
	console.error(e)
	process.exit(1)
})
