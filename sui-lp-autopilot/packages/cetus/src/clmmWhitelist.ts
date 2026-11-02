/**
 * Cetus CLMM mainnet pins — verified against:
 * - `@cetusprotocol/sui-clmm-sdk` 1.4.9 `CetusClmmSDK.createSDK({ env: 'mainnet' }).sdkOptions`
 * - https://cetus-1.gitbook.io/cetus-developer-docs (CLMM package + GlobalConfig, 2026)
 *
 * Do NOT reuse DLMM whitelist package IDs.
 */
export const CETUS_CLMM_MAINNET = {
	/** clmm package_id */
	packageId: '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb',
	/** clmm published_at (Move call target for pool::*) */
	publishedAt: '0x260693ec785a6e6c9d81d58c7d2ff72f1288ae0fa6a9725abe05a6478b11f084',
	/** integrate package_id — open/add liquidity helpers */
	integratePackageId: '0x996c4d9480708fb8b92aa7acf819fb0497b5ec8e65ba06601cae2fb6db3312c3',
	/** integrate published_at — `@cetusprotocol/sui-clmm-sdk` 1.4.9 mainnet sdkOptions.integrate (v17) */
	integratePublishedAt: '0x9ee0534b703b14457aee7698ea3a07a5080f954ed2b7e9910fbb7a55506824fa',
	globalConfigId: '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f',
	poolsId: '0xf699e7f2276f5c9a75944b37a0c5b5d9ddfd2471bf6242483b03ab2887d198d0',
} as const

export type ClmmWhitelistedPool = {
	poolId: string
	coinTypeA: string
	coinTypeB: string
	label: string
	tickSpacing: number
}

/**
 * SUI/USDC CLMM pools only. Empty by default until OWNER configures CETUS_CLMM_POOL_ID.
 * Do not create new pools.
 */
export function loadClmmPoolWhitelist(envPoolId?: string): ClmmWhitelistedPool[] {
	const id = envPoolId?.trim()
	if (!id) return []
	return [
		{
			poolId: id,
			coinTypeA: '0x2::sui::SUI',
			coinTypeB:
				'0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
			label: 'SUI/USDC CLMM (env)',
			tickSpacing: 60,
		},
	]
}

export function assertClmmPoolAllowed(poolId: string, whitelist: ClmmWhitelistedPool[]): void {
	if (!whitelist.some((p) => p.poolId === poolId)) {
		throw new Error(`CLMM pool ${poolId} not in whitelist`)
	}
}
