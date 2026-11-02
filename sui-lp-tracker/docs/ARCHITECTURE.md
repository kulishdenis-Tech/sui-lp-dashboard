# Архітектура Sui LP Tracker (`sui-lp-tracker`)

Оновлений опис стану кодової бази **без** дублювання кожного рядка коду — орієнтир для розробника та нового контексту чату.

## Призначення

Read-only SPA на **React + TypeScript + Vite** для гаманця / вставленої адреси на **Sui mainnet**:

- Баланси монет із USD та 24h %.
- **Відкриті** та **закриті** LP-позиції з кількох DEX (адаптери).
- Lending: **Alpha Lend**, **Navi** (merged у net worth), плюс позиції **Aftermath** у LP-розрізі.
- Вкладка **Analytics**: історія портфеля з **IndexedDB** (`portfolioSnapshotIdb`) + Lightweight Charts.

Немає відправлення транзакцій — лише читання ланцюга та публічних API.

## Монорепо робочої папки

| Рівень | Опис |
|--------|------|
| `SUI Dashboard/package.json` | Проксі-скрипти `npm run dev|build|preview` → `sui-lp-tracker` |
| `sui-lp-tracker/` | Фактичний застосунок |

Фіксований dev-порт: **5180** (`vite.config.ts`, `strictPort: true`; `preview` — **5181**).

## Точка входу та провайдери

- `src/main.tsx` — polyfill **`Buffer`** (потрібно для `@alphafi/alphalend-sdk`).
- **`@tanstack/react-query`** `QueryClientProvider` — обов’язковий для **`@mysten/dapp-kit`** (внутрішні hooks).
- **`@mysten/dapp-kit`**: `SuiClientProvider` (RPC з `VITE_SUI_RPC_URL` або Mysten fallback), `WalletProvider`.
- **`react-router-dom`**: глобальний `BrowserRouter`; маршрути в `App.tsx`.

## Static prod: serverless proxy

У **dev** зовнішні API йдуть через Vite `/ext/*` (`vite.config.ts`). У **static prod** (Vercel/Netlify) того шару немає — клієнт маршрутизує whitelisted хости на serverless:

```
Browser  →  /api/ext?host=…&path=…   (Navi, DexScreener, Gecko, Pyth, Bluefin, …)
         →  POST /api/okx             (HMAC на сервері, OKX_* env)
         →  POST /api/coingecko       (CG key на сервері)
         →  Sui RPC напряму (VITE_SUI_RPC_URL)
```

Реалізація: `api/ext.ts`, `api/okx.ts`, `api/coingecko.ts`, `vercel.json` (SPA fallback + `/api/*`). Клієнт: `utils/externalFetchUrl.ts`, `utils/apiProxy.ts`. Секрети **не** потрібні у prod bundle (`grep VITE_OKX_SECRET dist` має бути порожнім).

## Маршрутизація (`src/App.tsx`)

| Шлях | Компонент |
|------|-----------|
| `/` | `AppLayout` → `Outlet` показує `MainContent` (індекс) |
| `/design-system` | Дизайн-система |
| `/lp/position/:positionId` | Детальна картка LP |

## Основний UI-потік

- `components/layout/AppLayout.tsx` — хедер, таби (**balance | lp | lending | analytics**), гаманець / ручна адреса.
- `MainContent.tsx` — до підключення гаманця (або без адреси) показує підказку; після підключення — таб-панелі.
- **`useWalletAuth`** — верифікація підписом (TTL сесії в логіці хуку / storage).
- **Ручна адреса** (`manualViewAddress` у сторі) — read-only режим із `persistManualAddress` у `manualAddressStorage`.

## Глобальний стан (`src/store/appStore.ts`)

Центральна функція **`loadAll(address, options)`**:

1. Послідово в один «хвіст» на адресу (`enqueuePortfolioLoad`) — захист від гонок.
2. Завантажує **баланси** (`balanceService`), **`ensureLpWalletScanSession`** (один scan Bluefin+Momentum raw), **відкриті LP**: п’ять паралельних джерел із лічильником **`pendingProtocols`**, **lending** (Alpha + Navi), **закриті LP** — **`loadClosedPositions`** (eager) або при відкритті вкладки Closed (lazy); **`isLoadingClosed`** не блокує Open.
3. **`computeNetWorth`** поєднує видимий гаманець, LP (зі спот-цін), merged lending для картки Total.
4. **Enrichment відкритих** Bluefin/Momentum/Cetus: `enrichAllBluefinOpenPositions`, `markEnriching` через barrel **`services/enrichment.ts`** (реекспорт з `bluefinEnrichment.ts`).

Події таблиць по позиціях зберігаються в **`positionEvents`**, **`loadingEvents`** — індикація збагачення.

## Модуль Balance

- `balanceService.ts` — монети власника, ціни через класифікацію та spot-ланцюжок.
- `tokenClassifier.ts`, `verifiedTokenList.ts`, конфіги `junkTokens`, `hardcodedVerifiedCoins`.
- Компоненти: `BalanceDashboard.tsx`, `TokenRow.tsx`, `HiddenTokensSection.tsx`.

## Модуль LP

### Відкриті позиції

Джерело в `loadAll`:

- **Cetus** — `cetusService.ts`, події `cetusLpEvents.ts`.
- **Momentum** — `momentumService.ts` (`@mmt-finance/clmm-sdk`), `momentumLpEvents.ts`, резерв **`momentumPositionsRpcFallback.ts`**.
- **Bluefin Spot CLMM** — `bluefinService.ts` (`TickMath`, інспекція нагород/комісій, `bluefinAccruedSdk` / `bluefinAccruedInspect`).
- **Turbos** — `turbosService.ts`, `turbosLpEvents.ts`.
- **Aftermath farms** — `aftermathService.ts` як частина потоку LP у сторі (див. `loadAll` далі по файлу).

Константи пакунків та URL: **`src/utils/constants.ts`** (`PROTOCOL_PACKAGES`, `BLUEFIN_SPOT_API`, Explorer helpers).

UI: `LpModule.tsx`, `OpenPositionsTable.tsx`, детально `PositionDetailPage.tsx`, графік `PositionPoolChart.tsx` (+ Gecko OHLCV `poolOhlcvGecko.ts`, `poolCandlesClient.ts`, dev middleware `vite-plugin-lp-candles`).

### DEX × відкриті / закриті / канали скану

| DEX | Відкриті (discovery) | Що вважається «closed» | Скан подій (основні канали) | Enrichment USD |
|-----|----------------------|-------------------------|-----------------------------|----------------|
| **Bluefin** | Owned NFT `Position` + pool `multiGet` | NFT **немає** among owned + `PositionClosed` або фінальне `LiquidityRemoved` | `scanBluefinWalletAllPositionEvents` (Sender + assist `PositionClosed`); спільна **`LpWalletScanSession`** на `loadAll` | `enrichAllBluefinOpen/Closed` + історичні ціни (`prefetchHistoricalQuotes`) |
| **Momentum** | SDK `getAllUserPositions` (+ RPC fallback); pools/tokens **кеш 15 хв** | Те саме: не owned + `ClosePosition` / `RemoveLiquidity` | `scanMomentumWalletAllPositionEvents`; та сама session | Той самий enrichment pipeline |
| **Cetus** | SDK + owned NFT | NFT **owned**, `liquidity === 0` | **Один** `scanCetusWalletEvents` на гаманець → `enrichAllCetusOpenPositions`; closed — per-NFT + IDB | `enrichBluefinOpenPositionWithEvents` / closed batch |
| **Turbos** | Owned position objects | Власний closed scanner | Per-position `scanTurbosPositionEvents` (TX pages) | Як Cetus |
| **Aftermath** | Farms у `aftermathService` | Немає в `DEX_ADAPTERS` closed | — | Spot only у списку |

**Lazy closed** (`VITE_LP_LAZY_CLOSED`, за замовч. увімк.): `getClosedPositions` лише при відкритті вкладки Closed або якщо `=0` — одразу в `loadAll`. **Lazy Bluefin unclaimed** (`VITE_BLUEFIN_LAZY_UNCLAIMED`): devInspect у списку пропускається; догрузка на `PositionDetailPage`.

### Закриті позиції

- **`services/positionService.ts` → `getClosedPositions(wallet)`** (після `ensureLpWalletScanSession`).
- Перелік **`DEX_ADAPTERS`** (`services/adapters/registry.ts`): **Bluefin, Momentum, Cetus, Turbos** (`bluefinAdapter`, `momentumAdapter`, … кожен імплементує `getClosedPositions`).
- Злиття, сортування за `closedAt`; потім **`enrichAllBluefinClosedPositions`**; за прапорцем **`VITE_LP_LIFECYCLE_INDEXER=1`** — **`lpIndexerAugmentClosed.ts`** + IndexedDB **`lpTxRawStore`**, harvest **`lpTxRawHarvest.ts`**.

**Bluefin** закриті: події з ланцюга (`eventParser.scanBluefinWalletAllPositionEvents` — транзакції від адреси, події Sender, допоміжний прохід **`PositionClosed` + фильтр sender tx** через `VITE_BF_POSITION_CLOSED_ASSIST_PAGES`), збір за `bluefinClosedPositions.ts`; логіка відкритих об’єктів не використовується як джерело істини для закритих.

**Momentum** закриті: **`momentumClosedPositions.ts`**, скан подій із `published_at`-пакунку (`PROTOCOL_PACKAGES.MOMENTUM_PUBLISHED_AT` **не** дорівнює `MOMENTUM_CLMM` — у коді використовуються обидва призначення: package vs published path до Move-подій).

### LP lifecycle (індексер)

- **`lpDexLpActions.ts`** — перетворення сирих подій у `LpAction[]`.
- **`lpLifecycleCompose.ts`**, типи **`types/lpLifecycle.ts`**, gas **`lpLifecycleGas.ts`**.
- Кеш **`lpEventIdbCache.ts`**.

## Ціни

### Поточні spot (`services/spotPrice/`)

Центральне вирішування: **`resolveSpots.ts`** (ланцюжок: кеш пам’яті + localStorage **`currentSpotCache`**, OKX **`okxDexApi`** при наявності ключів, DexScreener, Aftermath, GeckoTerminal, DexPaprika, оверлеї CoinGecko для маплених символів — див. `priceSources.ts`).

### 24 год % (`spotChange24h.ts`)

OKX там, де можливо інакше CoinGecko batch / DexScreener тощо.

### Історичні USD для подій LP

**`okxHistoricalUsd.ts`**, узгоджено з `priceService.ts` / **`priceCache.ts`**; хук **`useHistoricalPrice.ts`**.

У dev браузернi запити до зовнішніх доменів ідуть через **проксі** `extFetchUrl` (`src/utils/externalFetchUrl.ts`) → префікси у `vite.config.ts`.

## Lending

- **`lendingService.ts`** — Alpha Lend через `@alphafi/alphalend-sdk` (динамічний import); через алиаси/shim сумісність з `@mysten/sui/client` як у коментарях у `vite.config.ts`.
- **`naviService.ts`** — Navi Open API (проксі `/ext/navi` у dev).
- UI: **`LendingModule.tsx`**.

Комбінований знімок у net worth уже описано вище.

## Analytics

- **`usePortfolioHistory.ts`** читає локальний часовий ряд із **`portfolioSnapshotIdb`**.
- Графік: **`lightweight-charts`** у `AnalyticsModule.tsx`.

## DEX adapters (`src/services/adapters/`)

- Єдиний реєстр: **`registry.ts`** — порядок у масиві = порядок злиття.
- Новий протокол: реалізація **`DexAdapter`** (`types.ts`) + імпорт у `registry`.

## Окремі шим-модулі (Vite)

`vite.config.ts` алиаси:

- `@mysten/sui/client` → `src/shims/sui-client.ts` (Momentum CLMM SDK still imports this path)

`optimizeDeps.include`: `alphalend-sdk`, `@naviprotocol/lending`, `buffer`.

## Зовнішні підключення (HTTP)

| Призначення | Хост / сервіс | Dev-проксі |
|-------------|---------------|------------|
| Sui RPC | `VITE_SUI_RPC_URL` | — |
| Hermes / Benchmarks Pyth | `hermes.pyth.network`, `benchmarks.pyth.network` | `/ext/hermes`, `/ext/bench` |
| DexScreener | `api.dexscreener.com` | `/ext/ds` |
| GeckoTerminal | `api.geckoterminal.com` | `/ext/gt` |
| DexPaprika | `api.dexpaprika.com` | `/ext/dp` |
| CoinGecko | free Demo API | `/ext/cg` |
| OKX Web3 | `web3.okx.com` | `/ext/okx` |
| Bluefin DAPI / Swap | `dapi.api.sui-prod.bluefin.io`, `swap.api.sui-prod.bluefin.io` | `/ext/bf-dapi`, `/ext/bf-swap` |
| Navi Open API | `open-api.naviprotocol.io` | `/ext/navi` |

У **production** `extFetchUrl` повертає прямий URL — важливий CORS або власний BFF при потребі.

## Змінні середовища

Повний перелік з типами у **`src/vite-env.d.ts`**. Приклад і коментарі — **`sui-lp-tracker/.env.example`**.

Ключові групи:

- **RPC**, **CoinGecko**, **OKX** (ключі потрапляють у бандл — секретів у prod через Vite небажано).
- **LP candles** `VITE_LP_CANDLES_URL` (прод) vs вбудований dev endpoint.
- **Bluefin debug** `VITE_DEBUG_BLUEFIN`.
- **Lifecycle indexer** `VITE_LP_LIFECYCLE_INDEXER`, **ascending force** `VITE_LP_LIFECYCLE_ASCENDING_FORCE`.
- **Bluefin assist закритих** `VITE_BF_POSITION_CLOSED_ASSIST_PAGES` (`0` = вимк.).

Після зміни `.env` потрібен перезапуск `npm run dev`.

## NPM-залежності (за призначенням)

| Пакунок | Роль |
|---------|------|
| `@mysten/sui`, `@mysten/dapp-kit` | RPC, гаманець |
| `@cetusprotocol/sui-clmm-sdk` | Cetus CLMM |
| `@mmt-finance/clmm-sdk` | Momentum CLMM |
| `@alphafi/alphalend-sdk`, `@naviprotocol/lending` | Lending |
| `aftermath-ts-sdk` | Aftermath |
| `@tanstack/react-query` | peer dep для `@mysten/dapp-kit` |
| `zustand` | стор |
| `decimal.js`, `bn.js` | арифметика для Move-значень |
| `lightweight-charts` | графік аналітики / пулів |

Точні версії див. `package.json`.

## Конвенція коментарів у коді

Частина сервісів має короткі українські пояснення біля складної on-chain логіки; текст UI англійською там, де вже використано англомовні рядки.

## Related docs

- [GLOSSARY.md](./GLOSSARY.md) — Liquidity vs Value тощо.
- [RFC: TradingView + UDF](./rfc-tv-charting-library-udf.md).
- Кореневий [README](../README.md) — швидкий старт та посилання сюди.
