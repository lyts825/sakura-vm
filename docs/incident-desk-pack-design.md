# 事件响应与复盘插件包设计

## 1. 版本与使用结果

设计 3.0.0，2026-10-24；基线 2.7.0 / `912287a`。`incident-desk` 含 10 个拟议插件，运行实现待开始，遵守[第三批总览](plugin-pack-suite-design.md)。

用户将多个任务、日志与人工观察归入一个案例，整理时序、验证假设、记录处置，并形成可追溯复盘。既有[任务证据页](task-evidence.md)继续负责原任务与恢复；本包组织跨任务调查，不接管原领域资源。

首版面向本地开发和运维案例。没有全天候托管监控、外部通知、自动封禁、自动远程处置或对外工单发送。独立使用时可完整完成材料上传到复盘交接；在线处置另需原提供者及明确授权。

## 2. 内部插件与依赖

短依赖前缀为 `incident-`。

| 插件 ID | 专属对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `incident-cases` | 案例范围、严重程度、关联对象和状态；IncidentCasesV1：open、scope、resolve、reopen | — | — |
| `incident-evidence` | 固定日志、指标快照、人工观察与许可；IncidentEvidenceV1：upload、planCapture、capture、redact、pin | cases | @metrics, @service-health |
| `incident-timeline` | 来源时间、观察时间和顺序关系；IncidentTimelineV1：assemble、annotateClock、compare | evidence | — |
| `incident-hypotheses` | 假设、支持/相反依据及待验证项；IncidentHypothesesV1：propose、linkEvidence、decide | cases, evidence, timeline | — |
| `incident-runbooks` | 固定查询、人工步骤和受限处置声明；IncidentRunbooksV1：compile、previewSteps | cases | — |
| `incident-actions` | 原提供者动作计划、批准和结果；IncidentActionsV1：planAction、submitAction、inspect、recordManual | cases, evidence, runbooks | @maintenance, @resilience-runs |
| `incident-reviews` | 证据覆盖、处置核对和复盘审阅；IncidentReviewsV1：open、decide、recheck | evidence, timeline, hypotheses, actions | — |
| `incident-reports` | 事实、推断、措施及未决问题；IncidentReportsV1：draft、seal、compare | cases, evidence, timeline, hypotheses, reviews | — |
| `incident-exchange` | 案例、脱敏材料和复盘交换；IncidentExchangeV1：export、inspectImport、acceptImport | cases, evidence, timeline, hypotheses, runbooks, actions, reviews, reports | — |
| `incident-workbench` | 收集、时间线、假设、处置及复盘；IncidentWorkbenchV1：view、templates | * | — |

可选指标与健康服务只提供经过作用域授权的快照。缺席时支持上传同类材料，但必须标为外来声明。actions 无权按 VM ID 自行停止实例或释放其他插件租约。

## 3. 完整用户流程

1. 选择“应用启动失败”“容量耗尽”或“演练中断”，新建案例并明确影响范围。
2. 逐项选择原任务、指标和日志，预览要复制的材料；也可上传文件或记录人工观察。
3. 建立时间线，对照来源时钟和采集时钟，标注无法确定顺序的事件。
4. 提出假设并关联支持与相反依据，选择固定查询或受限处置步骤。
5. 对每个动作单独查看原提供者计划并批准，保存原操作回执。无法确认的结果保持未知。
6. 分开审阅事实、推断、措施和未决问题，封存复盘，按导出许可交接。

## 4. 证据与处置规则

`EvidenceVersion` 记录原字节摘要、来源修订、来源时间、采集时间及采集方式。复制之后不随原日志更新；刷新生成新版本。脱敏保留原摘要与派生关系，普通导出默认只携带审阅过的派生材料。

时间校正保存为显示注释，不修改原时间。跨主机时钟没有可验证偏差时，不推断严格先后，更不能只凭时间接近认定因果。人工观察、系统记录和导入声明使用不同标记。

假设状态为 `open/supported/contradicted/unresolved`，允许多种解释并存。关闭案例不要求所有假设被证实，但必须公开未决项。报告不将建议写成已经执行的处置。

在线动作通过拟议 DelegatedActionsV1 调用原领域。首版只接入维护清理计划和原演练运行核销，分别沿用提供者的预览、批准与完整身份核对。动作成功不等于事件已经解决；事件解决也不证明资源已释放。

重启恢复案例和原回执，不自动执行 Runbook。取消只撤销后续动作，已发出的操作继续按原提供者状态显示。`recordManual` 只能保存人工声明，不能替代系统动作或清理证明。

## 5. 入口与预算

页面包含案例、证据、时间线、假设、步骤、处置和复盘；CLI 别名为 `incident`。

| 操作 | 拟议 HTTP | CLI | 输出 |
| --- | --- | --- | --- |
| 收集证据 | `/api/incident-evidence/capture` | `incident evidence capture` | 固定来源与复制范围 |
| 整理时间线 | `/api/incident-timeline/assemble` | `incident timeline assemble` | 原时间、校正注释和顺序不确定项 |
| 处置计划/提交 | `/api/incident-actions/planAction`、`submitAction` | `incident action preview/submit` | 提供者计划、原权限与回执 |
| 复盘/交接 | `/api/incident-reports/seal`、`/api/incident-exchange/export` | `incident report seal`、`incident export` | 固定结论、限制及材料清单 |

拟定 500 个案例，每例 500 项证据、100,000 条时间线事件；单文本 16 MiB、结构化日志 32 MiB。单案例派生内容 128 MiB，全包 4 GiB，导出 256 MiB。收集限 5 分钟，绝不为填满时间线而持续监听。超限时要求选择窗口，不静默丢弃关键事件。

## 6. 实施与验收

先完成离线案例、证据和假设，再接通只读快照及两种委派处置，最后完成审阅和交换。原任务恢复接口没有委派支持前，在线处置保持不可用，不写“已执行”。

验收包括三个模板、冲突证据、时钟偏移、脱敏引用、来源撤权、错误目标的处置拒绝、提供者代次变化、人工结果不提升系统状态、响应丢失后的原回执核对、重启与并发案例修改。证据中的脚本、链接和嵌入指令不执行；导出报告不发送给任何外部服务。
