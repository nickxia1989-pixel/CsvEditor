[CmdletBinding()]
param(
  [int]$Port = 5173
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeDir = Join-Path $ProjectRoot "artifacts"
$StatePath = Join-Path $RuntimeDir "csv-editor-server.json"
$Url = "http://127.0.0.1:$Port/"

function Write-Message {
  param([string]$Text)
  [Console]::Out.WriteLine($Text)
  [Console]::Out.Flush()
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

function Stop-ProcessTree {
  param([int]$ProcessId)

  $output = & taskkill.exe /PID $ProcessId /T /F 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw ($output -join [Environment]::NewLine)
  }
}

$pidToStop = $null
$state = $null
if (Test-Path -LiteralPath $StatePath) {
  try {
    $state = Get-Content -Raw -LiteralPath $StatePath | ConvertFrom-Json
    if (Test-SameProcess -ProcessId ([int]$state.pid) -StartedAt $state.processStartTime) {
      $pidToStop = [int]$state.pid
    }
  } catch {
    $state = $null
  }
}

if ($null -eq $pidToStop) {
  $ownerPid = Get-PortOwner
  if ($null -ne $ownerPid -and (Test-EditorResponse)) {
    $pidToStop = $ownerPid
    Write-Message "No tracked state found. Closing CSV editor process on port $Port."
  }
}

if ($null -eq $pidToStop) {
  Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
  Write-Message "CSV editor is not running."
  exit 0
}

Stop-ProcessTree -ProcessId $pidToStop
Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
Write-Message "CSV editor stopped."
