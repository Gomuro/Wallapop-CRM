# Daily pg_dump via ops CLI. Run once on the Windows VPS after git pull + npm install.
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$node = (Get-Command node).Source
$tsx = Join-Path $repo "node_modules\tsx\dist\cli.mjs"
$cli = Join-Path $repo "server\ops\cli.ts"
if (-not (Test-Path $tsx)) { throw "tsx missing under $repo (npm install first)." }

$wrapper = Join-Path $repo "server\ops\run-backup.cmd"
$log = Join-Path $repo "server\logs\backup.log"
@(
  "@echo off"
  "cd /d `"$repo`""
  "`"$node`" `"$tsx`" `"$cli`" backup >> `"$log`" 2>&1"
) | Set-Content -Path $wrapper -Encoding ASCII

$task = "WallapopCRM-Backup"
schtasks /Create /TN $task /SC DAILY /ST 03:15 /RU SYSTEM /NP /RL HIGHEST /F /TR "`"$wrapper`"" | Out-Host
Write-Host "Registered $task -> $wrapper"
