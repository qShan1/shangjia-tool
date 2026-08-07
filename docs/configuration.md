# 配置说明

配置来源按优先级分为环境变量、`global_config.yml` 和管理台保存的运行配置。敏感值只保存在本地运行环境，不能提交到 Git。

## 常用环境变量

| 变量 | 用途 | 示例 |
| --- | --- | --- |
| `API_HOST` | 源码服务监听地址 | `127.0.0.1` |
| `API_PORT` | 源码服务端口 | `8090` |
| `APP_DATA_DIR` | 运行数据根目录 | `D:\ShangjiaData` |
| `DB_PATH` | SQLite 数据库路径 | `D:\ShangjiaData\data\xianyu_data.db` |
| `SHANGJIA_DATA_DIR` | 桌面端数据目录 | `D:\ShangjiaData` |
| `SHANGJIA_PORT` | 桌面端服务端口 | `8090` |
| `ADMIN_PASSWORD` | 首次初始化管理员密码 | 仅在本机设置 |
| `COOKIES_STR` | 旧单账号兼容入口 | 不要写入仓库 |

显式设置的 `API_HOST` 和 `API_PORT` 会覆盖 `global_config.yml` 中的服务地址配置，适合本机多实例或隔离测试。

## 配置文件

`global_config.yml` 保存非敏感默认参数，包括接口地址、自动回复、心跳和日志设置。使用管理台修改的业务配置以运行数据库为准。

修改配置前备份运行数据。不要把真实 Cookie、API Key、密码、数据库或浏览器会话写进示例文件、Issue、日志或提交记录。
