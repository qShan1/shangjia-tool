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

### 工作区未提交改动（本轮 UI 改造）
1. **液态玻璃**（glass-theme.css）：body 多色光场 + 预设联动（ocean/graphite/rose/dark）；`.content-section .card` 渐变玻璃材质（顶部亮缘、多层 inset 高光、hover 加深）；`prefers-reduced-transparency` 降级不再回纯白实底，保留玻璃渐变。
   - 关键排障：headless Chromium 默认 `prefers-reduced-transparency: reduce`，会命中降级分支导致 blur=none；真实 WebView2 默认 `no-preference`，走完整 blur 规则。
2. **设置界面去重**：删除 `initializeDesktopExperienceControls` 动态注入的液态玻璃预设区，保留静态"主题设置"卡片。
3. **销售额趋势面板**：功能验证正常（API+Chart.js 链路 OK）；图表配色改读 `--primary-color`（跟随液态玻璃预设），深色模式轴文字/网格/标题色自适应。
4. **账号横栏滚轮**：`handleHorizontalWheel` 改为仅横向意图（deltaX 主导 / Shift+滚轮 / 容器可纵向滚动时滚自身）才劫持，普通纵向滚轮放行页面，不再"翻页被横栏抢走"。
5. **右下角通知**：toast 弹入从机械 `puffIn` 改为自定义 `sg-toast-in`（底部上滑+淡入，系统通知式）。
6. **公告恢复显示**：`isDashboardAnnouncementDismissed` 对旧值 `'true'`（旧版永久关闭标记）迁移为"TTL 已过期"时间戳，公告重新可见并走 24h 限时循环。

### 待办任务清单
- [x] 推送代码到远端
- [x] 库存相关问题核对
- [x] 修复前端冒烟测试空库失败
- [x] UI 玻璃感/设置去重/销售额面板/滚轮/通知/公告 本轮修复
- [x] app.js（995KB）拆分为 11 个功能模块：app.core / dashboard / auto-reply / filter-blacklist / accounts / notify / delivery-theme / items / logs / orders / misc（`103e95f`）
  - index.html 依次加载 11 个 `<script>`（core 最先）；服务端 `reply_server.py` 改为按各文件 mtime 动态打版本号；`ai_site_audit_service.py` 改为统计 `app*.js` 总大小
  - 拆分依据：全局函数命名空间 + DOMContentLoaded 回调在 DOM 就绪后执行，运行时解析跨文件依赖；22 个菜单页 playwright 巡检零 JS 错误，全量测试 64 passed
- [ ] WebView2 多进程 298MB：宿主代码不在本仓库（打包 exe 内），代码侧仅能通过减少 DOM/避免泄漏间接优化；如需 WebView2 级参数需在打包宿主传 `AdditionalBrowserArguments`
- [x] 第一轮 卡密商业化系统（软件售卖激活/在线管理，功能不受授权限制）：
  - DB：`users` 加 `is_admin/vip_level/vip_expires_at/remark/last_login_at/last_login_ip`；新增 `activation_codes` 表
  - 后端：`/admin/activation-codes*`（生成/列表/统计/禁用/删除/导出）、`/api/license`（我的授权）、`/api/license/redeem`（兑换）、`/api/presence/heartbeat`（心跳）、`/admin/online-users`（在线列表）、`/admin/kick`（踢下线）；登录记录 last_login
  - 前端：新增 `app.license.js`；侧边栏"我的授权"（兑换+状态）与管理员"在线用户/卡密管理"；心跳 60s；在线用户 15s 自动刷新
- [x] 第二轮 AI 文案优化：`ai_reply_engine.optimize_item_copy`（一次调用不落库）+ `POST /api/item-copy/optimize`；发布页新增"AI 优化文案"按钮回填；`submitItemPublishForm` 合规检查不再硬阻断（改为风险确认）；移除"素材库/保存素材/新建素材"入口
- [x] 第三轮 UI 动效：卡片 hover 上浮、表格行级联入场（1-12 行错开）、模态内容级联、下拉 pop、图表容器淡入、侧边栏折叠文字淡出、admin 菜单淡入、tab 指示条、空状态淡入、卡密统计数字滚动；reduced-motion 自动降级
- [x] 第四轮 数据中心 + 售后/退款分析：
  - orders 表加列 `refund_amount/refunded_at/refund_reason`；`db_manager.record_order_refund`
  - 报表 API：`/api/reports/overview`（销售额/订单/完成率/退款率/退款金额/今日/发货/关键词）、`keyword-hits`（发货规则关键词排行）、`item-heat`（商品热度）、`orders-distribution`（订单状态分布）、`sales-breakdown?group=item|account|day`（销售构成）、`export`（CSV）
  - 前端：新增 `app.reports.js` + 侧边栏"数据中心"菜单；总览统计卡、订单分布环形图、销售构成条形图（可切换）、关键词/商品排行进度条、导出 CSV
  - 25 个菜单 playwright 巡检零错误；全量测试 64 passed
- [x] 第五轮 AI 回复增强 + AI 自动写文案：
  - `ai_reply_settings` 加列 `temperature/max_tokens/history_limit`（幂等迁移）；`save/get/get_all` 支持；Pydantic 模型 + 前端配置弹窗新增"生成参数"卡片（温度/回复长度/对话记忆）
  - `generate_reply` 使用可配置温度/长度；对话历史按可配置条数 + token 估算截断；新增 `dry_run`（/ai-reply-test 不再污染 ai_conversations）
  - API Key 掩码：GET 返回掩码，保存时掩码/空值自动保留原 key
  - `optimize_item_copy` 支持 `mode=generate`（从零生成完整文案）；发布页新增"AI 写文案"按钮（输入卖点/关键词回填）
  - 25 菜单巡检零错误；全量测试 64 passed
- [x] 第六轮 商品发布重构（第一批）：
  - 位置可配置：新增系统设置 `publish_default_longitude/latitude`（发布页右侧"发布位置"卡片可保存/重置默认坐标）；`ItemPublisher.get_default_location` 支持坐标覆盖，优先用发布请求坐标 → 系统默认 → 账号默认地址（原硬编码南京）
  - 品牌接线：发布表单新增"品牌"输入，拼进类目提示辅助闲鱼识别；单发 JSON / multipart / 批量发布均透传 brand
  - 素材管理激活：发布页右侧"发布素材"卡片（保存为素材/列表/载入/删除），复用既有 product-materials 后端
  - 批量发布 UI：新增"批量发布"按钮 + 弹窗（多选账号 × 多选素材 + 可选位置坐标 → `/product-publish/batch` → 3s 轮询进度条 + 按账号结果明细）
  - 全链路 TestClient 验证（素材brand/批量location/单发location/系统设置）；64 passed；25 菜单巡检零错误
- [x] 第七轮 商品发布重构（第二批）：
  - 类目识别预览：`ItemPublisher.preview_category_recommendation` + `extract_category_candidates`（自动识别结果 + cardList 类目卡片候选）；新接口 `POST /product-publish/category-recommend`；发布页"识别类目"按钮展示候选类目按钮（★推荐优先）点击回填
  - AI 写文案增强：`optimize_item_copy` generate 模式新增 `price_min/price_max` 建议价格区间，前端回填现价（区间取中间值）并展示建议价
  - 发布失败原因可视化：发布记录卡片直接展示平台错误码/信息（既有 error_message/sync_message 呈现），类目推荐失败展示 Cookie/签名友好错误
  - 多规格发布暂缓（multiSKU payload 结构需真实接口验证，本轮未做）
  - TestClient 验证（AI价格区间/类目候选提取/推荐接口）；64 passed；25 菜单巡检零错误
- [x] 第八轮 商品发布重构（第三批·发布记录增强）：
  - 发布记录状态筛选（全部/成功/失败/发布中），按 status 过滤后端查询
  - 失败原因可视化增强：提取平台错误码（`FAIL::` → `平台错误码：...`）+ sync 错误合并展示
  - 失败记录支持"载入素材编辑"（material_id 存在时）与"重试发布"（载入失败素材到表单并滚动定位）
  - 发布记录从 10 条扩到 20 条；64 passed；25 菜单巡检零错误
- [ ] 打包新 dist（用户指示本次不打包）

## 注意事项 / 教训
- 真正业务源码在 `E:\AXianYu\shangjia-tool`；`E:\Agent\OpenCode\XianyyuShangjia` 只是 opencode 技能配置目录（grill-me/grilling），不要混淆。
- 每次大改动要刷新本文件，避免再次"找不到代码在哪"。
- Windows PowerShell 中 `2>/dev/null`、`ls -la` 会报错，用 `Get-ChildItem` / `git -C <path>`。