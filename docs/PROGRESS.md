# 开发进度记录

> 每次会话开始先读本文件，结束时更新。用于防止上下文丢失。

## 项目信息

- 目录: `E:\AXianYu\shangjia-tool`
- 远端: https://github.com/qShan1/shangjia-tool.git
- 当前分支: master（本地另有 E:\Agent\OpenCode\XianyyuShangjia 仅存放 opencode 技能配置，与业务代码无关）
- 打包：新增改动需打新 dist 版本（最近已发布版本见 dist_v242；本次会话暂不打包）

## 最近状态（截至最近一次会话）

### 最近提交（已入库）
- `889149f` fix(desktop): 启动前清理残留服务修复二次启动 "No front-end found"；退出时强杀服务进程树；公告关闭改 24h 限时；管理端备份/导出；玻璃 CSS + 侧边栏动效；测试适配；新增 docs/PROGRESS.md
- `12083a2` feat(items): 商品逐 SKU 库存存储 + 手动库存防自动同步覆盖
- `e04a413` fix(desktop): 移除 webview 不支持的 icon 参数；清除 Docker 遗留代码路径
- `4b68e69` chore: 移除 Docker 部署面
- `b3971e5` chore(release): v2.3.0 final
- `8078cee` chore(release): v2.3.0-beta（appKeys 集中化、路由认证审计）

### 工作区未提交改动
- 无（889149f 已提交全部改动；dist_v242/ 属打包产物，已被 gitignore 忽略，不推）

### 待办任务清单
- [x] 推送代码到远端（889149f 已推，55eea79 文档更新待推）
- [x] 库存相关问题核对：stock_manual 保护完整（手动 API 置位 / 自动同步跳过 / restore-sync 清除），无其他覆盖路径
- [x] 修复前端冒烟测试空库失败：seed 增加 cookie+item+订单（时间按 UTC 写入），sales 图表可渲染
- [ ] UI 玻璃感/侧边栏动效是否达到预期，按用户反馈打磨
- [ ] 打包新 dist（用户指示本次不打包）

## 注意事项 / 教训
- 真正业务源码在 `E:\AXianYu\shangjia-tool`；`E:\Agent\OpenCode\XianyyuShangjia` 只是 opencode 技能配置目录（grill-me/grilling），不要混淆。
- 每次大改动要刷新本文件，避免再次"找不到代码在哪"。
- Windows PowerShell 中 `2>/dev/null`、`ls -la` 会报错，用 `Get-ChildItem` / `git -C <path>`。