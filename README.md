# SHANGJIA TOOL

上架工具是面向闲鱼运营的本地管理台，提供账号管理、商品管理、订单处理、自动回复和运营记录能力。项目使用 FastAPI、SQLite 和 Playwright 构建，主要以 Windows 桌面端交付，也支持源码运行。

> 本项目是基于 [xianyu-auto-reply](https://github.com/zhinianboke/xianyu-auto-reply) 的二次开发，遵循 AGPL-3.0。请遵守适用法律、平台规则和上游许可证要求；不要提交或分享真实 Cookie、Token、订单、数据库或验证截图。

## 功能范围

- 多账号 Cookie 管理与状态查看
- 关键词和 AI 辅助回复
- 商品、订单、发货和运营记录管理
- 本地日志、健康检查和系统状态
- Windows 桌面端和源码运行

平台侧状态必须以实际响应为准。浏览器登录、缓存数据或本地开关不等同于平台接口可用。

## 快速开始

### Windows 桌面端

从源码构建后，双击 `dist\ShangjiaTool\ShangjiaTool.exe`。它会启动本地服务并打开管理台；用户数据保存在 `%LOCALAPPDATA%\ShangjiaTool\`，不会写入安装目录。

构建与故障排查见 [桌面端说明](docs/DESKTOP_INSTALL.md)。

### 源码运行

```powershell
git clone https://github.com/qShan1/shangjia-tool.git
cd shangjia-tool
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
python Start.py
```

管理台地址为 `http://127.0.0.1:8090/admin`，健康检查为 `http://127.0.0.1:8090/health`。

## 文档

| 文档 | 内容 |
| --- | --- |
| [项目结构](docs/PROJECT_STRUCTURE.md) | 目录职责与运行数据边界 |
| [桌面端说明](docs/DESKTOP_INSTALL.md) | 构建、启动、数据位置与诊断 |
| [部署说明](docs/deployment.md) | 源码运行与可选 Docker 部署 |
| [配置说明](docs/configuration.md) | 常用环境变量与配置文件 |
| [使用指南](docs/usage.md) | 管理台基础使用流程 |
| [常见问题](docs/faq.md) | 端口、浏览器、桌面端和数据问题 |

## 开发与发布

```powershell
pip install -r requirements-dev.txt
pytest -q
.\scripts\build_desktop.ps1
```

`data/`、`browser_data/`、`logs/`、`output/`、`static/uploads/` 和构建产物均为本地运行内容，已由 Git 忽略。发布前请检查 `git status` 和暂存区，确认不包含用户数据或凭证。

## 许可证

本项目使用 [GNU Affero General Public License v3.0](LICENSE)。保留上游版权和许可证声明，网络部署或再分发时请履行 AGPL-3.0 对应义务。
