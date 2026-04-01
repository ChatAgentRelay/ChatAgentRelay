# CAR 定位、功能全景与 Roadmap (Internal)

| | |
|---|---|
| **Status** | Active |
| **Classification** | Internal — do not publish |
| **Last Updated** | 2026-03-28 |

---

## 1. CAR 的定位

### 1.1 一句话定位

**CAR 是一个开源的、自托管的消息中继中间件，通过 A2A 协议将企业聊天平台与 AI agent 连接，并在消息流路径上提供治理和全链路审计。**

### 1.2 CAR 是什么

- 聊天平台与 A2A agent 之间的**透明管道**
- 消息流级别的**治理层**（入站/出站内容过滤、访问控制）
- 全链路**审计层**（7 事件因果链、追加式账本）
- 多渠道**归一化层**（不同平台 → 统一 canonical event）
- 多 agent **路由层**（消息按规则分发到不同 agent）

### 1.3 CAR 不是什么

- **不是 agent 运行时**：agent 独立运行，CAR 只通过 A2A HTTP 调用
- **不是 agent 治理工具**：agent 内部的工具调用/推理/审批由 agent 自己负责（Faramesh/AetherClaw 等）
- **不是智能层**：CAR 不做任何 LLM 推理，不嵌入 agent 逻辑
- **不是 SaaS 平台**：自托管，企业完全控制数据

### 1.4 生态位

```
┌───────────┐     ┌─────────────┐     ┌──────────────────┐
│ Chat      │     │             │     │ A2A Agent        │
│ Platforms │────▶│     CAR     │────▶│ (with internal   │
│           │◀────│             │◀────│  governance via   │
│ Slack     │     │ • normalize │     │  Faramesh /      │
│ Teams     │     │ • govern    │     │  AetherClaw /    │
│ Discord   │     │ • route     │     │  MS Gov Toolkit) │
│ Telegram  │     │ • audit     │     │                  │
│ ...       │     │ • deliver   │     │                  │
└───────────┘     └─────────────┘     └──────────────────┘

CAR 治理范围：消息流（入站过滤、出站过滤、路由、审计）
Agent 治理范围：执行层（工具调用审批、推理监督、动作控制）
两者互补，不重叠。
```

### 1.5 竞品对比定位

| | OpenClaw | RemoteClaw | RouteKit | AetherClaw | Faramesh | **CAR** |
|---|---|---|---|---|---|---|
| 角色 | Agent 运行时 + 消息桥 | CLI agent 远程桥 | SaaS 消息路由 | Agent 执行治理 | Agent 动作治理 | **消息流中继 + 治理** |
| Agent 模型 | 嵌入式 | 子进程 | 私有 API | 平台内 | SDK 包装 | **A2A 远程调用** |
| 与 CAR 关系 | 定位不同 | 定位不同 | 部分重叠（消息路由） | **互补** | **互补** | — |

---

## 2. 终极目标的完整功能全景

企业消息流的完整生命周期：

```
用户在 Slack 发消息
    ↓
① 接收 (Ingress)          ─── 渠道适配器接收、归一化
    ↓
② 上下文充实 (Enrichment)  ─── 会话追踪、租户解析、会话管理
    ↓
③ 入站治理 (Inbound Gov)   ─── 策略评估、内容过滤、访问控制、频率限制
    ↓
④ 路由 (Routing)           ─── 规则匹配、多 agent 分发
    ↓
⑤ Agent 调用 (Invocation)  ─── A2A 协议调用、流式、多轮、HITL 中继
    ↓
⑥ 出站治理 (Outbound Gov)  ─── 响应内容过滤、兜底防护
    ↓
⑦ 投递 (Delivery)          ─── 渠道投递、重试、富消息格式化
    ↓
⑧ 账本 (Ledger & Audit)    ─── 全程记录、可追溯、可重放
    ↓
⑨ 运维 (Operations)        ─── 配置管理、CLI、API、健康检查、日志
    ↓
⑩ 安全 (Security)          ─── API 认证、签名验证、加密、租户隔离
```

### 各环节功能点与当前状态

#### ① 接收 (Ingress)

| 功能点 | 状态 | 说明 |
|--------|------|------|
| Slack 适配器 | ✅ 完成 | Socket Mode + 事件扩展（mention/edit/delete/reaction/slash） |
| Discord 适配器 | ✅ 完成 | Gateway API + slash commands + rich embed |
| WebChat 适配器 | ✅ 完成 | HTTP transport + CORS + session + streaming |
| Telegram 适配器 | ✅ 完成 | Bot API ingress + sender |
| Lark (飞书) 适配器 | ✅ 完成 | Ingress + sender |
| DingTalk (钉钉) 适配器 | ✅ 完成 | Robot callback + sender |
| Microsoft Teams 适配器 | ❌ 缺失 | 企业 #1 聊天平台 |
| WhatsApp Business 适配器 | ❌ 缺失 | 客户触达高价值渠道 |
| Webhook 签名验证 | ⚠️ 部分 | Slack token 验证有，通用框架无 |
| 幂等/去重 | ⚠️ 部分 | WebChat 有 idempotency key，其他渠道无 |
| 富消息归一化 | ⚠️ 部分 | 各渠道各自处理，无统一抽象 |

#### ② 上下文充实 (Enrichment)

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 会话追踪 (conversation_id) | ✅ 完成 | 所有事件携带 conversation_id |
| 租户/工作区 (tenant_id, workspace_id) | ✅ 完成 | 事件模型中有，但未强制隔离 |
| 会话管理 (session) | ⚠️ 部分 | WebChat 有内存 session store，其他渠道无持久 session |
| 身份解析/拼接 | ❌ 缺失 | RFC 提及但未实现 |

#### ③ 入站治理 (Inbound Governance)

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 策略评估 (allow/deny) | ✅ 完成 | `policyFn` 在 pipeline 中执行 |
| 关键词过滤 | ✅ 完成 | `PolicyRule` type: "keyword" |
| 正则过滤 | ✅ 完成 | `PolicyRule` type: "regex" |
| 结构化条件 (sender/channel/time) | ❌ 缺失 | 当前只能匹配 payload.text |
| 频率限制 (rate limiting) | ❌ 缺失 | |
| 发送者白名单/黑名单 | ❌ 缺失 | |
| mandatory deny (不可覆盖的强制拒绝) | ❌ 缺失 | |

#### ④ 路由 (Routing)

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 渠道匹配路由 | ✅ 完成 | match_type: "channel" |
| 模式匹配路由 | ✅ 完成 | match_type: "pattern" |
| 默认路由 | ✅ 完成 | match_type: "default" |
| 优先级排序 | ✅ 完成 | RouteEngine 按 priority 排序 |
| 路由热更新 | ❌ Bug | 启动时加载一次，API 修改后不生效 |
| 路由启用/禁用 API | ❌ 缺失 | DB 支持 enabled 字段，API 未暴露 |

#### ⑤ Agent 调用 (Invocation)

| 功能点 | 状态 | 说明 |
|--------|------|------|
| A2A message/send | ✅ 完成 | 同步调用 |
| A2A message/stream | ✅ 完成 | SSE 流式 |
| Agent Card 发现 | ✅ 完成 | Best-effort /.well-known/agent.json |
| 多轮会话上下文 | ✅ 完成 | conversationHistory 从 ledger 构建 |
| HITL 中继 — adapter 层 | ✅ 完成 | input-required 状态处理、resume()、resumeStream()、cancel() |
| HITL 中继 — pipeline 层 | ⚠️ 部分 | hitlPending flag 设置了，但无完整的暂停→通知→等待→恢复流程 |
| Artifact 处理 | ✅ 完成 | file/data part 映射 |
| 超时与错误处理 | ✅ 完成 | 分类错误码 (timeout/unavailable/rpc_error/task_failed) |

#### ⑥ 出站治理 (Outbound Governance)

| 功能点 | 状态 | 说明 |
|--------|------|------|
| Agent 响应的策略检查 | ❌ 缺失 | 当前 agent 响应直接投递，无过滤 |

#### ⑦ 投递 (Delivery)

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 渠道投递 | ✅ 完成 | 各渠道 sender 实现 |
| 重试 (指数退避) | ✅ 完成 | DeliveryOrchestrator |
| 投递耗尽错误 | ✅ 完成 | DeliveryExhaustedError |
| 流式更新 | ✅ 完成 | Slack chat.update, WebChat SSE |
| 富消息格式化 | ⚠️ 部分 | Slack Block Kit, Discord embed 有；其他渠道基础 |
| 死信队列 | ❌ 缺失 | 失败只记录错误事件，无持久化重处理队列 |

#### ⑧ 账本与审计 (Ledger & Audit)

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 追加式存储 (SQLite + In-Memory) | ✅ 完成 | |
| 7 事件因果链 | ✅ 完成 | |
| 会话重放 | ✅ 完成 | getByConversationId |
| 关联追踪 | ✅ 完成 | getByCorrelationId |
| 审计解释 API | ✅ 完成 | explainFirstExecutablePath |
| 事件查询 | ✅ 完成 | 按 conversation/correlation/event_id |
| 保留策略 (retention) | ❌ 缺失 | 无 TTL / 归档 / 清理机制 |

#### ⑨ 运维 (Operations)

| 功能点 | 状态 | 说明 |
|--------|------|------|
| CLI (car start/channel/agent/route/config/status) | ✅ 完成 | |
| HTTP 管理 API (CRUD) | ✅ 完成 | agents/channels/routes/settings/events |
| 健康检查 | ✅ 完成 | /api/health |
| 优雅关闭 | ✅ 完成 | SIGINT/SIGTERM, inflight drain 30s |
| 结构化日志 | ✅ 完成 | |
| 敏感字段加密 | ✅ 完成 | CAR_ENCRYPTION_KEY |
| CLI/API 响应结构不一致 | ❌ Bug | CLI 期望 `{ agents: [...] }`，API 返回 `[...]` |
| 端口配置源不一致 | ❌ Bug | server 用 DB setting，CLI 用环境变量 |
| API addChannel 类型限制过窄 | ❌ Bug | 硬编码 `slack|discord|webchat`，遗漏 telegram/lark/dingtalk |
| 配置热更新 | ❌ 缺失 | 路由/策略修改后需重启 |
| WebChat resume/stream 未实际流式 | ❌ Bug | onStreamEvent 参数被忽略 |
| help text 过时 | ❌ Bug | 仍提及 `--type=TYPE` |

#### ⑩ 安全 (Security)

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 管理 API 认证 | ❌ 缺失 | 任何人可调用 /api/* |
| Webhook 签名验证框架 | ❌ 缺失 | 各渠道各自实现，无统一机制 |
| TLS | ⚠️ 外部 | 依赖反向代理 (nginx等)，文档未说明 |
| 租户隔离 | ⚠️ 模型有 | 数据模型有 tenant_id，但未在 API/查询层强制隔离 |

---

## 3. Gap 汇总与优先级

### 原则

优先级基于：**修复此 gap 对 "企业能否采用 CAR" 的影响程度**。

- **P0 (Blocker)**: 不修就没法用
- **P1 (Must-have)**: 企业评估时的硬性要求
- **P2 (Should-have)**: 显著提升可信度和竞争力
- **P3 (Nice-to-have)**: 加分项，可延后

### P0 — 不修就没法用

| # | Gap | 环节 | 说明 | 工作量 |
|---|-----|------|------|--------|
| 0.1 | 修复 CLI/API 响应结构不匹配 | ⑨ 运维 | `car agent list` 等命令对接服务器时解析失败 | 0.5d |
| 0.2 | 修复 API addChannel 类型限制 | ⑨ 运维 | 只允许 3 种类型，实际支持 6 种 | 0.5d |
| 0.3 | 修复端口配置源不一致 | ⑨ 运维 | CLI 和 server 可能连不上 | 0.5d |
| 0.4 | 修复路由热更新 | ④ 路由 | API 修改路由后不生效 | 1d |
| 0.5 | 修复 help text 过时 | ⑨ 运维 | 误导用户 | 0.5d |
| 0.6 | 修复 WebChat resume/stream | ⑤ Agent 调用 | HITL 流式恢复不实际工作 | 1d |

**合计：~4 天**

### P1 — 企业硬性要求

| # | Gap | 环节 | 说明 | 工作量 |
|---|-----|------|------|--------|
| 1.1 | 管理 API 认证 | ⑩ 安全 | 裸跑的管理 API 无法通过安全审计 | 3d |
| 1.2 | Microsoft Teams 渠道 | ① 接收 | 企业 #1 平台，缺失则无法进入企业 POC | 2w |
| 1.3 | 出站治理 (pre-send policy) | ⑥ 出站治理 | Agent 响应直接到用户是不可接受的风险 | 3d |
| 1.4 | HITL 中继完整流程 | ⑤ Agent 调用 | A2A input-required → 通知聊天用户 → 等待回复 → resume。adapter 已就绪，pipeline 需编排 | 3d |
| 1.5 | 频率限制 | ③ 入站治理 | 防滥用的基本保护 | 2d |
| 1.6 | 发送者白名单/黑名单 | ③ 入站治理 | 基本访问控制 | 1d |

**合计：~4.5 周**

### P2 — 显著提升竞争力

| # | Gap | 环节 | 说明 | 工作量 |
|---|-----|------|------|--------|
| 2.1 | 结构化策略条件 | ③ 入站治理 | 基于 sender/channel/time/content_length 的组合条件 | 3d |
| 2.2 | mandatory deny | ③ 入站治理 | 不可覆盖的强制拒绝规则（借鉴 FPL） | 1d |
| 2.3 | WhatsApp Business 渠道 | ① 接收 | 客户触达场景 | 1.5w |
| 2.4 | Webhook 签名验证框架 | ① 接收 | 统一的签名验证抽象，各渠道实现 | 2d |
| 2.5 | 幂等/去重框架 | ① 接收 | 统一的 idempotency key 抽象 | 2d |
| 2.6 | 配置热更新 | ⑨ 运维 | 路由/策略修改后不需重启 | 2d |
| 2.7 | 路由启用/禁用 API | ④ 路由 | 暴露已有的 DB 能力 | 0.5d |
| 2.8 | YAML 策略配置文件 | ③ 入站治理 | 声明式、可版本管理的策略 | 2d |

**合计：~4.5 周**

### P3 — 加分项

| # | Gap | 环节 | 说明 | 工作量 |
|---|-----|------|------|--------|
| 3.1 | 租户隔离强制执行 | ⑩ 安全 | API/查询层按 tenant_id 隔离 | 3d |
| 3.2 | 死信队列 | ⑦ 投递 | 持久化失败消息供重处理 | 2d |
| 3.3 | 审计保留策略 | ⑧ 账本 | TTL / 归档 / 清理 | 2d |
| 3.4 | 身份解析/拼接 | ② 上下文 | 跨渠道身份关联 | 1w |
| 3.5 | 富消息统一抽象 | ① / ⑦ | 跨渠道的 card/button/embed 归一化 | 1w |
| 3.6 | 可插拔策略提供者接口 | ③ 入站治理 | PolicyProvider 接口，支持接入外部策略系统 | 2d |
| 3.7 | 所有渠道 streaming 支持 | ⑦ 投递 | Telegram/Lark/DingTalk 的 progressive update | 1w |

---

## 4. Roadmap

### Sprint 0: 修复基础 (1 周)

**目标**: 让当前代码库可靠地工作。

| 任务 | 对应 Gap |
|------|---------|
| 修复 CLI/API 响应结构不匹配 | 0.1 |
| 修复 API addChannel 类型限制 | 0.2 |
| 修复端口配置源统一 | 0.3 |
| 修复路由热更新（API 修改后立即生效） | 0.4 |
| 修复 help text | 0.5 |
| 修复 WebChat resume/stream 流式恢复 | 0.6 |

**验收**: `bun test --recursive` 全通过，CLI 对接运行中的 server 全部命令正常工作。

### Sprint 1: 安全与出站治理 (2 周)

**目标**: 消除企业安全审计的 blocker。

| 任务 | 对应 Gap |
|------|---------|
| 管理 API 认证 (Bearer token / API key) | 1.1 |
| 出站治理 — pre-send 策略检查点 | 1.3 |
| 频率限制 (per sender / per conversation) | 1.5 |
| 发送者白名单/黑名单 | 1.6 |

**设计要点**:

API 认证：
- 启动时通过环境变量 `CAR_API_KEY` 或 config setting `api.key` 设置
- 所有 `/api/*` 端点（除 `/api/health`）要求 `Authorization: Bearer <key>`
- WebChat 端点 `/api/chat*` 可配置为 public（面向终端用户）或 protected

出站治理：
- 在 pipeline 的 agent response 到 delivery 之间插入第二个策略检查点
- 复用同一个 `PolicyFn` 接口，配置中区分 `inbound_rules` 和 `outbound_rules`
- 出站被 deny 时生成 `event.blocked` (block_stage: "outbound_governance")

频率限制：
- 滑动窗口计数器，scope: sender / conversation / tenant
- 超限时返回 `event.blocked` (block_stage: "rate_limit")

**验收**: 无 API key 访问管理端点返回 401。Agent 响应中包含禁止词时被拦截。突发大量消息被限流。

### Sprint 2: HITL 完整流程 + 治理增强 (2 周)

**目标**: 完成核心差异化功能。

| 任务 | 对应 Gap |
|------|---------|
| HITL 完整 pipeline 编排 | 1.4 |
| 结构化策略条件 (sender/channel/time/rate/length 组合) | 2.1 |
| mandatory deny 规则 | 2.2 |
| 配置热更新（watch or API-triggered reload） | 2.6 |
| 路由启用/禁用 API | 2.7 |

**HITL 编排设计**:

```
Agent 返回 input-required
    ↓
Pipeline 创建 agent.input.required 事件 → 写入 ledger
    ↓
Pipeline 将 prompt 投递到聊天用户（通过 sender）
    ↓
Pipeline 记录 pending session（conversation_id → sessionHandle 映射）
    ↓
用户在聊天中回复
    ↓
新的 message.received 进入 pipeline
    ↓
Pipeline 检测到 active session → 跳过策略/路由 → 直接调用 agent.resume()
    ↓
正常流程继续
```

对于 WebChat: 已有 `/api/chat/resume` 端点，修复 stream 后直接可用。
对于 Slack/Discord/Telegram 等: 需要在 server 的消息处理逻辑中增加 pending session 检查。

**验收**: Agent 返回 input-required → Slack 用户收到提示 → 用户回复 → agent 继续处理 → 最终响应送达。

### Sprint 3: Microsoft Teams 渠道 (3 周)

**目标**: 进入企业 POC 资格。

| 任务 | 对应 Gap |
|------|---------|
| `packages/channel-teams/` 完整实现 | 1.2 |
| Webhook 签名验证框架 | 2.4 |
| 幂等/去重框架 | 2.5 |

**Teams 实现要点**:
- 使用 Bot Connector REST API（不依赖 Bot Framework SDK，保持依赖精简）
- Azure AD / Entra ID 注册，JWT token 验证
- 支持 1:1 chat 和 Group/Channel conversation
- 支持 Activity update 做 progressive streaming
- Adaptive Card 支持（至少 text + button）
- Proactive messaging 支持（HITL prompt 推送）

签名验证框架：
- 定义 `WebhookVerifier` 接口 (`verify(request): boolean`)
- 各渠道各自实现（Slack signing secret、Teams JWT、Telegram secret token、Lark verification token）
- Pipeline ingress 阶段统一调用

**验收**: Teams 通过 adapter conformance 测试。完整 E2E: Teams 用户发消息 → CAR → A2A agent → 回复送达 Teams。

### Sprint 4: WhatsApp + 策略配置 (2 周)

**目标**: 扩展渠道 + 提升策略可用性。

| 任务 | 对应 Gap |
|------|---------|
| WhatsApp Business (Cloud API) 渠道 | 2.3 |
| YAML 策略配置文件支持 | 2.8 |

### Sprint 5: 加固与完善 (持续)

按需从 P3 列表中选取实施。

---

## 5. 里程碑总览

| 里程碑 | 时间 | 标志性能力 | Sprint |
|--------|------|-----------|--------|
| **v0.2 — 可靠基础** | +1w | 所有已知 bug 修复，CLI 和 API 一致性 | S0 |
| **v0.3 — 安全就绪** | +3w | API 认证、出站治理、频率限制、访问控制 | S1 |
| **v0.4 — 核心完备** | +5w | HITL 完整、结构化策略、热更新 | S2 |
| **v0.5 — 企业入场** | +8w | Microsoft Teams、签名验证、幂等框架 | S3 |
| **v0.6 — 渠道丰富** | +10w | WhatsApp、YAML 策略配置 | S4 |
| **v1.0 — Production Ready** | +12w | 全面加固、文档完善、性能测试 | S5 |

---

## 6. 当前状态总结 (2026-04-01 更新)

**17 个包，692 测试全通过。v0.2–v0.6 路线图 20 个 REQ 全部达成。**

| 维度 | v0 时 | 当前 | 剩余 Gap |
|------|-------|------|----------|
| 接收 (8/8 渠道) | 75% | **~92%** | 富消息统一抽象 (P3) |
| 上下文充实 | 60% | **~65%** | 身份解析/拼接 (P3) |
| 入站治理 | 40% | **~95%** | 可插拔策略提供者 (P3) |
| 路由 | 80% | **100%** | — |
| Agent 调用 | 85% | **100%** | — |
| 出站治理 | 0% | **100%** | — |
| 投递 | 80% | **~88%** | DingTalk/WhatsApp streaming (P3)、死信队列 (P3) |
| 账本审计 | 95% | **~95%** | 保留策略 (P3) |
| 运维 | 70% | **~95%** | — |
| 安全 | 20% | **~65%** | 租户隔离 ✅、TLS (外部) |
| **整体** | **~60%** | **~88%** | P3 加分项 |

关键变化：
- P0 (Blocker) 6 项 ✅ 全部修复
- P1 (Must-have) 6 项 ✅ 全部实现 (API 认证、Teams、出站治理、HITL、频率限制、ACL)
- P2 (Should-have) 8 项 ✅ 全部实现 (结构化策略、mandatory deny、WhatsApp、webhook 框架、幂等、热更新、路由控制、YAML 策略)
- P3 (Nice-to-have) 租户隔离 ✅ 已实现，其余 6 项待定

核心差异化（A2A 中继、7 事件审计链、消息流治理、HITL 透明中继）已全部就绪。
