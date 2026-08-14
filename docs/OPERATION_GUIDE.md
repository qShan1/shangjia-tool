# 上架工具 操作手册

面向个人自用（单用户本地安装、管理端仅本人）。覆盖：日常开发、提交推送、本地打包、发布新版本、手机远程调用配置。

---

## 1. 项目位置与目录约定

- **项目目录**：`E:\AXianYu\shangjia-tool`（所有代码改动都在这）
- **协作记录**：`E:\Agent\OpenCode\XianyyuShangjia`（PROGRESS.md 等记录文件，非项目代码）
- **运行数据**：桌面版启动后写 `%LOCALAPPDATA%\ShangjiaTool\`（数据库/日志/上传），不写安装目录

| 关键文件 | 作用 |
|---|---|
| `desktop_launcher.py` | 桌面启动器（pywebview + 托盘 + 更新检查 + 单实例） |
| `shangjia_tool/reply_server.py` | FastAPI 服务（约 1.8 万行，全部 API） |
| `shangjia_tool/db_manager.py` | SQLite 数据层（全局单连接 + RLock） |
| `Start.py` | 源码模式服务入口 |
| `ShangjiaService.spec` / `ShangjiaTool.spec` | PyInstaller 打包配置（onedir） |
| `scripts/build_desktop.ps1` | 一键打包脚本 |
| `installer/setup.iss` | Inno Setup 安装器脚本 |
| `update-manifest.json` | 桌面整包更新清单（GitHub raw） |
| `.github/workflows/auto-release.yml` | 手动触发式自动发版（workflow_dispatch） |

---

## 2. 日常开发流程

```powershell
cd E:\AXianYu\shangjia-tool

# 1) 改代码（前端 static/js、static/index.html；后端 shangjia_tool/、utils/）
# 2) 语法校验（改完必做，不跑完整测试）
python -c "import ast; [ast.parse(open(p,encoding='utf-8').read()) for p in ['desktop_launcher.py','shangjia_tool/reply_server.py']]; print('py OK')"
node --check static/js/app.orders.js
git diff --check

# 3) 提交推送
git add -A
git commit -m "fix: 改动说明"
git push origin main
```

> 规则：改完即推。不要在代码目录改动 `E:\Agent\OpenCode\XianyyuShangjia` 里的文件。
> 除非用户明确要求，不打包、不发布、不提交未确认范围的历史遗留变更。

---

## 3. 本地打包（生成分发包）

### 3.1 前置条件

- 已激活 venv，已安装 `pyinstaller pywebview pystray`
- **确保没有正在运行的 ShangjiaTool / ShangjiaService 进程**（否则打包时会因文件被占用失败）：

```powershell
Get-Process | Where-Object { $_.ProcessName -match "Shangjia" }
Stop-Process -Name ShangjiaTool, ShangjiaService -Force -ErrorAction SilentlyContinue
```

### 3.2 执行打包

```powershell
cd E:\AXianYu\shangjia-tool
.\scripts\build_desktop.ps1
```

脚本做了两步：
1. `ShangjiaService`（onefile，打包全部后端 + 静态资源）→ `dist\ShangjiaService.exe`
2. `ShangjiaTool`（onedir，嵌入 ShangjiaService.exe）→ `dist\ShangjiaTool\`

> 若 `build_desktop.ps1` 因 pip 的 stderr 输出中断（NativeCommandError），依赖已就绪时可跳过 pip 直接手动构建：
> ```powershell
> $env:SHANGJIA_SERVICE_EXE = "$PWD\dist\ShangjiaService.exe"
> .\venv\Scripts\python.exe -m PyInstaller --noconfirm --clean --distpath .\dist ShangjiaTool.spec
> ```

### 3.3 压缩发布 zip

```powershell
$ver = (Get-Content .\static\version.txt).Trim()
Compress-Archive -Path .\dist\ShangjiaTool -DestinationPath ".\dist\ShangjiaTool-$ver-windows-x64.zip" -CompressionLevel Optimal
```

产物：`dist\ShangjiaTool-v<版本>-windows-x64.zip`（约 130MB）。

### 3.4 验证

- `dist\ShangjiaTool\ShangjiaTool.exe` 存在且可双击启动
- `dist\ShangjiaTool\_internal\ShangjiaService.exe` 存在
- `dist\ShangjiaTool\_internal\static\version.txt` 存在且版本号正确
- 首次启动确认：加载页 → 管理台打开、无 403 闪烁、`/health` 返回 healthy

---

## 4. 发布新版本（整包更新 + 热更新）

### 4.1 版本号规则

- 版本号写在 `static/version.txt`，格式 `v1.0.3`
- 有功能/修复改动就升版本（`v1.0.3 → v1.0.4`），用脚本改：

```powershell
.\scripts\bump_version.ps1   # 查看用法，通常需要传目标版本
```

改版本号时同步确认：`installer/setup.iss` 里的 `AppVersion`/`AppVerName`/`UninstallDisplayName`。

### 4.2 发布前预检

```powershell
python release_precheck.py
```

输出"可以直接发版"再继续；有"阻塞"项先处理（常见：版本号未升但文件有改动）。

### 4.3 桌面整包更新清单（update-manifest.json）

发布前手动更新仓库根目录 `update-manifest.json`：

```json
{
  "latest": "v1.0.4",
  "name": "ShangjiaTool-v1.0.4-windows-x64.zip",
  "zip_url": "https://github.com/qShan1/shangjia-tool/releases/download/v1.0.4/ShangjiaTool-v1.0.4-windows-x64.zip",
  "mirrors": [
    "https://gh-proxy.com/https://github.com/qShan1/shangjia-tool/releases/download/v1.0.4/ShangjiaTool-v1.0.4-windows-x64.zip",
    "https://ghproxy.net/https://github.com/qShan1/shangjia-tool/releases/download/v1.0.4/ShangjiaTool-v1.0.4-windows-x64.zip"
  ],
  "digest": "sha256:<打包zip的sha256>",
  "force": false
}
```

`digest` 生成（强烈建议填写，防止镜像/传输被篡改）：

```powershell
Get-FileHash .\dist\ShangjiaTool-v1.0.4-windows-x64.zip -Algorithm SHA256
```

`force: true` 表示强制更新（不询问、直接下载安装重启），一般用于不兼容旧数据/接口的版本。

### 4.4 发布到 GitHub Releases

两种方式：

**方式 A — GitHub Actions（推荐，自动生成热更新清单 update_files.json）**
1. 把 `static/version.txt` 升到目标版本并提交推送
2. 更新并提交 `update-manifest.json`
3. GitHub 仓库页面 → Actions → **Auto Release** → Run workflow（手动触发）
4. 工作流会：创建 release（含 `update_files.json`）→ 云端构建 Windows 桌面包并上传 zip

> 工作流只响应手动触发，不会因为 push 自动发版。

**方式 B — 手动上传**
1. GitHub → Releases → Draft a new release → Tag = `v1.0.4`
2. 上传 `ShangjiaTool-v1.0.4-windows-x64.zip`
3. 本地生成热更新清单并一并上传：
   ```powershell
   python generate_update_manifest.py .
   # 产出 update_files.json，上传到 release 附件
   ```
4. Publish release

### 4.5 双更新通道说明

| 通道 | 清单 | 触发 | 适用 |
|---|---|---|---|
| 桌面整包更新 | `update-manifest.json`（仓库根，raw 拉取） | 启动时/托盘"检查更新" | 大版本、后端大改 |
| 网页热更新 | `update_files.json`（release 附件） | 管理台"一键热更新" | 只改前端静态文件 |

> 热更新目录已修正：打包环境固定写 `_internal/static`（frozen 时的 `sys._MEIPASS`），与静态资源读取一致。

---

## 5. 手机远程调用（刮刮乐远程控制）

### 5.1 原理

`/api/captcha/*`（刮刮乐远程控制 router）已支持可配置 token 认证。未配置时本机自用照常跳过校验；配置后所有非本机请求必须带 token。

### 5.2 配置 token

二选一：
- **环境变量**：给服务进程设置 `CAPTCHA_REMOTE_TOKEN=<你的token>`
- **配置文件**：在项目根目录创建 `config/captcha_remote_token.txt`，内容写 token（换行符会被 strip）

### 5.3 开放端口让手机能连到

服务默认只监听 `127.0.0.1`（仅本机）。手机远程调用需：

1. 配置服务绑定地址（如 `0.0.0.0` 或局域网 IP），设置端口 8890
2. 防火墙放行该端口
3. 手机端通过 `http://<电脑局域网IP>:8890` + token 调用

> 安全提醒：开放端口后，captcha 端点必须配置强 token，否则任何人可截图/注入鼠标事件。`slider-solve` 端点另有独立 secret_key 校验。

---

## 6. 常见问题速查

| 现象 | 处理 |
|---|---|
| 打包报 `PermissionError ... ClrLoader.dll` | 有旧实例在运行，先 `Stop-Process -Name ShangjiaTool,ShangjiaService -Force` |
| `build_desktop.ps1` 报 NativeCommandError | pip 依赖已装，跳过 pip 直接手动跑 spec（见 3.2） |
| 首屏短暂 403 | 启动器已改为同时校验 `/health` 与 `/admin` 200 才切页；仍出现则看 `%LOCALAPPDATA%\ShangjiaTool\logs\` 日志 |
| 检测不到更新 | 确认 `update-manifest.json` 的 `latest` 高于本地 `version.txt`，且文件已推送 |
| 更新下载后一直不重启 | 新版启动器下载完会停服务并自动重启；旧版请手动更新到新包 |
| 定时任务被重复执行 | 已加重入保护（`_RUNNING_TASK_IDS`），若仍出现检查是否有多个服务进程并存 |
| 热更新点了没效果 | 确认热更新清单文件（update_files.json）在 release 附件中，且打包环境的 `_internal/static` 可写 |
