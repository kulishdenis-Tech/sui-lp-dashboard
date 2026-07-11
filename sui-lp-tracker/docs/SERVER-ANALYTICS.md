# Server analytics (Supabase)

Фонові знімки портфеля кожні **15 хв** для адрес з `WATCH_WALLETS`, навіть без відкритого браузера.

## 1. Supabase

1. [supabase.com](https://supabase.com) → New project.
2. **SQL Editor** → виконай `supabase/schema.sql` (таблиці + seed двох адрес).
3. **Project Settings → API**:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = `service_role` (secret, лише server-side)

## 2. Vercel env

Додай у Vercel → Project → Environment Variables:

| Variable | Value |
|----------|--------|
| `SUPABASE_URL` | з Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key |
| `WATCH_WALLETS` | дві адреси через кому |
| `CRON_SECRET` | довільний random string (32+ chars) |

У Vercel **Cron** автоматично надсилає `Authorization: Bearer <CRON_SECRET>` якщо secret налаштований у проєкті (див. Vercel docs). Якщо ні — додай `CRON_SECRET` у Vercel і вручну тригер:  
`GET https://your-app.vercel.app/api/cron/portfolio-snapshot?secret=YOUR_SECRET`

## 3. Deploy

`npm run build` збирає cron bundle (`api/_lib/cron-bundle.mjs`) + SPA.

Після деплою перший cron — протягом 15 хв. Перевір **Analytics** для watchlist-адреси.

## API

- `GET /api/snapshots?wallet=0x…&range=7d` — історія (лише watchlist)
- Cron: `GET /api/cron/portfolio-snapshot` (authorized)

## Ліміти

- Hobby Vercel: function timeout **10s** — для 2 гаманців може бути tight; Pro дає **60s** (`vercel.json`).
- RPC: використовуй приватний endpoint у `VITE_SUI_RPC_URL`.
