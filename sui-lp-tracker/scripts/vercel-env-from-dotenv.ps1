# Upload non-empty .env entries to Vercel (production, preview, development).
# Usage: .\scripts\vercel-env-from-dotenv.ps1
# Does not print secret values.

param(
	[string]$EnvFile = (Join-Path (Join-Path $PSScriptRoot '..') '.env')
)

$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not (Test-Path $EnvFile)) {
	Write-Error ".env not found at $EnvFile"
}

Get-Content $EnvFile | ForEach-Object {
	$line = $_.Trim()
	if (-not $line -or $line.StartsWith('#')) { return }
	$eq = $line.IndexOf('=')
	if ($eq -lt 1) { return }
	$name = $line.Substring(0, $eq).Trim()
	$value = $line.Substring($eq + 1).Trim()
	if ($value.StartsWith('"') -and $value.EndsWith('"')) {
		$value = $value.Substring(1, $value.Length - 2)
	}
	if ([string]::IsNullOrWhiteSpace($value)) { return }

	Write-Host "Adding env: $name"
	foreach ($target in @('production', 'preview', 'development')) {
		$null = ($value | npx --yes vercel@latest env add $name $target --force 2>&1)
		if ($LASTEXITCODE -ne 0) {
			Write-Warning "Failed to add $name for $target (exit $LASTEXITCODE)"
		}
	}
}

Write-Host 'Done uploading env vars to Vercel.'
