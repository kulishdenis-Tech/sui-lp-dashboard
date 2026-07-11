# RFC: TradingView Charting Library + UDF для графіка пулу LP

Мета окремої фази продукту — максимально наблизити UX до повного TradingView (індикатори, малювання, синхронізація осьового UI) там, де **Lightweight Charts** + Gecko embed не вистачить.

## 1. Доступ і легальність

1. Подати заявку через офіційний потік TradingView на **Charting Library** ([документація TradingView Charting Library](https://www.tradingview.com/charting-library-docs/latest/)): отримання приватного npm/registry-доступу, ознайомлення з умовами redist/hosting для вашого кейсу web-app.
2. Окремо погодити з юридичною службою/замовником: умови ліцензії провайдера, обмеження на збереження/кеш сторонніх котувань, відображення брендингу TV.

## 2. Обов’язки UDF сервіса даних

Charting Library очікує **UDF (Universal Data Feed)** JSON API: головні ендпоінти конфігурації, символ-інформація, бари OHLC та (опційно) пошук. Реальне джерело даних уже є як **REST OHLCV GeckoTerminal по `pool`** у клієнті.

Пропонується один з шляхів:

1. **BFF/backend** перед вашим SPA: узгоджений набір роутів UDF над існуючою логікою `poolCandlesClient.ts` / `buildGeckoPoolOhlcvUrl` (можлива збірка в Node/worker із тим же `geckoPoolOhlcvCore`).
2. **Символ** у TV: синтетичний рядок, напр. `SUINPOOL:0x{pool}:{tf}`, який UDF-парсер перетворює на параметри `network=sui-network`, `pool`, timeframe і aggregate як у вашому типі `PoolCandleTimeframeId`.

Необхідно:

- Конвертер відповіді Gecko OHLC (`ohlcv_list`) у формат масивів полів барів за актуальною версією UDF (перевірити офіційний гід UDF і ваш збірний пакунок Charting Library).
- Для посторінкового завантаження використати вже передбачені query-параметри (`before_timestamp`), якщо ваш datafeed робить prefetch сторінками у часі назад.

## 3. Альтернатива — залишити гібрид

Зберігати **режим Авто + Gecko iframe + LWC fallback** там, де пул уже проіндексований Gecko; Charting Library підключити після офіційного доступу там, де embed заборонений CSP або потрібен повний набір інструментів TV.

## 4. Operational

- CSP **`frame-src`**: для поточного Gecko embed підказано в UI під графіком; для ізольованої сторінки з TV Library узгодити з документацією провайдера дозволені домени.
- Публічний Gecko Terminal API зберігає ліміт (наприклад 30 RPM); при UDF з сервера варто кешувати відповіді за ключем `network × pool × timeframe × aggregate`.
