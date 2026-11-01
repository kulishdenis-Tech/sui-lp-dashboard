/** Official Haedal Liquidity v2 mainnet (`haedal-vault-sdk@2.5.14` `vaultsV2`). */
export const HAEDAL_VAULTS_V2_PACKAGE = '0xfbc91f75397ce25b3b1b01cab2bf494d2e3f9b9e89c97545d88bd616cbbfcc37';
export const HAEDAL_VAULTS_V2_PUBLISHED_AT = '0xbf180d2cd8a9126a8b363fcd6bd8b1d57d7ac3fc6c6c11557713f0f27dc21ea7';
export const HAEDAL_VAULTS_V2_POOLS_HANDLE = '0xc88e97a3a3bb71dfcf8cc90e6383d7e3e1dee0170fa07c9365d233568659fc8f';
/**
 * Fungible vault-LP incentive farm used by Cetus Earn auto-stake.
 * Wallet owns `DepositInfo<LP>`; shared `Deposit<LP>.amount` is the staked LP raw.
 */
export const VAULT_LP_INCENTIVE_PACKAGE = '0xd5b301aae5f5bbd01d7cc067efd1ea27f566aaa2f62e504aac60dd0062ebfd97';
export const VAULT_LP_INCENTIVE_DEPOSIT_INFO = `${VAULT_LP_INCENTIVE_PACKAGE}::core::DepositInfo`;
/** Q64 fixed-point scale for `per_share` / pending reward math (`2^64`). */
export const VAULT_LP_INCENTIVE_ACC = 2n ** 64n;
