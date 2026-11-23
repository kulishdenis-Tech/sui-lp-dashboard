import { normalizeSuiAddress } from '@mysten/sui/utils'
import { loadPortfolioSnapshotDetailed } from '@/services/server/loadPortfolioSnapshot'
import { mergePartialOverview } from '@/services/server/overviewCache'
import { installPriceCacheDisk } from '@/services/server/priceCacheDisk'
import {
	OVERVIEW_VERSION,
	type OverviewRiskLite,
	type WalletOverview,
} from '@/services/server/overviewTypes'
import { countLpFilters } from '@/pages/overviewLab/overviewMetrics'
import { buildOverviewRiskRows } from '@/pages/overviewLab/overviewRisk'
import { aggregateOpenMetrics } from '@/utils/aggregateOpenMetrics'
import { isCetusVaultPosition } from '@/utils/cetusVault'
import { hydrateBluefinUnclaimedBatch } from '@/services/bluefinService'
import { WATCH_WALLET_SEED } from '@/config/watchWallets'
import { getCurrentPositions } from '@/services/currentService'
import { getCurrentMultiplyVaultPositions } from '@/services/currentMultiplyVaultsService'
import { shortAddress } from '@/utils/formatting'
import { isCurrentMultiplyVaultPosition } from '@/utils/currentMultiplyVault'
import type { OverviewWalletBook } from '@/pages/overviewLab/overviewRisk'
import type { LendingSnapshot, OpenPosition } from '@/types'
import { finiteUsd } from '@/utils/finiteUsd'

installPriceCacheDisk()

function riskLite(
	rows: ReturnType<typeof buildOverviewRiskRows>,
): OverviewRiskLite[] {
	return rows.map((r) => ({
		id: r.id,
		walletLabel: r.walletLabel,
		protocolLabel: r.protocolLabel,
		positionLabel: r.positionLabel,
		healthFactor: r.healthFactor,
		suiLiquidationPriceUSD: r.suiLiquidationPriceUSD,
		stableLoop: r.stableLoop,
		pegRate: r.pegRate ?? null,
		pegAlert: r.pegAlert ?? null,
	}))
}

/**
 * Build a Home overview for one wallet using the same snapshot pipeline as cron.
 * Source failures are listed in `partial`; callers merge with the previous cache entry.
 */
/** Other watch wallets' Current books, so server risk rows match the live Home (which merges them). */
async function loadWatchBooks(
	wallet: string,
	active: LendingSnapshot | null,
	partial: string[],
): Promise<{ books: OverviewWalletBook[]; multiply: OpenPosition[]; owner: Record<string, string> }> {
	const others = WATCH_WALLET_SEED.map((a) => a.toLowerCase()).filter((a) => a !== wallet)
	if (others.length === 0) return { books: [], multiply: [], owner: {} }
	const rows = await Promise.all(
		others.map(async (addr) => {
			const [snap, multiply] = await Promise.all([
				getCurrentPositions(addr).catch(() => null),
				getCurrentMultiplyVaultPositions(addr).catch(() => [] as OpenPosition[]),
			])
			if (!snap) partial.push(`watch:${shortAddress(addr)}`)
			return { addr, snap, multiply }
		}),
	)
	const owner: Record<string, string> = {}
	const multiply: OpenPosition[] = []
	for (const r of rows) {
		for (const p of r.multiply) {
			multiply.push(p)
			owner[p.id] = r.addr
		}
	}
	const books: OverviewWalletBook[] = [
		{ walletId: wallet, label: shortAddress(wallet), current: active },
		...rows.map((r) => ({ walletId: r.addr, label: shortAddress(r.addr), current: r.snap })),
	]
	return { books, multiply, owner }
}

export async function buildWalletOverview(
	rawAddress: string,
	previous?: WalletOverview | null,
	now = Date.now(),
): Promise<WalletOverview> {
	const wallet = normalizeSuiAddress(rawAddress).toLowerCase()
	const full = await loadPortfolioSnapshotDetailed(wallet)
	const partial: string[] = []

	for (const s of full.lendingSources) {
		if (!s.ok || s.status !== 'ok') partial.push(s.id)
	}
	for (const s of full.lpSources) {
		if (!s.ok) partial.push(`lp:${s.id}`)
	}
	if (full.incomplete && partial.length === 0) partial.push('incomplete')

	// Bluefin lists positions without unclaimed (lazy mode); the client hydrates it right after.
	// Do the same here, otherwise Home "Unclaimed" is null → 0 on the server.
	let positions = full.positions
	try {
		const patches = await hydrateBluefinUnclaimedBatch(wallet, positions)
		if (patches.length > 0) {
			const byId = new Map(patches.map((x) => [x.id, x.merged]))
			positions = positions.map((p) => (byId.has(p.id) ? { ...p, ...byId.get(p.id)! } : p))
		}
		if (positions.some((p) => p.protocol === 'bluefin' && p.bluefinUnclaimed?.source === 'unavailable')) {
			partial.push('bluefin-unclaimed')
		}
	} catch {
		partial.push('bluefin-unclaimed')
	}

	const snap = full.snapshot
	const counts = countLpFilters(positions)
	// Same filter as client buildOverviewKpis: Cetus vaults are not part of the Home "Unclaimed" tile.
	const openMetrics = aggregateOpenMetrics(positions.filter((p) => !isCetusVaultPosition(p)))
	const watch = await loadWatchBooks(wallet, full.current, partial).catch(() => null)
	const ownOwner: Record<string, string> = {}
	for (const p of positions) if (isCurrentMultiplyVaultPosition(p)) ownOwner[p.id] = wallet
	const riskRows = riskLite(
		watch
			? buildOverviewRiskRows(
					full.current,
					[...positions, ...watch.multiply],
					watch.books,
					{ ...watch.owner, ...ownOwner },
				)
			: buildOverviewRiskRows(full.current, positions),
	)

	const lpUSD = snap
		? finiteUsd(snap.lpUSD + snap.aftermathUSD)
		: 0
	const built: WalletOverview = {
		version: OVERVIEW_VERSION,
		wallet,
		computedAt: now,
		net: snap ? finiteUsd(snap.totalUSD) : 0,
		walletUSD: snap ? finiteUsd(snap.walletUSD) : 0,
		lpUSD,
		lendingNetUSD: snap ? finiteUsd(snap.lendingNetUSD) : 0,
		unclaimedUSD: openMetrics.totalUnclaimedUsd,
		ranges: {
			in: counts.in,
			near: counts.near,
			above: counts.above,
			below: counts.below,
			empty: counts.empty,
		},
		riskRows,
		partial,
		incomplete: full.incomplete,
	}

	return mergePartialOverview(built, previous)
}
