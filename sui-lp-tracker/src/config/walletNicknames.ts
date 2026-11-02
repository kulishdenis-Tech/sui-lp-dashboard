import { WATCH_WALLET_SEED } from '@/config/watchWallets'

/** Seed names for the two monitored accounts, in `WATCH_WALLET_SEED` order. */
const SEED_NICKNAME = ['Slush', 'OKX'] as const

export interface WalletNickname {
	address: string
	nickname: string
}

const NICKNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .'_-]*$/u

/** A short display name. Empty, too long, or an address is rejected. */
export function normalizeNickname(raw: string): string | null {
	const name = raw.trim().replace(/\s+/g, ' ')
	if (name.length < 1 || name.length > 24) return null
	if (name.toLowerCase().startsWith('0x')) return null
	if (!NICKNAME_PATTERN.test(name)) return null
	return name
}

export function isMonitoredWallet(address: string): boolean {
	const key = address.trim().toLowerCase()
	return WATCH_WALLET_SEED.some((item) => item === key)
}

/** Seed names, with a saved override winning when it is a valid nickname. */
export function resolveNicknames(
	overrides: Record<string, string> | null | undefined,
): WalletNickname[] {
	const extra = overrides ?? {}
	return WATCH_WALLET_SEED.map((address, index) => {
		const raw = extra[address]
		const nickname = typeof raw === 'string' ? normalizeNickname(raw) : null
		return { address, nickname: nickname ?? SEED_NICKNAME[index] ?? 'Account' }
	})
}

/** Keep only the two monitored accounts from an API payload. */
export function walletsFromPayload(wallets: unknown): WalletNickname[] | null {
	if (!Array.isArray(wallets)) return null
	const overrides: Record<string, string> = {}
	for (const item of wallets) {
		if (!item || typeof item !== 'object') continue
		const address =
			'address' in item && typeof item.address === 'string' ? item.address.trim().toLowerCase() : ''
		const nickname =
			'nickname' in item && typeof item.nickname === 'string' ? normalizeNickname(item.nickname) : null
		if (!isMonitoredWallet(address) || !nickname) continue
		overrides[address] = nickname
	}
	return resolveNicknames(overrides)
}
