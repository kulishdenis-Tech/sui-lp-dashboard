/**
 * Shared LP source registry — client loadAll and server snapshot must stay in parity.
 * Fetch error ≠ confirmed empty; callers must honour `{ ok, error? }`.
 */
import type { OpenPosition } from '@/types'
import { getMomentumPositions } from '@/services/momentumService'
import { getBluefinSpotPositions } from '@/services/bluefinService'
import { getCetusPositions } from '@/services/cetusService'
import { getCetusDlmmPositions } from '@/services/cetusDlmmLazy'
import { getCetusVaultPositions } from '@/services/cetusVaultsService'
import { getHaedalVaultPositions } from '@/services/haedalVaultsService'
import { getHaedalLendingVaultPositions } from '@/services/haedalLendingVaultsService'
import { getCurrentMultiplyVaultPositions } from '@/services/currentMultiplyVaultsService'
import { getTurbosPositions } from '@/services/turbosService'
import { getAftermathFarmsPositions } from '@/services/aftermathService'
import { getUnsupportedLpStubs } from '@/services/unsupportedLpService'
import { mapPool } from '@/utils/concurrency'

function readEnv(name: string): string | undefined {
	if (typeof process !== 'undefined' && process.env) {
		const v = process.env[name]
		if (typeof v === 'string' && v.trim()) return v.trim()
	}
	return undefined
}

/** Concurrency limit for parallel LP source loading (RPC-heavy operations). */
const LP_SOURCE_CONCURRENCY = (() => {
	const n = Number(readEnv('PORTFOLIO_LP_SOURCE_CONCURRENCY') ?? 4)
	return Number.isFinite(n) && n >= 1 && n <= 12 ? n : 6
})()

export const PORTFOLIO_LP_SOURCE_IDS = [
	'momentum',
	'bluefin',
	'cetus-clmm',
	'cetus-dlmm',
	'cetus-vaults',
	'haedal-vaults',
	'haedal-lending-vaults',
	'current-multiply',
	'turbos',
	'aftermath',
	'unsupported',
] as const

export type PortfolioLpSourceId = (typeof PORTFOLIO_LP_SOURCE_IDS)[number]

/** Client-side protocol buckets that map onto registry ids (cetus aggregates CLMM+DLMM+vaults). */
export const CLIENT_LP_PROTOCOL_IDS = [
	'momentum',
	'bluefin',
	'cetus',
	'turbos',
	'aftermath',
] as const

export type PortfolioLpSourceStatus = {
	id: PortfolioLpSourceId
	ok: boolean
	error?: string
	/** Confirmed empty only when ok === true && count === 0 */
	count: number
}

export type PortfolioLpSourceLoad = {
	id: PortfolioLpSourceId
	ok: boolean
	error?: string
	positions: OpenPosition[]
}

export type SnapshotLpLoadOpts = {
	forceRefreshPrices?: boolean
}

type Loader = (wallet: string, opts?: SnapshotLpLoadOpts) => Promise<OpenPosition[]>

const LOADERS: Record<PortfolioLpSourceId, Loader> = {
	momentum: (w) => getMomentumPositions(w),
	bluefin: (w, o) => getBluefinSpotPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
	'cetus-clmm': (w, o) => getCetusPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
	'cetus-dlmm': (w, o) => getCetusDlmmPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
	'cetus-vaults': (w, o) => getCetusVaultPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
	'haedal-vaults': (w, o) => getHaedalVaultPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
	'haedal-lending-vaults': (w, o) =>
		getHaedalLendingVaultPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
	'current-multiply': (w, o) =>
		getCurrentMultiplyVaultPositions(w, { forceRefreshPrices: o?.forceRefreshPrices }),
	turbos: (w) => getTurbosPositions(w),
	aftermath: (w) => getAftermathFarmsPositions(w),
	unsupported: (w) => getUnsupportedLpStubs(w),
}

export function portfolioLpSourceIds(): readonly PortfolioLpSourceId[] {
	return PORTFOLIO_LP_SOURCE_IDS
}

/** Registry must include DLMM (parity with client loadAll). */
export function registryIncludesDlmm(): boolean {
	return PORTFOLIO_LP_SOURCE_IDS.includes('cetus-dlmm')
}

function timingEnabled(): boolean {
	return readEnv('VITEST') !== 'true' && readEnv('SUI_LP_ADVISOR_DEV_TIMING') === '1'
}

export async function loadPortfolioLpSource(
	id: PortfolioLpSourceId,
	wallet: string,
	opts?: SnapshotLpLoadOpts,
): Promise<PortfolioLpSourceLoad> {
	const t0 = Date.now()
	try {
		const positions = await LOADERS[id](wallet, opts)
		return { id, ok: true, positions }
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e)
		return { id, ok: false, error, positions: [] }
	} finally {
		if (timingEnabled()) console.log(`[lp-source] ${id}: ${Date.now() - t0}ms`)
	}
}

export async function loadAllPortfolioLpSources(
	wallet: string,
	opts?: SnapshotLpLoadOpts,
): Promise<{
	loads: PortfolioLpSourceLoad[]
	statuses: PortfolioLpSourceStatus[]
	positions: OpenPosition[]
	incomplete: boolean
}> {
	// One pool for all sources. Current Multiply (devInspect + hedge) is the slowest, so it goes first
	// instead of waiting for every other source to finish (was a serial tail after the pool).
	const order = [
		'current-multiply',
		...PORTFOLIO_LP_SOURCE_IDS.filter((id) => id !== 'current-multiply'),
	] as PortfolioLpSourceId[]
	const loaded = await mapPool(order, LP_SOURCE_CONCURRENCY, async (id) => {
		try {
			return await loadPortfolioLpSource(id, wallet, opts)
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e)
			return { id, ok: false, error, positions: [] } as PortfolioLpSourceLoad
		}
	})
	const byId = new Map<PortfolioLpSourceId, PortfolioLpSourceLoad>(loaded.map((l) => [l.id, l] as const))
	const loads = PORTFOLIO_LP_SOURCE_IDS.map((id) => byId.get(id)!)

	const statuses: PortfolioLpSourceStatus[] = loads.map((l) => ({
		id: l.id,
		ok: l.ok,
		error: l.error,
		count: l.ok ? l.positions.length : 0,
	}))
	let incomplete = loads.some((l) => !l.ok)
	const positions = loads.filter((l) => l.ok).flatMap((l) => l.positions)
	// Sanity (P1-8): liq>0 but value 0/NaN with known prices → incomplete/partial
	for (const p of positions) {
		const liq = typeof p.liquidity === 'string' ? p.liquidity : '0'
		if (liq !== '0' && liq !== '') {
			const val = p.currentValueUSD
			const pxOk =
				Number.isFinite(p.currentPriceA_USD) &&
				Number.isFinite(p.currentPriceB_USD) &&
				(p.currentPriceA_USD > 0 || p.currentPriceB_USD > 0)
			if (pxOk && (!Number.isFinite(val) || val === 0)) {
				incomplete = true
				p.historyPartial = true
			}
		}
	}
	return { loads, statuses, positions, incomplete }
}
