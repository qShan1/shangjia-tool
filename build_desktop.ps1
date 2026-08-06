$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $root 'venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw "venv not found: $python" }
& $python -m pip install pywebview pyinstaller
& $python -m PyInstaller --noconfirm --clean --onedir --windowed --name ShangjiaService Start.py
& $python -m PyInstaller --noconfirm --clean --onedir --windowed --name ShangjiaTool `
  --add-data "static;static" --add-binary "dist\ShangjiaService\ShangjiaService.exe;." desktop_launcher.py
Write-Host "Build output: $root\dist\ShangjiaTool"
