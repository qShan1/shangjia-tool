# bump_version.ps1 - 统一版本发布脚本
#
# 用法:
#   .\scripts\bump_version.ps1                              # patch 升号 v2.2.3 -> v2.2.4，不使用 -Changelog 时不写更新日志
#   .\scripts\bump_version.ps1 -Changelog "🎉1.发布 v2.2.3：..." , "🔧2...."
#   .\scripts\bump_version.ps1 -TargetVersion v2.2.3 -Changelog @("🎉1.发布 v2.2.3：...")
#   .\scripts\bump_version.ps1 -DryRun -Changelog "🎉1.发布 v2.3.0：..."
#   .\scripts\bump_version.ps1 -NormalizeLogOnly             # 仅规范化 update_log.txt 历史格式
#
# 同步文件:
#   - static/version.txt
#   - static/css/app.css   （12 处 @import ?v=）
#   - static/index.html    （2 处资源 ?v=，含 chart.js 本地引用）
#   - static/update_log.txt（顶部插入新版本日志，格式与现状一致）

param(
    [string]$TargetVersion = '',
    [string[]]$Changelog = @(),
    [switch]$DryRun,
    [switch]$NormalizeLogOnly
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$versionFile = Join-Path $root 'static\version.txt'
$appCssFile = Join-Path $root 'static\css\app.css'
$indexHtmlFile = Join-Path $root 'static\index.html'
$updateLogFile = Join-Path $root 'static\update_log.txt'

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-Utf8([string]$path) {
    return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8([string]$path, [string]$content) {
    [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function Get-NewVersion([string]$current, [string]$target) {
    if ($target) {
        if ($target -notmatch '^v\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$') {
            throw "TargetVersion 格式不正确: $target (应为 vX.Y.Z 或 vX.Y.Z-xxx)"
        }
        return $target
    }
    if ($current -notmatch '^v(\d+)\.(\d+)\.(\d+)(-[A-Za-z0-9.]+)?$') {
        throw "无法解析当前版本号: $current"
    }
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    $patch = [int]$Matches[3]
    $suffix = $Matches[4]
    if ($suffix) {
        # 测试版 -> 正式版（去后缀）
        return "v$major.$minor.$patch"
    }
    return "v$major.$minor.$($patch + 1)"
}

function Get-NormalizedLogLine([string]$line) {
    $l = $line.Trim()
    if (-not $l) { return $l }
    # 去掉历史遗留包装: '内容',  / 单引号包裹 + 尾部逗号
    if ($l.StartsWith("'") -and $l.EndsWith("',")) {
        $l = $l.Substring(1, $l.Length - 3).TrimEnd()
    }
    elseif ($l.StartsWith("'") -and $l.EndsWith("'")) {
        $l = $l.Substring(1, $l.Length - 2)
    }
    elseif ($l.EndsWith("' ,")) {
        $l = $l.Substring(0, $l.Length - 3).TrimEnd()
    }
    elseif ($l.StartsWith("'") -and $l.EndsWith("；") -and $l.IndexOf("'", 1) -lt 0) {
        # 仅包裹在开头、结尾为中文分号的残留引号
        $l = $l.Substring(1).TrimStart()
    }
    elseif ($l.EndsWith(",")) {
        $l = $l.Substring(0, $l.Length - 1).TrimEnd()
    }
    return $l
}

function New-LogEntry([string]$newVersion, [string[]]$items) {
    if (-not $items) {
        return "🎉1.发布 $newVersion：更新说明；"
    }
    $lines = @()
    for ($i = 0; $i -lt $items.Count; $i++) {
        $text = (Get-NormalizedLogLine $items[$i]).TrimEnd(';', '；', ' ')
        $text = $text.Trim()
        $sep = if ($i -lt $items.Count - 1) { '；' } else { '。' }
        $lines += "$text$sep"
    }
    return $lines
}

function Replace-InFiles([string]$old, [string]$new, [string[]]$files) {
    foreach ($f in $files) {
        $content = Read-Utf8 $f
        $count = ([regex]::Matches($content, [regex]::Escape($old))).Count
        if ($count -gt 0) {
            $content = $content.Replace($old, $new)
            if (-not $DryRun) {
                Write-Utf8 $f $content
            }
            Write-Host ("  {0,-28} {1}x  {2} -> {3}" -f (Split-Path $f -Leaf), $count, $old, $new)
        }
    }
}

Write-Host "项目目录: $root"

if ($NormalizeLogOnly) {
    Write-Host "规范化 update_log.txt ..."
    $rawLines = (Read-Utf8 $updateLogFile) -split "`r?`n"
    $clean = @()
    $prevBlank = $false
    foreach ($line in $rawLines) {
        $l = Get-NormalizedLogLine $line
        if (-not $l) {
            if (-not $prevBlank) { $clean += '' }
            $prevBlank = $true
            continue
        }
        $clean += $l
        $prevBlank = $false
    }
    while ($clean.Count -gt 0 -and $clean[-1] -eq '') { $clean = $clean[0..($clean.Count - 2)] }
    if (-not $DryRun) {
        Write-Utf8 $updateLogFile (($clean -join "`r`n") + "`r`n")
    }
    Write-Host "  update_log.txt 规范化完成（$($clean.Count) 行）"
    exit 0
}

$oldVersion = (Read-Utf8 $versionFile).Trim()
$newVersion = Get-NewVersion $oldVersion $TargetVersion
Write-Host "版本号: $oldVersion -> $newVersion"

# 1. version.txt
if (-not $DryRun) {
    Write-Utf8 $versionFile $newVersion
}
Write-Host ("  {0,-28} {1} -> {2}" -f 'version.txt', $oldVersion, $newVersion)

# 2. app.css / index.html 内的 ?v= 缓存版本号
function Get-VersionNumber([string]$tagVersion) {
    # v2.2.3 -> 2.2.3（?v= 缓存号只取数字部分）；支持 -beta 后缀
    $n = $tagVersion
    if ($n -match '^v?(\d+\.\d+\.\d+)(-[A-Za-z0-9.]+)?$') { $n = $Matches[1] }
    return $n
}

$oldNoSuffix = Get-VersionNumber $oldVersion
$newNoSuffix = Get-VersionNumber $newVersion

if ($oldNoSuffix -ne $newNoSuffix) {
    Replace-InFiles "?v=$oldNoSuffix" "?v=$newNoSuffix" @($appCssFile, $indexHtmlFile)
}
if ($oldVersion -ne $oldNoSuffix -and $oldVersion -ne $newVersion) {
    Replace-InFiles "?v=$oldVersion" "?v=$newNoSuffix" @($appCssFile, $indexHtmlFile)
}

# 3. update_log.txt 顶部插入新条目
$entry = New-LogEntry $newVersion $Changelog
if ($Changelog -or $DryRun) {
    $logContent = Read-Utf8 $updateLogFile
    $block = ($entry -join "`r`n")
    $newLog = "$block`r`n`r`n" + $logContent.TrimStart("`r", "`n", ' ', "`t")
    if (-not $DryRun) {
        Write-Utf8 $updateLogFile $newLog
    }
    Write-Host "  update_log.txt 顶部插入 $($entry.Count) 行"
}

Write-Host ""
Write-Host "完成。当前版本: $newVersion"
if ($DryRun) { Write-Host "(DryRun 模式，未写入任何文件)" }