# 开发进度记录

> 每次会话开始先读本文件，结束时更新。用于防止上下文丢失。

## 项目信息

- 目录: `E:\AXianYu\shangjia-tool`
- 远端: https://github.com/qShan1/shangjia-tool.git
- 当前分支: master（本地另有 E:\Agent\OpenCode\XianyyuShangjia 仅存放 opencode 技能配置，与业务代码无关）
- 打包：新增改动需打新 dist 版本（最近已发布版本见 dist_v242；本次会话暂不打包）

## 最近状态（截至最近一次会话）

### 最近提交（已入库）
- `12083a2` feat(items): 商品逐 SKU 库存存储 + 手动库存防自动同步覆盖
  - item_info.sku_info 持久化多规格明细（名称/数量/价格），商品管理页 SKU 详情弹窗
  - item_info.stock_manual：手动改库存置位；自动同步跳过覆盖手动值
  - 新增 `POST /items/{cid}/{iid}/stock/restore-sync` 清除手动标标记、恢复平台库存
  - 附：启动器关闭到托盘、端口释放、单实例等待；PyInstaller 配置镜像、icon；登录记住我；液态玻璃 CSS + 透明 ICO
- `e04a413` fix(desktop): 移除 webview 不支持的 icon 参数；清除 Docker 遗留代码路径
- `4b68e69` chore: 移除 Docker 部署面
- `b3971e5` chore(release): v2.3.0 final
- `8078cee` chore(release): v2.3.0-beta（appKeys 集中化、路由认证审计）

### 工作区未提交改动（本次会话重点，完成度：代码已写，待验证）
1. `desktop_launcher.py`：
   - `clean_stale_services()`：启动前清理残留 `ShangjiaService.exe`，修复二次启动 "No front-end found"
   - `stop_service()` 全面强化： terminate + taskkill /T /F 走整棵进程树，端口占用进程强制击杀
   - `request_exit()` 立即 `stop_service()`，托盘 stop 放独立线程防卡死
   - `atexit.register(stop_service)` 兜底
   - `webview.start(private_mode=False, storage_path=data/webview)` 持久化 localStorage（记住登录/主题）
2. `shangjia_tool/reply_server.py`（+183 行）：
   - 上传文件管理：`list_upload_files` / `delete_upload_file`
   - 数据库备份管理：`download_backup_file` / `delete_backup_file`
   - 表格导出接口（`/admin/data/{table}/export`）
3. `static/js/app.js` (+462 行)：
   - 公告关闭改为 24h 限时隐藏（`DASHBOARD_ANNOUNCEMENT_DISMISS_TTL_MS`），解决"关了再也看不到"
   - 数据表 Excel 导出矩阵、服务器备份列表/下载
   - 液态玻璃预设、主题背景透明化、侧边栏激活/折叠动效
4. `static/css/glass-theme.css`、`static/index.html`、`static/css/admin.css`：配套 UI

### 待办任务清单
- [ ] 校验未提交改动（启动器、公告、备份/导出）后再提交、推送（只推代码，不推打包版本）
- [ ] 打包新 dist（本次先不做）
- [ ] 库存相关问题再核对（stock_manual 已入库，确认是否有遗漏场景）
- [ ] UI 玻璃感/侧边栏动效是否达到预期，按用户反馈打磨

## 注意事项 / 教训
- 真正业务源码在 `E:\AXianYu\shangjia-tool`；`E:\Agent\OpenCode\XianyyuShangjia` 只是 opencode 技能配置目录（grill-me/grilling），不要混淆。
- 每次大改动要刷新本文件，避免再次"找不到代码在哪"。
- Windows PowerShell 中 `2>/dev/null`、`ls -la` 会报错，用 `Get-ChildItem` / `git -C <path>`。