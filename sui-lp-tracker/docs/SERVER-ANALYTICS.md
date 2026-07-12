# Server analytics (Supabase)

Фонові знімки портфеля кожні **15 хв** для адрес з `WATCH_WALLETS`, навіть без відкритого браузера.

## 1. Supabase

1. [supabase.com](https://supabase.com) → New project.
2. **SQL Editor** → виконай `supabase/schema.sql` (таблиці + seed двох адрес).
3. **Project Settings → API**:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = `service_role` (secret, лише server-side)

## 2. Vercel env

Додай у Vercel → Project → Environment Variables (або `scripts/vercel-env-analytics.ps1` / `scripts/setup-portfolio-cron.ps1`):

| Variable | Value |
|----------|--------|
| `SUPABASE_URL` | з Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key |
| `WATCH_WALLETS` | дві адреси через кому |
| `CRON_SECRET` | довільний random string (32+ chars) |
| `GITHUB_DISPATCH_TOKEN` | fine-grained PAT: Actions read/write + Contents read (лише цей repo) |

## 3. Cron (~кожні 15 хв) — надійний ланцюжок

Офіційні обмеження, через які «сам GHA schedule» не годиться:

- **GitHub Actions `schedule`** — best-effort: під навантаженням може **затримуватись або дропатись** ([docs](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule)).
- **Vercel Hobby cron** — максимум **1 раз на добу**; частіший вираз ламає deploy ([docs](https://vercel.com/docs/cron-jobs/usage-and-pricing)).
- **Vercel Hobby duration** — повний `snapshot:once` (~1 хв на 2 гаманці) не вміщається в короткий serverless timeout.

**Оптимальна схема (імплементовано):**

```
Supabase pg_cron (*/15) + pg_net
  → GET /api/cron/dispatch-portfolio-snapshot  (легкий, <2с, Bearer CRON_SECRET)
    → GitHub workflow_dispatch
      → Actions: npm run snapshot:once  (важка робота)
```

Налаштування:

1. Fine-grained PAT → `GITHUB_DISPATCH_TOKEN` на Vercel (`scripts/setup-portfolio-cron.ps1`).
2. SQL: `supabase/portfolio-snapshot-cron.sql` (або згенерований `.setup.sql`) у Supabase SQL Editor — Vault + `cron.schedule`.
3. GHA `.github/workflows/portfolio-snapshot.yml` — `workflow_dispatch` + **погодинний backup** `22 * * * *`.

Клиєнт (відкритий дашборд) також **POST** знімки в `/api/snapshots` для watchlist.

Secrets у репозиторії GitHub (для worker):
- `WATCH_WALLETS`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUI_RPC_URL`, `VITE_COINGECKO_API_KEY` (або `COINGECKO_API_KEY`)
- `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`

Локально / CI: `npm run snapshot:once`.

Ручний тригер dispatch:  
`GET /api/cron/dispatch-portfolio-snapshot` + `Authorization: Bearer <CRON_SECRET>`.  
(Важкий прямий `/api/cron/portfolio-snapshot` на Hobby зазвичай не встигає.)

## 4. Deploy

`npm run build` збирає cron bundle (`api/_lib/cron-bundle.mjs`) + SPA.

Після деплою перший snapshot — протягом 15 хв (GitHub Actions). Перевір **Analytics** для watchlist-адреси.

## API

- `GET /api/snapshots?wallet=0x…&range=7d` — історія портфеля (лише watchlist)
- `POST /api/snapshots` — upsert клієнтських знімків `{ snapshots: [...] }` (лише watchlist)
- `GET /api/lp-history?wallet=0x…&status=closed|open|all` — кеш LP events (open + closed)
- Cron dispatch: `GET /api/cron/dispatch-portfolio-snapshot` (authorized) → GHA
- Cron (heavy, Hobby-risky): `GET /api/cron/portfolio-snapshot` (authorized)

## LP history (open + closed)

Фоновий sync історії позицій для `WATCH_WALLETS`:

- Workflow: `.github/workflows/lp-history-sync.yml` (щогодини + manual)
- Локально: `npm run lp-history:sync`
- Schema: `supabase/lp-history.sql` (також у `schema.sql`)
- **Інкрементально:** closed, які вже в Supabase, не пере-enrich (лише нові NFT). Повний прогін: `LP_HISTORY_FULL_RESYNC=1`
- OKX hist quotes: `LP_HIST_QUOTE_CONCURRENCY` (Node default `3`)
- Wallets sync **послідовно** — не роздувати `WATCH_WALLETS` без потреби

Клиєнт для watchlist спочатку тягне closed/open events з `/api/lp-history` (ETag / 304), без cold RPC.  
Refresh оновлює ціни; **Force rescan** — cold LP scan.  
Analytics: server snapshots мерджаться з локальними 15-хв точками (GHA cron на private repo інколи запізнюється).

У `npm run dev` `/api/*` проксується на prod (окрім `/api/lp/pool-candles`).

## Ліміти

- **GitHub Actions `schedule`** — офіційно best-effort (затримки/дропи під навантаженням) → первинний тригер через **Supabase Cron**.
- **Vercel Hobby cron** — лише 1×/день; не використовуємо для 15-хв.
- Повний snapshot на Vercel (`/api/cron/portfolio-snapshot`) зараз падає на `cron-bundle` ESM/`ERR_MODULE_NOT_FOUND` — важка робота лишається в **GHA** (`snapshot:once`).
- Легкий `/api/cron/dispatch-portfolio-snapshot` лише ставить `workflow_dispatch` (<2с).
- Клиєнтський POST `/api/snapshots` добиває прогалини, коли браузер відкритий.
- RPC: публічний Mysten fullnode ок для старту; при 429 зменш concurrency.
- LP history sync важчий за portfolio snapshot — wallets послідовно, не паралельно.
