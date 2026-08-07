param(
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
$dist = if ($OutputDirectory) { [System.IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $root 'dist' }
$python = Join-Path $root 'venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    $python = (Get-Command python).Source
    if (-not $python) { throw "Python not found" }
}
Write-Host "Using Python: $python"
& $python -m pip install --upgrade pywebview pyinstaller

# 第一步：构建 ShangjiaService（onefile 模式，打包静态资源和配置）
Write-Host "Building ShangjiaService (onefile)..."
& $python -m PyInstaller --noconfirm --clean --distpath $dist ShangjiaService.spec
if ($LASTEXITCODE -ne 0) { throw "ShangjiaService build failed" }
$service = Join-Path $dist 'ShangjiaService.exe'
if (-not (Test-Path $service)) {
    throw "ShangjiaService.exe build failed"
}

# 第二步：构建 ShangjiaTool（onedir 模式，嵌入 ShangjiaService.exe）
Write-Host "Building ShangjiaTool (onedir)..."
$env:SHANGJIA_SERVICE_EXE = $service
& $python -m PyInstaller --noconfirm --clean --distpath $dist ShangjiaTool.spec
Remove-Item Env:SHANGJIA_SERVICE_EXE -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0) { throw "ShangjiaTool build failed" }
if (-not (Test-Path (Join-Path $dist 'ShangjiaTool\ShangjiaTool.exe'))) {
    throw "ShangjiaTool.exe build failed"
}
if (-not (Test-Path (Join-Path $dist 'ShangjiaTool\_internal\ShangjiaService.exe'))) {
    throw "Embedded ShangjiaService.exe is missing from the desktop bundle"
}

Write-Host ""
Write-Host "Build complete!"
Write-Host "  Desktop launcher: $dist\ShangjiaTool\ShangjiaTool.exe"
Write-Host "  Background service (embedded): $dist\ShangjiaTool\_internal\ShangjiaService.exe"
Write-Host ""
Write-Host "To run: double-click dist\ShangjiaTool\ShangjiaTool.exe"
