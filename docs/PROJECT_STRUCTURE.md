# 项目结构

| 路径 | 说明 | 是否提交 |
| --- | --- | --- |
| `Start.py` | 后台服务入口 | 是 |
| `desktop_launcher.py` | Windows 桌面启动器 | 是 |
| `static/` | 管理台静态资源 | 是，`static/uploads/` 除外 |
| `scripts/` | 构建与部署脚本 | 是 |
| `tests/` | 自动化回归测试 | 是 |
| `data/` | SQLite 数据库和本地配置 | 否 |
| `browser_data/` | 浏览器会话与档案 | 否 |
| `logs/`、`output/` | 运行日志与导出物 | 否 |
| `dist/`、`build/` | PyInstaller 构建产物 | 否 |

代码、公开文档和构建脚本属于仓库内容；账号信息、订单数据、验证截图、上传素材、日志和编译产物属于本地运行内容。整理文件时先分类，未经确认不要删除业务数据。
