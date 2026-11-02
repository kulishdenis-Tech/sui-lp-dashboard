import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'

/**
 * Canonical Sui transaction digest from frozen BCS bytes (pre-broadcast).
 * Base58 digests are case-sensitive — never normalize with toLowerCase.
 */
export function suiTxDigestFromBytesBase64(txBytesBase64: string): string {
	const bytes = fromBase64(txBytesBase64)
	return TransactionDataBuilder.getDigestFromBytes(bytes)
}

/** Exact digest equality (base58 is case-sensitive). */
export function sameSuiTxDigest(a: string | null | undefined, b: string | null | undefined): boolean {
	if (a == null || b == null) return false
	return a === b
}
