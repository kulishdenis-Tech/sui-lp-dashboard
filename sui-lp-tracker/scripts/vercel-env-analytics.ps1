# Upload server analytics env vars to Vercel (no secrets printed).
param(
	[string]$ProjectDir = (Join-Path $PSScriptRoot '..')
)

$ErrorActionPreference = 'Continue'
Set-Location $ProjectDir

function Add-VercelEnv($name, $value) {
	if ([string]::IsNullOrWhiteSpace($value)) { return }
	Write-Host "Adding $name"
	foreach ($target in @('production', 'preview', 'development')) {
		$null = ($value | npx --yes vercel@latest env add $name $target --force 2>&1)
	}
}

$cronSecret = Get-Content (Join-Path $ProjectDir '.cron-secret.tmp') -Raw -ErrorAction SilentlyContinue
if ($cronSecret) { Add-VercelEnv 'CRON_SECRET' $cronSecret.Trim() }

$watch = '0xff8a51f37daceef95619a7d31915868375329964bacea6c72811175d6a458da6,0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
Add-VercelEnv 'WATCH_WALLETS' $watch

$envFile = Join-Path $ProjectDir '.env'
if (Test-Path $envFile) {
	Get-Content $envFile | ForEach-Object {
		$line = $_.Trim()
		if (-not $line -or $line.StartsWith('#')) { return }
		$eq = $line.IndexOf('=')
		if ($eq -lt 1) { return }
		$name = $line.Substring(0, $eq).Trim()
		$value = $line.Substring($eq + 1).Trim()
		if ($value.StartsWith('"') -and $value.EndsWith('"')) { $value = $value.Substring(1, $value.Length - 2) }
		if ([string]::IsNullOrWhiteSpace($value)) { return }
		if ($name -match '^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)$') {
			Add-VercelEnv $name $value
		}
	}
}

Write-Host 'Done.'
