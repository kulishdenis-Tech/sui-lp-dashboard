-- Reliable 15-min portfolio snapshot scheduler (Supabase Cron + pg_net).
--
-- Architecture (see docs/SERVER-ANALYTICS.md):
--   pg_cron every 15 min
--     → HTTP GET Vercel /api/cron/dispatch-portfolio-snapshot (Bearer CRON_SECRET)
--       → GitHub workflow_dispatch (GITHUB_DISPATCH_TOKEN on Vercel)
--         → Actions runs `npm run snapshot:once`
--
-- Why not GitHub schedule alone? Official docs: schedule may be delayed or dropped.
-- Why not Vercel cron */15? Hobby allows only once per day; full snapshot exceeds Hobby duration.
--
-- Prerequisites:
-- 1. Enable extensions: Database → Extensions → pg_cron, pg_net (and Vault if using secrets below)
-- 2. Replace placeholders OR use vault secrets (recommended)
-- 3. Deploy app with GITHUB_DISPATCH_TOKEN on Vercel

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Optional: store secrets in Vault (Dashboard → Project Settings → Vault), then:
--   select vault.create_secret('https://sui-lp-dashboard.vercel.app', 'portfolio_app_url');
--   select vault.create_secret('<CRON_SECRET>', 'portfolio_cron_secret');

-- Unschedule previous job if re-running this file
select cron.unschedule(jobid)
from cron.job
where jobname = 'portfolio-snapshot-dispatch';

select
  cron.schedule(
    'portfolio-snapshot-dispatch',
    '*/15 * * * *',
    $$
    select
      net.http_get(
        url := coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'portfolio_app_url' limit 1),
          'https://sui-lp-dashboard.vercel.app'
        ) || '/api/cron/dispatch-portfolio-snapshot',
        headers := jsonb_build_object(
          'Authorization',
          'Bearer ' || coalesce(
            (select decrypted_secret from vault.decrypted_secrets where name = 'portfolio_cron_secret' limit 1),
            'REPLACE_WITH_CRON_SECRET'
          ),
          'Accept', 'application/json'
        ),
        timeout_milliseconds := 15000
      ) as request_id;
    $$
  );
