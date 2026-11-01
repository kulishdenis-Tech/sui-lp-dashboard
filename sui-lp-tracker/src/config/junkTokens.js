/**
 * Токени, які не показуємо (спам, відомі «сміттєві» airdrop тощо).
 * Оновлюй вручну; повні `0x...::module::Struct` — найнадійніше.
 * Suiscan: «Unknown»/неверифіковані — оціни сам; публічного єдиного API списку немає.
 */
export const JUNK_COIN_TYPE_DENYLIST = new Set([
// Приклад: додай пакети/типи, які не хочеш бачити
]);
const SPAM_NAME_RE = /(https?:\/\/|t\.me\/|claim|airdrop|visit|www\.)/i;
/** Евристика «шлаку»: явний список + посилання/«claim» в імені. */
export function isJunkToken(coinType, symbol, name) {
    if (JUNK_COIN_TYPE_DENYLIST.has(coinType))
        return true;
    const s = `${symbol} ${name}`;
    return SPAM_NAME_RE.test(s);
}
export const HIDE_LOW_USD_DEFAULT = 1;
export function isLowValueAsset(valueUSD, threshold = HIDE_LOW_USD_DEFAULT) {
    if (valueUSD == null || !Number.isFinite(valueUSD))
        return false;
    return valueUSD < threshold;
}
