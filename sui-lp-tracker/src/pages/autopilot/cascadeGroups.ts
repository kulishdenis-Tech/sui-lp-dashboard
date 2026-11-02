import { setCostBasisForPositions } from './costBasis'
import { compositionView, type PortfolioPosition } from './portfolioMetrics'

/**
 * How cascade `positionIds` were established.
 * - `open_digest` — bound from the shared open PTB digest (or later digest re-bind).
 * - `user_confirmed` — owner explicitly confirmed the composition in UI.
 * - `legacy_untrusted` — older storage without provenance (may include heuristic IDs).
 */
export type CascadeMembershipOrigin = 'open_digest' | 'user_confirmed' | 'legacy_untrusted'

export type CascadeRecord = {
	digest: string
	protocol: 'clmm' | 'dlmm' | 'bluefin'
	poolId: string
	lpCount: number
	slot: 'BUY' | 'SELL' | null
	/** Total USDC (BUY) or SUI×spot approx invested at open — for equal-split cost basis. */
	totalBudget: number
	/**
	 * Confirmed member position object IDs only.
	 * Never persist value/Empty-count heuristics here.
	 */
	positionIds: string[]
	atMs: number
	/** Missing on old rows → treat as legacy_untrusted until user confirms. */
	membershipOrigin?: CascadeMembershipOrigin
	/** Owner address that opened / confirmed the cascade (optional on legacy). */
	owner?: string
	/** Network the digest belongs to. */
	network?: 'mainnet' | 'testnet'
}

export type PortfolioGroup = {
	id: string
	kind: 'cascade' | 'single'
	protocol: 'clmm' | 'dlmm' | 'bluefin'
	poolId: string
	openTxDigest: string | null
	slot: 'BUY' | 'SELL' | null
	members: PortfolioPosition[]
	valueUsd: number | null
	feeUsd: number
	lower: number
	upper: number
	inRangeCount: number
}

const CASCADE_KEY = 'sui-lp-autopilot.cascades.v1'

export function loadCascadeRecords(): CascadeRecord[] {
	try {
		const raw = localStorage.getItem(CASCADE_KEY)
		if (!raw) return []
		const parsed = JSON.parse(raw) as CascadeRecord[]
		return Array.isArray(parsed)
			? parsed
					.filter((r) => r && typeof r.digest === 'string')
					.map((r) => {
						const origin = r.membershipOrigin
						const membershipOrigin: CascadeMembershipOrigin =
							origin === 'open_digest' || origin === 'user_confirmed' || origin === 'legacy_untrusted'
								? origin
								: 'legacy_untrusted'
						return {
							...r,
							totalBudget: Number.isFinite(r.totalBudget) ? r.totalBudget : 0,
							positionIds: Array.isArray(r.positionIds) ? r.positionIds : [],
							membershipOrigin,
							owner: typeof r.owner === 'string' && r.owner ? r.owner : undefined,
							network: r.network === 'testnet' ? 'testnet' : r.network === 'mainnet' ? 'mainnet' : undefined,
						}
					})
			: []
	} catch {
		return []
	}
}

/** Financial cascade actions require digest-bound or user-confirmed membership. */
export function cascadeMembershipTrusted(rec: Pick<CascadeRecord, 'membershipOrigin'>): boolean {
	return rec.membershipOrigin === 'open_digest' || rec.membershipOrigin === 'user_confirmed'
}

function saveCascadeRecords(rows: CascadeRecord[]): void {
	localStorage.setItem(CASCADE_KEY, JSON.stringify(rows.slice(0, 40)))
}

/** Remember a cascade open (one PTB / one digest). */
export function rememberCascadeOpen(input: {
	digest: string
	protocol: 'clmm' | 'dlmm' | 'bluefin'
	poolId: string
	lpCount: number
	slot: 'BUY' | 'SELL' | null
	totalBudget?: number
	owner?: string
	network?: 'mainnet' | 'testnet'
	positionIds?: string[]
}): void {
	const digest = input.digest.trim()
	if (!digest) return
	const all = loadCascadeRecords().filter((r) => r.digest !== digest)
	all.unshift({
		digest,
		protocol: input.protocol,
		poolId: input.poolId,
		lpCount: Math.max(2, Math.floor(input.lpCount)),
		slot: input.slot,
		totalBudget: Number.isFinite(input.totalBudget) ? Number(input.totalBudget) : 0,
		positionIds: Array.isArray(input.positionIds) ? [...new Set(input.positionIds)] : [],
		atMs: Date.now(),
		membershipOrigin: 'open_digest',
		owner: input.owner,
		network: input.network ?? 'mainnet',
	})
	saveCascadeRecords(all)
}

/**
 * Persist only confirmed member IDs (digest bind or user confirm).
 * Refuses to silently upgrade legacy_untrusted without an explicit origin.
 */
export function persistConfirmedCascadeMembers(input: {
	digest: string
	positionIds: string[]
	origin: Exclude<CascadeMembershipOrigin, 'legacy_untrusted'>
	owner?: string
	network?: 'mainnet' | 'testnet'
}): void {
	const digest = input.digest.trim()
	if (!digest) return
	const all = loadCascadeRecords()
	const i = all.findIndex((r) => r.digest === digest)
	if (i < 0) return
	const prev = all[i]!
	const ids = [...new Set(input.positionIds.filter(Boolean))]
	all[i] = {
		...prev,
		positionIds: ids,
		membershipOrigin: input.origin,
		owner: input.owner ?? prev.owner,
		// Prefer explicit input; keep prior network; never invent mainnet for legacy rows here.
		network: input.network ?? prev.network,
		atMs: Date.now(),
	}
	saveCascadeRecords(all)
}

/** Owner confirms the displayed composition (replaces legacy / heuristic doubt). */
export function confirmCascadeMembership(input: {
	digest: string
	positionIds: string[]
	owner: string
	/** Required — confirming membership also binds the UI network. */
	network: 'mainnet' | 'testnet'
}): void {
	persistConfirmedCascadeMembers({
		digest: input.digest,
		positionIds: input.positionIds,
		origin: 'user_confirmed',
		owner: input.owner,
		network: input.network,
	})
}

function rangesOverlap(a: PortfolioPosition, b: PortfolioPosition): boolean {
	const aLo = Math.min(a.lowerPriceUsdcPerSui, a.upperPriceUsdcPerSui)
	const aHi = Math.max(a.lowerPriceUsdcPerSui, a.upperPriceUsdcPerSui)
	const bLo = Math.min(b.lowerPriceUsdcPerSui, b.upperPriceUsdcPerSui)
	const bHi = Math.max(b.lowerPriceUsdcPerSui, b.upperPriceUsdcPerSui)
	if (!(aLo > 0) || !(aHi > 0) || !(bLo > 0) || !(bHi > 0)) return false
	return Math.min(aHi, bHi) > Math.max(aLo, bLo) + 1e-12
}

function valueOf(p: PortfolioPosition): number | null {
	return compositionView(p).valueUsd
}

/** Link position ids to a remembered cascade once we see the open digest on-chain. */
export function bindCascadePositionIds(
	records: CascadeRecord[],
	positions: (PortfolioPosition & { openTxDigest?: string | null })[],
): CascadeRecord[] {
	let changed = false
	const next = records.map((rec) => {
		const found = positions
			.filter(
				(p) =>
					(p.protocol ?? 'dlmm') === rec.protocol &&
					p.poolId === rec.poolId &&
					p.openTxDigest === rec.digest,
			)
			.map((p) => p.positionId)
		if (found.length === 0) return rec
		// Digests prove membership. Legacy heuristic IDs are not carried forward.
		const trustedPrev = cascadeMembershipTrusted(rec) ? rec.positionIds : []
		const merged = [...new Set([...trustedPrev, ...found])]
		const sameIds =
			merged.length === rec.positionIds.length &&
			merged.every((id) => rec.positionIds.includes(id)) &&
			rec.positionIds.every((id) => merged.includes(id))
		if (sameIds && rec.membershipOrigin === 'open_digest') return rec
		changed = true
		if (rec.totalBudget > 0 && merged.length > 0) {
			setCostBasisForPositions(merged, rec.totalBudget / merged.length, {
				protocol: rec.protocol,
				poolId: rec.poolId,
				digest: rec.digest,
			})
		}
		return { ...rec, positionIds: merged, membershipOrigin: 'open_digest' as const }
	})
	if (changed) saveCascadeRecords(next)
	return next
}

function groupFromMembers(
	id: string,
	kind: 'cascade' | 'single',
	members: PortfolioPosition[],
	openTxDigest: string | null,
	slot: 'BUY' | 'SELL' | null,
): PortfolioGroup {
	const protocol = (members[0]?.protocol ?? 'dlmm') as 'clmm' | 'dlmm'
	const poolId = members[0]?.poolId ?? ''
	let valueSum = 0
	let valueAny = false
	let fee = 0
	let lower = Infinity
	let upper = -Infinity
	let inRangeCount = 0
	for (const m of members) {
		const v = valueOf(m)
		if (v != null) {
			valueSum += v
			valueAny = true
		}
		if (Number.isFinite(m.feeUsdEstimate)) fee += m.feeUsdEstimate
		const lo = Math.min(m.lowerPriceUsdcPerSui, m.upperPriceUsdcPerSui)
		const hi = Math.max(m.lowerPriceUsdcPerSui, m.upperPriceUsdcPerSui)
		if (lo > 0) lower = Math.min(lower, lo)
		if (hi > 0) upper = Math.max(upper, hi)
		if (m.inRange) inRangeCount += 1
	}
	return {
		id,
		kind,
		protocol,
		poolId,
		openTxDigest,
		slot,
		members: [...members].sort(
			(a, b) =>
				Math.max(b.lowerPriceUsdcPerSui, b.upperPriceUsdcPerSui) -
				Math.max(a.lowerPriceUsdcPerSui, a.upperPriceUsdcPerSui),
		),
		valueUsd: valueAny ? valueSum : null,
		feeUsd: fee,
		lower: Number.isFinite(lower) ? lower : 0,
		upper: Number.isFinite(upper) ? upper : 0,
		inRangeCount,
	}
}

/**
 * Group portfolio rows: remembered cascade digests / shared openTxDigest / overlapping heuristic.
 */
export function groupPortfolioPositions(
	positions: (PortfolioPosition & { openTxDigest?: string | null })[],
): PortfolioGroup[] {
	const records = bindCascadePositionIds(loadCascadeRecords(), positions)
	const used = new Set<string>()
	const groups: PortfolioGroup[] = []

	for (const rec of records) {
		const members = positions.filter((p) => {
			if (used.has(p.positionId)) return false
			if (rec.positionIds.includes(p.positionId) || rec.positionIds.includes(p.positionId.toLowerCase())) {
				return true
			}
			return (
				(p.protocol ?? 'dlmm') === rec.protocol &&
				p.poolId === rec.poolId &&
				!!p.openTxDigest &&
				p.openTxDigest === rec.digest
			)
		})
		// Keep cascade while any NFT from the open remains (incl. Empty); require original size ≥ 2.
		const keep =
			members.length >= 2 || (members.length >= 1 && (rec.lpCount >= 2 || rec.positionIds.length >= 2))
		if (!keep) continue
		for (const m of members) used.add(m.positionId)
		groups.push(
			groupFromMembers(`cascade:${rec.digest}`, 'cascade', members, rec.digest, rec.slot),
		)
	}

	// Shared open tx digest (one PTB cascade) even without local remember.
	const byDigest = new Map<string, typeof positions>()
	for (const p of positions) {
		if (used.has(p.positionId)) continue
		const d = p.openTxDigest?.trim()
		if (!d) continue
		const key = `${p.protocol ?? 'dlmm'}|${p.poolId}|${d}`
		const list = byDigest.get(key) ?? []
		list.push(p)
		byDigest.set(key, list)
	}
	for (const [key, members] of byDigest) {
		if (members.length < 2) continue
		for (const m of members) used.add(m.positionId)
		const digest = members[0]?.openTxDigest ?? null
		groups.push(groupFromMembers(`digest:${key}`, 'cascade', members, digest, null))
	}

	// Heuristic: overlapping ladder on same pool (for cascades opened as separate txs).
	const leftover = positions.filter((p) => !used.has(p.positionId))
	const byPool = new Map<string, typeof leftover>()
	for (const p of leftover) {
		const key = `${p.protocol ?? 'dlmm'}|${p.poolId}`
		const list = byPool.get(key) ?? []
		list.push(p)
		byPool.set(key, list)
	}
	for (const [poolKey, poolPos] of byPool) {
		const sorted = [...poolPos].sort(
			(a, b) =>
				Math.max(b.lowerPriceUsdcPerSui, b.upperPriceUsdcPerSui) -
				Math.max(a.lowerPriceUsdcPerSui, a.upperPriceUsdcPerSui),
		)
		const component: typeof sorted = []
		const flush = () => {
			if (component.length >= 2) {
				for (const m of component) used.add(m.positionId)
				groups.push(
					groupFromMembers(
						`overlap:${poolKey}:${component.map((c) => c.positionId).join(',')}`,
						'cascade',
						component,
						component[0]?.openTxDigest ?? null,
						null,
					),
				)
			} else if (component.length === 1) {
				const only = component[0]!
				used.add(only.positionId)
				groups.push(
					groupFromMembers(`single:${only.positionId}`, 'single', [only], only.openTxDigest ?? null, null),
				)
			}
			component.length = 0
		}
		for (const p of sorted) {
			if (component.length === 0) {
				component.push(p)
				continue
			}
			const prev = component[component.length - 1]!
			const vPrev = valueOf(prev)
			const vCur = valueOf(p)
			const similarValue =
				vPrev != null &&
				vCur != null &&
				vPrev > 0 &&
				vCur > 0 &&
				Math.max(vPrev, vCur) / Math.min(vPrev, vCur) <= 1.35
			if (rangesOverlap(prev, p) && similarValue) {
				component.push(p)
			} else {
				flush()
				component.push(p)
			}
		}
		flush()
	}

	for (const p of positions) {
		if (used.has(p.positionId)) continue
		groups.push(
			groupFromMembers(`single:${p.positionId}`, 'single', [p], p.openTxDigest ?? null, null),
		)
	}

	return groups.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))
}
