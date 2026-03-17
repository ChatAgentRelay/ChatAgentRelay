# OpenClaw-Oriented Competitor Research

## Executive Summary

目标系统不是单一 Agent 框架，而是一个可开源、企业可用的 **chat-platform <-> agent middleware**：统一接入多种聊天入口，在中间层完成 canonical event normalization、routing、governance、audit、replay、delivery orchestration，再通过稳定的 backend adapter contract 对接一个或多个 Agent / workflow runtime。

本轮调研结论：**不直接复用单一底座，而是组合借鉴多个项目的成熟模式，自研中间层核心协议与控制面。**

推荐借鉴分工：
- **OpenClaw**：gateway / control plane / session scope / channel policy / RPC & ops surface
- **Microsoft Bot Framework**：canonical activity 思路 / adapter boundary / middleware pipeline
- **Rasa**：append-only event history / replay / tracker-like state reconstruction
- **Agent Kernel**：backend runtime portability / runner-session boundary / framework-neutral adapter contract
- **Automagik Omni**：instance-channel-router-trace 的 omnichannel middleware shape
- **Chatwoot / Chaskiq**：企业运营治理 / audit / queue / handoff / assignment / extensibility
- **opsdroid**：轻量 connector ergonomics / plugin-style adapter DX
- **RoomKit RFC**：channel/provider/capability/identity/pipeline/resilience/protocol trace
- **NanoClaw**：execution isolation and sandbox policy inspiration
- **Nanobot**：minimum-core discipline and auditability
- **ZeroClaw / PicoClaw**：lightweight data-plane and edge deployment profiles

---

## 1. OpenClaw

### 中间层定位
OpenClaw 是当前最接近目标形态的公开参考之一。它的公开资料体现出明显的 **gateway / control-plane / channel policy / operator-facing self-hosted architecture** 特征，而不是单纯的 bot SDK。

### 渠道接入方式
公开资料显示其面向多渠道接入，包含 Web、IRC 及多种 IM / provider 场景；渠道侧通过配置命名空间和 provider 集成暴露。

### 适配器模型
最值得借鉴的是其 **gateway + RPC adapter** 思路：
- 渠道特性收敛在 provider / channel adapter 边界内
- gateway 作为统一入口与策略执行点
- adapter 通过 RPC / event interface 接入而非直接污染核心逻辑

### 统一消息 / 事件模型
公开的 RPC / event surface 非常关键：
- `/api/v1/events`
- `/api/v1/check`
- JSON-RPC methods：`watch.subscribe`、`watch.unsubscribe`、`send`、`chats.list`

这说明它内部至少存在明确的事件与会话边界，适合作为 canonical event / adapter protocol 的参考。

### Agent 后端对接方式
OpenClaw 更像是 gateway 控制面，后端能力通过 gateway / session / RPC 体系暴露。其优势不在于某个具体 agent runtime，而在于 **中间层先有稳定控制边界**。

### 路由 / 治理 / 可观测性 / 多租户
公开文档能看到较强的治理意识：
- channel policy
- allowlist / mention gating / per-sender tools
- health / doctor / status / usage / ops surface

说明治理与运维能力不是附加特性，而是系统设计的一部分。

### 成熟度与是否适合作为基线
适合作为 **gateway / control-plane / policy / adapter protocol** 的首要基线。

### 值得借鉴
- gateway / control-plane 拆分
- channel policy 不下沉到 Agent
- RPC / event / health / ops 明确化
- self-hosted operator workflow

### 不宜照搬
- 不应默认继承其全部产品边界或 CLI / deployment 细节
- 对外协议仍需结合本项目的 canonical event 与 enterprise governance 重新收敛

---

## 2. Automagik Omni

### 中间层定位
Automagik Omni 是最接近“**omnichannel messaging hub for AI agents**”产品形态的项目，直接贴近目标中的“多聊天入口 -> 统一中间层 -> Agent 后端”。

### 渠道接入方式
公开资料显示支持或计划支持 WhatsApp、Discord、Slack、Telegram、Instagram、Teams 等多渠道。

### 适配器模型
其公开架构明显体现出：
- instance manager
- channel handler / provider integration
- message router
- trace system

这对本项目很有启发：**tenant / instance / channel binding** 是一个自然的企业落地模型。

### 统一消息 / 事件模型
公开资料更多展示处理流水线，而不是完整 schema。但可明显看出以下闭环：
- inbound webhook
- validation / access control
- route to AI agent
- outbound formatting
- trace persistence

### Agent 后端对接方式
公开 API 暴露 `agent_url` / `agent_api_key` 一类字段，说明其典型后端集成方式是 **HTTP-first external agent binding**。

### 路由 / 治理 / 可观测性 / 多租户
其公开描述覆盖：
- multi-tenant instance management
- router
- trace / analytics
- API key auth

这使它在“产品形态”上非常接近目标。

### 成熟度与是否适合作为基线
适合作为 **instance-channel-router-trace 的产品形态参考**，但不建议直接作为依赖底座，原因是公开维护状态与长期活跃度信号偏弱。

### 值得借鉴
- instance 作为配置与隔离单元
- omnichannel admin surface
- router + trace 的显式拆分

### 不宜照搬
- 不应围绕某个现成 REST surface 反向设计平台内核
- 不应把 HTTP agent endpoint 当作唯一 backend adapter 形态

---

## 3. Agent Kernel

### 中间层定位
Agent Kernel 更偏向 **agent runtime portability layer**，不是完整 channel middleware control plane。

### 渠道接入方式
公开材料中存在 Slack / WhatsApp / Messenger 等 messaging handler，但重点仍在 runtime abstraction，而不是企业治理控制面。

### 适配器模型
其核心价值在于 runtime-neutral abstraction：
- Agent
- Runner
- Session
- Module
- Runtime

### 统一消息 / 事件模型
公开资料没有像 Bot Framework 或 OpenClaw 那样强的 canonical event envelope，但对 session / runtime / invocation boundary 的表达较强。

### Agent 后端对接方式
这是它最值得借鉴的部分：
- 多 agent framework portability
- REST / CLI / MCP / A2A / server deployment surfaces
- streaming / runtime boundary 更清晰

### 路由 / 治理 / 可观测性 / 多租户
公开资料更偏 observability、session、runtime portability，对 tenant governance、audit、routing policy 的公开表达相对弱。

### 成熟度与是否适合作为基线
适合作为 **backend adapter contract** 的主要参考；不适合作为整个中间层产品架构的唯一底座。

### 值得借鉴
- backend runtime adapter portability
- session / runner / runtime boundary
- framework-neutral 接口设计

### 不宜照搬
- 不应让 backend runtime 的抽象支配整个平台的 conversation identity 与 governance model

---

## 4. Microsoft Bot Framework

### 中间层定位
Bot Framework 更像成熟的 **adapter + canonical activity + middleware pipeline** 参考架构。

### 渠道接入方式
传统上支持多种渠道与 connector 模式，其长期价值不在产品形态，而在抽象质量。

### 适配器模型
其 adapter 设计对本项目非常关键：
- adapter 负责 translate inbound/outbound
- middleware 负责 processing pipeline
- 允许 short-circuit / outbound interception

### 统一消息 / 事件模型
Bot Framework 的 Activity 模型是本次 canonical event schema 最重要的参考之一。虽然本项目不应直接照抄 Activity schema，但应借鉴其：
- envelope 先于业务 handler
- 多类型 event 同一模型表达
- 渠道细节通过 extension 保留

### Agent 后端对接方式
Bot Framework 不直接给出本项目需要的 backend-agent neutrality，但提供了优秀的消息处理层基线。

### 路由 / 治理 / 可观测性 / 多租户
企业治理并非其最强项，但 middleware sequencing 对 policy insertion 非常有价值。

### 成熟度与是否适合作为基线
适合作为 **canonical event + adapter + middleware sequencing** 的一号参考。

### 值得借鉴
- activity / turn processing 思路
- adapter 与 middleware 的 ownership boundary
- policy / logging / transform 的中间件插入点

### 不宜照搬
- 不应继承其历史包袱或 channel-specific legacy assumptions

---

## 5. Rasa

### 中间层定位
Rasa 的最强价值不在多渠道中间层本身，而在 **append-only event history、tracker、state reconstruction、replayable conversation semantics**。

### 渠道接入方式
支持多渠道接入，但本项目更应借鉴其 conversation state 和 event ledger 思路。

### 适配器模型
其 channel connectors 值得参考，但不是主借鉴点。

### 统一消息 / 事件模型
Rasa 的 tracker / event log 模式说明：
- conversation state 应由 event ledger 重建
- policy decisions 可以成为 event 的一部分
- replay 与 debug 不应依赖隐式可变状态

### Agent 后端对接方式
Rasa 自身有较强内部运行时耦合，因此不适合作为 backend adapter contract 的直接模板。

### 路由 / 治理 / 可观测性 / 多租户
Replay / event history / state introspection 是其最大贡献。

### 成熟度与是否适合作为基线
适合作为 **event ledger + replay + state reconstruction** 的主要参考。

### 值得借鉴
- append-only ledger
- tracker-like materialized state
- replay / inspectability

### 不宜照搬
- 不应把 conversation state 与某个对话框架内部状态机强耦合

---

## 6. opsdroid

### 中间层定位
opsdroid 更像轻量 connector / plugin 风格系统，对大规模企业治理不是主打，但其 connector ergonomics 很值得借鉴。

### 渠道接入方式
通过 connectors / skills / plugins 扩展。

### 适配器模型
它最大的启发在于：**适配器开发体验可以很轻，不一定要先引入重型框架**。

### 统一消息 / 事件模型
模型相对轻量，不足以直接作为企业 canonical schema。

### Agent 后端对接方式
不适合作为 backend runtime neutrality 基线。

### 路由 / 治理 / 可观测性 / 多租户
企业治理能力相对有限。

### 成熟度与是否适合作为基线
适合作为 **connector DX / plugin ergonomics** 参考，不适合作为整体架构底座。

### 值得借鉴
- connector abstraction 的简洁度
- 多实例 connector 的 DX

### 不宜照搬
- 不应把轻量插件模型误当作企业控制面模型

---

## 7. Chatwoot

### 中间层定位
Chatwoot 不是 agent middleware，但它是很强的 **企业会话运营 / inbox / audit / assignment / handoff** 参考对象。

### 渠道接入方式
支持多会话来源与 inbox/operator 模式。

### 适配器模型
并非本项目直接要复用的 connector architecture，但其产品侧状态模型很重要。

### 统一消息 / 事件模型
不是主要借鉴点，但其 audit / inbox / assignment / operator queue 模型有启发。

### Agent 后端对接方式
不适合作为 backend adapter 参考。

### 路由 / 治理 / 可观测性 / 多租户
是此项目最值得借鉴的部分：
- audit logs
- queue / assignment
- operator workflow
- enterprise controls

### 成熟度与是否适合作为基线
适合作为 **运营治理 / human handoff / inbox model** 的强参考，不适合作为整个 middleware core 底座。

### 值得借鉴
- assignment / queue / audit
- operator-facing governance UX

### 不宜照搬
- operator inbox 不应成为核心状态来源；核心状态仍应来自 canonical event ledger

---

## 8. Chaskiq

### 中间层定位
Chaskiq 偏产品平台与 extensibility，对企业运营和扩展接口有参考价值。

### 渠道接入方式
更偏 customer messaging / engagement 平台思路。

### 适配器模型
不是本次主要适配器参考。

### 统一消息 / 事件模型
不是主要借鉴点。

### Agent 后端对接方式
不是主要参考。

### 路由 / 治理 / 可观测性 / 多租户
其价值在于：
- extensibility
- app / integration surface
- 产品化能力

### 成熟度与是否适合作为基线
适合作为 **企业产品化与扩展面** 的补充参考。

### 值得借鉴
- extensibility surface
- 平台型产品边界

### 不宜照搬
- 不应让 CRM / engagement 产品边界影响 middleware 核心协议设计

---

## 9. RoomKit RFC

### 中间层定位
RoomKit 更像一个 **multi-channel conversation framework / conversation runtime**，而不是纯粹的 channel-agent middleware control plane。

### 渠道接入方式
它明确覆盖多 transport、多 provider、多 integration surface，并将 webhook、source provider、WebSocket、voice 统一纳入同一框架抽象。

### 适配器模型
它最强的点之一是：
- channel type / provider 分离
- channel instance、binding、event source 三层元数据边界
- capability declaration 与统一 channel interface

### 统一消息 / 事件模型
其 RoomEvent / timeline / immutable event / sequential index 思路，与本项目的 append-only ledger 与 replay 思想高度接近。

### Agent 后端对接方式
其 AI 设计偏 `AI channel`，这与本项目有明显不同。本项目应维持 transport-side channel adapter 与 runtime-side backend agent adapter 的分层，而不直接采用 `Everything is a Channel`。

### 路由 / 治理 / 可观测性 / 多租户
值得借鉴的部分包括：
- sync / async hook pipeline
- identity resolution pipeline
- capabilities + transcoding
- resilience controls
- protocol trace
- organization / room / participant / identity 的分层

### 成熟度与是否适合作为基线
适合作为 **capability、identity、pipeline、resilience、protocol trace** 的强参考；不适合作为整个 middleware 顶层协议的唯一基线。

### 值得借鉴
- channel type / provider 分离
- capability schema 与 fallback / transcoding
- identity resolution 状态机
- blocked event 也进入 timeline / audit
- lock / idempotency / retry / circuit breaker
- protocol trace 与 canonical event 分层

### 不宜照搬
- `Everything is a Channel`
- AI runtime = channel
- Room 作为唯一状态边界
- side effects 永远不受治理控制
- 当前阶段完整引入 voice-first 复杂度

---

## 10. Secondary OpenClaw-like References

### NanoClaw
更像 security-first assistant runtime，而不是 control-plane-first middleware。

**帮助点：**
- 执行隔离应被视为平台能力
- backend adapter 之后可以挂 execution isolation policy
- host access 最小化可成为 tenant / runtime policy 的一部分

### Nanobot
更像 ultra-light assistant runtime，而不是 enterprise middleware。

**帮助点：**
- CAP 必须重新收敛最小内核
- v1 应可审计、可阅读、可解释
- 先证明最小闭环，再扩能力

### ZeroClaw
更像高效的 Rust runtime。

**帮助点：**
- 轻量 data-plane / worker 可以独立于 control plane
- always-on relay / delivery worker 适合低资源部署

### PicoClaw
更像嵌入式 / edge-friendly assistant。

**帮助点：**
- CAP 可以按部署轮廓分层：control plane 较重，edge/data plane 较轻
- 不应默认所有组件都需要重部署形态

### 注意
上述项目不是主架构参考，不应主导 canonical protocol、routing/governance 或 enterprise control-plane 设计。

## 11. Minimum Kernel Reassessment

基于 RoomKit、Nanobot、NanoClaw 等补充参考，CAP 的最小内核应重新收敛为：
- one inbound channel adapter
- one canonical event ledger
- one policy check stage
- one route decision stage
- one backend agent adapter
- one outbound delivery path
- auditable blocked / failed outcomes

不属于最小内核的内容：
- 全量多渠道覆盖
- 完整 operator inbox 产品面
- 复杂 CRM / ticketing 逻辑
- 重型 realtime / voice 子系统
- 丰富 UI 私有状态管理

## 12. Versioned Delivery Recommendation

### v0 / Protocol Prototype
- 目标：验证统一协议是否足够串起全链路
- 产物：stub channel adapter、stub backend adapter、route rule、ledger walkthrough

### v1 / Minimum Kernel
- 目标：证明一个真实渠道与一个真实 backend 可以稳定跑通
- 范围：real inbound/outbound、replayable ledger、basic governance、basic handoff events

### v2 / Enterprise Middleware
- 目标：企业可落地
- 范围：multi-tenant control plane、queue/assignment projection、redaction/retention、resilience hardening

### v3 / Expanded Product Surface
- 目标：扩大渠道与产品面
- 范围：更多 channels、更多 backend adapters、可选 realtime/media families、 richer operator experiences

## Final Recommendation

### 哪类项目最接近目标
最接近目标的是：
1. **OpenClaw**：最像 gateway / control-plane / policy-first middleware
2. **Automagik Omni**：最像 omnichannel product shape
3. **Agent Kernel**：最像 backend runtime abstraction layer

### 哪些项目只能借鉴局部能力
- **Bot Framework**：借鉴 adapter + middleware + activity，不作为完整底座
- **Rasa**：借鉴 event ledger + replay，不作为完整底座
- **opsdroid**：借鉴 connector DX，不作为完整底座
- **Chatwoot / Chaskiq**：借鉴治理、handoff、运营与 extensibility，不作为 middleware core

### 是否值得直接复用某个现成项目作为底座
当前结论：**不建议。**

原因：
- 没有单一项目同时满足 canonical protocol、backend neutrality、enterprise governance、replay、handoff、multi-channel、self-hosted operator control 这些要求
- 直接复用会让平台边界被现有项目的历史包袱锁定

### 建议采用的组合路线
- **OpenClaw**：借鉴 gateway / control plane / policy / ops
- **Bot Framework**：借鉴 canonical event / adapter / middleware sequencing
- **Rasa**：借鉴 event ledger / replay / reconstruction
- **Agent Kernel**：借鉴 backend runtime adapter portability
- **Omni**：借鉴 instance / channel / router / trace 拆分
- **Chatwoot / Chaskiq**：借鉴 human handoff / queue / assignment / audit / extensibility
- **opsdroid**：借鉴 connector plugin DX
- **RoomKit RFC**：借鉴 channel/provider/capability/identity/pipeline/resilience/protocol trace

最终结论：**组合借鉴多个项目的架构模式，自研中间层。**

## Sources
- OpenClaw repo: https://github.com/openclaw/openclaw
- OpenClaw docs: https://docs.openclaw.ai/
- OpenClaw RPC docs: https://docs.openclaw.ai/reference/rpc
- Automagik Omni repo: https://github.com/namastexlabs/automagik-omni
- Agent Kernel repo: https://github.com/yaalalabs/agent-kernel
- Agent Kernel docs: https://kernel.yaala.ai/
- Microsoft Bot Framework activity flow: https://microsoft.github.io/botframework-solutions/virtual-assistant/handbook/activity-flow/
- Rasa architecture docs: https://rasa.com/docs/rasa/
- Chatwoot docs: https://developers.chatwoot.com/
- Chaskiq site: https://chaskiq.io/
- opsdroid docs: https://docs.opsdroid.dev/