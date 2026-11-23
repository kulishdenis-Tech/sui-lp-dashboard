import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
	OVERVIEW_STALE_MS,
	OVERVIEW_VERSION,
	type OverviewCacheFile,
	type OverviewApiResponse,
	type WalletOverview,
} from '@/services/server/overviewTypes'

/** Resolve monorepo `_local/overview-cache.json` from tracker or root cwd. */
export function overviewCachePath(start = process.cwd()): string {
	let dir = path.resolve(start)
	for (let i = 0; i < 6; i++) {
		const trackerPkg = path.join(dir, 'sui-lp-tracker', 'package.json')
		const rootPkg = path.join(dir, 'package.json')
		if (existsSync(trackerPkg) && existsSync(rootPkg)) {
			return path.join(dir, '_local', 'overview-cache.json')
		}
		const parent = path.dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	return path.resolve(start, '../_local/overview-cache.json')
}

export function emptyOverviewCache(now = Date.now()): OverviewCacheFile {
	return { version: OVERVIEW_VERSION, updatedAt: now, wallets: {} }
}

export function readOverviewCache(file: string): OverviewCacheFile {
	try {
		const raw = readFileSync(file, 'utf8')
		const parsed = JSON.parse(raw) as Partial<OverviewCacheFile>
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyOverviewCache()
		const wallets: Record<string, WalletOverview> = {}
		if (parsed.wallets && typeof parsed.wallets === 'object' && !Array.isArray(parsed.wallets)) {
			for (const [key, value] of Object.entries(parsed.wallets)) {
				if (value && typeof value === 'object' && typeof (value as WalletOverview).wallet === 'string') {
					wallets[key.toLowerCase()] = value as WalletOverview
				}
			}
		}
		return {
			version: OVERVIEW_VERSION,
			updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
			wallets,
		}
	} catch {
		return emptyOverviewCache()
	}
}

/** Atomic write: tmp file next to the target, then rename. */
export function writeOverviewCache(file: string, cache: OverviewCacheFile): void {
	mkdirSync(path.dirname(file), { recursive: true })
	const payload: OverviewCacheFile = {
		version: OVERVIEW_VERSION,
		updatedAt: cache.updatedAt,
		wallets: cache.wallets,
	}
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
	writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
	renameSync(tmp, file)
}

export function isOverviewStale(computedAt: number, now = Date.now(), staleMs = OVERVIEW_STALE_MS): boolean {
	if (!Number.isFinite(computedAt) || computedAt <= 0) return true
	return now - computedAt > staleMs
}

export function getOverviewForWallet(
	cache: OverviewCacheFile,
	wallet: string,
	now = Date.now(),
): OverviewApiResponse | null {
	const key = wallet.trim().toLowerCase()
	const overview = cache.wallets[key]
	if (!overview) return null
	return {
		overview,
		computedAt: overview.computedAt,
		stale: isOverviewStale(overview.computedAt, now),
	}
}

/**
 * When a source fails, keep numeric fields from the previous successful overview
 * for that wallet so Home does not flash zeros.
 */
export function mergePartialOverview(
	next: WalletOverview,
	previous: WalletOverview | null | undefined,
): WalletOverview {
	if (!previous || previous.wallet !== next.wallet) return next
	if (next.partial.length === 0 && !next.incomplete) return next

	const keepMoney = next.incomplete || next.partial.length > 0
	return {
		...next,
		net: keepMoney && !Number.isFinite(next.net) ? previous.net : next.net,
		walletUSD:
			next.partial.includes('wallet') || next.partial.includes('balance')
				? previous.walletUSD
				: next.walletUSD,
		lpUSD: next.partial.some((p) => p.startsWith('lp:') || p === 'lp') ? previous.lpUSD : next.lpUSD,
		lendingNetUSD: next.partial.some((p) =>
			p === 'alphalend' || p === 'navi' || p === 'current' || p === 'lending',
		)
			? previous.lendingNetUSD
			: next.lendingNetUSD,
		unclaimedUSD:
			next.unclaimedUSD == null && previous.unclaimedUSD != null
				? previous.unclaimedUSD
				: next.unclaimedUSD,
		ranges:
			next.partial.some((p) => p.startsWith('lp:')) && next.ranges.in + next.ranges.near + next.ranges.above + next.ranges.below + next.ranges.empty === 0
				? previous.ranges
				: next.ranges,
		riskRows: next.riskRows.length === 0 && previous.riskRows.length > 0 ? previous.riskRows : next.riskRows,
	}
}
