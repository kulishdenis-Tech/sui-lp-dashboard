# Дебаг: аналітика закритих позицій (Bluefin + Momentum)

> **Env перевірено**: `VITE_LP_LIFECYCLE_INDEXER=1` ✓, OKX ключі ✓.  
> Аналіз коду виявив конкретні баги — нижче від критичного до мінорного.

---

## BUG 1 — КРИТИЧНИЙ: `withMinInterval` глобальний → enrichment "зависає" на хвилини

**Файл**: `src/utils/rateLimiter.ts`

```ts
let lastCallAt = 0  // ← module-level singleton, один на ВСЮ програму

export async function withMinInterval<T>(minIntervalMs: number, fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, minIntervalMs - (now - lastCallAt))
  if (wait > 0) await sleep(wait)
  // ...
}
```

`withMinInterval(2100, ...)` використовується у **двох** GeckoTerminal-функціях у `priceService.ts` (рядки ~150 і ~192). Оскільки `lastCallAt` глобальний, всі паралельні виклики з різних позицій стають у **єдину глобальну чергу** з паузою 2100 мс між кожним.

**Математика для 1 закритої позиції (8 подій, 2 токени, Pyth не покриває):**
- Uniq `quoteAt` викликів: 16 (8 timestamps × 2 tokens, після dedup за хвилиною)
- Fallback до GT: 4 GT-виклики на кожен `quoteAt` = **64 виклики GeckoTerminal**
- При 2100 мс між кожним = **134 секунди мінімум** тільки на GT
- З `concurrency = 3` у `enrichAllBluefinClosedPositions` — GT-черга **спільна** → 3 позиції не прискорюють, а серіалізуються

**Що відчуває користувач**: таб Closed завантажується, потім "зависає" на 2-5 хвилин без progress. UI не показує що enrichment іще йде.

**Fix**:
1. Зробити rate-limiter per-API або per-instance, а не global singleton:
   ```ts
   export function createRateLimiter(minIntervalMs: number) {
     let lastCallAt = 0
     return async function withMinInterval<T>(fn: () => Promise<T>): Promise<T> { ... }
   }
   // В priceService.ts:
   const gtLimiter = createRateLimiter(2100)
   // ...
   return gtLimiter(() => fetch(...))
   ```
2. Або зменшити інтервал до 500ms (GT public limit ~30 req/min) і додати retry при 429.
3. Опційно: запустити GT lookups паралельно через `Promise.all` замість sequential for-loop в `fetchOhlcvClosest`.

---

## BUG 2 — КРИТИЧНИЙ: OKX DEX candles — 10 послідовних викликів на кожен (токен, час)

**Файл**: `src/services/okxHistoricalUsd.ts`

```ts
const DEX_BARS_CASCADE = ['1m', '15m', '1H', '4H', '1Dutc']  // 5 розмірів

export async function okxDexHistoricalClosestUsd(...) {
  for (const bar of DEX_BARS_CASCADE) {              // ← до 5 ітерацій
    const afterBranch = await dexCandlesFetch(...)    // ← await кожен
    const beforeBranch = await dexCandlesFetch(...)   // ← await кожен
    // ...
    if (cand && cand.close > 0) return ...            // early exit тільки якщо знайдено
  }
  return null
}
```

Для токенів, яких немає в OKX OHLCV (більшість Sui DeFi tokens) — всі **10 викликів виконуються** до кінця, і кожен займає час RTT до OKX. Хоча OKX відповідає швидко (~200-500ms), 10 послідовних = ~2-5 секунд на один `quoteAt`.

**Fix**:
1. Починати з грубіших свічок `['1Dutc', '4H', '1H', '15m', '1m']` — більший шанс знайти дані з першої спроби.
2. Робити `afterBranch` і `beforeBranch` паралельно:
   ```ts
   const [afterBranch, beforeBranch] = await Promise.all([
     dexCandlesFetch(coinType, bar, { afterMs: targetMs }),
     dexCandlesFetch(coinType, bar, { beforeMs: targetMs }),
   ])
   ```
3. Додати in-memory кеш для `dexCandlesFetch` відповідей (ключ: `coinType|bar|pivotMs rounded`).

---

## BUG 3 — СЕРЕДНІЙ: `dexCandlesFetch` не перетворює native SUI

**Файл**: `src/services/okxHistoricalUsd.ts`, функція `dexCandlesFetch`

```ts
const q = new URLSearchParams({
  chainIndex: CHAIN_SUI,
  tokenContractAddress: coinType,  // ← raw Move type, без трансформації!
  // ...
})
```

Функція `okxWalletTokenAddressParam` (для wallet API) вже обробляє це: native SUI → `""`. Але `dexCandlesFetch` не використовує цю трансформацію.

Результат: для SUI (`0x000...002::sui::SUI`) OKX DEX candles API отримує повний Move struct string замість очікуваного формату. OKX повертає порожні дані → весь cascade DEX candles завжди падає для SUI → enrichment для SUI-пар (більшість пар на Bluefin/Momentum) ніколи не отримує ціну з OKX candles.

**Fix** (один рядок у `dexCandlesFetch`):
```ts
// Додати імпорт:
import { okxWalletTokenAddressParam } from '@/services/okxHistoricalUsd'
// Або просто інлайн:
const q = new URLSearchParams({
  chainIndex: CHAIN_SUI,
  tokenContractAddress: isNativeSuiCoinType(coinType) ? '' : coinType,
  bar,
  limit: '299',
})
```

Перевірити також: чи OKX candles взагалі приймає полний Move struct type для non-native токенів (напр. `0xdeeb...::deep::DEEP`), або очікує скорочений адрес `0xdeeb...`. Якщо тільки скорочений — потрібне: `coinType.split('::')[0]`.

---

## BUG 4 — СЕРЕДНІЙ: `fetchMomentumPoolPairMeta` N+1 `getAllPools()`

**Файл**: `src/services/momentumClosedPositions.ts`

```ts
const metas = await Promise.all(
  [...uniqPoolKeys].map((k) => fetchMomentumPoolPairMeta(k))  // ← N паралельних!
)
```

Виглядає паралельно, але `fetchMomentumPoolPairMeta` всередині:
```ts
// src/services/momentumService.ts
export async function fetchMomentumPoolPairMeta(poolRaw: string) {
  sdk = MmtSDK.NEW({ network: 'mainnet', client: suiClient })  // ← новий SDK щоразу
  poolsData = await sdk.Pool.getAllPools()                       // ← повний список пулів щоразу
  // ...
}
```

При 5 унікальних закритих пулах = 5 паралельних `getAllPools()` + 5 SDK ініціалізацій. Кожен `getAllPools()` — повний HTTP-запит до MMT API. Паралельно вони виконуються, але все одно зайво.

**Fix**: кешувати результат `getAllPools()` на рівні модуля (Map з TTL ~60 сек):
```ts
// У momentumService.ts, перед fetchMomentumPoolPairMeta:
let _poolsCache: { data: PoolsData; at: number } | null = null
const POOLS_TTL = 60_000

async function getCachedAllPools(sdk: MmtSDK) {
  if (_poolsCache && Date.now() - _poolsCache.at < POOLS_TTL) return _poolsCache.data
  const data = await sdk.Pool.getAllPools()
  _poolsCache = { data, at: Date.now() }
  return data
}
```

---

## BUG 5 — СЕРЕДНІЙ: `okxTimestamp()` без мілісекунд

**Файл**: `src/services/spotPrice/okxDexApi.ts`

```ts
function okxTimestamp(): string {
  return new Date().toISOString().slice(0, -5) + 'Z'
  //                                 ^^^^^^^^
  // "2026-05-03T07:00:42.596Z" → slice(0,-5) видаляє ".596Z" → + "Z" = "2026-05-03T07:00:42Z"
  // OKX DOCS вимагають: "2026-05-03T07:00:42.596Z" (з мілісекундами)
}
```

Підтверджено bash-тестом: `slice(0, -5) + 'Z'` strips milliseconds completely.

OKX signing message: `timestamp + method + path`. Якщо `OK-ACCESS-TIMESTAMP` header не збігається з форматом підпису — `sign validation failed` (code 50113).

**Перевірка**: в browser console шукати `[OKX] GET` warnings при enrichment. Якщо там `50113` або `Invalid sign` → timestamp bug підтверджено.

**Fix** (один рядок):
```ts
function okxTimestamp(): string {
  return new Date().toISOString()  // "2026-05-03T07:00:42.596Z" ✓
}
```

> **Примітка**: якщо POST `price-info` (спот-ціни на балансі) **вже** працює з таким форматом — значить OKX tolerate missing ms. Але DEX Historical API (v6) може бути суворішим. Треба перевірити по console warnings.

---

## BUG 6 — МІНОРНИЙ: `priceCache` кешує за символом, не за coinType

**Файл**: `src/services/priceCache.ts`

```ts
function key(symbol: string, ts: number): string {
  return `${symbol}_${roundToHour(ts)}`  // ← "SUI_...", "DEEP_...", тощо
}
```

`getUsdPerTokenAtTimestamp` викликається з `tokenSymbol` = `p.tokenA` (наприклад `"SUI"`). Якщо два різних токени мають однаковий символ (bridged USDC vs native USDC), вони share one cache entry → один буде отримувати неправильну ціну.

Також: `roundToHour(tsSec)` → всі події в межах однієї години отримують ОДНЕ значення з кешу. Це навмисне (historical price ≈ constant within hour), але якщо ціна швидко рухалась — неточність.

**Fix (опційно)**: поміняти ключ на coinType замість symbol:
```ts
// В getUsdPerTokenAtTimestamp:
const cached = priceCache.get(coinType, tsSec)  // замість tokenSymbol
// ...
priceCache.set(coinType, tsSec, usdPerToken, quoteAsOfUnixSec)
```

---

## Рекомендований порядок виправлень

```
1. BUG 5 (1 рядок): okxTimestamp → new Date().toISOString()
   → Перевірити console на 50113 errors: якщо зникли — інші OKX calls почнуть працювати

2. BUG 3 (2 рядки): dexCandlesFetch → застосувати isNativeSuiCoinType трансформацію
   → okxDexHistoricalClosestUsd почне повертати дані для SUI пар

3. BUG 1 (рефактор): rateLimiter → per-instance замість global singleton
   → найбільший ефект на швидкість enrichment

4. BUG 2 (minor): DEX bars cascade → паралельний after+before + reverse order
   → зменшить кількість OKX calls у ~2-3 рази

5. BUG 4 (1 функція): fetchMomentumPoolPairMeta → кешувати getAllPools()
   → прискорить Momentum closed loading
```

---

## Діагностика без коду (Browser Console)

Відкрити DevTools → Console → обрати `Verbose`. Завантажити сторінку з кількома закритими позиціями.

Шукати:
- `[OKX] GET` warnings → якщо є `50113` / `Invalid sign` → BUG 5 підтверджено
- `[OKX] GET /api/v6/dex/market/historical-candles` повторюється без відповіді → BUG 2 (повільно)
- Console тихий більше 30 секунд під час Closed tab → BUG 1 (GT queue)
- Momentum closed positions взагалі не з'являються і є errors → перевірити `sdk.Pool.getAllPools()` failures

Додати тимчасовий `console.log` у `getUsdPerTokenAtTimestamp` перед `return empty()` — якщо він спрацьовує для більшості events → всі price sources failing → BUG 5 + BUG 3.

---

## Файли для змін (повний список)

| Файл | Що виправити |
|------|-------------|
| `src/services/spotPrice/okxDexApi.ts` | `okxTimestamp()` → `.toISOString()` без slice |
| `src/services/okxHistoricalUsd.ts` | `dexCandlesFetch`: native SUI transform; `after/before` → `Promise.all`; reverse bar order |
| `src/utils/rateLimiter.ts` | `createRateLimiter(ms)` factory замість global singleton |
| `src/services/priceService.ts` | Використати per-instance limiter для GT |
| `src/services/momentumService.ts` | `getAllPools()` module-level cache |
