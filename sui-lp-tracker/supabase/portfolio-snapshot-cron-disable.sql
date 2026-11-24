-- Snapshots now run on the home server (systemd timer). Remove the old Supabase scheduler.
-- Run once in the Supabase SQL editor. Then delete the Edge Function `portfolio-snapshot`
-- (Dashboard → Edge Functions) and the vault secrets portfolio_edge_url, portfolio_cron_secret,
-- github_dispatch_token, github_dispatch_repo, github_dispatch_workflow, github_dispatch_ref.
select cron.unschedule(jobid)
from cron.job
where jobname in ('portfolio-snapshot-dispatch', 'portfolio-snapshot-edge');
