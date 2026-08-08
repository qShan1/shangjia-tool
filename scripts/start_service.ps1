$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$python = Join-Path $root 'venv\Scripts\python.exe'
$healthUrl = 'http://127.0.0.1:8090/health'

if (-not (Test-Path -LiteralPath $python)) {
    throw "Project Python environment not found: $python"
}

$listener = Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    Write-Host 'Service already running: http://127.0.0.1:8090/'
    exit 0
}

$startArgs = @('Start.py')
Start-Process -FilePath $python -ArgumentList $startArgs -WorkingDirectory $root -WindowStyle Hidden | Out-Null

for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            Write-Host 'Service started: http://127.0.0.1:8090/'
            exit 0
        }
    }
    catch {
        # The API may need a few seconds to start listening.
    }
}

throw 'Service did not start within 30 seconds. Check the logs directory.'
