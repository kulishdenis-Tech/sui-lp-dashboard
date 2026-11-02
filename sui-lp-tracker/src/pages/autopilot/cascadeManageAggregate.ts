/**
 * Aggregate cascade Manage dry-runs: receives by coinType + net network fee.
 * Unknown ≠ zero; incomplete USD marked Partial by callers.
 */
import { normalizeCoinTypeForMatch } from '@/utils/suiCoinType'
import {
	estimateNetworkFee,
	type GasPreviewInput,
	type NetworkFeeEstimate,
} from './manageAmounts'
import {
	aggregateOwnerReceives,
	rawToHuman,
	symbolFromType,
	type BalanceChangeRow,
} from './previewReceiveSummary'

export type CascadeDryRunSlice = {
	owner: string
	balanceChanges?: BalanceChangeRow[]
	gas?: GasPreviewInput
	/** false when build/dry-run failed — excluded from sums (not treated as zero). */
	ok: boolean
}

export type AggregatedRawLine = {
	coinType: string
	raw: bigint
}

export type AggregatedHumanLine = {
	coinType: string
	symbol: string
	amount: number | null
	/** Missing decimals → amount unavailable */
	unavailable: boolean
}

export type CascadeFeeAggregate = {
	/** Sum of grossMist (computation + storage) — wallet-comparable fee. */
	grossMist: bigint | null
	/** Sum of signed netMist across successful slices with gas. */
	netMist: bigint | null
	/** At least one ok slice lacked parseable gas. */
	anyMissing: boolean
	sliceCountWithFee: number
}

export function aggregateCascadeReceives(slices: CascadeDryRunSlice[]): AggregatedRawLine[] {
	const byType = new Map<string, bigint>()
	for (const slice of slices) {
		if (!slice.ok) continue
		const fee = estimateNetworkFee(slice.gas ?? null)
		const gasMistStr = fee ? fee.netMist.toString() : null
		const lines = aggregateOwnerReceives(slice.balanceChanges, slice.owner, gasMistStr)
		for (const line of lines) {
			const key = normalizeCoinTypeForMatch(line.coinType)
			byType.set(key, (byType.get(key) ?? 0n) + line.raw)
		}
	}
	const out: AggregatedRawLine[] = []
	for (const [coinType, raw] of byType) {
		if (raw > 0n) out.push({ coinType, raw })
	}
	out.sort((a, b) => (a.coinType < b.coinType ? -1 : 1))
	return out
}

export function aggregateCascadeNetworkFees(slices: CascadeDryRunSlice[]): CascadeFeeAggregate {
	let netMist = 0n
	let grossMist = 0n
	let anyMissing = false
	let sliceCountWithFee = 0
	let anyOk = false
	for (const slice of slices) {
		if (!slice.ok) continue
		anyOk = true
		const fee: NetworkFeeEstimate | null = estimateNetworkFee(slice.gas ?? null)
		if (!fee) {
			anyMissing = true
			continue
		}
		netMist += fee.netMist
		grossMist += fee.grossMist
		sliceCountWithFee += 1
	}
	if (!anyOk) {
		return { grossMist: null, netMist: null, anyMissing: true, sliceCountWithFee: 0 }
	}
	if (sliceCountWithFee === 0) {
		return { grossMist: null, netMist: null, anyMissing: true, sliceCountWithFee: 0 }
	}
	return { grossMist, netMist, anyMissing, sliceCountWithFee }
}

/**
 * Humanize aggregated raw lines. Missing decimals → unavailable (not zero).
 * `decimalsByCoinType` keys should be normalizeCoinTypeForMatch'd.
 */
export function humanizeAggregatedReceives(
	lines: AggregatedRawLine[],
	decimalsByCoinType: Map<string, number>,
	symbolByCoinType?: Map<string, string>,
): AggregatedHumanLine[] {
	return lines.map((line) => {
		const key = normalizeCoinTypeForMatch(line.coinType)
		const decimals = decimalsByCoinType.get(key)
		const symbol = symbolByCoinType?.get(key) || symbolFromType(line.coinType)
		if (decimals == null || !Number.isInteger(decimals) || decimals < 0) {
			return { coinType: line.coinType, symbol, amount: null, unavailable: true }
		}
		const amount = rawToHuman(line.raw, decimals)
		if (amount == null) {
			return { coinType: line.coinType, symbol, amount: null, unavailable: true }
		}
		return { coinType: line.coinType, symbol, amount, unavailable: false }
	})
}

export function cascadeBatchReady(slices: CascadeDryRunSlice[]): boolean {
	return slices.length > 0 && slices.every((s) => s.ok)
}
