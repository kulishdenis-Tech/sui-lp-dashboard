import { PARTIAL_FILL_REL_TOLERANCE } from '@/poolQuote/config'

/**
 * Exact-in: consumed must match requested within absolute 1 mist or relative tolerance.
 */
export function isPartialFill(requested: string, consumed: string, relTol = PARTIAL_FILL_REL_TOLERANCE): boolean {
	try {
		const req = BigInt(requested)
		const got = BigInt(consumed)
		if (req <= 0n) return got !== req
		const diff = req > got ? req - got : got - req
		if (diff === 0n) return false
		if (diff <= 1n) return false
		const rel = Number(diff) / Number(req)
		return rel > relTol
	} catch {
		return true
	}
}
