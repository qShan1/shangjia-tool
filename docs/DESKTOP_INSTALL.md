# 上架工具桌面版

运行 `desktop_launcher.py` 可一键启动本地服务并打开管理台；安装版构建使用
`build_desktop.ps1`。运行数据默认放在 `%LOCALAPPDATA%\ShangjiaTool`，包括数据库、
浏览器状态、日志、上传文件和轨迹记录。源码目录中的旧数据不会自动删除。

当前仓库重命名需要在 GitHub 网页/API 中完成；完成后执行：

```powershell
git remote set-url origin https://github.com/qShan1/SHANGJIA-TOOL.git
```
