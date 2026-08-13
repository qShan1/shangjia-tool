# 安装器使用说明

本目录是「上架工具」的 Windows 安装/卸载方案（基于 Inno Setup），替代原来的绿色解压包发布方式。

## 环境

- 需要安装 [Inno Setup](https://jrsoftware.org/isinfo.php)（6.x，官方或 Unicode 版均可）。

## 编译步骤

1. 用 Inno Setup 打开 `setup.iss`。
2. 在 `[Setup]` 段的 `SourceDir` 一行，将 `..\dist\ShangjiaTool` 改为你机器上实际的 dist 目录路径（该目录需包含 `ShangjiaTool.exe` 和 `_internal`）。
3. 选择「编译」（Build / Compile），生成安装程序 `output\setup.exe`。

## 产物

- `setup.exe`：安装程序，默认安装到 `Program Files\ShangjiaTool`，包含开始菜单与可选桌面快捷方式，安装后自动运行，并提供标准卸载入口。
