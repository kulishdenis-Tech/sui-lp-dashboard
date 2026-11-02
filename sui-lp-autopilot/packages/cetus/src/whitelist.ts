/**
 * Cetus DLMM mainnet pins from cetus-skills (2026-10-21 snapshot).
 * Prefer SDK config at runtime; these are fail-closed defaults.
 */
export const CETUS_DLMM_MAINNET = {
	packageId: '0x5664f9d3fd82c84023870cfbda8ea84e14c8dd56ce557ad2116e0668581a682b',
	publishedAt: '0x6b989f9b05bd11a00f1c7779443d66802c5e71631f59e87be5d2a616991f151e',
	routerPackageId: '0x8d389fa25cb08ebc5e520bc520ed394eed9e62b56b7868acb398bf298b8a76f3',
	/** `dlmm_router.published_at` from `@cetusprotocol/dlmm-sdk` 1.3.3 mainnet config. Calls use this id. */
	routerPublishedAt: '0x8937cf16447e9fd8f0db24f1e05364be0422585e0954b86afb18693510b6ca5b',
	globalConfig: '0xf31b605d117f959b9730e8c07b08b856cb05143c5e81d5751c90d2979e82f599',
	registry: '0xb1d55e7d895823c65f98d99b81a69436cf7d1638629c9ccb921326039cda1f1b',
	versioned: '0x05370b2d656612dd5759cbe80463de301e3b94a921dfc72dd9daa2ecdeb2d0a8',
} as const

/** Fill pool object IDs after discovery — never invent unverified pools. */
export type WhitelistedPool = {
	poolId: string
	coinTypeA: string
	coinTypeB: string
	/** Human label */
	label: string
	binStep: number
}

/**
 * SUI/USDC DLMM pools only. Empty by default until OWNER configures CETUS_DLMM_POOL_ID.
 * Do not create new pools.
 */
export function loadPoolWhitelist(envPoolId?: string): WhitelistedPool[] {
	const id = envPoolId?.trim()
	if (!id) return []
	return [
		{
			poolId: id,
			coinTypeA: '0x2::sui::SUI',
			coinTypeB:
				'0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
			label: 'SUI/USDC DLMM (env)',
			binStep: 10,
		},
	]
}

export function assertPoolAllowed(poolId: string, whitelist: WhitelistedPool[]): void {
	if (!whitelist.some((p) => p.poolId === poolId)) {
		throw new Error(`pool ${poolId} not in whitelist`)
	}
}
