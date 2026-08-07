# Windows 桌面端

`ShangjiaTool.exe` 是桌面启动器，`ShangjiaService.exe` 是后台服务。两者必须保留在同一个 `ShangjiaTool` 文件夹中，不能只复制单个 EXE。

## 启动

双击 `dist\ShangjiaTool\ShangjiaTool.exe`。启动器会：

1. 检查本机 `127.0.0.1:8090` 的服务状态。
2. 启动 `_internal\ShangjiaService.exe`。
3. 等待健康检查成功后打开管理台。

重复启动时会复用已健康的本地服务，不创建第二个服务进程。

## 数据位置

默认数据目录为 `%LOCALAPPDATA%\ShangjiaTool\`，其中包含数据库、浏览器状态、上传文件和日志。安装目录用于程序文件，不应保存用户数据。首次迁移只复制旧目录内容，不删除来源数据。

可用环境变量：

- `SHANGJIA_DATA_DIR`：指定桌面端数据目录。
- `SHANGJIA_PORT`：指定本地端口，默认 `8090`。
- `ADMIN_PASSWORD`：首次初始化时预设管理员密码。

## 构建

```powershell
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
.\scripts\build_desktop.ps1
```

构建脚本会在 `dist\` 生成发行目录。若旧桌面端正在运行并锁定默认输出目录，可输出到其他位置：

```powershell
.\scripts\build_desktop.ps1 -OutputDirectory D:\Path\shangjia-tool-build
```

构建失败会返回非零退出码，不会再误报构建完成。

## 无法打开

启动失败时，检查 `%LOCALAPPDATA%\ShangjiaTool\logs\desktop-launcher.log`。该日志会记录实际启动的后台服务路径和端口。若 30 秒内未通过健康检查，启动器会显示错误并指出诊断日志位置。

不要从安装目录删除 `data`、`logs` 或 `_internal` 目录来“修复”问题。先保留数据目录，再根据日志排查端口占用、杀毒软件拦截或缺失的后台服务文件。
