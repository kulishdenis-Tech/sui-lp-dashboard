/**
 * Client/server watchlist. Prefer env — never hardcode personal wallets in git.
 * - Client: `VITE_WATCH_WALLETS` (comma-separated)
 * - Server: `WATCH_WALLETS` or `VITE_WATCH_WALLETS`
 */
function parseList(raw: string | undefined): string[] {
	if (!raw) return []
	return raw
		.split(/[,;\s]+/)
		.map((s) => s.trim().toLowerCase())
		.filter((s) => s.startsWith('0x') && s.length >= 66)
}

function envWatchList(): string[] {
	const fromNode =
		typeof process !== 'undefined'
			? process.env.WATCH_WALLETS || process.env.VITE_WATCH_WALLETS
			: undefined
	const fromVite =
		typeof import.meta !== 'undefined'
			? (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_WATCH_WALLETS
			: undefined
	return parseList(fromNode || fromVite)
}

/** Same list as env; empty when unset (privacy). */
export const WATCH_WALLET_SEED: readonly string[] = envWatchList()

let _set: Set<string> | null = null

export function getClientWatchWallets(): Set<string> {
	if (_set) return _set
	_set = new Set(envWatchList())
	return _set
}

export function isClientWatchWallet(addr: string | null | undefined): boolean {
	if (!addr) return false
	return getClientWatchWallets().has(addr.trim().toLowerCase())
}
