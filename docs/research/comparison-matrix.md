# Comparison Matrix

## Matrix

### Primary References
These directly influence the target architecture:
- OpenClaw
- Automagik Omni
- Agent Kernel
- Microsoft Bot Framework
- Rasa
- RoomKit RFC

### Secondary References
These influence implementation style, deployment profile, or selected subsystem choices:
- Chatwoot
- Chaskiq
- opsdroid
- NanoClaw
- Nanobot
- ZeroClaw
- PicoClaw

| Project | Primary role | Middleware fit | Channel adapter quality | Canonical schema maturity | Backend agent abstraction | Routing / governance / audit | Replay / event history | Tenancy / identity mapping | Extensibility | Deployment maturity | Recommendation |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| OpenClaw | Gateway / control plane | 5 | 4 | 4 | 3 | 5 | 3 | 3 | 4 | 5 | **Borrow** gateway, policy, RPC, ops |
| Automagik Omni | Omnichannel middleware product shape | 4 | 4 | 3 | 3 | 3 | 2 | 4 | 3 | 3 | **Inspire** instance/router/trace split |
| Agent Kernel | Agent runtime portability | 2 | 3 | 2 | 5 | 2 | 2 | 2 | 4 | 4 | **Borrow** backend adapter portability |
| Bot Framework | Activity / adapter / middleware model | 4 | 5 | 5 | 2 | 4 | 2 | 2 | 4 | 4 | **Borrow** canonical event + middleware sequencing |
| Rasa | Event ledger / tracker / replay | 3 | 3 | 4 | 2 | 3 | 5 | 2 | 3 | 4 | **Borrow** event history + replay |
| opsdroid | Connector / plugin ergonomics | 2 | 4 | 2 | 1 | 1 | 1 | 1 | 4 | 3 | **Inspire** connector DX |
| Chatwoot | Enterprise inbox / audit / handoff | 2 | 2 | 2 | 1 | 5 | 3 | 4 | 3 | 5 | **Borrow** governance / queue / assignment / audit |
| Chaskiq | Extensible messaging platform | 2 | 2 | 2 | 1 | 3 | 2 | 3 | 4 | 3 | **Inspire** extensibility surface |
| RoomKit RFC | Multi-channel conversation framework | 4 | 5 | 4 | 2 | 4 | 4 | 4 | 5 | 2 | **Borrow/Inspire** capabilities, identity, pipeline, resilience |
| NanoClaw | Security-first assistant runtime | 2 | 1 | 1 | 2 | 2 | 1 | 1 | 2 | 3 | **Inspire** execution isolation policy |
| Nanobot | Minimal assistant runtime | 2 | 1 | 1 | 2 | 1 | 1 | 1 | 3 | 4 | **Inspire** minimum-core discipline |
| ZeroClaw | Ultra-light Rust runtime | 2 | 2 | 2 | 3 | 1 | 1 | 1 | 3 | 5 | **Inspire** lightweight data-plane deployment |
| PicoClaw | Embedded-friendly Go assistant | 1 | 2 | 1 | 2 | 1 | 1 | 1 | 2 | 5 | **Inspire** edge deployment profile |

## Borrow / Inspire / Avoid / Depend-on

### OpenClaw
- **Borrow**:
  - gateway / control-plane decomposition
  - session scope and channel policy
  - RPC / SSE / health / operator ops surface
- **Avoid**:
  - 直接继承其所有产品边界与现成部署细节
- **Depend-on**:
  - 否

### Automagik Omni
- **Borrow / Inspire**:
  - instance manager
  - channel-router-trace 拆分
  - omnichannel middleware product shape
- **Avoid**:
  - 直接把 HTTP agent endpoint 视为唯一后端契约
- **Depend-on**:
  - 否

### Agent Kernel
- **Borrow**:
  - backend runtime portability
  - runner / session / runtime boundary
  - framework-neutral adapter contract
- **Avoid**:
  - 让 backend runtime 模型主导 middleware conversation identity
- **Depend-on**:
  - 否

### Bot Framework
- **Borrow**:
  - canonical activity / event envelope
  - adapter boundary
  - middleware sequencing
  - short-circuit / outbound interception
- **Avoid**:
  - legacy channel assumptions
- **Depend-on**:
  - 否

### Rasa
- **Borrow**:
  - append-only ledger
  - tracker-like projection
  - replay / state reconstruction
  - policy decision as events
- **Avoid**:
  - 与单一对话框架状态机强耦合
- **Depend-on**:
  - 否

### opsdroid
- **Borrow / Inspire**:
  - connector ergonomics
  - plugin-style adapter DX
  - 多实例 connector 配置体验
- **Avoid**:
  - 把轻量插件系统误当成企业控制面
- **Depend-on**:
  - 否

### Chatwoot
- **Borrow**:
  - queue / assignment / inbox / audit / handoff 模型
- **Avoid**:
  - operator inbox 成为核心状态来源
- **Depend-on**:
  - 否

### Chaskiq
- **Borrow / Inspire**:
  - extensibility surface
  - platform-style integration model
- **Avoid**:
  - CRM / engagement 产品边界反向污染 middleware 协议
- **Depend-on**:
  - 否

### RoomKit RFC
- **Borrow / Inspire**:
  - channel type / provider 分离
  - capability schema
  - content transcoding / fallback 规则
  - identity resolution pipeline
  - inbound pipeline 的步骤化表达
  - resilience controls（lock / idempotency / retry / circuit breaker）
  - blocked event 也进入 timeline / audit
  - protocol trace 设计
- **Avoid**:
  - `Everything is a Channel` 作为顶层协议模型
  - 将 AI runtime 直接建模为 transport-like channel
  - 把 Room 作为唯一状态边界
  - side effects 永远不受治理约束
- **Depend-on**:
  - 否

### NanoClaw
- **Inspire**:
  - containerized execution isolation
  - host access minimization
  - security as platform concern
- **Avoid**:
  - 把安全隔离实现等同于中间层核心协议
- **Depend-on**:
  - 否

### Nanobot
- **Inspire**:
  - 最小可审计内核
  - v1 范围控制
  - 小代码面实现策略
- **Avoid**:
  - 将极简 runtime 误当成企业控制面
- **Depend-on**:
  - 否

### ZeroClaw
- **Inspire**:
  - 轻量 data-plane / worker 部署思路
  - 低资源常驻运行模型
- **Avoid**:
  - 用 runtime efficiency 替代 protocol/governance 设计
- **Depend-on**:
  - 否

### PicoClaw
- **Inspire**:
  - edge / embedded deployment profile
  - control plane 与 data plane 重量分离思路
- **Avoid**:
  - 让嵌入式约束主导整个企业协议层
- **Depend-on**:
  - 否

## Build-vs-Adopt by Subsystem

| Subsystem | Decision | Rationale |
|---|---|---|
| Gateway / Control Plane | Build | 产品核心边界；需统一 policy、routing、tenant isolation、ops |
| Canonical Event Schema | Build | 必须围绕自身协议定制；参考 Bot Framework + Rasa |
| Channel Adapter SDK / Contract | Build | 需统一 ingress/egress/idempotency/capabilities/test contract |
| Backend Agent Adapter Contract | Build | 需对接多 runtime；参考 Agent Kernel |
| Event Ledger / Replay / Audit Logic | Build | 属于系统事实来源与治理核心 |
| Storage Engine | Adopt | 先选择能支撑 ledger/replay/audit 的 durable store，具体技术单独选型 |
| Queue / Broker | Optional Adopt Later | 初期可不强依赖 Kafka / NATS |
| Operator Inbox UX | Borrow ideas, build later | 先把 handoff state 设计成 canonical event projection |

## Final Recommendation

### Recommended baseline composition
- **OpenClaw**：gateway / control-plane / policy / ops
- **Bot Framework**：canonical event / adapter / middleware sequencing
- **Rasa**：ledger / replay / reconstruction
- **Agent Kernel**：backend runtime portability
- **Omni**：instance / router / trace product shape
- **Chatwoot / Chaskiq**：governance / handoff / assignment / extensibility
- **opsdroid**：connector DX
- **RoomKit RFC**：channel/provider/capability/identity/pipeline/resilience 细化

### Final choice
**组合借鉴多个项目的架构模式，自研中间层。**