/**
 * Map Cetus close / prepare failures to short English copy.
 * Abort 23 = ECannotCloseAttackedPosition (compensation certificate NFT).
 */
import { CETUS_CLOSE_LOCKED_MESSAGE } from '@/services/cetusCompensationLock'

export function humanizeCetusCloseError(raw: string | null | undefined): string | null {
	if (!raw) return null
	if (
		/ECannotCloseAttackedPosition/i.test(raw) ||
		(/abort code:\s*23\b/i.test(raw) && /close_position/i.test(raw)) ||
		(/abort code:\s*23\b/i.test(raw) && /0x260693/i.test(raw)) ||
		/recovery certificate/i.test(raw) ||
		/received post-incident compensation/i.test(raw)
	) {
		return CETUS_CLOSE_LOCKED_MESSAGE
	}
	if (/upper tick cannot calculate liquidity by coinA/i.test(raw)) {
		return 'This range only accepts the other token at the current price. Switch the deposit token and try again.'
	}
	if (/Price is below this range/i.test(raw) || /Price is above this range/i.test(raw)) {
		return raw.split('.')[0] + '.'
	}
	return null
}
