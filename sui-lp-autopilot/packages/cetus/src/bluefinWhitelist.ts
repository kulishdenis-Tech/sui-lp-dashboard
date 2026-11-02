import { BLUEFIN_SPOT_MAINNET } from './bluefinConfig.js'

/**
 * Packages a MANUAL_SIGN Bluefin Spot open may call.
 * CurrentPackage hosts `pool::open_position` + `gateway::provide_liquidity_with_fixed_amount`.
 * BasePackage is the type origin (NFT / Pool type tags).
 */
export const BLUEFIN_MANUAL_SIGN_PACKAGES = [
	'0x1',
	'0x2',
	BLUEFIN_SPOT_MAINNET.BasePackage,
	BLUEFIN_SPOT_MAINNET.CurrentPackage,
] as const

export type BluefinWhitelistedPool = {
	poolId: string
	label: string
}

/** Optional env allowlist: comma-separated pool object IDs. Empty = all SUI/USDC from Spot API. */
export function loadBluefinPoolWhitelist(): BluefinWhitelistedPool[] | null {
	const raw = process.env.BLUEFIN_POOL_WHITELIST?.trim()
	if (!raw) return null
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.map((poolId) => ({ poolId, label: 'env' }))
}

export function assertBluefinPoolAllowed(poolId: string): void {
	const list = loadBluefinPoolWhitelist()
	if (!list) return
	const ok = list.some((p) => p.poolId.toLowerCase() === poolId.toLowerCase())
	if (!ok) throw new Error(`Bluefin pool ${poolId} is not in BLUEFIN_POOL_WHITELIST`)
}
