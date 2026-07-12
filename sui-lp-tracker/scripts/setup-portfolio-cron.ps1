# One-time setup: Vercel GITHUB_DISPATCH_TOKEN + generated SQL for Supabase Cron.
# Usage (from sui-lp-tracker):
#   $env:GITHUB_DISPATCH_TOKEN = 'github_pat_...'
#   .\scripts\setup-portfolio-cron.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Read-DotEnvValue([string]$key) {
	$line = Get-Content .env -ErrorAction SilentlyContinue |
		Where-Object { $_ -match "^$([regex]::Escape($key))=" } |
		Select-Object -First 1
	if (-not $line) { return $null }
	return ($line -replace "^$([regex]::Escape($key))=", '').Trim().Trim('"').Trim("'")
}

$cronSecret = Read-DotEnvValue 'CRON_SECRET'
if (-not $cronSecret -and (Test-Path .cron-secret.tmp)) {
	$cronSecret = (Get-Content .cron-secret.tmp -Raw).Trim()
}
if (-not $cronSecret) { throw 'CRON_SECRET missing (.env or .cron-secret.tmp)' }

$token = $env:GITHUB_DISPATCH_TOKEN
if (-not $token) {
	Write-Host @'
Create a GitHub fine-grained PAT:
  https://github.com/settings/personal-access-tokens/new
  Repository access: Only select repositories → sui-lp-dashboard
  Permissions: Actions (Read and write), Contents (Read-only)
Then:
  $env:GITHUB_DISPATCH_TOKEN = "github_pat_..."
  .\scripts\setup-portfolio-cron.ps1
'@
	throw 'Set GITHUB_DISPATCH_TOKEN env var and re-run'
}

Write-Host 'Adding GITHUB_DISPATCH_TOKEN to Vercel (production)...'
$token | npx --yes vercel env add GITHUB_DISPATCH_TOKEN production --force
if ($LASTEXITCODE -ne 0) {
	Write-Host 'vercel env add failed — add GITHUB_DISPATCH_TOKEN manually in Vercel → Settings → Environment Variables'
}

$appUrl = 'https://sui-lp-dashboard.vercel.app'
$dollar = '$$'
$sqlPath = Join-Path $root 'supabase\portfolio-snapshot-cron.setup.sql'
# Escape single quotes for SQL string literals
$cronSql = $cronSecret.Replace("'", "''")
$sqlOut = @"
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select vault.create_secret('$appUrl', 'portfolio_app_url');
select vault.create_secret('$cronSql', 'portfolio_cron_secret');

select cron.unschedule(jobid) from cron.job where jobname = 'portfolio-snapshot-dispatch';

select cron.schedule(
  'portfolio-snapshot-dispatch',
  '*/15 * * * *',
  $dollar
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'portfolio_app_url' limit 1)
      || '/api/cron/dispatch-portfolio-snapshot',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'portfolio_cron_secret' limit 1),
      'Accept', 'application/json'
    ),
    timeout_milliseconds := 15000
  ) as request_id;
  $dollar
);
"@
[System.IO.File]::WriteAllText($sqlPath, $sqlOut)
Write-Host "Wrote $sqlPath"
Write-Host '1) Open Supabase SQL Editor and run that file:'
Write-Host '   https://supabase.com/dashboard/project/toozgqlephynookxeahb/sql/new'
Write-Host '2) Redeploy so the new env is live: npx vercel --prod'
