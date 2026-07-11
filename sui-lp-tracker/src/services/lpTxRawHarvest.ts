import { suiClient } from '@/services/suiClient'
import type { LpTxRawRecord } from '@/types/lpLifecycle'
import { LP_LIFECYCLE_PARSER_VERSION } from '@/types/lpLifecycle'

/** Батчі `multiGetTransactionBlocks` без зайвого навантаження. */
export const LP_TX_FETCH_CHUNK = 8

/** Нормалізує сирий блок у запис для indexer (events + balanceChanges + effects опційно). */
export async function harvestLpTransactionsByDigest(digests: string[]): Promise<Map<string, LpTxRawRecord>> {
	const uniq = [...new Set(digests.filter((d) => d && d.trim().length > 0))]
	const out = new Map<string, LpTxRawRecord>()
	for (let i = 0; i < uniq.length; i += LP_TX_FETCH_CHUNK) {
		const chunk = uniq.slice(i, i + LP_TX_FETCH_CHUNK)
		let batch: Array<unknown>
		try {
			batch = await suiClient.multiGetTransactionBlocks({
				digests: chunk,
				options: {
					showBalanceChanges: true,
					showEffects: true,
					showEvents: true,
				},
			})
		} catch {
			for (const d of chunk) {
				try {
					const one = await suiClient.getTransactionBlock({
						digest: d,
						options: {
							showBalanceChanges: true,
							showEffects: true,
							showEvents: true,
						},
					})
					const rec = txResponseToRawRecord(one)
					if (rec) out.set(rec.digest, rec)
				} catch {
					/* skip */
				}
			}
			continue
		}
		for (const tx of batch) {
			const rec = txResponseToRawRecord(tx as Parameters<typeof txResponseToRawRecord>[0])
			if (rec) out.set(rec.digest, rec)
		}
	}
	return out
}

function txResponseToRawRecord(tx: {
	digest?: string
	timestampMs?: string | null
	events?: unknown[] | null
	balanceChanges?: unknown[] | null
	effects?: unknown | null
	transaction?: { data?: { sender?: string } } | null
}): LpTxRawRecord | null {
	const digest = tx.digest?.trim()
	if (!digest) return null
	let sender = ''
	const te = tx.transaction?.data?.sender
	if (typeof te === 'string' && te.startsWith('0x')) sender = te
	if (!sender && Array.isArray(tx.events) && tx.events.length > 0) {
		const s = (tx.events[0] as { sender?: string })?.sender
		if (typeof s === 'string' && s.startsWith('0x')) sender = s
	}
	const ts = tx.timestampMs != null ? parseInt(String(tx.timestampMs), 10) : NaN
	return {
		digest,
		timestampMs: Number.isFinite(ts) ? ts : 0,
		sender,
		eventsJson: tx.events ?? [],
		balanceChangesJson: tx.balanceChanges ?? [],
		effectsJson: tx.effects ?? null,
		parserVersion: LP_LIFECYCLE_PARSER_VERSION,
	}
}
