# 新功能规划（2026-08-11）

> 状态：**仅规划，未实现**。用户确认方向后再进入开发。
> 依据：2026-08-11 全项目源码调研（AI 回复 / 商品发布 / 订单结构 / 定时任务 / 管理端 / 卡密现状）。

---

## 0. 现状盘点（调研结论速览）

| 领域 | 现状 | 关键资产 |
|---|---|---|
| AI 回复 | `AIReplyEngine`（686 行）已支持 6 家供应商（openai/openai_responses/gemini/anthropic/azure_openai/dashscope），统一提示词 + 会话去抖/串行锁 + 预设体系 | `ai_reply_engine.py`、`ai_reply_settings` 表、`ai_config_presets` 表 |
| 商品发布 | `ItemPublisher` 直接请求闲鱼 mtop 接口；类目/品牌/成色自由文本；位置硬编码南京；素材绑定死板、批量发布前端无入口；无多规格 | `utils/item_publisher.py`、`product_materials` 表、`publish_logs` 表、`check_product` 合规检查 |
| 订单 | 退款仅用 `order_status` 表达（refunding/refund_cancelled/cancelled），**无退款金额/原因字段** | 订单状态机、`ORDER_SALES_TIME_SQL` 销售口径、`/api/sales`+`/api/sales/summary` |
| 定时任务 | 仅 `item_polish` 一种业务类型；`auto_comment`/`auto_red_flower` 是硬编码独立协程，不可配置时间 | `scheduled_task_checker` 轮询框架、`calculate_next_daily_run`、任务日志聚合中心 |
| 管理端 | 复用 index.html，`is_admin` 显隐菜单，后端 `require_admin` 保护；能力已覆盖用户/数据/日志/风控/备份恢复 | `/admin/*` 路由族、users 表 `is_admin` 字段 |
| 卡密 | **无任何软件授权/兑换码体系**。现有 `cards` 是"卡券自动发货"（虚拟商品发货内容），与授权无关 | `data_card_reservations` 预占-消费状态机（可作参考模式） |

---

## 1. 数据看板 / 报表增强（高优先级，低风险）

### 目标
把"销售额单点图表"升级为可下钻、可导出的经营数据中心。

### 建议改动
1. **新增菜单"数据中心"**（或扩展仪表盘）：
   - 销售额多维分析：按日/周/月、按商品、按账号（复用 `ORDER_SALES_TIME_SQL` 口径）
   - 关键词触发排行：统计每个关键词被命中的次数
   - 商品咨询热度排行：按商品聚合订单/咨询量
   - 订单状态分布（含退款率、完成率）
2. **导出 Excel/CSV**：复用管理端 `/admin/data/{table}/export` 的 Excel 导出工具，为统计结果加导出按钮。
3. **新增统计 API**（建议 `/api/reports/*`）：
   - `GET /api/reports/keyword-hits`（聚合关键词命中）
   - `GET /api/reports/item-heat`（商品热度）
   - `GET /api/reports/sales-breakdown?group=item|account|day`
   - `GET /api/reports/orders-distribution`
4. **前端**：新增 `app.reports.js` 模块（沿用 11 模块拆分后的规范），图表复用 Chart.js。

### 复用与成本
- 复用：订单表、销售时间口径、Excel 导出、Chart.js、`app.dashboard.js` 图表封装。
- 成本：中低。无表结构变更，主要是聚合查询 + 一个新页面。

---

## 2. 售后 / 退款分析（高优先级，中风险）

### 目标
从"退款只做状态标记"升级为可统计、可预警、可拦截的售后闭环。

### 建议改动
1. **orders 表加列**（沿用现有迁移机制 `_execute_sql` PRAGMA）：
   - `refund_amount`（退款金额，数量级同 amount）
   - `refunded_at`（退款时间）
   - `refund_reason`（退款原因，平台消息可识别则记录）
2. **退款识别增强**：`order_status_handler._check_refund_message` 已能从退款卡片识别状态，扩展为同时抓金额/原因写回订单。
3. **新增售后统计 API**：
   - `GET /api/refunds/overview`：退款率、退款金额、近 7 天趋势
   - `GET /api/refunds/list`：退款单台账（可按账号/商品/原因筛选）
   - `GET /api/refunds/reasons`：退款原因分布
4. **退货自动拦截发货**：新订单下单时，若该买家近 N 天退款次数超阈值，自动挂起发货并告警（复用 `data_card_reservations` 预占-确认状态机的"挂起"思路）。
5. **前端**：新增"售后中心"菜单页（`app.after-sale.js`），退款单列表 + 统计卡片 + 拦截规则设置。

### 复用与成本
- 复用：订单状态机、`data_card_reservations` 状态机、`order_status_handler`。
- 成本：中。涉及表迁移 + 状态机扩展 + 新页面，但都是增量。

---

## 3. AI 智能回复：重新制作（中优先级，工作量集中）

### 现状痛点（调研确认）
- 温度 / max_tokens / 历史条数**硬编码**（0.7 / 150 / 10 条）
- 对话历史无 token 截断，长会话可能超限
- 测试接口复用 `generate_reply`，**会写入 `ai_conversations` 污染真实会话**
- API key 明文存 SQLite
- 无回复前敏感词/违规拦截，有回复被平台判违规的风险

### 建议改动（增强为主，非推倒重写）
1. **参数可配置化**：`ai_reply_settings` 增加 `temperature`、`max_tokens`、`history_limit` 字段；前端配置弹窗（index.html L5710-5829）补齐。
2. **上下文管理**：按模型 token 上限做历史截断（`estimate_tokens` 工具），最多保留可放入的条数。
3. **测试隔离**：`generate_reply` 增加 `dry_run` 参数，测试不写 `ai_conversations`。
4. **密钥保护**：API key 存储改为加密（或至少前端只回显掩码、只写不回读）。
5. **敏感词拦截**：生成后发送前跑 `product_compliance` 正则 + 平台规则校验，命中则走默认兜底。
6. **质量增强（可选）**：
   - 多轮议价策略升级（议价轮数、让步幅度）
   - 回复风格选项（简洁/热情/专业）
   - 图片消息处理（openai/ollama 已支持多模态，补齐到配置层）

### 复用与成本
- 复用：`AIReplyEngine` 多供应商调用层、统一提示词、去抖锁。
- 成本：中。主要是配置层 + 上下文层增强，不重写引擎。

---

## 4. AI 自动写商品文案 + 自动发布 + 商品发布重构（中高优先级，工作量最大）

### 现状痛点（调研确认，"太差劲"原因）
- 类目/品牌/成色**全靠自由文本**，无选项树；类目虽有 AI 推荐但需人工复核
- 素材（`product_materials`）绑定死板：只能整表载入表单再手动发布；**批量发布后端已有但前端零入口**
- 位置硬编码南京坐标
- 无 SKU/多规格发布（`multiSKU: False` 硬编码）
- `precheck` 仅正则黑名单，无法防平台审核驳回

### 建议改动
1. **删除素材管理**（用户已确认）：
   - 移除 `product_materials` 表相关前端 UI 与路由（`/product-materials*`）
   - 移除前端 `app.items.js` 中素材 CRUD 函数（L472-605 区域）
   - 保留/迁移为"发布草稿"（`publish_drafts` 表）或直接进入"AI 生成草稿"模式
2. **AI 写文案**：
   - 输入：标题关键词 + 卖点 + 商品图片（多模态）
   - 输出：标题建议 + 完整描述 + 推荐类目 + 建议价格区间
   - 复用 `AIReplyEngine` 的供应商调用层，新建 `ai_product_copy_service.py`；复用 `build_ai_optimization_prompt` 已有基础
3. **类目/成色选择树**：把 `kgraph.property.recommend` 的推荐结果做成前端可视化选择树，替代自由文本。
4. **发布流程简化**：AI 预填表单 → 用户微调 → 发布；失败原因可视化（平台返回的错误直接展示）。
5. **批量发布 UI**：前端补上"批量发布"入口（复用已有 `/product-publish/batch`，账号×草稿，上限 100）。
6. **多规格发布**：`ItemPublisher` 放开 `multiSKU`，支持规格名/规格值数组。
7. **位置可选**：POI 从硬编码改为可配置（设置页存默认坐标 + 发布时可选）。

### 复用与成本
- 复用：`ItemPublisher`（图片上传/类目推荐/POI/发布 payload）、`check_product`、批量发布后端、`AIReplyEngine`。
- 成本：高。涉及前端表单重构 + AI 服务 + 发布流程改动 + 删除素材管理，建议拆成 2-3 个迭代。

---

## 5. 卡密系统评估（建议：可做，独立立项，低优先级）

### 结论
项目目前**没有任何软件授权/会员体系**。现有 `cards` 表是"卡券自动发货"，是虚拟商品发货内容，与"卡密授权"是两回事。如果要做商业化授权，是**全新模块**，不是增量。

### 若做，建议范围
1. 新表 `activation_codes`：`code / plan / duration_days / used_by / used_at / expires_at / created_by`
2. `users` 表加 `vip_level / vip_expires_at`
3. 管理端新增"卡密管理"：生成/批量导出/禁用/查询
4. 用户侧"兑换卡密"入口 + 到期提醒
5. 权限中间件：VIP 功能按 `vip_level` 校验（与现有 `is_admin` 并存）

### 建议
- **不建议现在做**：核心业务（自动回复/发货/发布）稳定性和数据功能优先级更高；卡密涉及商业定价，需你明确售卖模式（按时间/按功能）后再设计。
- 复用参考：`data_card_reservations` 的"预占-消费"状态机、`cards` 表的类型化管理模式、admin 用户管理。

---

## 6. 管理端评估（建议：补缺口，不做独立页面）

### 结论
现有管理端能力已较全（用户/数据/日志/风控/备份恢复，均 `require_admin` 保护）。**不建议另做独立管理端页面**，成本高、双入口维护负担大。

### 建议补齐的缺口（低投入高价值）
1. 用户管理增强：**创建用户 / 重置密码 / 禁用（封禁）用户**（当前只有删除 + 设管理员）
2. 操作审计页：记录敏感操作（发布/删除/改权限/备份恢复）的操作人/时间/IP，独立于系统日志
3. 统一 `require_admin` 与 `verify_admin_token` 两套鉴权，消除不一致
4. 数据管理：增加常用表快捷入口（当前是白名单表选择器）

---

## 7. 优先级与依赖建议

| 序号 | 方向 | 优先级 | 风险 | 依赖 | 建议 |
|---|---|---|---|---|---|
| 1 | 数据看板/报表 | 高 | 低 | 无 | 先做，独立迭代 |
| 2 | 售后/退款分析 | 高 | 中 | 表迁移 | 紧随其后 |
| 3 | AI 回复增强 | 中 | 中 | 无 | 可与 1/2 并行 |
| 4 | 商品发布重构 + AI 文案 | 中高 | 高 | 删素材管理 | 拆 2-3 迭代，独立排期 |
| 5 | 卡密系统 | 低 | 中 | 商业模式确认 | 独立立项 |
| 6 | 管理端补缺口 | 低 | 低 | 无 | 顺手做 |

## 8. 实施约定（若进入开发）
- 新功能沿用 11 模块拆分规范，新增 `app.<模块>.js` 并在 `index.html` 按 core 优先顺序引入。
- 新 API 沿用 `verify_token` + `require_admin` 鉴权、`safe_client_error` 脱敏。
- 表变更走 `db_manager.py` 现有 `_execute_sql` 迁移机制。
- 每批改动跑 `venv\Scripts\python.exe -m pytest -q`（当前基线 64 passed）并 playwright 巡检受影响菜单页。
