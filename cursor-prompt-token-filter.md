# Token Classification & Spam Filter — Cursor Prompt

> Модуль для Sui LP Dashboard: класифікація токенів гаманця, фільтрація спаму та шлак-токенів.
> Вписується в `balanceService.ts` + `BalanceDashboard.tsx` з основного проєкту.

---

## Контекст

На Sui будь-хто може задеплоїти токен і надіслати його на будь-який гаманець без дозволу. Через це гаманці часто засмічені:
- **Spam-токени** — підроблені або рекламні токени з URL в назві ("Visit site.com to claim 1000 SUI")
- **Dust-токени** — легітимні токени але з балансом < $0.01
- **Unverified-токени** — нові/маловідомі токени без верифікації, але реальні

SuiVision вирішує це через власний ручний whitelist. Ми реалізуємо **три шари автоматичної фільтрації** без ручної роботи.

---

## Файли для створення

```
src/
├── services/
│   ├── tokenClassifier.ts     ← головна логіка класифікації
│   └── verifiedTokenList.ts   ← завантаження та кешування Suiet list
├── components/balance/
│   ├── BalanceDashboard.tsx   ← оновлений з фільтрацією
│   ├── TokenRow.tsx           ← один токен у списку
│   ├── TokenStatusBadge.tsx   ← бейдж verified/unverified/spam
│   └── HiddenTokensSection.tsx ← collapsed секція для прихованих
└── hooks/
    └── useTokenClassification.ts
```

---

## ШАР 1 — Suiet Verified Coin List

### Що це

Офіційний верифікований список токенів Sui, який підтримує команда Suiet Wallet. Tokens проходять ручну перевірку перед додаванням.

- **GitHub:** https://github.com/suiet/sui-coin-list
- **Raw JSON:** `https://raw.githubusercontent.com/suiet/sui-coin-list/main/src/coins.json`
- **Оновлення:** кешувати на 24 год у localStorage

### Структура JSON

```typescript
// src/services/verifiedTokenList.ts

export interface SuietCoin {
  type: string;          // "0x2::sui::SUI" — coinType
  symbol: string;        // "SUI"
  name: string;          // "Sui"
  decimals: number;      // 9
  iconUrl: string;       // "https://..."
  tags: string[];        // ["native"] | ["bridge"]
  // wrapped?: { bridge: "wormhole", chain: "eth" }
}

const SUIET_LIST_URL = 'https://raw.githubusercontent.com/suiet/sui-coin-list/main/src/coins.json';
const CACHE_KEY = 'suiet_verified_coins';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 год

export async function getVerifiedCoinList(): Promise<Map<string, SuietCoin>> {
  // 1. Перевіряємо localStorage кеш
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) {
        return new Map(data.map((c: SuietCoin) => [c.type, c]));
      }
    }
  } catch {}

  // 2. Завантажуємо свіжий список
  const res = await fetch(SUIET_LIST_URL);
  const { coins } = await res.json();

  // 3. Зберігаємо в кеш
  localStorage.setItem(CACHE_KEY, JSON.stringify({
    data: coins,
    timestamp: Date.now(),
  }));

  return new Map(coins.map((c: SuietCoin) => [c.type, c]));
}
```

---

## ШАР 2 — getCoinMetadata евристика

Для токенів яких немає в Suiet list — запитуємо Sui RPC і аналізуємо metadata.

```typescript
// src/services/tokenClassifier.ts

import { SuiClient } from '@mysten/sui/client';

// Паттерни спаму в назві/описі токена
const SPAM_PATTERNS = [
  /https?:\/\//i,           // URL в назві/описі
  /www\./i,                 // домен без протоколу
  /\.com|\.io|\.xyz|\.net/i, // домен
  /claim/i,                 // "claim your tokens"
  /airdrop/i,               // "free airdrop"
  /visit/i,                 // "visit our site"
  /free\s+\d/i,             // "free 1000 tokens"
  /telegram\.me/i,
  /t\.me\//i,
];

export interface CoinClassification {
  coinType: string;
  status: 'verified' | 'unverified' | 'spam';
  suietData?: SuietCoin;    // якщо є в verified list
  metadata?: {
    symbol: string;
    name: string;
    decimals: number;
    iconUrl: string | null;
    description: string;
  } | null;
  reason?: string;          // чому spam (для дебагу)
}

export async function classifyToken(
  coinType: string,
  verifiedList: Map<string, SuietCoin>,
  suiClient: SuiClient,
): Promise<CoinClassification> {

  // ── Шар 1: Suiet verified list ──────────────────────────────
  if (verifiedList.has(coinType)) {
    return {
      coinType,
      status: 'verified',
      suietData: verifiedList.get(coinType),
    };
  }

  // ── Шар 2: getCoinMetadata евристика ────────────────────────
  let metadata = null;
  try {
    const raw = await suiClient.getCoinMetadata({ coinType });
    if (raw) {
      metadata = {
        symbol: raw.symbol,
        name: raw.name,
        decimals: raw.decimals,
        iconUrl: raw.iconUrl ?? null,
        description: raw.description ?? '',
      };
    }
  } catch {
    // getCoinMetadata може кинути помилку якщо токен не існує
    return { coinType, status: 'spam', metadata: null, reason: 'no_metadata' };
  }

  // Немає metadata → spam
  if (!metadata) {
    return { coinType, status: 'spam', metadata: null, reason: 'null_metadata' };
  }

  // Перевіряємо spam patterns
  const textToCheck = `${metadata.name} ${metadata.description} ${metadata.symbol}`;
  const spamMatch = SPAM_PATTERNS.find(p => p.test(textToCheck));
  if (spamMatch) {
    return {
      coinType,
      status: 'spam',
      metadata,
      reason: `spam_pattern: ${spamMatch.source}`,
    };
  }

  // Додаткові евристики
  const spamSignals: string[] = [];

  if (!metadata.iconUrl) spamSignals.push('no_icon');
  if (metadata.symbol.length > 12) spamSignals.push('long_symbol');
  if (metadata.name.length > 60) spamSignals.push('long_name');
  if (metadata.description.length < 5 && !metadata.iconUrl) spamSignals.push('empty_desc_no_icon');
  if (/^\d+$/.test(metadata.symbol)) spamSignals.push('numeric_symbol');
  if (metadata.symbol !== metadata.symbol.toUpperCase()) spamSignals.push('lowercase_symbol');

  // 2+ сигналів → spam
  if (spamSignals.length >= 2) {
    return {
      coinType,
      status: 'spam',
      metadata,
      reason: `signals: ${spamSignals.join(', ')}`,
    };
  }

  // 1 сигнал або жодного → unverified (показуємо але окремо)
  return { coinType, status: 'unverified', metadata };
}

// Batch класифікація з rate limiting (Sui RPC ~100 req/сек)
export async function classifyTokensBatch(
  coinTypes: string[],
  verifiedList: Map<string, SuietCoin>,
  suiClient: SuiClient,
): Promise<Map<string, CoinClassification>> {
  const results = new Map<string, CoinClassification>();

  // Спочатку швидко перевіряємо verified list (без RPC)
  const needsRPC: string[] = [];
  for (const ct of coinTypes) {
    if (verifiedList.has(ct)) {
      results.set(ct, { coinType: ct, status: 'verified', suietData: verifiedList.get(ct) });
    } else {
      needsRPC.push(ct);
    }
  }

  // Для решти — паралельно з обмеженням concurrency
  const BATCH_SIZE = 10; // не більше 10 паралельних RPC запитів
  for (let i = 0; i < needsRPC.length; i += BATCH_SIZE) {
    const batch = needsRPC.slice(i, i + BATCH_SIZE);
    const classified = await Promise.all(
      batch.map(ct => classifyToken(ct, verifiedList, suiClient).catch(() => ({
        coinType: ct,
        status: 'spam' as const,
        reason: 'rpc_error',
      })))
    );
    classified.forEach(c => results.set(c.coinType, c));
    // Невелика пауза між батчами
    if (i + BATCH_SIZE < needsRPC.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  return results;
}
```

---

## ШАР 3 — USD Value threshold

```typescript
// src/services/tokenClassifier.ts (додати)

export interface TokenWithValue {
  coinType: string;
  humanBalance: number;
  priceUSD: number | null;
  valueUSD: number | null;
  classification: CoinClassification;
}

export function shouldShowToken(token: TokenWithValue): boolean {
  // Verified → завжди показуємо (навіть якщо $0)
  if (token.classification.status === 'verified') return true;

  // Spam → ніколи не показуємо в основному списку
  if (token.classification.status === 'spam') return false;

  // Unverified → показуємо тільки якщо є USD value > $0.01
  return (token.valueUSD ?? 0) >= 0.01;
}

export function sortTokens(tokens: TokenWithValue[]): {
  verified: TokenWithValue[];
  unverified: TokenWithValue[];
  hidden: TokenWithValue[];  // spam + dust
} {
  const verified: TokenWithValue[] = [];
  const unverified: TokenWithValue[] = [];
  const hidden: TokenWithValue[] = [];

  for (const token of tokens) {
    if (token.classification.status === 'spam') {
      hidden.push(token);
    } else if (token.classification.status === 'unverified') {
      if (shouldShowToken(token)) {
        unverified.push(token);
      } else {
        hidden.push(token);
      }
    } else {
      verified.push(token);
    }
  }

  // Сортування за USD value (більші вгорі)
  const byValue = (a: TokenWithValue, b: TokenWithValue) =>
    (b.valueUSD ?? 0) - (a.valueUSD ?? 0);

  return {
    verified: verified.sort(byValue),
    unverified: unverified.sort(byValue),
    hidden: hidden.sort(byValue),
  };
}
```

---

## Hook

```typescript
// src/hooks/useTokenClassification.ts

import { useEffect, useState } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { getVerifiedCoinList } from '../services/verifiedTokenList';
import { classifyTokensBatch, sortTokens } from '../services/tokenClassifier';

export function useTokenClassification(
  rawBalances: Array<{ coinType: string; humanBalance: number; priceUSD: number | null }>
) {
  const suiClient = useSuiClient();
  const [classified, setClassified] = useState<ReturnType<typeof sortTokens> | null>(null);
  const [isClassifying, setIsClassifying] = useState(false);

  useEffect(() => {
    if (!rawBalances.length) return;
    setIsClassifying(true);

    (async () => {
      const verifiedList = await getVerifiedCoinList();
      const coinTypes = rawBalances.map(b => b.coinType);
      const classifications = await classifyTokensBatch(coinTypes, verifiedList, suiClient);

      const withValues = rawBalances.map(b => ({
        ...b,
        valueUSD: b.priceUSD !== null ? b.humanBalance * b.priceUSD : null,
        classification: classifications.get(b.coinType)!,
      }));

      setClassified(sortTokens(withValues));
      setIsClassifying(false);
    })();
  }, [rawBalances.map(b => b.coinType).join(',')]);

  return { classified, isClassifying };
}
```

---

## UI Components

### TokenRow.tsx

```tsx
// Один рядок у списку токенів

interface TokenRowProps {
  token: TokenWithValue;
  showStatus?: boolean; // показувати бейдж verified/unverified
}

// Відображення:
// [Icon] SUI          1,200.50 SUI     $1,248.52   +2.4%
// [Icon] USDC         5,000.00 USDC    $5,000.00    0.0%
// [?]   UnknownToken  100.00           $0.84       —

// - Verified токени: іконка з Suiet list або iconUrl з metadata
// - Unverified: іконка з metadata або сіра заглушка [?]
// - symbol берем з suietData.symbol або metadata.symbol
// - decimals з suietData.decimals або metadata.decimals
// - Якщо priceUSD === null → показуємо "—" замість вартості
```

### TokenStatusBadge.tsx

```tsx
// Мінімальний бейдж статусу

// verified   → не показуємо нічого (захаращує UI)
// unverified → маленький сірий бейдж "?" з tooltip "Unverified token"
// spam       → не показуємо (токен прихований)
```

### HiddenTokensSection.tsx

```tsx
// Collapsed секція внизу списку

// [▶ Show 12 hidden tokens]  ← кнопка

// При розкритті:
// ┌────────────────────────────────────────────────┐
// │ ⚠ Hidden Tokens (spam & dust)                 │
// │ These tokens were automatically filtered.      │
// │                                                │
// │ [?] CLAIM1000SUI   999,999.00    $0.00   spam │
// │ [?] FreeAirdrop      1,000.00    $0.00   spam │
// │ [?] SMALLTOKEN           0.01    $0.00   dust │
// └────────────────────────────────────────────────┘

// - Клік на токен → відкриває суiсан для перевірки
// - Кнопка "Report as spam" (опціонально, відкриває GitHub issue)
```

### BalanceDashboard.tsx (оновлена структура)

```tsx
// Фінальна структура компонента:

<BalanceDashboard>
  <SummaryBar>
    Total: $12,430  |  {verified.length} tokens  |  {hidden.length} hidden
  </SummaryBar>

  {/* Verified токени — основний список */}
  <section>
    {classified.verified.map(t => <TokenRow key={t.coinType} token={t} />)}
  </section>

  {/* Unverified — окрема секція якщо є */}
  {classified.unverified.length > 0 && (
    <section>
      <SectionLabel>Other tokens</SectionLabel>
      {classified.unverified.map(t => (
        <TokenRow key={t.coinType} token={t} showStatus />
      ))}
    </section>
  )}

  {/* Приховані (spam + dust) — collapsed */}
  {classified.hidden.length > 0 && (
    <HiddenTokensSection tokens={classified.hidden} />
  )}
</BalanceDashboard>
```

---

## TypeScript типи (додати в src/types/index.ts)

```typescript
export type TokenStatus = 'verified' | 'unverified' | 'spam';

export interface SuietCoin {
  type: string;
  symbol: string;
  name: string;
  decimals: number;
  iconUrl: string;
  tags: string[];
  wrapped?: {
    bridge: string;
    chain: string;
  };
}

export interface CoinClassification {
  coinType: string;
  status: TokenStatus;
  suietData?: SuietCoin;
  metadata?: {
    symbol: string;
    name: string;
    decimals: number;
    iconUrl: string | null;
    description: string;
  } | null;
  reason?: string;
}

export interface TokenWithValue {
  coinType: string;
  humanBalance: number;
  priceUSD: number | null;
  valueUSD: number | null;
  classification: CoinClassification;
}
```

---

## Edge cases для обробки

1. **Той самий символ, різний coinType** — наприклад є кілька "USDC" (wormhole, native, bridged). Suiet list розрізняє їх — показувати символ з уточненням ("USDCarb", "USDCsol"). Для native USDC від Circle — просто "USDC"

2. **sCoins від Scallop** (sSUI, sUSDC) — їх немає в Suiet list, але вони легітимні. Додати хардкодований whitelist Scallop sCoins:
```typescript
const SCALLOP_SCOINS = new Set([
  '0x...::s_sui::S_SUI',
  '0x...::s_usdc::S_USDC',
  // ...
]);
// Якщо coinType є в SCALLOP_SCOINS → status = 'verified', tag = 'Scallop Deposit'
```

3. **xSUI від Momentum** — аналогічно, хардкодований whitelist LST токенів

4. **getCoinMetadata повертає null** — токен задеплоєний без metadata → однозначно spam

5. **getCoinMetadata кидає помилку** (network error) — не класифікувати як spam, показати як 'unverified' і retry

6. **Порожній баланс (0 токенів)** — `getAllBalances` може повернути залишки від спалених об'єктів. Фільтрувати `humanBalance === 0` до класифікації

7. **Дуже багато токенів** (> 50) — пагінація в UI, класифікувати тільки перші 50 за значенням, решту lazy

---

## Константи (додати в src/utils/constants.ts)

```typescript
// Scallop sCoins — легітимні але не в Suiet list
export const SCALLOP_SCOINS: Record<string, string> = {
  '0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI': 'sSUI',
  // Додати актуальні адреси з Scallop docs
};

// Momentum LST
export const MOMENTUM_LST: Record<string, string> = {
  '0x2b6602099970374cf58a2a1b9d96f005fccceb81e92eb059873baf420eb6c717::x_sui::X_SUI': 'xSUI',
};

// Об'єднаний whitelist (verified поверх Suiet list)
export const PROTOCOL_TOKEN_WHITELIST = new Set([
  ...Object.keys(SCALLOP_SCOINS),
  ...Object.keys(MOMENTUM_LST),
]);

// Spam patterns
export const SPAM_TEXT_PATTERNS = [
  /https?:\/\//i,
  /www\./i,
  /\.com|\.io|\.xyz|\.net|\.org/i,
  /claim/i,
  /airdrop/i,
  /visit/i,
  /free\s+\d/i,
  /t\.me\//i,
  /telegram/i,
  /discord\.gg/i,
];

// Мінімальний USD value для unverified токенів
export const MIN_UNVERIFIED_VALUE_USD = 0.01;
```

---

## Порядок реалізації

1. `verifiedTokenList.ts` — завантаження та кешування Suiet list
2. `tokenClassifier.ts` — логіка класифікації (3 шари)
3. `useTokenClassification.ts` — hook з batch обробкою
4. `TokenStatusBadge.tsx` — мінімальний UI компонент
5. `TokenRow.tsx` — оновити для підтримки класифікації
6. `HiddenTokensSection.tsx` — collapsed секція
7. `BalanceDashboard.tsx` — інтегрувати все разом
8. Тести на edge cases (спамові назви, sCoins, xSUI)
```
