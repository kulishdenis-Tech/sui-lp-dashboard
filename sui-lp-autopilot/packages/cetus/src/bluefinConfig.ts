/**
 * Bluefin Spot mainnet IDs.
 * CurrentPackage is the live upgrade (UpgradeCap.package, on-chain upgrade version 17).
 * Its config::VERSION is 9, which matches GlobalConfig.version. The previous package
 * aborts config::verify_version with 1001 (errors::version_mismatch).
 * Spot getting-started v2.0.1 still lists that previous CurrentPackage.
 * @see https://github.com/fireflyprotocol/bluefin-spot-contracts-public/blob/main/sources/config.move
 * @see https://github.com/fireflyprotocol/bluefin-spot-contract-interface/blob/main/Move.toml
 */
export const BLUEFIN_SPOT_MAINNET = {
	GlobalConfig: '0x03db251ba509a8d5d8777b6338836082335d93eecbdd09a11e190a1cff51c352',
	ProtocolFeeCap: '0x55697473304e901372020f30228526c4e93558b23259d90bc6fdddedf83295d2',
	Display: '0x5f34ee74e113d74ae9546695af6e6d0fde51731fe8d9a71309f8e66b725d54ab',
	AdminCap: '0xc5e736b21175e1f8121d58b743432a39cbea8ee23177b6caf7c2a0aadba8d8b9',
	UpgradeCap: '0xd5b2d2159a78030e6f07e028eb75236693ed7f2f32fecbdc1edb32d3a2079c0d',
	Publisher: '0xd9810c5d1ec5d13eac8a70a059cc0087b34d245554d8704903b2492eebb17767',
	BasePackage: '0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267',
	CurrentPackage: '0xd075338d105482f1527cbfd363d6413558f184dec36d9138a70261e87f486e9c',
	Operators: {
		Admin: '0x37a8d55f29e5b4bdba0cb3fe0ba51a93db8c868fe0de649e1bf36bb42ea7d959',
	},
} as const

/** Spot REST for pool discovery (read-only). */
export const BLUEFIN_SPOT_API = 'https://swap.api.sui-prod.bluefin.io'

/** Known mainnet SUI/USDC Bluefin Spot pools from official config samples. */
export const BLUEFIN_SUI_USDC_POOL_IDS = [
	'0x3b585786b13af1d8ea067ab37101b6513a05d2f90cfe60e8b1d9e1b46a63c4fa',
	'0xa701a909673dbc597e63b4586ace6643c02ac0e118382a78b9a21262a4a2e35d',
] as const
