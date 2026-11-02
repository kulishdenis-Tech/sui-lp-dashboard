import type { OpenPosition } from '@/types'
import {
	bindCascadePositionIds,
	cascadeMembershipTrusted,
	loadCascadeRecords,
	persistConfirmedCascadeMembers,
	rememberCascadeOpen,
	type CascadeRecord,
} from './cascadeGroups'
import { sortCascadeMembersForSlot, cascadeRangeHigh, cascadeRangeLow } from './cascadeMemberOrder'
import { positionValueUsd } from '@/utils/positionDerivedMetrics'
import type { PortfolioPosition } from './portfolioMetrics'

export type CascadeTableGroup =
	| {
			kind: 'cascade'
			id: string
			record: CascadeRecord
			members: OpenPosition[]
			/**
			 * Financial Manage allowed only when true (digest-bound or user-confirmed).
			 * Untrusted display groups stay visible but Manage stays blocked.
			 */
			membershipTrusted: boolean
			/** Same-pool candidates not proven — never used for financial actions. */
			suggestedMembers: OpenPosition[]
	  }
	| { kind: 'single'; id: string; members: [OpenPosition] }

function isClmmCetus(p: OpenPosition): boolean {
	return p.protocol === 'cetus' && !p.cetusDlmm && !p.cetusVault
}

function isDlmmCetus(p: OpenPosition): boolean {
	return p.protocol === 'cetus' && !!p.cetusDlmm && !p.cetusVault
}

function toPortfolioStub(
	p: OpenPosition,
	openTxDigest: string | null,
): PortfolioPosition & { openTxDigest?: string | null } {
	const lo = cascadeRangeLow(p)
	const hi = cascadeRangeHigh(p)
	return {
		protocol: p.cetusDlmm ? 'dlmm' : 'clmm',
		positionId: p.id,
		poolId: p.poolId,
		lowerPriceUsdcPerSui: lo,
		upperPriceUsdcPerSui: hi,
		inRange: p.status === 'in_range',
		amountSui: 0,
		amountUsdc: 0,
		feeUsdEstimate: Number.isFinite(p.unclaimedFeeUSD) ? p.unclaimedFeeUSD : 0,
		openTxDigest,
	}
}

function uniqueById(rows: OpenPosition[]): OpenPosition[] {
	const seen = new Set<string>()
	const out: OpenPosition[] = []
	for (const p of rows) {
		if (seen.has(p.id)) continue
		seen.add(p.id)
		out.push(p)
	}
	return out
}

/**
 * Cascade stays visible until every NFT from the open is fully closed (gone from open list).
 * Empty (liquidity 0, NFT kept) members remain when they are confirmed members.
 */
function shouldKeepCascade(members: OpenPosition[], rec: Pick<CascadeRecord, 'lpCount' | 'positionIds'>): boolean {
	if (members.length >= 2) return true
	if (members.length >= 1 && (rec.lpCount >= 2 || rec.positionIds.length >= 2)) return true
	return false
}

function poolProtocolMatch(p: OpenPosition, rec: CascadeRecord): boolean {
	if (p.poolId !== rec.poolId) return false
	return rec.protocol === 'clmm' ? isClmmCetus(p) : isDlmmCetus(p)
}

/**
 * Group LP rows for Build cascades — confirmed membership only for financial actions.
 *
 * Proven sources:
 * 1) `rememberCascadeOpen` + digest-bound / user-confirmed `positionIds`
 * 2) shared on-chain openTxDigest (one PTB / one signature)
 *
 * Value similarity, Empty counts, and array order never prove membership and must not
 * be persisted as confirmed IDs.
 */
export function groupRememberedCascades(
	rows: OpenPosition[],
	openDigestByPosId: Map<string, string> = new Map(),
): CascadeTableGroup[] {
	const cetus = rows.filter((p) => p.protocol === 'cetus' && !p.cetusVault)
	const digestOf = (id: string) =>
		openDigestByPosId.get(id) ?? openDigestByPosId.get(id.toLowerCase()) ?? null
	const stubs = cetus.map((p) => toPortfolioStub(p, digestOf(p.id)))
	const records = bindCascadePositionIds(loadCascadeRecords(), stubs)

	const used = new Set<string>()
	const groups: CascadeTableGroup[] = []
	const byId = new Map(rows.map((p) => [p.id, p]))

	for (const rec of records) {
		const trusted = cascadeMembershipTrusted(rec)

		// Confirmed path: only stored confirmed IDs + live digest matches for this open.
		let members: OpenPosition[] = []
		if (trusted) {
			members = rec.positionIds
				.map((id) => byId.get(id) ?? byId.get(id.toLowerCase()))
				.filter((p): p is OpenPosition => !!p && !used.has(p.id))
		} else {
			// Legacy untrusted: show stored IDs for review, but Manage stays blocked.
			members = rec.positionIds
				.map((id) => byId.get(id) ?? byId.get(id.toLowerCase()))
				.filter((p): p is OpenPosition => !!p && !used.has(p.id) && poolProtocolMatch(p, rec))
		}

		for (const p of rows) {
			if (used.has(p.id) || members.some((m) => m.id === p.id)) continue
			if (!poolProtocolMatch(p, rec)) continue
			const d = digestOf(p.id)?.trim()
			if (d && d === rec.digest) members.push(p)
		}

		members = uniqueById(members)

		// Suggestions only — never persisted, never included in Manage plan.
		const suggestedMembers = rows.filter((p) => {
			if (used.has(p.id) || members.some((m) => m.id === p.id)) return false
			if (!poolProtocolMatch(p, rec)) return false
			return true
		})

		if (!shouldKeepCascade(members, rec)) continue

		const ordered = sortCascadeMembersForSlot(members, rec.slot)
		const digestProven = ordered.filter((m) => digestOf(m.id)?.trim() === rec.digest)
		const membershipTrusted =
			trusted ||
			(digestProven.length >= 2 && digestProven.length === ordered.length)

		if (membershipTrusted && digestProven.length > 0) {
			persistConfirmedCascadeMembers({
				digest: rec.digest,
				positionIds: ordered.map((m) => m.id),
				origin: trusted && rec.membershipOrigin === 'user_confirmed' ? 'user_confirmed' : 'open_digest',
			})
		}

		for (const m of ordered) used.add(m.id)
		groups.push({
			kind: 'cascade',
			id: `cascade:${rec.digest}`,
			record: {
				...rec,
				positionIds: ordered.map((m) => m.id),
				lpCount: Math.max(rec.lpCount, ordered.length),
				membershipOrigin: membershipTrusted
					? rec.membershipOrigin === 'user_confirmed'
						? 'user_confirmed'
						: 'open_digest'
					: 'legacy_untrusted',
			},
			members: ordered,
			membershipTrusted,
			suggestedMembers: membershipTrusted ? [] : suggestedMembers,
		})
	}

	// Same open digest = one Build cascade PTB (even if localStorage was cleared).
	const byDigest = new Map<string, OpenPosition[]>()
	for (const p of rows) {
		if (used.has(p.id)) continue
		if (p.protocol !== 'cetus' || p.cetusVault) continue
		const d = digestOf(p.id)?.trim()
		if (!d) continue
		const list = byDigest.get(d) ?? []
		list.push(p)
		byDigest.set(d, list)
	}
	for (const [digest, digestMembers] of byDigest) {
		if (used.has(digestMembers[0]?.id ?? '')) continue
		const existing = loadCascadeRecords().find((r) => r.digest === digest)
		const fromRecordTrusted =
			existing && cascadeMembershipTrusted(existing)
				? (existing.positionIds ?? [])
						.map((id) => byId.get(id) ?? byId.get(id.toLowerCase()))
						.filter((p): p is OpenPosition => !!p && !used.has(p.id))
				: []
		const members = uniqueById([
			...digestMembers.filter((p) => !used.has(p.id)),
			...fromRecordTrusted,
		])
		const protocol: 'clmm' | 'dlmm' = members[0]!.cetusDlmm ? 'dlmm' : 'clmm'
		const poolId = members[0]!.poolId

		if (
			!shouldKeepCascade(members, existing ?? { lpCount: members.length, positionIds: members.map((m) => m.id) })
		) {
			continue
		}

		const fundedBudget = members.reduce((s, m) => s + positionValueUsd(m), 0)
		if (!existing) {
			rememberCascadeOpen({
				digest,
				protocol,
				poolId,
				lpCount: Math.max(members.length, 2),
				slot: null,
				totalBudget: fundedBudget,
				positionIds: members.map((m) => m.id),
				network: 'mainnet',
			})
		} else {
			persistConfirmedCascadeMembers({
				digest,
				positionIds: members.map((m) => m.id),
				origin: 'open_digest',
			})
		}
		const slot = existing?.slot ?? null
		const ordered = sortCascadeMembersForSlot(members, slot)
		for (const m of ordered) used.add(m.id)
		groups.push({
			kind: 'cascade',
			id: `cascade:${digest}`,
			record: {
				digest,
				protocol,
				poolId,
				lpCount: Math.max(existing?.lpCount ?? 0, ordered.length),
				slot,
				totalBudget: existing?.totalBudget || fundedBudget,
				positionIds: ordered.map((m) => m.id),
				atMs: existing?.atMs ?? Date.now(),
				membershipOrigin: 'open_digest',
				owner: existing?.owner,
				network: existing?.network ?? 'mainnet',
			},
			members: ordered,
			membershipTrusted: true,
			suggestedMembers: [],
		})
	}

	for (const p of rows) {
		if (used.has(p.id)) continue
		groups.push({ kind: 'single', id: `single:${p.id}`, members: [p] })
	}

	return groups
}
