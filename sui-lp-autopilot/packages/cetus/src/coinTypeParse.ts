/**
 * Parse Move coin-type values from gRPC / JSON-RPC object JSON.
 * Handles plain strings, TypeName `{ name }`, and `0x1::string::String` `{ fields: { bytes } }`.
 */
export function parseMoveCoinType(raw: unknown): string | null {
	if (typeof raw === 'string') {
		const t = raw.trim()
		if (!t.includes('::')) return null
		return ensure0xCoinType(t)
	}
	if (!raw || typeof raw !== 'object') return null
	const o = raw as {
		name?: unknown
		fields?: { name?: unknown; bytes?: number[] }
	}
	if (typeof o.name === 'string' && o.name.includes('::')) {
		return ensure0xCoinType(o.name.trim())
	}
	if (typeof o.fields?.name === 'string' && o.fields.name.includes('::')) {
		return ensure0xCoinType(o.fields.name.trim())
	}
	const bytes = o.fields?.bytes
	if (Array.isArray(bytes) && bytes.length) {
		try {
			const s = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes)).trim()
			if (s.includes('::')) return ensure0xCoinType(s)
		} catch {
			/* ignore */
		}
	}
	return null
}

function ensure0xCoinType(t: string): string {
	const s = t.startsWith('0x') ? t : `0x${t}`
	return s.replace(/^0x0+(?=[0-9a-fA-F])/, '0x')
}

/** Normalize for equality checks (lowercase, short 0x prefix). */
export function normCoinTypeKey(ct: string): string {
	return ct.replace(/^0x0+/, '0x').toLowerCase()
}

/**
 * Resolve decimals: on-chain metadata → known SUI/USDC → caller map by coin type.
 * Never invents decimals for unknown coins.
 */
export function resolveCoinDecimals(opts: {
	coinType: string
	metaDecimals?: number | null
	knownDecimals?: (coinType: string) => number | null
	byCoinType?: Record<string, number> | null
}): number | null {
	const meta = opts.metaDecimals
	if (meta != null && Number.isInteger(meta) && meta >= 0) return meta
	const known = opts.knownDecimals?.(opts.coinType)
	if (known != null && Number.isInteger(known) && known >= 0) return known
	const map = opts.byCoinType
	if (map) {
		const want = normCoinTypeKey(opts.coinType)
		for (const [k, v] of Object.entries(map)) {
			if (normCoinTypeKey(k) === want && Number.isInteger(v) && v >= 0) return v
		}
	}
	return null
}
