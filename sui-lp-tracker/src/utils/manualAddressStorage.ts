import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'

const LS_KEY = 'sui_lp_manual_address_v1'

/** Strip invisible / whitespace so paste from Discord / block explorers works. */
export function sanitizePastedAddressInput(raw: string): string {
	return raw
		.replace(/[\u200b-\u200d\ufeff\u2060\ufe00-\ufe0f]/g, '')
		.replace(/[\r\n\t]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

export function readStoredManualAddress(): string | null {
	if (typeof window === 'undefined') return null
	try {
		const raw = localStorage.getItem(LS_KEY)
		if (!raw) return null
		const n = normalizeSuiAddress(raw)
		return isValidSuiAddress(n) ? n : null
	} catch {
		return null
	}
}

export function persistManualAddress(address: string | null) {
	if (typeof window === 'undefined') return
	try {
		if (address) localStorage.setItem(LS_KEY, address)
		else localStorage.removeItem(LS_KEY)
	} catch {
		/* ignore */
	}
}
