# Server analytics (Supabase)

Фонові знімки портфеля кожні **15 хв** для адрес з `WATCH_WALLETS`, навіть без відкритого браузера.

## 1. Supabase

1. [supabase.com](https://supabase.com) → New project.
2. **SQL Editor** → виконай `supabase/schema.sql` (таблиці + seed двох адрес).
3. **Project Settings → API**:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = `service_role` (secret, лише server-side)

## 2. Vercel env

Додай у Vercel → Project → Environment Variables (або `scripts/vercel-env-analytics.ps1` з `.env`):

| Variable | Value |
|----------|--------|
| `SUPABASE_URL` | з Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key |
| `WATCH_WALLETS` | дві адреси через кому |
| `CRON_SECRET` | довільний random string (32+ chars) |

## 3. Cron (кожні 15 хв)

**Vercel Hobby** не підтримує cron кожні 15 хв — snapshot запускає **GitHub Actions** (`.github/workflows/portfolio-snapshot.yml`), який виконує `npm run snapshot:once` у `sui-lp-tracker/`.

Secrets у репозиторії GitHub (Settings → Secrets):
- `WATCH_WALLETS`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUI_RPC_URL`, `VITE_COINGECKO_API_KEY` (або `COINGECKO_API_KEY`)
- `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` (для цін DEX)

Локально / CI: `npm run snapshot:once` (через **vite-node**, щоб працювали Vite aliases + `import.meta.env`).

Опційно — ручний HTTP-тригер Vercel (може бути обмежений ESM/timeout на Hobby):  
`GET /api/cron/portfolio-snapshot` + `Authorization: Bearer <CRON_SECRET>`.

## 4. Deploy

`npm run build` збирає cron bundle (`api/_lib/cron-bundle.mjs`) + SPA.

Після деплою перший snapshot — протягом 15 хв (GitHub Actions). Перевір **Analytics** для watchlist-адреси.

## API

- `GET /api/snapshots?wallet=0x…&range=7d` — історія портфеля (лише watchlist)
- `GET /api/lp-history?wallet=0x…&status=closed|open|all` — кеш LP events (open + closed)
- Cron: `GET /api/cron/portfolio-snapshot` (authorized)

## LP history (open + closed)

Фоновий sync історії позицій для `WATCH_WALLETS`:

- Workflow: `.github/workflows/lp-history-sync.yml` (щогодини + manual)
- Локально: `npm run lp-history:sync`
- Schema: `supabase/lp-history.sql` (також у `schema.sql`)

Клиєнт для watchlist спочатку тягне closed/open events з `/api/lp-history`, без cold RPC.

## Ліміти

- Hobby Vercel: function timeout **10s** — для 2 гаманців може бути tight; Pro дає **60s** (`vercel.json`).
- RPC: використовуй приватний endpoint у `VITE_SUI_RPC_URL`.
- LP history sync важчий за portfolio snapshot — краще private RPC і sequential wallets.
