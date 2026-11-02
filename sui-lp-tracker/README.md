# Sui LP & Lending Dashboard

Веб-додаток (**React + TypeScript + Vite**) для огляду портфеля на **Sui mainnet** і торгівлі Cetus/Bluefin LP з **MANUAL_SIGN**: баланс, LP, lending, analytics, **Build** (конструктор каскаду) і **Markets**. Код UI — у **`sui-lp-tracker`**; Autopilot bot API — у **`sui-lp-autopilot`** (порт **5191**).

## Швидкий старт

З кореня **`SUI Dashboard`**:

```bash
npm install
npm run bot          # окремо: API 5191 (або через bat нижче)
npm run dev          # Vite 5180 (+ concurrently bot, якщо `npm run dev` з кореня)
```

Або **`sui-lp-tracker/start-SUIdashboard.bat`**: піднімає **bot 5191** + **tracker 5180**.

- **Dashboard UI:** [http://localhost:5180](http://localhost:5180) — **єдиний** UI (manual sign / submit)
- **Build / Markets:** `/lp/build`, `/lp/markets` (proxy `/api/autopilot` → `127.0.0.1:5191`)
- **Прод-збірка:** `npm run build`, preview: **5181**
- **CI / QA:** з кореня `npm run ci` (typecheck → test → lint → build)
- **Тести:** `npm run test` у корені або в `sui-lp-tracker` / `sui-lp-autopilot`

Скопіюй **`sui-lp-tracker/.env.example`** → **`.env`**. Після зміни `.env` перезапусти Vite.

## Autopilot

| Компонент | Роль |
|-----------|------|
| **tracker (5180)** | Єдиний UI: preview, dry-run, wallet sign, submit |
| **bot (5191)** | HTTP build/recommend; default **MONITOR_ONLY**; без AUTO_GUARDED execution |
| **`@autopilot/db`** | JSON file store (strategies, ops, position map) |
| **deprecated dashboard** | `packages/dashboard` **видалено** — не використовувати порт 5190 |

Підпис завжди власником гаманця (MANUAL_SIGN). Bot не підписує live tx.

## Pool quote

`/api/pool-quote` (Vite plugin + `quotePoolImpact`) лишається для impact-оцінок Cetus/Turbos. Research arb/scanner scripts і docs прибрані; мінімальна pricing-логіка в `src/arbitrage/pricing` збережена лише для quote.

## Документація в репозиторії

| Файл | Зміст |
|------|--------|
| **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** | Архітектура: модулі, стор, DEX, ціни, проксі |
| **[docs/GLOSSARY.md](./docs/GLOSSARY.md)** | Liquidity vs Value |
| **[docs/CHAT-HANDOFF.md](./docs/CHAT-HANDOFF.md)** | Контекст для нового чату |

## Cursor

У корені воркспейсу: **`.cursor/rules/verify-official-docs.mdc`** — перед новими HTTP/SDK інтеграціями звіряти офіційну документацію провайдера.
