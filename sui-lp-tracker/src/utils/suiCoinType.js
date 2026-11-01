import { normalizeSuiAddress } from '@mysten/sui/utils';
/**
 * CoinType з різних джерел: `0x2::sui::SUI` vs `0x000…0002::sui::SUI` — для зіставлення з DexPaprika / індексами.
 */
export function normalizeCoinTypeForMatch(coinType) {
    const parts = coinType.split('::');
    if (parts.length < 3)
        return coinType;
    try {
        const addr = normalizeSuiAddress(parts[0]);
        return `${addr}::${parts[1]}::${parts[2]}`;
    }
    catch {
        return coinType;
    }
}
/** Канонічний padded `0x000…0002::sui::SUI` для match / кешу. */
export const NATIVE_SUI_COIN_TYPE = normalizeCoinTypeForMatch('0x2::sui::SUI');
/** Short form OKX price-info очікує для нативного SUI (padded → порожня відповідь). */
export const OKX_NATIVE_SUI_TOKEN_ADDRESS = '0x2::sui::SUI';
export function isNativeSuiCoinType(coinType) {
    return normalizeCoinTypeForMatch(coinType) === NATIVE_SUI_COIN_TYPE;
}
/**
 * Адреса для OKX `price-info` body:
 * - native SUI → короткий `0x2::sui::SUI` (не padded 0x000…2)
 * - інші → normalizeSuiAddress (leading zeros), інакше OKX може віддати ghost-ціну
 */
export function okxPriceInfoTokenAddress(coinType) {
    if (isNativeSuiCoinType(coinType))
        return OKX_NATIVE_SUI_TOKEN_ADDRESS;
    return normalizeCoinTypeForMatch(coinType);
}
