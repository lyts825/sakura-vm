# 跨包流程插件包设计

## 1. 版本与使用结果

设计 3.0.0，2026-10-24；基线 2.7.0 / `912287a`。`flow-studio` 含 10 个拟议插件，实现待开始，共同约定见[第三批总览](plugin-pack-suite-design.md)。

用户将固定材料、领域操作、人工审批和等待节点组成长期流程，逐步保存原提供者回执。现有[流水线](pipeline-graph.md)继续编排项目任务；本包重点处理跨领域计划、人工等待及中断后的原操作核对，不提供通用 Shell 或任意 HTTP 自动化。

首版支持有向无环图、固定条件、人工材料确认和绝对时间等待。循环、脚本表达式、动态节点及后台无人审批的写操作不支持。输入或提供者状态变化后，相关阶段必须重新预览。

## 2. 内部插件与依赖

短依赖前缀为 `flow-`。

| 插件 ID | 专属对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `flow-definitions` | 空间、图结构和固定节点类型；FlowDefinitionsV1：compile、validate | — | — |
| `flow-inputs` | 固定材料、变量及绑定规则；FlowInputsV1：upload、bind、resolve | definitions | — |
| `flow-connectors` | 静态提供者适配目录、能力和版本；FlowConnectorsV1：catalogue、inspectProvider | definitions | @integration-runners, @integration-reports, @knowledge-publish |
| `flow-plans` | 图计划和逐阶段领域计划；FlowPlansV1：previewFlow、previewStep、invalidate | definitions, inputs, connectors | — |
| `flow-approvals` | 当前主体对具体阶段的批准与撤销；FlowApprovalsV1：approve、revoke、inspect | plans | — |
| `flow-journal` | 有序事件、原始提供者回执及保护引用；FlowJournalV1：readTimeline、verify | definitions | — |
| `flow-runs` | 节点推进、取消与原任务核对；FlowRunsV1：start、advance、cancel、reconcile | plans, approvals, connectors, journal | — |
| `flow-timers` | 持久等待和到期记录；FlowTimersV1：scheduleWait、due、cancelWait | runs, approvals | — |
| `flow-exchange` | 定义、固定材料与历史交换；FlowExchangeV1：export、inspectImport、acceptImport | definitions, inputs, connectors, plans, approvals, journal, runs, timers | — |
| `flow-workbench` | 图编辑、审批箱、时间线和恢复；FlowWorkbenchV1：view、templates | * | — |

没有必需的外部插件。可选服务缺席时，相关节点显示未就绪，允许编辑但拒绝执行。首版须落实接口验证和知识发布两个真实适配器；全包验收包括启用与缺席两种组合。

## 3. 完整用户流程

1. 选择“材料审阅与等待”“接口验证后人工放行”或“文稿批准后本机发布”，创建流程。
2. 固定输入和节点条件，检查环、未声明变量、缺少适配器及失效来源。
3. 预览整体拓扑和预计步骤；只有依赖结果已固定的节点，才能生成具体动作计划。
4. 审阅当前节点的完整参数、原提供者计划和范围，批准后执行。下一阶段未知输入不会提前获得授权。
5. 进入人工或时间等待，之后再次核对授权。失败时按原回执决定继续、跳过或结束。
6. 交接流程定义及历史，明确哪些节点是人工声明，哪些由真实提供者确认。

## 4. 委派、状态与恢复

connectors 是编译时审核的适配表，每项固定提供者服务版本、输入/输出模式、预览、提交、查询与收尾方法。用户不能指定任意服务、HTTP 路径或方法名。变量只能进入声明的字段，不能决定权限、目标范围或执行代码。

拟议 DelegatedActionsV1 由原提供者签发一次动作票据，绑定批准者、调用消费者、输入摘要及 generation。流程审批不是第二套权限系统；原提供者仍独立准入、持有资源并生成真实回执。现有 V1 不支持委派的部分必须新增窄接口。

节点状态为 `blocked/ready/awaiting-approval/running/waiting/completed/failed/unknown/cancelled`。调度以预期修订比较交换，重复 advance 返回原节点运行；发送后失联先查询原回执，unknown 阻止后继节点。

宿主重启后恢复时间线和等待状态，所有旧写入批准失效。定时到期只把节点标为待处理，不自动执行领域动作。执行中的原提供者任务按原权能收尾；停止等待不等于终止已经发出的任务。

取消阻止后续节点，支持停止的提供者按原句柄取消；不支持或结果未知时明确保留。补偿是新的显式节点和计划，不推导为自动回滚，也不删除原成功记录。人工标记“已处理”不能制造提供者的清理证明。

## 5. 入口与预算

页面包含定义、输入、提供者、预览、审批箱、运行时间线和交接。CLI 别名 `flow`。

| 操作 | 拟议 HTTP | CLI | 输出 |
| --- | --- | --- | --- |
| 图/阶段预览 | `/api/flow-plans/previewFlow`、`previewStep` | `flow plan preview/step` | 固定图及当前可授权输入 |
| 明确批准 | `/api/flow-approvals/approve` | `flow approval approve` | 绑定当前主体的单阶段票据 |
| 推进/核对 | `/api/flow-runs/advance`、`reconcile` | `flow run advance/reconcile` | 原操作回执或 unknown |
| 等待/导出 | `/api/flow-timers/scheduleWait`、`/api/flow-exchange/export` | `flow wait create`、`flow export` | 绝对等待点及无执行权限的包 |

拟定 200 个定义，每定义 100 个节点、200 条边；每空间 1 个活动流程，全包 8 个。单流程最多 10,000 条事件，等待最长 30 天，控制材料与记录总量 1 GiB，导出 128 MiB。外部动作继续计入原提供者和宿主预算，不在流程层重复发放 VM 额度。

## 6. 实施与验收

先实现纯图、材料、人工审批和等待；再通过委派门禁并接通两个实际提供者；最后完成故障恢复、交换和页面。不能把模拟提供者通过当作跨包执行完成。

验收覆盖三个模板、并发推进只执行一次、提前批准未知输入拒绝、权限/代次改变、等待过期、计时器重复触发、提供者缺席、发送后断线、重启不重放、取消不误停替换任务和补偿需新批准。导入历史只能作为参考，审批、等待和未完节点不能在接收端自动启动。
