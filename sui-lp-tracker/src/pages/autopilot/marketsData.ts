import { useEffect, useMemo, useState } from 'react'
import { formatRawBalance, SUI_DECIMALS, USDC_DECIMALS } from './format'
import { priceRisesWithBinId, type PoolRow, type ProtocolId } from './types'

export function poolBalances(p: PoolRow): { sui: string; usdc: string } {
	const aIsSui = priceRisesWithBinId(p.coinTypeA)
	return {
		sui: formatRawBalance(aIsSui ? p.balanceA : p.balanceB, SUI_DECIMALS, 2),
		usdc: formatRawBalance(aIsSui ? p.balanceB : p.balanceA, USDC_DECIMALS, 2),
	}
}

/** Same brand icons as LP table (`PROTOCOL_BRAND_ICON_URL` / ProtocolIcon). */
export function dexMeta(protocol: ProtocolId): {
	lpProtocol: 'cetus' | 'bluefin'
	amm: 'CLMM' | 'DLMM'
	title: string
} {
	if (protocol === 'dlmm') return { lpProtocol: 'cetus', amm: 'DLMM', title: 'Cetus DLMM' }
	if (protocol === 'bluefin') return { lpProtocol: 'bluefin', amm: 'CLMM', title: 'Bluefin Spot' }
	return { lpProtocol: 'cetus', amm: 'CLMM', title: 'Cetus CLMM' }
}

/** Module cache — survives StrictMode remount; avoids blank "Loading…" forever. */
type MarketsCache = {
	clmm: PoolRow[]
	dlmm: PoolRow[]
	bluefin: PoolRow[]
	atMs: number
}
let marketsCache: MarketsCache | null = null
let marketsInflight: Promise<void> | null = null

const CACHE_TTL_MS = 60_000

function patchMarketsCache( partial: Partial<Omit<MarketsCache, 'atMs'>>): void {
	marketsCache = {
		clmm: marketsCache?.clmm ?? [],
		dlmm: marketsCache?.dlmm ?? [],
		bluefin: marketsCache?.bluefin ?? [],
		...partial,
		atMs: Date.now(),
	}
}

async function fetchProtocolPools(protocol: ProtocolId): Promise<PoolRow[]> {
	const r = await fetch(`/api/autopilot/market?protocol=${protocol}`)
	const j = (await r.json()) as { pools?: PoolRow[]; error?: string }
	if (!r.ok) throw new Error(j.error ?? `market ${protocol} failed`)
	return Array.isArray(j.pools) ? j.pools : []
}

/** Shared fetch — progressive; writes module cache even if a subscriber unmounted. */
function ensureMarketsLoaded(
	onPatch: (c: MarketsCache) => void,
	onError: (msg: string) => void,
): Promise<void> {
	const fresh = marketsCache && Date.now() - marketsCache.atMs < CACHE_TTL_MS
	if (fresh && marketsCache) {
		onPatch(marketsCache)
		return Promise.resolve()
	}
	if (marketsInflight) {
		return marketsInflight.then(() => {
			if (marketsCache) onPatch(marketsCache)
		})
	}
	marketsInflight = (async () => {
		const errors: string[] = []
		await Promise.all(
			(['clmm', 'dlmm', 'bluefin'] as const).map(async (protocol) => {
				try {
					const rows = await fetchProtocolPools(protocol)
					patchMarketsCache({ [protocol]: rows })
					if (marketsCache) onPatch({ ...marketsCache })
				} catch (e) {
					errors.push(e instanceof Error ? e.message : String(e))
				}
			}),
		)
		if (errors.length && !marketsCache?.clmm.length && !marketsCache?.dlmm.length && !marketsCache?.bluefin.length) {
			onError(errors.join(' · '))
		}
	})().finally(() => {
		marketsInflight = null
	})
	return marketsInflight
}

export function feesToTvlPct(p: PoolRow): number | null {
	const tvl = p.tvlUsd
	const fees = p.fees24hUsd
	if (tvl == null || fees == null || !Number.isFinite(tvl) || !Number.isFinite(fees) || tvl <= 0) {
		return null
	}
	return (fees / tvl) * 100
}

export function poolTickValue(p: PoolRow): number | null {
	const protocol = p.protocol
	const v = protocol === 'dlmm' ? p.binStep : p.tickSpacing
	return v == null || !Number.isFinite(v) ? null : v
}


export function useMarketPools(): { allPools: PoolRow[]; loading: boolean; error: string | null } {
	const [clmmPools, setClmmPools] = useState<PoolRow[] | null>(() => marketsCache?.clmm ?? null)
	const [dlmmPools, setDlmmPools] = useState<PoolRow[] | null>(() => marketsCache?.dlmm ?? null)
	const [bluefinPools, setBluefinPools] = useState<PoolRow[] | null>(() => marketsCache?.bluefin ?? null)
	const [loading, setLoading] = useState(
		() => !(marketsCache && Date.now() - marketsCache.atMs < CACHE_TTL_MS),
	)
	const [error, setError] = useState<string | null>(null)
	useEffect(() => {
		let cancelled = false
		const apply = (c: MarketsCache) => {
			if (cancelled) return
			setClmmPools(c.clmm)
			setDlmmPools(c.dlmm)
			setBluefinPools(c.bluefin)
			setError(null)
		}
		void ensureMarketsLoaded(apply, (msg) => {
			if (!cancelled) setError(msg)
		}).finally(() => {
			if (!cancelled) setLoading(false)
		})
		return () => {
			cancelled = true
		}
	}, [])
	const allPools = useMemo(() => {
		const rows: PoolRow[] = []
		for (const p of clmmPools ?? []) rows.push({ ...p, protocol: p.protocol ?? 'clmm' })
		for (const p of dlmmPools ?? []) rows.push({ ...p, protocol: p.protocol ?? 'dlmm' })
		for (const p of bluefinPools ?? []) rows.push({ ...p, protocol: p.protocol ?? 'bluefin' })
		rows.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))
		return rows
	}, [clmmPools, dlmmPools, bluefinPools])
	return { allPools, loading, error }
}
