# 常见问题

## 端口被占用

源码或桌面端可设置 `API_PORT` / `SHANGJIA_PORT` 使用其他端口。修改后访问对应端口的 `/health` 确认服务状态。

## 桌面端双击没有反应

保留完整的 `ShangjiaTool` 目录，检查 `_internal\ShangjiaService.exe` 是否存在，再查看 `%LOCALAPPDATA%\ShangjiaTool\logs\desktop-launcher.log`。常见原因是端口占用、旧服务仍在运行、杀毒软件隔离后台服务或只复制了启动器 EXE。

## Playwright Chromium 缺失

在源码虚拟环境中运行：

```powershell
playwright install chromium
```

浏览器自动化能力需要有效的本地浏览器和账户授权。不要通过反复自动重试来绕过平台验证。

## Cookie 或 Token 失效

在管理台重新导入或刷新相应账号的有效授权信息，并按页面提示人工完成验证。网页端仍处于登录状态，不代表管理台保存的 Cookie 或接口 Token 可用。

## 数据库或日志在哪里

桌面端在 `%LOCALAPPDATA%\ShangjiaTool\`；源码运行默认在项目目录的运行数据位置。升级、重装或清理前先备份这些文件，尤其是数据库和浏览器档案。
