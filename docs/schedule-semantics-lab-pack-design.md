# 调度语义实验插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；应用保持 2.8.1，核对基线为 `4afb3b9a`。包 ID 为 `schedule-semantics-lab`，含 14 个拟议插件，运行实现待开始。共同约定见[第七批总览](plugin-pack-seventh-design.md)。

用户定义周期、日历、时区、错过触发和重试规则，观察固定时间段内的触发序列。交付调度规范、虚拟轨迹、固定工具实测和差异报告。适用于周期任务开发者及运维规则维护者。

本包拥有调度语义的实验材料与判断。[自动化规则](automation-rules.md)和现有 `automation-scheduler` 继续负责真实业务调度。本包启用、导入或封存均不创建生产计划。

## 2. 内部插件与直接依赖

每个服务均为拟议 V1。表中依赖使用完整 ID；`@projects` 表示基线已有插件。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `schedlab-spaces` 调度空间 | 空间、授权修订和额度根账本；SchedlabSpacesV1：create、list、archive | — | — |
| `schedlab-calendars` 日历集合 | 工作日、排除日期和显式节假日材料；SchedlabCalendarsV1：save、validate、seal | `schedlab-spaces` | — |
| `schedlab-clocks` 时钟档案 | 时区数据库版本、墙上时间与单调时间映射；SchedlabClocksV1：save、resolve、seal | `schedlab-spaces` | — |
| `schedlab-rules` 周期规则 | 固定间隔和受限五字段周期表达式；SchedlabRulesV1：save、expand、seal | `schedlab-spaces`, `schedlab-calendars`, `schedlab-clocks` | — |
| `schedlab-policies` 触发策略 | 重叠、错过、重试和退避策略；SchedlabPoliciesV1：save、validate、seal | `schedlab-spaces` | — |
| `schedlab-workloads` 工作负载 | 固定任务时长、确定性失败点与幂等键模型；SchedlabWorkloadsV1：save、validate、seal | `schedlab-spaces` | — |
| `schedlab-scenarios` 场景编排 | 时钟跳变、暂停、重启和规则修订时间表；SchedlabScenariosV1：compose、preview、seal | `schedlab-spaces`, `schedlab-clocks`, `schedlab-rules`, `schedlab-policies`, `schedlab-workloads` | — |
| `schedlab-simulations` 虚拟推进 | 虚拟事件队列、触发原因与模拟回执；SchedlabSimulationsV1：preview、run、cancel、reconcile | `schedlab-spaces`, `schedlab-calendars`, `schedlab-clocks`, `schedlab-rules`, `schedlab-policies`, `schedlab-workloads`, `schedlab-scenarios` | — |
| `schedlab-harness` 固定调度器 | 专属客户机工具会话、真实时钟探针与资源票据；SchedlabHarnessV1：preview、start、cancel、reconcile | `schedlab-spaces`, `schedlab-rules`, `schedlab-policies`, `schedlab-workloads`, `schedlab-scenarios`, `@projects` | — |
| `schedlab-observations` 触发观察 | 原始触发流、序号、丢失声明与时间换算；SchedlabObservationsV1：capture、readEvents、coverage | `schedlab-spaces`, `schedlab-clocks`, `schedlab-simulations`, `schedlab-harness` | — |
| `schedlab-checks` 语义判断 | 漏发、重复、顺序、延迟和退避比较；SchedlabChecksV1：evaluate、compare、explain | `schedlab-spaces`, `schedlab-rules`, `schedlab-policies`, `schedlab-scenarios`, `schedlab-observations` | — |
| `schedlab-reports` 调度报告 | 规则版本、覆盖范围、人工说明和核销索引；SchedlabReportsV1：assemble、review、seal | `schedlab-spaces`, `schedlab-scenarios`, `schedlab-simulations`, `schedlab-harness`, `schedlab-observations`, `schedlab-checks` | — |
| `schedlab-exchange` 调度交接 | 规则、场景与报告的隔离交换；SchedlabExchangeV1：export、inspectImport、acceptImport | `schedlab-spaces`, `schedlab-calendars`, `schedlab-clocks`, `schedlab-rules`, `schedlab-policies`, `schedlab-workloads`, `schedlab-scenarios`, `schedlab-simulations`, `schedlab-harness`, `schedlab-observations`, `schedlab-checks`, `schedlab-reports` | — |
| `schedlab-workbench` 调度工作台 | 日历、双时钟轨迹、差异和恢复导航；SchedlabWorkbenchV1：view、templates | `schedlab-spaces`, `schedlab-calendars`, `schedlab-clocks`, `schedlab-rules`, `schedlab-policies`, `schedlab-workloads`, `schedlab-scenarios`, `schedlab-simulations`, `schedlab-harness`, `schedlab-observations`, `schedlab-checks`, `schedlab-reports`, `schedlab-exchange` | — |

所有非根插件直接查询空间授权和额度。harness 保存原工具字节，observations 保存带来源的标准化事件；两者分别计费，不把转换后的时间覆盖到原记录。

## 3. 模板与完整流程

| 模板 | 初始材料 | 用户得到的结果 |
| --- | --- | --- |
| 跨时区日报 | 本地 02:30、固定时区版本和夏令时转换日期 | 缺失及重复本地时间的处理清单 |
| 长任务与重试 | 30 秒周期、45 秒任务、两次固定失败 | 排队、跳过、并行及退避差异 |
| 停机后恢复 | 暂停区间、持久游标和错过触发上限 | 补发边界、重新准入及重复触发证据 |

1. 创建空间，选择模板并固定规则语言与时区数据库版本。
2. 导入日历 JSON，编辑触发、错过、重叠和失败策略；冲突即时定位到字段。
3. 编排任务时长、暂停与时钟变化，展开全部预期触发及排除原因。
4. 预览窗口、最大事件数、截止及工具版本，提交有界虚拟推进。
5. 对可支持的规则选择固定调度器，在新建的专属客户机执行真实短周期探针。
6. 按计划时间、实际时间和观察时间比较；人工解释只追加，不移除失败。
7. 核销原工具进程、连接和客户机，封存结果；导出、离线核验后隔离接收。

## 4. 时间与执行规则

首版导入 UTF-8 JSON，时间统一保存 UTC 时刻及原时区标识。周期语言明确限定五字段的枚举、范围和步长；不支持的宏、秒字段或供应商语法直接拒绝。日历来自用户固定材料，不自动认定法定节假日。

夏令时缺失时间的策略只能为跳过或移到首个有效时刻；重复时间选择较早、较晚或两次。每次触发记录规则修订、本地候选、UTC 实际时刻和策略原因。闰秒及未提供的时区版本报告不支持。

间隔规则明确以单调时间或墙上时间为基准。固定速率与前次完成后计时分别建模；重叠策略记录拒绝、排队或有界并行。虚拟任务的幂等键只用于观察去重，不承诺真实业务恰好执行一次。

拟议本体接口 `ScheduleModelComputeV1` 提供确定性事件推进；`SchedulerProbeSessionsV1` 提供固定工具握手、真实事件流和原会话核销。两者须独立登记，不能将既有任务调度接口当作虚拟时钟或任意命令入口。

实测只支持经验证的工具和平台组合。默认无外部网络、宿主挂载或公开端口。墙上时间跳变仅作用于工具时钟适配，不修改宿主时钟；无法提供独立截止时拒绝实测。

## 5. 页面、HTTP 与 CLI

工作台包含规则编辑、日历排除、时间轴、逐触发详情、对比、报告和恢复页。时间轴必须显示时区、折叠区间、总事件数与缺失范围；列表分页不缩小批准窗口。

| 拟议 HTTP | 对应服务方法 | 用途 |
| --- | --- | --- |
| `POST /api/schedlab-rules/expand` | SchedlabRulesV1.expand | 展开固定窗口及排除原因 |
| `POST /api/schedlab-scenarios/preview` | SchedlabScenariosV1.preview | 固定全部场景、预算和工具 |
| `POST /api/schedlab-simulations/run` | SchedlabSimulationsV1.run | 创建虚拟推进任务 |
| `POST /api/schedlab-harness/start` | SchedlabHarnessV1.start | 消费固定计划并启动专属探针 |
| `POST /api/schedlab-checks/evaluate` | SchedlabChecksV1.evaluate | 判断触发与策略的一致性 |
| `POST /api/schedlab-harness/reconcile` | SchedlabHarnessV1.reconcile | 核对原执行与清理票据 |
| `POST /api/schedlab-exchange/acceptImport` | SchedlabExchangeV1.acceptImport | 接受通过校验的隔离材料 |

CLI 拟为 `sakura schedule-lab`，提供 rules、simulate、probe、compare、report、exchange 和 verify 子命令。异步提交返回原 runId；status、wait 和 cancel 查询同一任务，退出码沿总览。

## 6. 容量、权限与恢复

设计上限为每空间 500 条规则、100 份日历、每场景 100,000 个虚拟事件和 366 天窗口。单次虚拟推进 60 秒；实测最长 10 分钟、最多 2 个并发任务及 10,000 条事件，原始流不超过 32 MiB。

每包持久上限拟为 512 MiB，含 32 MiB 恢复账本。专属客户机另按虚拟磁盘容量预留；与既有 8 GiB 总量的准入尚须实施。超出窗口、事件、磁盘或计算预算时明确截停，不把前缀轨迹判为全窗通过。

权限沿现有 owner 会话，服务端绑定 actor、空间、generation 和授权修订。真实探针计划固定输入、目标、输出与绝对截止；旧计划重复提交只查询原回执，未知执行不重发。

取消先停止调度准入，再核销原进程和 VM。控制器退出或迟到事件保留 interrupted 与 cleanup-pending，只有原提供者确认后才归还容量。计划完成、语义通过和清理确认分别显示。

交接使用 `sakura-schedule-semantics-lab/1`，导出 JSON 规则、分段轨迹和报告。导入不携带可执行计划、VM 身份或触发权限。升级预览迁移，保留旧字节及回执；降级不理解新时钟语义时拒绝写入。

## 7. 实施与验收

实施依次完成材料与模型、本体固定探针、页面与交接，最后核验独立安装产物。状态全部为待开始；模板与文档不计作运行证据。

| 场景 | 必须观察的结果 |
| --- | --- |
| 春季缺失时刻 | 跳过与顺延产生不同且可解释的事件，原本地候选保留 |
| 秋季重复时刻 | 三种策略分别产生一条早时刻、一条晚时刻或两条不同 UTC 事件 |
| 任务长于周期 | 排队、跳过和有界并行结果匹配各自策略；达到队列上限明确失败 |
| 时钟后退 | 单调间隔不重复，墙上时间规则按固定策略处理并记录原因 |
| 重启与补发 | 只对规定窗口和数量产生补发；未知业务回执不重放 |
| 模型与实测比较 | 展示二者来源和容差，实测缺项不由模拟填成通过 |
| 撤权或取消 | 拒绝新触发，原工具和 VM 实际退出后确认清理 |
| 导入与升级失败 | 篡改轨迹或未知模式拒绝接受，旧材料可读且保留原恢复入口 |
