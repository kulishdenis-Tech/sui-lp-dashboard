param(
	[string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path -LiteralPath $Root).Path
Set-Location $Root

$Tracker = Join-Path $Root 'sui-lp-tracker'
$Auto = Join-Path $Root 'sui-lp-autopilot'
$BotDir = Join-Path $Auto 'packages\bot'
$DbFile = Join-Path $BotDir 'data\autopilot.db.json'
$LogDir = Join-Path $Root '_local\logs'
$Port = 5180
$ApiPort = 5191
$Url = "http://localhost:$Port/"
$Marker = 'Projects\SUI Dashboard'

function Write-ReleaseTagWarning {
	try {
		$head = (git rev-parse HEAD 2>$null)
		$tag = (git tag -l 'v2.0.*' --sort=-v:refname | Select-Object -First 1)
		if (-not $tag) { return }
		$tagged = (git rev-parse "$tag^{commit}" 2>$null)
		if ($head -and $tagged -and $head.Trim() -ne $tagged.Trim()) {
			Write-Host "Увага: git HEAD не збігається з останнім тегом $tag."
		}
	} catch {
		return
	}
}

Write-ReleaseTagWarning

function Fail([string]$Message) {
	Write-Host ""
	Write-Host "ERROR: $Message" -ForegroundColor Red
	exit 1
}

function Get-OurNode([string]$Needle) {
	# Get-NetTCPConnection on this machine often returns no listeners even while
	# the port answers. Match our own node.exe by command line instead.
	Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
		Where-Object {
			$_.CommandLine -and
			$_.CommandLine -like "*$Marker*" -and
			$_.CommandLine -like "*$Needle*"
		} |
		Select-Object -First 1
}

function Test-HttpUp([string]$Uri) {
	try {
		$res = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 3
		return ($res.StatusCode -ge 200 -and $res.StatusCode -lt 500)
	} catch {
		return $false
	}
}

function Start-HiddenNode {
	param(
		[Parameter(Mandatory = $true)][string]$NodeExe,
		[Parameter(Mandatory = $true)][string[]]$ArgumentList,
		[Parameter(Mandatory = $true)][string]$WorkingDirectory,
		[Parameter(Mandatory = $true)][string]$StdoutPath,
		[Parameter(Mandatory = $true)][string]$StderrPath
	)
	# Windows PowerShell 5.1 does not quote ArgumentList items. Pre-quote paths
	# that contain spaces so "SUI Dashboard" stays one argv entry.
	$quoted = foreach ($arg in $ArgumentList) {
		if ($arg -match '[\s"]') { '"' + ($arg -replace '"', '\"') + '"' } else { $arg }
	}
	Start-Process -FilePath $NodeExe -ArgumentList $quoted -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath | Out-Null
}

function Wait-Http([string]$Uri, [int]$Seconds) {
	$deadline = (Get-Date).AddSeconds($Seconds)
	while ((Get-Date) -lt $deadline) {
		try {
			$res = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 3
			if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 500) { return $true }
		} catch {
			# keep polling until the listener answers
		}
		Start-Sleep -Seconds 1
	}
	return $false
}

function Test-AutopilotDistStale {
	$dist = Join-Path $BotDir 'dist\main.js'
	if (-not (Test-Path $dist)) { return $true }
	$distTime = (Get-Item $dist).LastWriteTimeUtc
	$srcRoots = @(
		(Join-Path $Auto 'packages\engine\src'),
		(Join-Path $Auto 'packages\cetus\src'),
		(Join-Path $Auto 'packages\db\src'),
		(Join-Path $Auto 'packages\bot\src')
	)
	foreach ($dir in $srcRoots) {
		if (-not (Test-Path $dir)) { continue }
		$newer = Get-ChildItem $dir -Recurse -File -Filter *.ts |
			Where-Object { $_.LastWriteTimeUtc -gt $distTime } |
			Select-Object -First 1
		if ($newer) { return $true }
	}
	return $false
}

if (-not (Test-Path (Join-Path $Tracker 'package.json'))) {
	Fail "Не знайдено sui-lp-tracker\package.json у $Root"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
	Fail 'npm не знайдено в PATH.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
	Fail 'node не знайдено в PATH.'
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $DbFile) | Out-Null

if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
	Write-Host 'Встановлюю залежності (npm install)...'
	& npm install
	if ($LASTEXITCODE -ne 0) { Fail "npm install завершився з кодом $LASTEXITCODE" }
}

$ourVite = Get-OurNode 'vite.js'
$ourBot = Get-OurNode 'dist\main.js'
$botUrl = "http://127.0.0.1:${ApiPort}/api/auto-withdraw/status"

if (-not $ourVite -and (Test-HttpUp $Url)) {
	Fail "Порт $Port уже відповідає, але це не Vite з цієї папки. Процес не зупинено."
}
if (-not $ourBot -and (Test-HttpUp $botUrl)) {
	Fail "Порт $ApiPort уже відповідає, але це не бот цієї папки. Другий бот не запущено."
}

$env:DATABASE_URL = "file:$DbFile"
$env:AUTOPILOT_MODE = 'MONITOR_ONLY'
$env:API_PORT = "$ApiPort"

if (-not $ourBot) {
	if (Test-AutopilotDistStale) {
		Write-Host 'Збираю autopilot (engine → cetus → db → bot). Старий dist не використовується.'
		& npm run build:autopilot
		if ($LASTEXITCODE -ne 0) { Fail "Збірка autopilot завершилася з кодом $LASTEXITCODE" }
		if (-not (Test-Path (Join-Path $BotDir 'dist\main.js'))) {
			Fail 'Після збірки немає packages\bot\dist\main.js'
		}
	} else {
		Write-Host 'dist бота новіший за source — перезбірка не потрібна.'
	}

	$node = (Get-Command node).Source
	$botMain = Join-Path $BotDir 'dist\main.js'
	$botOut = Join-Path $LogDir 'bot-5191.log'
	$botErr = Join-Path $LogDir 'bot-5191.err.log'
	Write-Host "Запускаю бота на 127.0.0.1:$ApiPort (MONITOR_ONLY, без вікна)."
	Start-HiddenNode -NodeExe $node -ArgumentList @($botMain) -WorkingDirectory $BotDir -StdoutPath $botOut -StderrPath $botErr
	if (-not (Wait-Http $botUrl 45)) {
		$tail = ''
		if (Test-Path $botErr) { $tail = (Get-Content $botErr -Tail 30) -join "`n" }
		Fail "Бот не відповів на http://127.0.0.1:$ApiPort/api/auto-withdraw/status за 45 с.`n$tail"
	}
	Write-Host "Бот готовий: http://127.0.0.1:$ApiPort/"
} else {
	Write-Host "Бот цієї збірки вже працює (PID $($ourBot.ProcessId)) — другий екземпляр не запускаю."
	if (-not (Test-HttpUp $botUrl)) {
		Fail "Процес бота є, але $botUrl не відповідає."
	}
}

if (-not $ourVite) {
	$node = (Get-Command node).Source
	$vite = Join-Path $Root 'node_modules\vite\bin\vite.js'
	if (-not (Test-Path $vite)) {
		$vite = Join-Path $Tracker 'node_modules\vite\bin\vite.js'
	}
	if (-not (Test-Path $vite)) { Fail "Не знайдено vite.js. Запустіть npm install у $Root" }
	$viteOut = Join-Path $LogDir 'vite-5180.log'
	$viteErr = Join-Path $LogDir 'vite-5180.err.log'
	Write-Host "Запускаю tracker на $Url (без вікна)."
	Start-HiddenNode -NodeExe $node -ArgumentList @($vite, '--host', '--port', "$Port", '--strictPort') -WorkingDirectory $Tracker -StdoutPath $viteOut -StderrPath $viteErr
	if (-not (Wait-Http $Url 60)) {
		$tail = ''
		if (Test-Path $viteErr) { $tail = (Get-Content $viteErr -Tail 40) -join "`n" }
		Fail "Tracker не відповів на $Url за 60 с.`n$tail"
	}
	Write-Host "Tracker готовий: $Url"
} else {
	Write-Host "Tracker цієї збірки вже працює (PID $($ourVite.ProcessId))."
	if (-not (Test-HttpUp $Url)) {
		Fail "Процес Vite є, але $Url не відповідає."
	}
}

Start-Process $Url
Write-Host ""
Write-Host "SUI Dashboard 2.0.16 відкрито: $Url"
Write-Host "Бот: http://127.0.0.1:$ApiPort/  режим MONITOR_ONLY"
Write-Host "База: $DbFile"
exit 0
