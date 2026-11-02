export const GECKO_NETWORK = 'sui-network'

export const PROTOCOL_PACKAGES = {
	CETUS_CLMM: '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb',
	/** Cetus DLMM `dlmm_pool.package_id` from `@cetusprotocol/dlmm-sdk` 1.3.3 `dlmmMainnet`. */
	CETUS_DLMM: '0x5664f9d3fd82c84023870cfbda8ea84e14c8dd56ce557ad2116e0668581a682b',
	/** Cetus DLMM `dlmm_pool.published_at` (upgrade pointer). */
	CETUS_DLMM_PUBLISHED_AT: '0x6b989f9b05bd11a00f1c7779443d66802c5e71631f59e87be5d2a616991f151e',
	/** Sync with [@mmt-finance/clmm-sdk](https://github.com/mmt-finance/clmm-sdk) MainnetConfig + [офіційні deployments](https://developers.mmt.finance/clmm-smart-contracts/deployments). */
	MOMENTUM_CLMM: '0xcf60a40f45d46fc1e828871a647c1e25a0915dec860d2662eb10fdb382c3c1d1',
	/** Для повного шляху MoveEvent (`published_at::liquidity::…`); не плутати з packageId. */
	MOMENTUM_PUBLISHED_AT: '0x70285592c97965e811e0c6f98dccc3a9c2b4ad854b3594faab9597ada267b860',
	/** Bluefin Spot AMM/CLMM (pools, positions NFT) */
	BLUEFIN_CLMM: '0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267',
	/** older constant name in repo — spot router package */
	BLUEFIN_SPOT: '0xb104ecc75397f3a65735ef26c85a037da1d197e26f4f275a9990a577ba0e6c4c',
	/** Original package-id — stable across upgrades, used for NFT StructType filter.
	 *  Source: turbos.gitbook.io/turbos/developer-docs/dev-overview */
	TURBOS: '0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1',
	/** Latest published-at upgrade (v0.1.8) — prefix for current event types. */
	TURBOS_PUBLISHED_AT: '0xa5a0c25c79e428eba04fb98b3fb2a34db45ab26d4c8faf0d7e39d66a63891e64',
	/** Shared Positions table — parentId for dynamic field lookup by nftId. */
	TURBOS_POSITIONS_TABLE: '0xf5762ae5ae19a2016bb233c72d9a4b2cba5a302237a82724af66292ae43ae52d',
	FLOWX_V3: '0xba153169476e8c3114962261d1edc70de5ad9781b83cc617ecc8c1923191cae0',
	AFTERMATH: '0xefe170ec0be4d762196bedecd7a065816576198a6527c99282a2551aaa7da38c',
	SCALLOP_MARKET: '0xa757975255146dc9686aa823b7838b507f315d704f428cbadad2f4ea061939d9',
	SCALLOP_VERSION: '0x07871c4b3c847a0f674510d4978d5cf6f960452795e8ff6f189fd2088a3f6ac7',
} as const

/** Alias for `{published_at}::liquidity::…` / `::collect::…` MoveEvent paths (same as PROTOCOL_PACKAGES). */
export const MOMENTUM_PUBLISHED_AT = PROTOCOL_PACKAGES.MOMENTUM_PUBLISHED_AT

export const BLUEFIN_SPOT_API = 'https://swap.api.sui-prod.bluefin.io'

export const SUISCAN_TX = (digest: string) => `https://suiscan.xyz/mainnet/tx/${digest}`

/** Сторінка токену (coin type) на Suiscan */
export const SUISCAN_COIN = (coinType: string) =>
	`https://suiscan.xyz/mainnet/coin/${encodeURIComponent(coinType)}`

/** Pool / NFT / інший об’єкт на Suiscan mainnet */
export const SUISCAN_OBJECT = (objectId: string) =>
	`https://suiscan.xyz/mainnet/object/${encodeURIComponent(objectId.trim())}`

/** sCoins / LST, яких може не бути в Suiet list — вважаємо verified */
export const SCALLOP_SCOIN_TYPES: string[] = [
	'0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI',
]

export const MOMENTUM_LST_TYPES: string[] = [
	'0x2b6602099970374cf58a2a1b9d96f005fccceb81e92eb059873baf420eb6c717::x_sui::X_SUI',
]

export const PROTOCOL_TOKEN_VERIFIED = new Set<string>([
	...SCALLOP_SCOIN_TYPES,
	...MOMENTUM_LST_TYPES,
])

/** Мін. USD, щоб показати unverified з ціною (верифіковані завжди в основному списку) */
export const MIN_UNVERIFIED_VALUE_USD = 0.01

/** Поріг для опційного приховування дрібних позицій у таблиці балансу */
export const HIDE_BALANCE_VALUE_BELOW_USD = 0.1

/** Max parallel Sui JSON-RPC calls (metadata, ticks, enrichment). */
export const RPC_CONCURRENCY = 10

/** Max parallel Turbos position event scans during loadAll enrichment. */
export const TURBOS_ENRICH_CONCURRENCY = 4

export const PROTOCOL_COLORS: Record<string, string> = {
	cetus: '#00D4FF',
	momentum: '#9B59B6',
	bluefin: '#1E90FF',
	turbos: '#FF6B35',
	flowx: '#7C3AED',
	aftermath: '#10B981',
	scallop: '#F39C12',
	current: '#3B82F6',
}
