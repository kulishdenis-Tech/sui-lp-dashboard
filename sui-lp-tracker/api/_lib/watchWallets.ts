/** Comma-separated Sui addresses (0x…) merged with Supabase watched_wallets. */
export function parseWatchWalletsFromEnv(): string[] {
	const raw = process.env.WATCH_WALLETS ?? ''
	return raw
		.split(/[,;\s]+/)
		.map((s) => s.trim().toLowerCase())
		.filter((s) => s.startsWith('0x') && s.length >= 66)
}

export function isWatchWallet(addr: string, allowed: Set<string>): boolean {
	return allowed.has(addr.trim().toLowerCase())
}
