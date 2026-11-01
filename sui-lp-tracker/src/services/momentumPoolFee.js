/**
 * Конвертує pool.lpFeesPercent з MMT API у частку ставки свопу (0…1), як очікує OpenPosition.fee та UI (`×100` → відсоти).
 *
 * Джерело: або Uni v3 ppm (ціле > 1 → / 1e6), або відсоти рівня MMT («0.25», «0.250», «0.175» — інакше ×100 у бейджі).
 */
export function momentumPoolFeeFraction(lpFeesPercent) {
    const s = lpFeesPercent.trim();
    const n = parseFloat(s);
    if (!Number.isFinite(n) || n <= 0)
        return 0;
    // Стандарт Uni v3 ppm: наприклад 2500 або 3000
    if (n > 1)
        return n / 1_000_000;
    if (n === 1)
        return 0.01;
    if (n <= 0.001)
        return n;
    const sNorm = s.includes('.')
        ? s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
        : s;
    const fracPart = sNorm.includes('.') ? (sNorm.split('.')[1] ?? '') : '';
    const fracLen = fracPart.length;
    const looksLikeHundredthsPercent = sNorm.includes('.') && /^\d*\.\d{1,2}$/.test(sNorm) && n < 1;
    /** «0.175» від MMT = 0.175% дріб свопу; без /100 дає в UI 17.5%. Uni «0.003» має три знаки, але n&lt;0.01 — не чіпаємо. */
    const threeFracDigitsAsPercentPts = sNorm.includes('.') && fracLen === 3 && n >= 0.01 && n < 1;
    if (looksLikeHundredthsPercent || threeFracDigitsAsPercentPts)
        return n / 100;
    return n;
}
