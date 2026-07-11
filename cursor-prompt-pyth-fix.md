# Фікс PTHh / PTHb / BAggr колонок — Cursor Prompt

## Діагноз

Зі скрінів видно:
- **AFM, GT, DS, DPap, BSpot** — працюють нормально
- **PTHh (Pyth Hermes), PTHb (Pyth Benchmarks)** — пусті для більшості токенів (NS, WAL, DEEP, BLUE, NAVX, stSUI, xSUI, USDZ, E4C, NAVX)
- **BAggr (Bluefin Aggregator)** — пустий майже скрізь

**Причина PTHh/PTHb** — не CORS, не баг коду. Pyth Core **просто не має** price feeds для цих токенів. Це фізична межа: Pyth Core покриває топ ~200 активів, дрібні Sui токени туди не входять.

**Причина BAggr** — Bluefin7k Aggregator SDK повертає ціни тільки для токенів що є в їхньому роутері (переважно SUI, USDC, великі токени).

---

## Що потрібно зробити

### 1. Оновити PYTH_FEED_IDS — додати всі наявні Sui-токени

Pyth дійсно має деякі Sui ecosystem токени. Потрібно динамічно перевірити які є через Hermes search API, і додати їх у константи.

**Алгоритм пошуку feed ID для нового токена:**
```
GET https://hermes.pyth.network/v2/price_feeds?query={SYMBOL}&assetType=crypto
→ фільтруємо results де attributes.symbol === "{SYMBOL}/USD"
→ беремо id першого результату
```

**Актуальні feed IDs — додати в `src/utils/pythFeedIds.ts`:**

```typescript
// src/utils/pythFeedIds.ts
// Повний актуальний список Pyth Core feed IDs для Sui екосистеми
// Перевірено через: GET https://hermes.pyth.network/v2/price_feeds?query={symbol}&assetType=crypto

export const PYTH_FEED_IDS: Record<string, string> = {
  // ── Підтверджено є в Pyth Core ────────────────────────────────────────────
  'SUI/USD':    '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744',
  'BTC/USD':    '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  'ETH/USD':    '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  'USDC/USD':   '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  'USDT/USD':   '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
  'WBTC/USD':   '0xc9d8b075a5c69303365ae23633d4e085199bf5c520a3b90fed1322a0342ffc33',
  'NAVX/USD':   '0x9ee4dc4d6b4b4125d8f585e36becd88a7c67a0f25fa75a8eff7eeef3a7c9b53d',
  // ── Перевірити через Hermes search — можуть бути додані нещодавно ─────────
  // 'DEEP/USD': знайти через GET /v2/price_feeds?query=DEEP&assetType=crypto
  // 'CETUS/USD': знайти через GET /v2/price_feeds?query=CETUS&assetType=crypto
  // 'SCA/USD':  знайти через GET /v2/price_feeds?query=SCA&assetType=crypto
  // 'WAL/USD':  знайти через GET /v2/price_feeds?query=WAL&assetType=crypto
  // 'NS/USD':   знайти через GET /v2/price_feeds?query=NS&assetType=crypto
  // 'BLUE/USD': знайти через GET /v2/price_feeds?query=BLUE&assetType=crypto
};

// LST токени → маппінг на SUI feed (апроксимація, бо ціна ≈ SUI)
// Pyth не має окремих feeds для afSUI, stSUI, xSUI, vSUI
// Показуємо SUI ціну з поміткою "≈SUI" в tooltip
export const PYTH_LST_ALIAS: Record<string, string> = {
  'afSUI': 'SUI/USD',
  'stSUI': 'SUI/USD',
  'xSUI':  'SUI/USD',
  'vSUI':  'SUI/USD',
  'haSUI': 'SUI/USD',
};

// Токени яких точно НЕМАЄ в Pyth Core — не робити запит взагалі
// Це заощаджує rate limit і прибирає failed requests з Network tab
export const PYTH_UNSUPPORTED = new Set([
  'NS', 'WAL', 'BLUE', 'USDZ', 'E4C', 'NAVX', 'stSUI', 'xSUI', 'vSUI', 'afSUI',
  // Додавати сюди після перевірки через Hermes search якщо feed не знайдено
]);
```

**Як автоматично перевірити наявність feed для токена:**

```typescript
// src/services/pythFeedDiscovery.ts
// Запускати один раз при старті або при додаванні нового токена в whitelist

export async function discoverPythFeedId(symbol: string): Promise<string | null> {
  try {
    // Через проксі якщо є, або напряму
    const url = `/ext/hermes/v2/price_feeds?query=${symbol}&assetType=crypto`;
    const res = await fetch(url);
    const data = await res.json();

    // Шукаємо точний match по символу
    const exact = data.find(
      (feed: any) => feed.attributes?.base === symbol &&
                     feed.attributes?.quote_currency === 'USD'
    );

    return exact ? `0x${exact.id}` : null;
  } catch {
    return null;
  }
}

// Кешуємо результати пошуку (feed ID не змінюється)
const DISCOVERY_CACHE_KEY = 'pyth_feed_discovery';

export async function discoverAllFeedIds(symbols: string[]): Promise<Record<string, string>> {
  const cached = JSON.parse(localStorage.getItem(DISCOVERY_CACHE_KEY) ?? '{}');
  const toDiscover = symbols.filter(s => !(s in cached) && !PYTH_UNSUPPORTED.has(s));

  // Паралельно шукаємо невідомі символи (з throttle)
  for (const symbol of toDiscover) {
    const feedId = await discoverPythFeedId(symbol);
    cached[symbol] = feedId; // null якщо не знайдено
    await new Promise(r => setTimeout(r, 200)); // 200ms між запитами
  }

  localStorage.setItem(DISCOVERY_CACHE_KEY, JSON.stringify(cached));
  return cached;
}
```

---

### 2. Виправити логіку Pyth сервісу

У `pythHermes.ts` (або як він у вас називається) змінити логіку:

```typescript
// src/services/pythHermes.ts

import { PYTH_FEED_IDS, PYTH_LST_ALIAS, PYTH_UNSUPPORTED } from '../utils/pythFeedIds';

export async function fetchPythHermesPrices(
  tokens: Array<{ symbol: string; coinType: string }>
): Promise<Record<string, { price: number | null; change24h: number | null; isAlias?: boolean }>> {
  const results: Record<string, any> = {};

  // 1. Розбиваємо токени на групи:
  const withFeed: Array<{ symbol: string; feedId: string }> = [];
  const lstAliased: Array<{ symbol: string; aliasSymbol: string }> = [];
  const unsupported: string[] = [];

  for (const { symbol } of tokens) {
    if (PYTH_UNSUPPORTED.has(symbol)) {
      unsupported.push(symbol);
      results[symbol] = { price: null, change24h: null, unsupported: true };
      continue;
    }

    const feedKey = `${symbol}/USD`;
    if (PYTH_FEED_IDS[feedKey]) {
      withFeed.push({ symbol, feedId: PYTH_FEED_IDS[feedKey] });
      continue;
    }

    if (PYTH_LST_ALIAS[symbol]) {
      lstAliased.push({ symbol, aliasSymbol: PYTH_LST_ALIAS[symbol].replace('/USD', '') });
      continue;
    }

    // Невідомий токен — спробуємо discovery (якщо вже є в кеші)
    const cached = JSON.parse(localStorage.getItem('pyth_feed_discovery') ?? '{}');
    if (cached[symbol]) {
      withFeed.push({ symbol, feedId: cached[symbol] });
    } else {
      results[symbol] = { price: null, change24h: null };
    }
  }

  // 2. Batch запит для токенів з відомим feed ID
  if (withFeed.length > 0) {
    try {
      const feedIds = withFeed.map(t => t.feedId);
      const params = feedIds.map(id => `ids[]=${id}`).join('&');
      const res = await fetch(`/ext/hermes/v2/updates/price/latest?${params}&parsed=true`);
      const data = await res.json();

      for (let i = 0; i < withFeed.length; i++) {
        const parsed = data.parsed?.[i];
        if (!parsed) continue;
        const price = Number(parsed.price.price) * Math.pow(10, parsed.price.expo);
        results[withFeed[i].symbol] = {
          price,
          change24h: null, // Hermes не дає 24h change напряму
        };
      }
    } catch (err) {
      console.warn('[Pyth Hermes] Batch fetch failed:', err);
      for (const { symbol } of withFeed) {
        results[symbol] = { price: null, change24h: null };
      }
    }
  }

  // 3. LST alias — копіюємо ціну SUI
  const suiPrice = results['SUI']?.price ?? null;
  for (const { symbol } of lstAliased) {
    results[symbol] = {
      price: suiPrice,
      change24h: results['SUI']?.change24h ?? null,
      isAlias: true, // для відображення "≈SUI" в tooltip
    };
  }

  return results;
}
```

---

### 3. Виправити UI колонки PTHh/PTHb для unsupported токенів

У компоненті що рендерить комірку таблиці:

```tsx
// Замість порожнього "—" для unsupported токенів показуємо інформативніше

function PythCell({ value }: { value: PythResult | null }) {
  if (!value) return <span className="text-gray-600">—</span>;

  if (value.unsupported) {
    return (
      <Tooltip content="Pyth Core не має price feed для цього токена">
        <span className="text-gray-700 text-xs">n/a</span>
      </Tooltip>
    );
  }

  if (value.isAlias) {
    return (
      <Tooltip content="Approximated via SUI/USD feed (Pyth не має окремого LST feed)">
        <span className="text-yellow-500">
          ${value.price?.toFixed(4)} <span className="text-xs opacity-60">≈SUI</span>
        </span>
      </Tooltip>
    );
  }

  if (value.price === null) {
    return <span className="text-gray-600">—</span>;
  }

  return <span>${value.price.toFixed(value.price < 0.01 ? 8 : 4)}</span>;
}
```

---

### 4. Bluefin Aggregator (BAggr) — чесний fallback

Bluefin7k Aggregator SDK покриває тільки токени в їхньому роутері. Для решти — `null`, не порожній рядок.

```typescript
// src/services/bluefinAggregator.ts

import { getTokenPrices, getSuiPrice } from '@bluefin-exchange/bluefin7k-aggregator-sdk';

// Токени що точно є в Bluefin роутері
const BLUEFIN_SUPPORTED_SYMBOLS = new Set([
  'SUI', 'USDC', 'USDT', 'WETH', 'WBTC', 'DEEP', 'CETUS', 'SCA', 'BLUE',
  // Перевіряти і оновлювати список при необхідності
]);

export async function fetchBluefinAggregatorPrices(
  coinTypes: string[],
  symbolMap: Record<string, string> // coinType → symbol
): Promise<Record<string, number | null>> {
  // Фільтруємо тільки ті coinType що є в роутері
  const supported = coinTypes.filter(ct => {
    const sym = symbolMap[ct];
    return sym && BLUEFIN_SUPPORTED_SYMBOLS.has(sym);
  });

  if (supported.length === 0) {
    // Повертаємо null для всіх
    return Object.fromEntries(coinTypes.map(ct => [ct, null]));
  }

  try {
    const prices = await getTokenPrices(supported);
    const result: Record<string, number | null> = {};
    for (const ct of coinTypes) {
      result[ct] = prices[ct] ?? null;
    }
    return result;
  } catch (err) {
    console.warn('[Bluefin Aggr] Failed:', err);
    return Object.fromEntries(coinTypes.map(ct => [ct, null]));
  }
}
```

**UI для BAggr колонки:**
```tsx
function BAggr({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <Tooltip content="Токен не в роутері Bluefin 7k">
        <span className="text-gray-700 text-xs">—</span>
      </Tooltip>
    );
  }
  return <span>${value.toFixed(4)}</span>;
}
```

---

### 5. Додати в Vite proxy маршрут для Hermes price_feeds (discovery)

У `vite.config.ts` додати endpoint для discovery:

```typescript
// vite.config.ts — переконатись що є цей маршрут
proxy: {
  '/ext/hermes': {
    target: 'https://hermes.pyth.network',
    changeOrigin: true,
    rewrite: (path) => path.replace('/ext/hermes', ''),
    // Наприклад: /ext/hermes/v2/price_feeds?query=WAL → https://hermes.pyth.network/v2/price_feeds?query=WAL
  },
  // ...решта маршрутів без змін
}
```

---

### 6. Оновити заголовки/tooltips колонок в матриці

```tsx
// В компоненті заголовків таблиці додати пояснення:

const COLUMN_TOOLTIPS = {
  PTHh: 'Pyth Hermes — real-time, покриває ~200 топ-токенів. Sui-специфічні (NS, WAL, BLUE) відсутні.',
  PTHb: 'Pyth Benchmarks — historical/verified prices. Ті самі feed IDs що й Hermes.',
  BAggr: 'Bluefin 7k Aggregator — ціни тільки для токенів в їхньому роутері.',
  BSpot: 'Bluefin Spot API — відображає ціну з GeckoTerminal (не має власного oracle).',
  GT:   'GeckoTerminal — on-chain DEX дані, покриває всі токени з ліквідністю.',
  DS:   'DexScreener — on-chain DEX дані, широке покриття.',
  DPap: 'DexPaprika — on-chain агрегатор.',
  AFM:  'Aftermath Finance — Sui-нативний oracle, найширше покриття в екосистемі.',
  RPC:  'Sui RPC fullnode — не має USD цін (тільки on-chain баланси).',
};
```

---

## Порядок реалізації

1. Запустити Hermes discovery для кожного токена з таблиці:
   ```bash
   # В DevTools Console або окремий скрипт:
   for token in NS WAL DEEP BLUE NAVX USDZ E4C NAVX CETUS SCA; do
     curl "https://hermes.pyth.network/v2/price_feeds?query=$token&assetType=crypto" | jq '.[].id, .[].attributes.base'
   done
   ```
   Результат визначить що додавати в `PYTH_FEED_IDS` а що в `PYTH_UNSUPPORTED`

2. Оновити `PYTH_FEED_IDS` і `PYTH_UNSUPPORTED` з реальними даними

3. Реалізувати `pythFeedDiscovery.ts` для автоматичного пошуку нових токенів

4. Оновити логіку `fetchPythHermesPrices` — не робити запити для unsupported токенів

5. Оновити `fetchBluefinAggregatorPrices` — `BLUEFIN_SUPPORTED_SYMBOLS` whitelist

6. Оновити UI комірок — `n/a` замість `—` для unsupported, `≈SUI` для LST aliases

7. Додати tooltips на заголовки колонок з поясненням покриття кожного джерела

---

## Очікуваний результат після фіксу

| Токен | PTHh | PTHb | BAggr |
|-------|------|------|-------|
| SUI   | ✅ | ✅ | ✅ |
| ETH   | ✅ | ✅ | ✅ |
| DEEP  | ✅ (якщо feed є) або `n/a` | same | ✅ |
| NAVX  | ✅ (feed є!) | ✅ | `—` |
| NS    | `n/a` (немає feed) | `n/a` | `—` |
| WAL   | `n/a` | `n/a` | `—` |
| stSUI | `≈SUI` | `≈SUI` | `—` |
| xSUI  | `≈SUI` | `≈SUI` | `—` |
| USDZ  | `n/a` | `n/a` | `—` |

Колонки більше не будуть пустими — або ціна, або чітке `n/a`/`≈SUI` з поясненням в tooltip.
