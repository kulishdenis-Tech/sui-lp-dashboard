# Sui LP & Lending Dashboard

Веб-додаток (**React + TypeScript + Vite**) для read-only огляду портфеля на **Sui mainnet**: баланс токенів, LP-позиції (відкриті та закриті), lending, вкладка аналітики. Код живе в каталозі **`sui-lp-tracker`**.

## Швидкий старт

З кореня репозиторію **`SUI Dashboard`** (батьківський `package.json` лише проксує команди):

```bash
npm run dev
```

Або напряму:

```bash
cd sui-lp-tracker
npm install
npm run dev
```

- **Локальна URL:** [http://localhost:5180](http://localhost:5180) (порт зафіксовано у `vite.config.ts`; якщо зайнятий — звільни порт або зміни конфіг).
- **Прод-збірка:** `npm run build`, попередній перегляд: `npm run preview` (порт **5181**).
- **Тести:** `npm run test`

Скопіюй **`sui-lp-tracker/.env.example`** → **`.env`**, підстав RPC і за потреби ключі провайдерів. Після зміни `.env` перезапусти dev-сервер (Vite зчитує змінні при старті).

## Документація в репозиторії

| Файл | Зміст |
|------|--------|
| **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** | Поточна архітектура: модулі, стор, адаптери DEX, ціни, проксі, змінні середовища |
| **[docs/GLOSSARY.md](./docs/GLOSSARY.md)** | Терміни Liquidity vs Value для UI |
| **[docs/CHAT-HANDOFF.md](./docs/CHAT-HANDOFF.md)** | Короткий контекст для нового чату |
| **[docs/rfc-tv-charting-library-udf.md](./docs/rfc-tv-charting-library-udf.md)** | RFC на майбутню інтеграцію TradingView UDF |

## Ціни та змінні середовища (коротко)

У **`.env.example`** описані ключі (**CoinGecko**, **OKX Web3**, таймаути, прапорці indexer / Bluefin). Для деву зовнішні API часто йдуть через **Vite proxy** та `src/utils/externalFetchUrl.ts` (обхід CORS).

Детальніше таблиця зовнішніх доменів — у **`docs/ARCHITECTURE.md`**.

## Cursor / правило про документацію провайдерів

У корені воркспейсу: **`.cursor/rules/verify-official-docs.mdc`** — перед впровадженням нових інтеграцій з офіційними HTTP/SDK слід узгоджувати з документацією провайдера.
