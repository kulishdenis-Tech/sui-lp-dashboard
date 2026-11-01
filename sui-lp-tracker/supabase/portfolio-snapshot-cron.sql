-- Reliable portfolio snapshot scheduler (Supabase Cron + pg_net + Edge Function).
--
-- Architecture:
--   pg_cron every 2h
--     → HTTP POST Edge Function `portfolio-snapshot` (Bearer from vault)
--       → GitHub workflow_dispatch (token from vault)
--         → Actions runs `npm run snapshot:once` (90m per-wallet dedupe)
--
-- Prerequisites:
-- 1. Extensions: pg_cron, pg_net, supabase_vault
-- 2. Vault secrets (Dashboard → Project Settings → Vault), names:
--      portfolio_edge_url, portfolio_cron_secret, github_dispatch_token,
--      github_dispatch_repo, github_dispatch_workflow, github_dispatch_ref
-- 3. Edge Function `portfolio-snapshot` deployed (verify_jwt=false; auth via CRON secret)
-- 4. RPC public.portfolio_runtime_secret(text) for service_role vault reads
--
-- Disable:  select cron.unschedule(jobid) from cron.job where jobname = 'portfolio-snapshot-edge';

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname in ('portfolio-snapshot-dispatch', 'portfolio-snapshot-edge');

select
  cron.schedule(
    'portfolio-snapshot-edge',
    '0 */2 * * *',
    $$
    select
      net.http_post(
        url := coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'portfolio_edge_url' limit 1),
          'https://toozgqlephynookxeahb.supabase.co/functions/v1/portfolio-snapshot'
        ),
        headers := jsonb_build_object(
          'Authorization',
          'Bearer ' || coalesce(
            (select decrypted_secret from vault.decrypted_secrets where name = 'portfolio_cron_secret' limit 1),
            ''
          ),
          'Content-Type', 'application/json',
          'Accept', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 15000
      ) as request_id;
    $$
  );
