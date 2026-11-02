import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'

const LS_KEY = 'sui_lp_manual_address_v1'

/** ZWSP, ZWNJ, ZWJ, BOM, word joiner, variation selectors. Listed outside a regex class so they are not treated as one grapheme. */
const FORMAT_CODE_POINTS = new Set<number>([
	0x200b, 0x200c, 0x200d, 0xfeff, 0x2060,
	...Array.from({ length: 0xfe0f - 0xfe00 + 1 }, (_, i) => 0xfe00 + i),
])

function stripFormatChars(raw: string): string {
	let out = ''
	for (const ch of raw) {
		const cp = ch.codePointAt(0)
		if (cp != null && FORMAT_CODE_POINTS.has(cp)) continue
		out += ch
	}
	return out
}

/** Strip invisible / whitespace so paste from Discord / block explorers works. */
export function sanitizePastedAddressInput(raw: string): string {
	return stripFormatChars(raw)
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
