[CmdletBinding()]
param(
  [int]$Port = 5173,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeDir = Join-Path $ProjectRoot "artifacts"
$StatePath = Join-Path $RuntimeDir "csv-editor-server.json"
$LogPath = Join-Path $ProjectRoot "dev-server.log"
$ErrPath = Join-Path $ProjectRoot "dev-server.err"
$Url = "http://127.0.0.1:$Port/"

function Write-Message {
  param([string]$Text)
  [Console]::Out.WriteLine($Text)
  [Console]::Out.Flush()
}

function ConvertTo-QuotedPowerShellString {
  param([string]$Text)
  return "'" + ($Text -replace "'", "''") + "'"
}

function Get-ServerState {
  if (!(Test-Path -LiteralPath $StatePath)) {
    return $null
  }

  try {
    return Get-Content -Raw -LiteralPath $StatePath | ConvertFrom-Json
  } catch {
    Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    return $null
  }
}

function Test-SameProcess {
  param(
    [int]$ProcessId,
    [string]$StartedAt
  )

  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    if ([string]::IsNullOrWhiteSpace($StartedAt)) {
      return $true
    }

    $stored = ([datetime]$StartedAt).ToUniversalTime()
    $actual = $process.StartTime.ToUniversalTime()
    return [Math]::Abs(($actual - $stored).TotalSeconds) -lt 2
  } catch {
    return $false
  }
}

function Get-PortOwner {
  try {
    $connection = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction Stop |
      Select-Object -First 1
    if ($null -eq $connection) {
      return $null
    }
    return [int]$connection.OwningProcess
  } catch {
    return $null
  }
}

function Test-EditorResponse {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    return $response.Content -match "CSV Workspace Editor"
  } catch {
    return $false
  }
}

function Save-State {
  param(
    [int]$ProcessId,
    [bool]$Adopted = $false
  )

  New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
  $process = Get-Process -Id $ProcessId -ErrorAction Stop
  [pscustomobject]@{
    pid = $ProcessId
    processStartTime = $process.StartTime.ToUniversalTime().ToString("o")
    port = $Port
    url = $Url
    adopted = $Adopted
    log = $LogPath
    err = $ErrPath
  } | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
}

function Open-Editor {
  if (!$NoBrowser) {
    Start-Process $Url
  }
}

$state = Get-ServerState
if ($null -ne $state -and (Test-SameProcess -ProcessId ([int]$state.pid) -StartedAt $state.processStartTime)) {
  Write-Message "CSV editor is already running: $($state.url)"
  Open-Editor
  exit 0
}

if ($null -ne $state) {
  Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
}

$ownerPid = Get-PortOwner
if ($null -ne $ownerPid) {
  if (Test-EditorResponse) {
    Save-State -ProcessId $ownerPid -Adopted $true
    Write-Message "CSV editor is already available: $Url"
    Write-Message "Adopted existing server process $ownerPid for stop-editor."
    Open-Editor
    exit 0
  }

  throw "Port $Port is already in use by process $ownerPid. Close it or start with -Port <anotherPort>."
}

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
if (!(Test-Path -LiteralPath (Join-Path $ProjectRoot "node_modules"))) {
  Write-Message "node_modules not found. Running npm install..."
  & $npm install
}

New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
Set-Content -LiteralPath $LogPath -Value "" -Encoding UTF8
Set-Content -LiteralPath $ErrPath -Value "" -Encoding UTF8

Write-Message "Starting CSV editor at $Url ..."

$arguments = @("run", "dev", "--", "--port", "$Port", "--strictPort")
$childCommand = @(
  "Set-Location -LiteralPath $(ConvertTo-QuotedPowerShellString $ProjectRoot)"
  "& $(ConvertTo-QuotedPowerShellString $npm) $($arguments -join ' ') > $(ConvertTo-QuotedPowerShellString $LogPath) 2> $(ConvertTo-QuotedPowerShellString $ErrPath)"
) -join [Environment]::NewLine
$encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childCommand))
$server = Start-Process -FilePath "powershell.exe" `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encodedCommand) `
  -WindowStyle Hidden `
  -PassThru

Save-State -ProcessId $server.Id

$deadline = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $deadline) {
  if ($server.HasExited) {
    $errTail = ""
    if (Test-Path -LiteralPath $ErrPath) {
      $errTail = (Get-Content -LiteralPath $ErrPath -Tail 20) -join [Environment]::NewLine
    }
    Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    throw "CSV editor server exited early. $errTail"
  }

  if (Test-EditorResponse) {
    Write-Message "CSV editor started: $Url"
    Write-Message "Logs: $LogPath"
    Open-Editor
    exit 0
  }

  Start-Sleep -Milliseconds 500
}

Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
throw "Timed out waiting for CSV editor at $Url. See $LogPath and $ErrPath."
