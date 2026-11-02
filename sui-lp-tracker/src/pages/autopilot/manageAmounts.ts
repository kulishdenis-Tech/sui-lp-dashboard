import { asFiniteNumber, formatUSD } from '@/utils/formatting'
import { normalizeCoinTypeForMatch } from '@/utils/suiCoinType'

const SUI_TYPE = normalizeCoinTypeForMatch('0x2::sui::SUI')

export type GasPreviewInput = {
	computationCost?: string
	storageCost?: string
	storageRebate?: string
	nonRefundableStorageFee?: string
} | null

export type NetworkFeeEstimate = {
	computationMist: bigint
	storageMist: bigint
	storageRebateMist: bigint
	/**
	 * Gross = computation + storage (before rebate).
	 * Closest to what wallets show as “network fee” / gas.
	 */
	grossMist: bigint
	/**
	 * Signed net = computation + storage − rebate.
	 * Positive → net cost; negative → storage rebate exceeds costs.
	 */
	netMist: bigint
}

/** Parse a mist string; null = missing. Malformed is handled by callers as unavailable. */
function parseMistOptional(raw: string | undefined): { ok: true; value: bigint | null } | { ok: false } {
	if (raw == null) return { ok: true, value: null }
	if (!/^\d+$/.test(raw)) return { ok: false }
	return { ok: true, value: BigInt(raw) }
}

/**
 * Full network cost model — do not label computationCost alone as the network fee.
 * Incomplete or malformed fields → null (Estimate unavailable), never a fake zero fee.
 * Confirmed all-zero costs with valid digit fields → netMist 0 (real zero).
 */
export function estimateNetworkFee(gas: GasPreviewInput): NetworkFeeEstimate | null {
	if (!gas) return null

	const computation = parseMistOptional(gas.computationCost)
	const storage = parseMistOptional(gas.storageCost)
	const rebate = parseMistOptional(gas.storageRebate)
	if (!computation.ok || !storage.ok || !rebate.ok) return null

	// Incomplete breakdown → unavailable (do not treat missing storage/rebate as 0).
	if (computation.value == null || storage.value == null || rebate.value == null) return null

	const computationMist = computation.value
	const storageMist = storage.value
	const storageRebateMist = rebate.value
	const grossMist = computationMist + storageMist
	const netMist = grossMist - storageRebateMist
	return { computationMist, storageMist, storageRebateMist, grossMist, netMist }
}

export function mistToSui(mist: bigint): number {
	return Number(mist) / 1e9
}

export function formatTokenAmount(n: number | null | undefined): string {
	const v = asFiniteNumber(n)
	if (v == null) return 'Estimate unavailable'
	if (v === 0) return '0'
	const abs = Math.abs(v)
	if (abs > 0 && abs < 0.000001) return v < 0 ? '>-0.000001' : '<0.000001'
	if (abs >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
	if (abs >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 4 })
	if (abs >= 0.01) return v.toLocaleString('en-US', { maximumFractionDigits: 6 })
	return v.toLocaleString('en-US', { maximumFractionDigits: 8 })
}

export function formatUsdDisplay(n: number | null | undefined): string {
	const v = asFiniteNumber(n)
	if (v == null) return 'Estimate unavailable'
	return formatUSD(v)
}

export function formatSuiAmount(sui: number | null | undefined): string | null {
	const v = asFiniteNumber(sui)
	if (v == null) return null
	return formatTokenAmount(v)
}

export function remainingAfterRemove(
	inPosition: number,
	pct: number,
): { remove: number; left: number } {
	if (!(inPosition > 0) || !(pct > 0)) return { remove: 0, left: Math.max(0, inPosition) }
	const p = Math.min(1, pct)
	const remove = inPosition * p
	return { remove, left: Math.max(0, inPosition - remove) }
}

/** Price of native SUI from position hint by coinType — not by pair order. */
export function suiUsdFromHint(hint: {
	tokenAAddress: string
	tokenBAddress: string
	currentPriceA_USD?: number
	currentPriceB_USD?: number
} | null): number | null {
	if (!hint) return null
	if (normalizeCoinTypeForMatch(hint.tokenAAddress) === SUI_TYPE) {
		return asFiniteNumber(hint.currentPriceA_USD)
	}
	if (normalizeCoinTypeForMatch(hint.tokenBAddress) === SUI_TYPE) {
		return asFiniteNumber(hint.currentPriceB_USD)
	}
	return null
}

export function isSuiCoinType(coinType: string): boolean {
	return normalizeCoinTypeForMatch(coinType) === SUI_TYPE
}
