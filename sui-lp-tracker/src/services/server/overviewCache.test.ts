import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
	emptyOverviewCache,
	getOverviewForWallet,
	isOverviewStale,
	mergePartialOverview,
	writeOverviewCache,
	readOverviewCache,
} from '@/services/server/overviewCache'
import { OVERVIEW_STALE_MS, OVERVIEW_VERSION, type WalletOverview } from '@/services/server/overviewTypes'

function sample(partial: string[] = []): WalletOverview {
	return {
		version: OVERVIEW_VERSION,
		wallet: '0x' + 'a'.repeat(64),
		computedAt: 1_000_000,
		net: 100,
		walletUSD: 10,
		lpUSD: 70,
		lendingNetUSD: 20,
		unclaimedUSD: 1.5,
		ranges: { in: 2, near: 0, above: 0, below: 0, empty: 1 },
		riskRows: [
			{
				id: 'r1',
				walletLabel: '—',
				protocolLabel: 'Current',
				positionLabel: 'SUI',
				healthFactor: 1.4,
				suiLiquidationPriceUSD: 0.5,
			},
		],
		partial,
		incomplete: partial.length > 0,
	}
}

describe('overview cache', () => {
	const dirs: string[] = []
	afterEach(() => {
		for (const d of dirs) rmSync(d, { recursive: true, force: true })
		dirs.length = 0
	})

	it('writes atomically and reads back a stable overview shape', () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'ov-cache-'))
		dirs.push(dir)
		const file = path.join(dir, 'overview-cache.json')
		const overview = sample()
		const cache = emptyOverviewCache(2_000_000)
		cache.wallets[overview.wallet] = overview
		writeOverviewCache(file, cache)

		const raw = JSON.parse(readFileSync(file, 'utf8')) as { version: number; wallets: Record<string, WalletOverview> }
		expect(raw.version).toBe(OVERVIEW_VERSION)
		expect(raw.wallets[overview.wallet].net).toBe(100)
		expect(raw.wallets[overview.wallet].ranges).toEqual(overview.ranges)

		const loaded = readOverviewCache(file)
		expect(getOverviewForWallet(loaded, overview.wallet, 1_000_000 + 60_000)).toMatchObject({
			computedAt: 1_000_000,
			stale: false,
			overview: { net: 100, lpUSD: 70 },
		})
	})

	it('marks overview stale after the threshold', () => {
		expect(isOverviewStale(1_000, 1_000 + OVERVIEW_STALE_MS + 1)).toBe(true)
		expect(isOverviewStale(1_000, 1_000 + OVERVIEW_STALE_MS - 1)).toBe(false)
		const overview = sample()
		const cache = emptyOverviewCache()
		cache.wallets[overview.wallet] = overview
		const hit = getOverviewForWallet(cache, overview.wallet, overview.computedAt + OVERVIEW_STALE_MS + 5)
		expect(hit?.stale).toBe(true)
	})

	it('keeps previous lending and LP when those sources are partial', () => {
		const prev = sample()
		const next = sample(['navi', 'lp:bluefin'])
		next.lendingNetUSD = 0
		next.lpUSD = 0
		next.ranges = { in: 0, near: 0, above: 0, below: 0, empty: 0 }
		next.riskRows = []
		next.unclaimedUSD = null
		const merged = mergePartialOverview(next, prev)
		expect(merged.lendingNetUSD).toBe(20)
		expect(merged.lpUSD).toBe(70)
		expect(merged.ranges.in).toBe(2)
		expect(merged.riskRows).toHaveLength(1)
		expect(merged.unclaimedUSD).toBe(1.5)
		expect(merged.partial).toEqual(['navi', 'lp:bluefin'])
	})
})
