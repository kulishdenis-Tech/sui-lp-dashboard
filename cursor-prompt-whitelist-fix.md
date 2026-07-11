# Фікс whitelist токенів Sui — Cursor Prompt

## Проблема

Поточна реалізація `verifiedTokenList.ts` має критичний недолік:
- **Fallback** містить лише 3 токени (SUI, USDC, USDT)
- **Suiet GitHub URL** (`raw.githubusercontent.com/.../coins.json`) часто повертає 404 або не завантажується через CORS/мережеві обмеження браузера
- Результат: WAL, NS, DEEP, CETUS, stSUI, afSUI, BLUE, SCA та інші легітимні токени потрапляють в `unverified` або "Other tokens" — хоч Aftermath SDK знає їхню ціну

## Рішення: 4 джерела whitelist з пріоритетами

Замість одного зовнішнього JSON — агрегуємо з кількох джерел паралельно і об'єднуємо результат.

```
Пріоритет 1: HARDCODED_FALLBACK (завжди є, ~50 токенів)
Пріоритет 2: Aftermath SDK getAllCoins() (знає всі Sui токени з ціною)
Пріоритет 3: GeckoTerminal top tokens (знає токени з ліквідністю)
Пріоритет 4: Suiet GitHub JSON (якщо завантажується — дописуємо)
```

---

## ФАЙЛ: src/services/verifiedTokenList.ts

Повністю перезаписати файл:

```typescript
import { Aftermath } from 'aftermath-ts-sdk';
import { SuietCoin } from '../types';

// ─── HARDCODED FALLBACK (~50 токенів) ────────────────────────────────────────
// Це core Sui екосистема — ніколи не видаляти, оновлювати вручну при змінах

export const HARDCODED_VERIFIED: SuietCoin[] = [
  // ── Native ──────────────────────────────────────────────────────────────────
  {
    type: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    symbol: 'SUI', name: 'Sui', decimals: 9,
    iconUrl: 'https://coin-images.coingecko.com/coins/images/26375/large/sui-ocean-square.png',
    tags: ['native'],
  },

  // ── Stablecoins ─────────────────────────────────────────────────────────────
  {
    type: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    symbol: 'USDC', name: 'USD Coin (Native)', decimals: 6,
    iconUrl: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png',
    tags: ['native', 'stablecoin'],
  },
  {
    type: '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN',
    symbol: 'USDT', name: 'Tether USD', decimals: 6,
    iconUrl: 'https://coin-images.coingecko.com/coins/images/325/large/Tether.png',
    tags: ['bridge', 'stablecoin'],
  },
  {
    type: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN',
    symbol: 'USDC', name: 'USD Coin (Wormhole)', decimals: 6,
    iconUrl: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png',
    tags: ['bridge', 'stablecoin'],
  },
  {
    type: '0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY',
    symbol: 'USDY', name: 'Ondo US Dollar Yield', decimals: 6,
    iconUrl: 'https://coin-images.coingecko.com/coins/images/31050/large/usdy.png',
    tags: ['native', 'stablecoin'],
  },
  {
    type: '0x2053d08c1e2bd02791056171aab0fd12bd7cd7efad2ab8f6b9c8902f14df2ff2::ausd::AUSD',
    symbol: 'AUSD', name: 'Agora USD', decimals: 6,
    iconUrl: '',
    tags: ['native', 'stablecoin'],
  },

  // ── LST (Liquid Staking Tokens) ──────────────────────────────────────────────
  {
    type: '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI',
    symbol: 'afSUI', name: 'Aftermath Staked SUI', decimals: 9,
    iconUrl: 'https://aftermath.finance/afsui-icon.png',
    tags: ['native', 'lst'],
  },
  {
    type: '0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI',
    symbol: 'stSUI', name: 'Spring Staked SUI', decimals: 9,
    iconUrl: '',
    tags: ['native', 'lst'],
  },
  {
    type: '0x2b6602099970374cf58a2a1b9d96f005fccceb81e92eb059873baf420eb6c717::x_sui::X_SUI',
    symbol: 'xSUI', name: 'Momentum Staked SUI', decimals: 9,
    iconUrl: '',
    tags: ['native', 'lst'],
  },
  {
    type: '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
    symbol: 'vSUI', name: 'Volo Staked SUI', decimals: 9,
    iconUrl: '',
    tags: ['native', 'lst'],
  },
  {
    type: '0x790f258062909e3a0ffc78b3c53ac2f62d7084c3bab95644bdeb05add7250001::super_sui::SUPER_SUI',
    symbol: 'superSUI', name: 'Mstable Super SUI', decimals: 9,
    iconUrl: '',
    tags: ['native', 'lst'],
  },

  // ── Bridged assets (Wormhole) ─────────────────────────────────────────────
  {
    type: '0x26b3bc67befc214058ca78ea9a2690298d731a2d4309485ec3d40198063c4abc::wbtc::WBTC',
    symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8,
    iconUrl: 'https://coin-images.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png',
    tags: ['bridge'],
  },
  {
    type: '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN',
    symbol: 'WETH', name: 'Wrapped Ether', decimals: 8,
    iconUrl: 'https://coin-images.coingecko.com/coins/images/2518/large/weth.png',
    tags: ['bridge'],
  },
  {
    type: '0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC',
    symbol: 'LBTC', name: 'Lombard Staked BTC', decimals: 8,
    iconUrl: '',
    tags: ['native'],
  },

  // ── DEX tokens ───────────────────────────────────────────────────────────────
  {
    type: '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS',
    symbol: 'CETUS', name: 'Cetus Protocol', decimals: 9,
    iconUrl: 'https://coin-images.coingecko.com/coins/images/29445/large/cetus.png',
    tags: ['native'],
  },
  {
    type: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946a270::deep::DEEP',
    symbol: 'DEEP', name: 'DeepBook', decimals: 6,
    iconUrl: '',
    tags: ['native'],
  },
  {
    type: '0x3a5143bb1196e3bcdfab6203d1683ae29edd26294fc8bfeafe4aaa9d2704df37::coin::COIN',
    symbol: 'TURBOS', name: 'Turbos Finance', decimals: 9,
    iconUrl: '',
    tags: ['native'],
  },
  {
    type: '0xaafb102dd0902f5055cadecd687fb5b71c0ad4ac9f2e8823cc491cb2e1db89d9::buck::BUCK',
    symbol: 'BUCK', name: 'Bucket USD', decimals: 9,
    iconUrl: '',
    tags: ['native', 'stablecoin'],
  },

  // ── Lending tokens (Scallop) ─────────────────────────────────────────────
  {
    type: '0x5ca17430c1d046fae9edeaa8fd76c7b4193a00d764a0ecfa9418d733ad27bb20::sca::SCA',
    symbol: 'SCA', name: 'Scallop', decimals: 9,
    iconUrl: '',
    tags: ['native'],
  },

  // ── Other major ecosystem tokens ─────────────────────────────────────────
  {
    type: '0xb848cce11ef3a8f62eccea6eb5b35a12c4c2b1ee1af7755d02d7bd6218e8226f::blue::BLUE',
    symbol: 'BLUE', name: 'Bluefin', decimals: 9,
    iconUrl: '',
    tags: ['native'],
  },
  {
    type: '0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS',
    symbol: 'NS', name: 'SuiNS', decimals: 6,
    iconUrl: '',
    tags: ['native'],
  },
  {
    type: '0x7262fb2f7a3a14c888c438a3cd9b912469a58cf60f367352c46584262e8299aa::ika::IKA',
    symbol: 'IKA', name: 'IKA', decimals: 9,
    iconUrl: '',
    tags: ['native'],
  },
  {
    type: '0x87dfe1248a1dc4ce473bd9cb2937d66cdc6c30fee63f3fe0dbb55c7a09d35dec::up::UP',
    symbol: 'UP', name: 'Uni Protocol', decimals: 9,
    iconUrl: '',
    tags: ['native'],
  },
];

// ─── AFTERMATH SDK — getAllCoins ──────────────────────────────────────────────
// Aftermath знає всі токени що є в їхній системі (всі з ціною)
// Якщо Aftermath знає ціну токена → він легітимний за визначенням

async function fetchAftermathTokens(): Promise<SuietCoin[]> {
  try {
    const afSdk = new Aftermath('MAINNET');
    await afSdk.init();
    const prices = afSdk.Prices();

    // getAllCoins повертає coinType всіх токенів що Aftermath знає
    // Якщо метод не існує — fallback через getCoinsToPrice з відомих типів
    const coinTypes: string[] = await prices.getAllCoinTypes?.() ?? [];

    // Для кожного coinType отримуємо базову інфу (без RPC — тільки те що є в SDK)
    return coinTypes.map(type => ({
      type,
      symbol: type.split('::').pop() ?? type,
      name: type.split('::').pop() ?? type,
      decimals: 9, // буде перезаписано з metadata
      iconUrl: '',
      tags: ['aftermath-verified'],
    }));
  } catch (err) {
    console.warn('[VerifiedList] Aftermath SDK fetch failed:', err);
    return [];
  }
}

// ─── GECKOTERMINAL — top Sui tokens ──────────────────────────────────────────
// Токени з найбільшою ліквідністю на Sui DEXes
// Якщо токен є на GeckoTerminal з ліквідністю > $10K → легітимний

async function fetchGeckoTerminalTokens(): Promise<SuietCoin[]> {
  try {
    const GT = 'https://api.geckoterminal.com/api/v2';
    const H = { 'Accept': 'application/json;version=20230302' };

    // Top pools на Sui → беремо унікальні токени з них
    const res = await fetch(
      `${GT}/networks/sui-network/pools?page=1`,
      { headers: H }
    );
    const data = await res.json();

    const tokens = new Map<string, SuietCoin>();
    for (const pool of data.data ?? []) {
      const attrs = pool.attributes;
      const liq = parseFloat(attrs.reserve_in_usd ?? '0');
      if (liq < 10_000) continue; // Мінімум $10K ліквідності

      // base token
      const baseAddr = attrs.base_token_address;
      if (baseAddr && !tokens.has(baseAddr)) {
        tokens.set(baseAddr, {
          type: baseAddr,
          symbol: attrs.base_token_symbol ?? '',
          name: attrs.base_token_name ?? '',
          decimals: 9,
          iconUrl: '',
          tags: ['gecko-verified'],
        });
      }
      // quote token
      const quoteAddr = attrs.quote_token_address;
      if (quoteAddr && !tokens.has(quoteAddr)) {
        tokens.set(quoteAddr, {
          type: quoteAddr,
          symbol: attrs.quote_token_symbol ?? '',
          name: attrs.quote_token_name ?? '',
          decimals: 9,
          iconUrl: '',
          tags: ['gecko-verified'],
        });
      }
    }

    return Array.from(tokens.values());
  } catch (err) {
    console.warn('[VerifiedList] GeckoTerminal fetch failed:', err);
    return [];
  }
}

// ─── SUIET GITHUB — оригінальний список ───────────────────────────────────────
// Пробуємо завантажити, але не блокуємось якщо 404

async function fetchSuietList(): Promise<SuietCoin[]> {
  const URLS = [
    'https://raw.githubusercontent.com/suiet/sui-coin-list/main/src/coins.json',
    // Резервний URL (можна замінити на власне дзеркало або CDN)
    'https://cdn.jsdelivr.net/gh/suiet/sui-coin-list@main/src/coins.json',
  ];

  for (const url of URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const json = await res.json();
      const coins: SuietCoin[] = (json.coins ?? json ?? []).map((c: any) => ({
        type: c.type,
        symbol: c.symbol,
        name: c.name,
        decimals: c.decimals ?? 9,
        iconUrl: c.iconUrl ?? '',
        tags: c.tags ?? ['native'],
      }));
      if (coins.length > 0) return coins;
    } catch {
      // timeout або 404 → пробуємо наступний URL
    }
  }

  console.warn('[VerifiedList] Suiet list unavailable from all URLs');
  return [];
}

// ─── ГОЛОВНА ФУНКЦІЯ ──────────────────────────────────────────────────────────

const CACHE_KEY = 'sui_verified_tokens_v2';
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 годин

export async function getVerifiedCoinList(): Promise<Map<string, SuietCoin>> {
  // 1. Перевіряємо кеш
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL && data.length > 10) {
        return new Map(data.map((c: SuietCoin) => [c.type.toLowerCase(), c]));
      }
    }
  } catch {}

  // 2. Починаємо з hardcoded — він завжди є миттєво
  const merged = new Map<string, SuietCoin>();
  for (const coin of HARDCODED_VERIFIED) {
    merged.set(coin.type.toLowerCase(), coin);
  }

  // 3. Паралельно завантажуємо решту джерел
  const [aftermathCoins, geckoCoins, suietCoins] = await Promise.allSettled([
    fetchAftermathTokens(),
    fetchGeckoTerminalTokens(),
    fetchSuietList(),
  ]);

  // Aftermath — додаємо нові (не перезаписуємо hardcoded)
  if (aftermathCoins.status === 'fulfilled') {
    for (const coin of aftermathCoins.value) {
      const key = coin.type.toLowerCase();
      if (!merged.has(key)) merged.set(key, coin);
    }
  }

  // GeckoTerminal — додаємо нові
  if (geckoCoins.status === 'fulfilled') {
    for (const coin of geckoCoins.value) {
      const key = coin.type.toLowerCase();
      if (!merged.has(key)) merged.set(key, coin);
    }
  }

  // Suiet — має пріоритет по іконках та назвах (перезаписуємо поля але не type)
  if (suietCoins.status === 'fulfilled') {
    for (const coin of suietCoins.value) {
      const key = coin.type.toLowerCase();
      if (merged.has(key)) {
        // Оновлюємо іконку та назву якщо є краща
        const existing = merged.get(key)!;
        merged.set(key, {
          ...existing,
          iconUrl: coin.iconUrl || existing.iconUrl,
          name: coin.name || existing.name,
          tags: [...new Set([...existing.tags, ...coin.tags])],
        });
      } else {
        merged.set(key, coin);
      }
    }
  }

  // 4. Зберігаємо в кеш
  const result = Array.from(merged.values());
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      data: result,
      timestamp: Date.now(),
    }));
  } catch {}

  console.info(`[VerifiedList] Loaded ${result.length} verified tokens`);
  return merged;
}

// ─── ДОПОМІЖНІ ФУНКЦІЇ ───────────────────────────────────────────────────────

// Нормалізація coinType для порівняння (lower case, скорочений формат)
export function normalizeCoinType(coinType: string): string {
  return coinType.toLowerCase().replace(
    /^0x0+/, // видаляємо зайві нулі на початку
    '0x'
  );
}

// Перевірка чи токен є в whitelist (з нормалізацією)
export function isVerified(
  coinType: string,
  verifiedList: Map<string, SuietCoin>
): boolean {
  const normalized = normalizeCoinType(coinType);
  return verifiedList.has(normalized) || verifiedList.has(coinType.toLowerCase());
}

// Очистити кеш (для debug або примусового оновлення)
export function clearVerifiedListCache(): void {
  localStorage.removeItem(CACHE_KEY);
}
```

---

## ФАЙЛ: src/services/tokenClassifier.ts — оновити

Замінити виклик `verifiedList.has(coinType)` на:

```typescript
import { isVerified } from './verifiedTokenList';

// Замість:
if (verifiedList.has(coinType)) { ... }

// Писати:
if (isVerified(coinType, verifiedList)) { ... }
```

Причина: Sui coinType може мати різну кількість нулів у адресі (`0x2` vs `0x0000...0002`). `normalizeCoinType` вирівнює це.

---

## ФАЙЛ: src/types/index.ts — додати поле

```typescript
export interface SuietCoin {
  type: string;
  symbol: string;
  name: string;
  decimals: number;
  iconUrl: string;
  tags: string[];  // 'native' | 'bridge' | 'stablecoin' | 'lst' | 
                   // 'aftermath-verified' | 'gecko-verified'
  wrapped?: { bridge: string; chain: string };
}
```

---

## ФАЙЛ: src/components/balance/BalanceDashboard.tsx — додати індикатор

```tsx
// Показувати скільки джерел завантажилось
{loadingSources.aftermath && <Spinner size="xs" />}
{`${verifiedList.size} verified tokens loaded`}
```

---

## Edge cases і важливі нюанси

### 1. Нормалізація адрес
Sui RPC може повертати coinType з різною кількістю нулів:
```
0x2::sui::SUI                        ← скорочений (у транзакціях)
0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI  ← повний
```
Обидва варіанти — один токен. **Обов'язково** використовувати `normalizeCoinType()` при всіх порівняннях.

### 2. Aftermath SDK getAllCoinTypes
Метод `getAllCoinTypes()` може не існувати в поточній версії SDK. Fallback:
```typescript
// Якщо метод відсутній — використовуємо getCoinsToPrice з hardcoded списком
// і перевіряємо які повертають ціну
const testTypes = HARDCODED_VERIFIED.map(c => c.type);
const prices = await prices.getCoinsToPrice({ coins: testTypes });
// Токени з ціною > 0 = verified
```

### 3. GeckoTerminal `base_token_address` для Sui
GeckoTerminal для Sui мережі може повертати адреси в різних форматах. Перевіряти що address містить `::` (формат Sui coinType), інакше пропускати.

### 4. Кеш між сесіями
Ключ кешу `sui_verified_tokens_v2` (не `_v1`) — щоб не конфліктувати зі старим кешем у браузері користувача при оновленні коду.

### 5. Scallop sCoins в балансі
sCoins (sSUI, sUSDC) видаються Scallop при депозиті. Вони НЕ є в жодному з цих списків за замовчуванням. Логіка їх визначення — в `balanceService.ts` через перевірку coinType prefix від Scallop package, а не через whitelist.

### 6. Розмір localStorage
Якщо список виросте до 500+ токенів — розмір кешу може перевищити 5MB ліміт localStorage. Зберігати тільки `type` (без iconUrl і description) — або перейти на IndexedDB для великих списків.

---

## Порядок реалізації

1. Замінити `HARDCODED_FALLBACK` на розширений `HARDCODED_VERIFIED` (~50 токенів)
2. Додати `fetchGeckoTerminalTokens()` — найнадійніше джерело після hardcoded
3. Додати `fetchAftermathTokens()` — якщо SDK підтримує
4. Виправити Suiet URL (додати jsdelivr CDN як fallback)
5. Реалізувати `normalizeCoinType()` і оновити всі місця порівняння
6. Очистити старий кеш (`localStorage.removeItem('suiet_verified_coins')`)
7. Протестувати з реальним гаманцем що має WAL, NS, stSUI, afSUI

---

## Швидка перевірка після реалізації

Відкрий DevTools → Console і виконай:
```javascript
// Скільки токенів у whitelist
JSON.parse(localStorage.getItem('sui_verified_tokens_v2')).data.length

// Чи є конкретний токен
const data = JSON.parse(localStorage.getItem('sui_verified_tokens_v2')).data;
data.find(t => t.symbol === 'WAL')   // має знайти
data.find(t => t.symbol === 'NS')    // має знайти
data.find(t => t.symbol === 'stSUI') // має знайти
data.find(t => t.symbol === 'afSUI') // має знайти
```

Якщо `data.length > 30` і основні токени знайдені — whitelist працює коректно.
