/**
 * Attention panel — only computable facts (no rebalance advice).
 * Priority: action needed → stale sources → informational portfolio updates.
 */
import {
	formatHealthFactor,
	lendingHealthFactorThresholds,
} from '@/config/lendingHealthFactorThresholds'
import type { OverviewRiskRow } from '@/pages/overviewLab/overviewRisk'
import type { LendingSnapshot, OpenPosition } from '@/types'
import { getAutoWithdrawRule } from '@/pages/autopilot/autoWithdrawStore'
import {
	NEAR_EDGE_PCT,
	classifyPositionRangeEdge,
	type OverviewSourceHealth,
} from '@/pages/overviewLab/overviewMetrics'

export type AttentionSeverity = 'info' | 'warn' | 'critical'

/** action = needs owner response; update = informational portfolio fact. */
export type AttentionKind = 'action' | 'update'

export type AttentionItem = {
	id: string
	severity: AttentionSeverity
	kind: AttentionKind
	title: string
	detail: string
	href?: string
}

function pairLabel(p: OpenPosition): string {
	return `${p.tokenA}/${p.tokenB}`
}

export function buildLpAttentionItems(positions: OpenPosition[]): AttentionItem[] {
	const items: AttentionItem[] = []
	let aboveN = 0
	let belowN = 0
	let nearN = 0

	for (const p of positions) {
		const edge = classifyPositionRangeEdge(p)
		const rule = getAutoWithdrawRule(p.id)
		const watchingLive =
			!!rule &&
			rule.enabled &&
			rule.status !== 'disabled' &&
			rule.status !== 'completed'

		if (watchingLive && rule.status === 'awaiting_approval') {
			const side =
				edge.kind === 'out_of_range'
					? `${edge.side} range · `
					: edge.kind === 'near_edge'
						? `Near ${edge.bound} · `
						: ''
			items.push({
				id: `aw-met-${p.id}`,
				severity: 'critical',
				kind: 'action',
				title: `${side}Awaiting approval · ${pairLabel(p)}`,
				detail: 'Watching condition met. Owner signature required — no auto-send.',
				href: `/lp/position/${encodeURIComponent(p.id)}`,
			})
		} else if (watchingLive && rule.status === 'check_failed') {
			items.push({
				id: `aw-fail-${p.id}`,
				severity: 'warn',
				kind: 'action',
				title: `Watching check failed · ${pairLabel(p)}`,
				detail: 'Server reported check_failed for this Watching rule.',
				href: `/lp/position/${encodeURIComponent(p.id)}`,
			})
		} else if (
			watchingLive &&
			edge.kind === 'out_of_range' &&
			edge.side === 'Below'
		) {
			items.push({
				id: `aw-below-${p.id}`,
				severity: 'info',
				kind: 'update',
				title: `Below range · Watching · ${pairLabel(p)}`,
				detail: `${edge.distancePct.toFixed(1)}% below Lower (${edge.priceLabel}).`,
				href: `/lp/position/${encodeURIComponent(p.id)}`,
			})
		}

		if (edge.kind === 'near_edge') {
			nearN += 1
			if (nearN <= 3) {
				items.push({
					id: `near-${p.id}`,
					severity: 'warn',
					kind: 'update',
					title: `Near ${edge.bound} · ${pairLabel(p)}`,
					detail: `${edge.distancePct.toFixed(1)}% of spot to ${edge.bound} (${edge.priceLabel}). ≤${NEAR_EDGE_PCT}% threshold.`,
					href: `/lp/position/${encodeURIComponent(p.id)}`,
				})
			}
		} else if (edge.kind === 'out_of_range') {
			if (edge.side === 'Above') aboveN += 1
			else belowN += 1
		}
	}

	if (nearN > 3) {
		items.push({
			id: 'near-more',
			severity: 'warn',
			kind: 'update',
			title: `${nearN - 3} more near edge`,
			detail: 'Open Positions filters for the full list.',
		})
	}

	// Out-of-range is informational — never a red alarm dump of every row.
	if (aboveN + belowN > 0) {
		const parts: string[] = []
		if (aboveN) parts.push(`${aboveN} above`)
		if (belowN) parts.push(`${belowN} below`)
		items.push({
			id: 'oor-summary',
			severity: 'info',
			kind: 'update',
			title: `${aboveN + belowN} out of range`,
			detail: `${parts.join(' · ')}. May match BUY/SELL strategy.`,
		})
	}

	return items
}

export function buildLendingAttentionItems(
	snaps: Array<{ snap: LendingSnapshot | null; label: string; protocol?: string }>,
): AttentionItem[] {
	const items: AttentionItem[] = []
	for (const { snap, label, protocol } of snaps) {
		if (!snap) continue
		const debt = snap.totalBorrowedUSD
		if (!(debt > 0)) continue
		const hf = snap.healthFactor
		if (hf == null || !Number.isFinite(hf) || hf <= 0) continue
		const thresholds = lendingHealthFactorThresholds(protocol ?? snap.protocol ?? '')
		if (hf >= thresholds.safeMin) continue
		const p0 = hf < thresholds.warningMin
		items.push({
			id: `lend-hf-${label}`,
			severity: p0 ? 'critical' : 'warn',
			kind: 'action',
			title: `${label} HF ${formatHealthFactor(hf)} · below ${thresholds.safeMin.toFixed(2)}`,
			detail: p0
				? `P0 · health factor is under ${thresholds.warningMin.toFixed(2)}.`
				: `Warning · health factor is under ${thresholds.safeMin.toFixed(2)}.`,
			href: '/home',
		})
	}
	return items
}

/** Current isolated markets on every watch wallet. Multiplier rows are ignored. */
export function buildCurrentMarketAttentionItems(rows: readonly OverviewRiskRow[]): AttentionItem[] {
	return buildLendingAttentionItems(
		rows
			.filter((row) => row.kind === 'current_market' && !row.stableLoop)
			.map((row) => ({
				snap: {
					totalBorrowedUSD: 1,
					healthFactor: row.healthFactor,
					protocol: 'Current',
					supplies: [],
					borrows: [],
					totalSuppliedUSD: 0,
					netValueUSD: 0,
					rewardsToClaim: [],
				} as LendingSnapshot,
				label:
					row.walletLabel && row.walletLabel !== '—'
						? `${row.walletLabel} · ${row.positionLabel}`
						: row.positionLabel,
				protocol: 'Current',
			})),
	)
}

/** Compact range exceptions for the Attention panel. One line per kind, not per LP. */
export function buildRangeExceptionItems(positions: OpenPosition[]): AttentionItem[] {
	let aboveN = 0
	let belowN = 0
	let nearN = 0
	for (const p of positions) {
		const edge = classifyPositionRangeEdge(p)
		if (edge.kind === 'near_edge') nearN += 1
		else if (edge.kind === 'out_of_range') {
			if (edge.side === 'Above') aboveN += 1
			else belowN += 1
		}
	}
	const items: AttentionItem[] = []
	if (belowN + aboveN > 0) {
		const parts: string[] = []
		if (belowN) parts.push(`${belowN} below`)
		if (aboveN) parts.push(`${aboveN} above`)
		items.push({
			id: 'oor-summary',
			severity: 'warn',
			kind: 'update',
			title: `Out of range · ${parts.join(' · ')}`,
			detail: 'Each LP is counted on its own.',
		})
	}
	if (nearN > 0) {
		items.push({
			id: 'near-summary',
			severity: 'warn',
			kind: 'update',
			title: `Near edge · ${nearN} ${nearN === 1 ? 'LP' : 'LPs'} within ${NEAR_EDGE_PCT}% of a bound`,
			detail: 'Still inside the range.',
		})
	}
	return items
}

export function buildSourceAttentionItems(sources: OverviewSourceHealth[]): AttentionItem[] {
	const items: AttentionItem[] = []
	for (const s of sources) {
		if (s.status === 'error') {
			items.push({
				id: `src-err-${s.id}`,
				severity: 'warn',
				kind: 'action',
				title: `${s.label} unavailable`,
				detail: s.detail ?? 'Last load failed.',
			})
		} else if (s.status === 'stale') {
			items.push({
				id: `src-stale-${s.id}`,
				severity: 'info',
				kind: 'update',
				title: `Stale · ${s.label}`,
				detail: s.detail ?? 'Using last known data.',
			})
		}
	}
	return items
}

const ATTENTION_RANK = ['p0', 'warning', 'out_of_range', 'near_edge', 'other'] as const

function attentionRank(item: AttentionItem): (typeof ATTENTION_RANK)[number] {
	if (item.id.startsWith('oor-')) return 'out_of_range'
	if (item.id.startsWith('near-')) return 'near_edge'
	if (item.severity === 'critical') return 'p0'
	if (item.severity === 'warn' && item.kind === 'action') return 'warning'
	return 'other'
}

/** P0, then warning, then out of range, then near edge. */
export function orderOverviewAttention(items: readonly AttentionItem[]): AttentionItem[] {
	return [...items].sort(
		(a, b) => ATTENTION_RANK.indexOf(attentionRank(a)) - ATTENTION_RANK.indexOf(attentionRank(b)),
	)
}

/** Grey footer. Sources that are stale or failed; "none" when every source is fresh. */
export function staleAttentionLabel(sources: readonly { status: string; label: string }[]): string {
	const names = sources
		.filter((source) => source.status === 'stale' || source.status === 'error')
		.map((source) => source.label)
	return names.length === 0 ? 'STALE · none' : `STALE · ${names.join(', ')}`
}

export function mergeAttentionItems(...groups: AttentionItem[][]): AttentionItem[] {
	const seen = new Set<string>()
	const out: AttentionItem[] = []
	const order: AttentionSeverity[] = ['critical', 'warn', 'info']
	const flat = groups.flat()
	for (const sev of order) {
		for (const item of flat) {
			if (item.severity !== sev) continue
			if (seen.has(item.id)) continue
			seen.add(item.id)
			out.push(item)
		}
	}
	return out
}

export function splitAttention(items: AttentionItem[]): {
	action: AttentionItem[]
	updates: AttentionItem[]
} {
	return {
		action: items.filter((i) => i.kind === 'action'),
		updates: items.filter((i) => i.kind === 'update'),
	}
}
