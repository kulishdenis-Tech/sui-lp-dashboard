import { normalizeSuiAddress } from '@mysten/sui/utils'

/** Default advisor read wallet when `?wallet=` is omitted. */
export const ADVISOR_DEFAULT_WALLET =
	'0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'

const FALLBACK_WATCH_SECOND =
	'0xff8a51f37daceef95619a7d31915868375329964bacea6c72811175d6a458da6'

function parseWalletList(raw: string | undefined): string[] {
	if (!raw?.trim()) return []
	return raw
		.split(/[,;\s]+/)
		.map((s) => s.trim())
		.filter((s) => s.startsWith('0x') && s.length >= 66)
}

/** Allowed `?wallet=` values for advisor APIs (lowercase normalized). */
export function getAdvisorAllowedWalletSet(): Set<string> {
	const fromEnv = parseWalletList(process.env.WATCH_WALLETS)
	const seeds =
		fromEnv.length > 0
			? fromEnv
			: [ADVISOR_DEFAULT_WALLET, FALLBACK_WATCH_SECOND]
	const normalized = seeds.map((w) => normalizeSuiAddress(w).toLowerCase())
	normalized.push(normalizeSuiAddress(ADVISOR_DEFAULT_WALLET).toLowerCase())
	return new Set(normalized)
}

export type AdvisorWalletResolve =
	| { ok: true; wallet: string }
	| { ok: false; message: string }

export function resolveAdvisorQueryWallet(queryWallet: string | undefined): AdvisorWalletResolve {
	const allowed = getAdvisorAllowedWalletSet()
	if (queryWallet == null || queryWallet.trim() === '') {
		return { ok: true, wallet: normalizeSuiAddress(ADVISOR_DEFAULT_WALLET).toLowerCase() }
	}
	let normalized: string
	try {
		normalized = normalizeSuiAddress(queryWallet.trim()).toLowerCase()
	} catch {
		return { ok: false, message: 'invalid wallet address' }
	}
	if (!allowed.has(normalized)) {
		return { ok: false, message: 'wallet not allowed' }
	}
	return { ok: true, wallet: normalized }
}

export function pickQueryWalletParam(
	query: Record<string, string | string[] | undefined> | undefined,
): string | undefined {
	const raw = query?.wallet
	if (typeof raw === 'string') return raw
	if (Array.isArray(raw)) return raw[0]
	return undefined
}
