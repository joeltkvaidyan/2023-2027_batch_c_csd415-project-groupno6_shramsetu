# ShramSetu - one-command dev launcher (Windows PowerShell)
# Starts all four services, skipping any that are already running.
# Logs go to shramsetu/logs/ (gitignored). Run .\stop-all.ps1 to stop everything.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File start-all.ps1
#
# Waits for READINESS, not just an open port: the AI service answers 503 on
# /health/ready until its models finish loading, and the script prints which one
# it is still waiting on instead of returning while the chatbot cannot answer.
#
# NOTE: keep this file pure ASCII. PowerShell 5.1 reads BOM-less scripts
# as ANSI, so any em dash / smart quote corrupts string parsing.

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot           # ...\shramsetu
$Logs = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

function Get-PortPid([int]$Port) {
  $line = netstat -ano | Select-String -Pattern "[:.]$Port\s" |
          Select-String "LISTENING" | Select-Object -First 1
  if (-not $line) { return $null }
  $parts = ($line.ToString() -split "\s+") | Where-Object { $_ }
  $ownerPid = $parts[-1]
  if ($ownerPid -match '^\d+$') { return [int]$ownerPid }
  return $null
}

function Get-HttpCode([string]$Url, [int]$TimeoutSec = 3) {
  # curl.exe for every probe: it handles the self-signed :5443 cert with the
  # same code path as plain http, and returns 000 when nothing is listening
  # (so "not up yet" and "up but not ready" stay distinguishable).
  $code = & curl.exe -sk -o NUL -w "%{http_code}" --max-time $TimeoutSec $Url 2>$null
  if ("$code" -match '^\d{3}$') { return [int]$code }
  return 0
}

function Get-Json([string]$Url, [int]$TimeoutSec = 3) {
  try {
    return (& curl.exe -sk --max-time $TimeoutSec $Url 2>$null) -join ""
  } catch { return "" }
}

# Starts a detached process; stdout and stderr MUST go to different files
# (PowerShell requirement). Returns the new PID.
function Start-Detached([string]$Exe, [string[]]$ProcArgs, [string]$WorkDir, [string]$OutLog, [string]$ErrLog) {
  $p = Start-Process -FilePath $Exe -ArgumentList $ProcArgs -WorkingDirectory $WorkDir `
       -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog `
       -WindowStyle Hidden -PassThru
  return $p.Id
}

$started = 0
$already = 0

# -- 1. Node API (:8000) ------------------------------------------------
if (Get-PortPid 8000) {
  Write-Host "[skip] API      :8000 already running (pid $(Get-PortPid 8000))"
  $already++
} else {
  Write-Host "[start] API      :8000 ..."
  # Dev-only switches live HERE (and in server/.env.example), not in the app's
  # defaults: a deploy that forgets a variable must run safe, while this local
  # launcher still gets demo seeding and terminal OTP delivery. dotenv never
  # overrides values already in the environment, so these win over .env.
  $env:ENV = "development"
  $env:SEED_DEMO_DATA = "true"
  $env:OTP_ECHO_ENABLED = "true"
  $env:DEBUG = "true"
  Start-Detached "node.exe" @("src/index.js") (Join-Path $Root "server") `
    (Join-Path $Logs "server.log") (Join-Path $Logs "server.err.log") | Out-Null
  Remove-Item Env:ENV, Env:SEED_DEMO_DATA, Env:OTP_ECHO_ENABLED, Env:DEBUG -ErrorAction SilentlyContinue
  $started++
}

# -- 2. AI service (:8100) ----------------------------------------------
if (Get-PortPid 8100) {
  Write-Host "[skip] AI       :8100 already running (pid $(Get-PortPid 8100))"
  $already++
} else {
  Write-Host "[start] AI       :8100 ..."
  Start-Detached (Join-Path $Root "ai-service\venv\Scripts\python.exe") `
    @("-m","uvicorn","main:app","--host","127.0.0.1","--port","8100") `
    (Join-Path $Root "ai-service") `
    (Join-Path $Logs "ai.log") (Join-Path $Logs "ai.err.log") | Out-Null
  $started++
}

# -- 3. Frontend HTTP preview (:5199) ------------------------------------
if (Get-PortPid 5199) {
  Write-Host "[skip] Frontend :5199 already running (pid $(Get-PortPid 5199))"
  $already++
} else {
  Write-Host "[start] Frontend :5199 (HTTP) ..."
  $env:SHRAM_HTTPS = "off"
  Start-Detached "npm.cmd" @("run","dev","--","--port","5199","--host","127.0.0.1","--strictPort") `
    (Join-Path $Root "frontend") `
    (Join-Path $Logs "vite-http.log") (Join-Path $Logs "vite-http.err.log") | Out-Null
  Remove-Item Env:SHRAM_HTTPS -ErrorAction SilentlyContinue
  $started++
}

# -- 4. Frontend HTTPS for phones (:5443) --------------------------------
if (Get-PortPid 5443) {
  Write-Host "[skip] Frontend :5443 already running (pid $(Get-PortPid 5443))"
  $already++
} else {
  Write-Host "[start] Frontend :5443 (HTTPS, phones) ..."
  Start-Detached "npm.cmd" @("run","dev","--","--port","5443","--host","0.0.0.0","--strictPort") `
    (Join-Path $Root "frontend") `
    (Join-Path $Logs "vite-https.log") (Join-Path $Logs "vite-https.err.log") | Out-Null
  $started++
}

# -- Readiness checks ------------------------------------------------------
# This waits for the AI service to be READY, not merely LISTENING. The port
# opens before the embedding model and FAISS index finish loading, and asking
# the chatbot before then is what used to hang the first question after a
# restart until the Node proxy aborted it at 120s. The AI service reports this
# honestly on /health/ready (503 = still warming, 200 = it can answer).
Write-Host ""
Write-Host "Waiting for services (the AI service is ready only after its models load) ..."
$checks = @(
  @{ Name = "API      :8000"; Url = "http://127.0.0.1:8000/health";      Max = 90;  Port = 8000 },
  @{ Name = "AI       :8100"; Url = "http://127.0.0.1:8100/health/ready"; Max = 240; Port = 8100 },
  @{ Name = "Frontend :5199"; Url = "http://127.0.0.1:5199/";           Max = 90;  Port = 5199 },
  @{ Name = "HTTPS    :5443"; Url = "https://127.0.0.1:5443/";          Max = 90;  Port = 5443 }
)
$ok = @{}
$warm = @{}
$deadline = @{}
foreach ($c in $checks) {
  $ok[$c.Name] = $false
  $warm[$c.Name] = $false
  $deadline[$c.Name] = (Get-Date).AddSeconds($c.Max)
}
$lastState = ""

while ($true) {
  $now = Get-Date
  $pending = @($checks | Where-Object { -not $ok[$_.Name] -and $now -lt $deadline[$_.Name] })
  if ($pending.Count -eq 0) { break }

  foreach ($c in $pending) {
    $code = Get-HttpCode $c.Url
    if ($code -ge 200 -and $code -lt 300) { $ok[$c.Name] = $true; continue }

    if ($c.Port -eq 8100) {
      if (Get-PortPid 8100) {
        # Listening but not ready: report WHICH model is still loading, so a
        # 60s wait does not look like a hang.
        $body = Get-Json $c.Url
        $state = if ($body -match '"state"\s*:\s*"([a-z]+)"') { $Matches[1] } else { "http $code" }
        $loading = if ($body -match '"warming"\s*:\s*\[([^\]]*)\]') { $Matches[1].Trim() } else { "" }
        $warm[$c.Name] = $true
        $line = "  ... AI :8100 $state"
        if ($loading -and $loading -ne " ") { $line += " (loading: $loading)" }
        if ($line -ne $lastState) { Write-Host $line; $lastState = $line }
      } elseif (((Get-Date) - $deadline[$c.Name]).TotalSeconds -lt -30) {
        # No process on :8100 at all - fail fast rather than burn the full wait
        # on a service that is not coming.
        Write-Host "  ... AI :8100 never opened a port - giving up"
        $ok[$c.Name] = $false
        $deadline[$c.Name] = Get-Date
      }
    }
  }
  Start-Sleep -Seconds 2
}

Write-Host ""
$failed = 0
foreach ($c in $checks) {
  if ($ok[$c.Name]) {
    Write-Host "[OK]   $($c.Name)"
  } elseif ($c.Port -eq 8100 -and $warm[$c.Name]) {
    Write-Host "[WARM] $($c.Name)  - still loading models. The app runs, but the chatbot will answer 'starting up' for another minute. Watch shramsetu\logs\ai.log"
    $failed++
  } else {
    Write-Host "[FAIL] $($c.Name)  - check shramsetu\logs\"
    $failed++
  }
}

Write-Host ""
Write-Host "Desktop:  http://127.0.0.1:5199"
Write-Host "Phone:    https://192.168.1.70:5443   (accept the self-signed cert warning once; mic needs HTTPS)"
Write-Host "Gov login: ADMIN001 / Admin@123    Worker login: 9555500101..110 / Worker@123 or OTP"
if ($failed -gt 0) { exit 1 }
