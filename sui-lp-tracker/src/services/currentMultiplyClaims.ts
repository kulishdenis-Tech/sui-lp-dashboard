/**
 * Claimed Current Multiply liquidity-mining rewards.
 * Event: `{package}::liquidity_mining::RewardClaimedEvent`
 * Fields used: `obligation`, `reward_coin_type`, `reward_amount`.
 * Package: https://current-finance.gitbook.io/buildkit
 *
 * These coins leave the obligation and sit in the wallet. They are not part of
 * Net Value (collateral − debt).
 */
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { suiClient } from '@/services/suiClient'

const CLAIM_STRUCT = '::liquidity_mining::RewardClaimedEvent'
const MAX_PAGES = 12
const PAGE_SIZE = 50

export interface RawRewardClaim {
	coinType: string
	amountRaw: string
	timestampMs: number | null
}

export interface ObligationClaims {
	events: RawRewardClaim[]
	/** Sum of raw amounts by coin type. */
	totals: Array<{ coinType: string; amountRaw: string }>
}

type EventLike = {
	type?: string
	parsedJson?: unknown
	timestampMs?: string | null
}

function normId(id: string): string {
	try {
		return normalizeSuiAddress(id)
	} catch {
		return id.trim().toLowerCase()
	}
}

function with0x(t: string): string {
	const s = t.trim()
	return s.startsWith('0x') || s.startsWith('0X') ? s : `0x${s}`
}

function asRecord(v: unknown): Record<string, unknown> | null {
	return v != null && typeof v === 'object' ? (v as Record<string, unknown>) : null
}

/**
 * Dollar value of one claim. Only a non-approximate historical quote counts.
 * A current-spot fallback is not the price at the claim.
 */
export function historicalClaimUsd(
	amount: number | null,
	quote: { usdPerToken: number | null; approximate: boolean } | null,
): number | null {
	if (amount == null || !Number.isFinite(amount)) return null
	if (quote == null || quote.approximate) return null
	const px = quote.usdPerToken
	if (px == null || !Number.isFinite(px) || !(px > 0)) return null
	return amount * px
}

/** Keep RewardClaimed events for one obligation. Other obligations in the same tx stay out. */
export function claimsForObligation(events: EventLike[], obligationId: string): ObligationClaims {
	const want = normId(obligationId)
	const eventsOut: RawRewardClaim[] = []
	const sums = new Map<string, bigint>()
	for (const event of events) {
		const type = event.type ?? ''
		if (!type.endsWith(CLAIM_STRUCT)) continue
		const json = asRecord(event.parsedJson)
		if (!json) continue
		const obligation = typeof json.obligation === 'string' ? json.obligation : ''
		if (!obligation || normId(obligation) !== want) continue
		const coin = typeof json.reward_coin_type === 'string' ? json.reward_coin_type : ''
		const raw = typeof json.reward_amount === 'string' ? json.reward_amount : ''
		if (!coin || !/^\d+$/.test(raw) || raw === '0') continue
		const coinType = with0x(coin)
		const ts = event.timestampMs != null && /^\d+$/.test(event.timestampMs) ? Number(event.timestampMs) : null
		eventsOut.push({ coinType, amountRaw: raw, timestampMs: Number.isFinite(ts) ? ts : null })
		const key = coinType.toLowerCase()
		sums.set(key, (sums.get(key) ?? 0n) + BigInt(raw))
	}
	const totals = [...sums.entries()].map(([key, raw]) => {
		const sample = eventsOut.find((row) => row.coinType.toLowerCase() === key)
		return { coinType: sample?.coinType ?? key, amountRaw: raw.toString() }
	})
	return { events: eventsOut, totals }
}

/**
 * Sender scan, newest first. One pass covers every Multiply obligation on the wallet.
 * Stops after 12 pages. `partial` means older claims may still exist.
 */
export async function readWalletRewardClaims(
	owner: string,
	obligationIds: string[],
): Promise<{ status: 'complete' | 'partial' | 'unavailable'; byObligation: Map<string, ObligationClaims> }> {
	const wanted = new Set(obligationIds.map(normId))
	const byObligation = new Map<string, ObligationClaims>()
	if (wanted.size === 0) return { status: 'complete', byObligation }
	const bucket = new Map<string, EventLike[]>()
	// GraphQL pages use an opaque string. The client type still says EventId.
	let cursor: string | undefined
	let partial = false
	try {
		for (let page = 0; page < MAX_PAGES; page++) {
			const res = await suiClient.queryEvents({
				query: { Sender: owner },
				cursor: cursor as unknown as { txDigest: string; eventSeq: string } | undefined,
				limit: PAGE_SIZE,
				order: 'descending',
			})
			for (const event of res.data) {
				const json = asRecord(event.parsedJson)
				const obligation = typeof json?.obligation === 'string' ? normId(json.obligation) : ''
				if (!wanted.has(obligation)) continue
				const list = bucket.get(obligation) ?? []
				list.push({
					type: event.type,
					parsedJson: event.parsedJson,
					timestampMs: event.timestampMs,
				})
				bucket.set(obligation, list)
			}
			const next = res.nextCursor as unknown as string | null | undefined
			if (!res.hasNextPage || !next) {
				partial = false
				break
			}
			cursor = next
			partial = page === MAX_PAGES - 1
		}
	} catch (err) {
		console.warn('[current-multiply] reward claim history unavailable', err)
		return { status: 'unavailable', byObligation }
	}
	for (const id of obligationIds) {
		const key = normId(id)
		byObligation.set(key, claimsForObligation(bucket.get(key) ?? [], id))
	}
	return { status: partial ? 'partial' : 'complete', byObligation }
}
