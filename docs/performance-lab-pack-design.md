# 性能基准与剖析插件包设计

## 1. 版本与使用结果

设计版本 4.0.0，日期 2026-10-25。核对基线为应用 2.7.0 / `237d7bc`，工作区中的 2.8.0 实施另行验收。包 ID 为 `performance-lab`，含 12 个拟议插件，运行实现待开始。共同规则见[第四批总览](plugin-pack-next-design.md)。

用户固定候选制品、工作负载和测量环境，重复运行基准，比较性能变化并定位热点。交付结果包括逐次观测、可比性说明、统计区间、性能预算结论和剖析证据。结果只适用于记录的运行环境与工作负载。

[接口集成验证](integration-lab.md)负责请求语义和有限负载；[客户机火焰图](flamegraph.md)及[内核分析](ebpf-profiler.md)保留原采集权威。本包增加基准实验设计、重复样本、环境干扰记录和退化判定。已有图表可作为上传参考，不会变成本包真实采样回执。

首版只运行本包新建的专用虚拟机和本地目标制品。内置计算、序列化和本地请求模板各有固定工具适配；不把任意 URL 或任意宿主命令作为基准目标。没有可用采样器时可以运行计时实验，剖析项明确为未支持。

## 2. 内部插件与直接依赖

服务、方法及入口均为拟议接口。完整依赖使用精确插件 ID，`—` 表示无依赖；公共读写、保护引用和清理方法遵循总览。

| 插件 ID | 自有对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `perf-targets` | 工作空间、候选制品及目标入口档案；PerfTargetsV1：upload、pin、inspect | — | `delivery-artifacts` |
| `perf-workloads` | 固定输入、规模、到达模式和预热规则；PerfWorkloadsV1：validate、compile、estimate | `perf-targets` | — |
| `perf-environments` | 镜像、工具、资源和时钟能力档案及探测会话；PerfEnvironmentsV1：preview、probe、seal、compare、cancel、reconcile | `perf-targets`、`projects` | — |
| `perf-budgets` | 性能阈值、指标方向及适用范围；PerfBudgetsV1：define、validate、seal | `perf-targets` | — |
| `perf-experiments` | 对照/候选、交错顺序、重复次数、预算修订与停止规则；PerfExperimentsV1：compose、preview、seal | `perf-targets`、`perf-workloads`、`perf-environments`、`perf-budgets` | — |
| `perf-runners` | 专用虚拟机、基准会话、运行窗口和原始输出；PerfRunnersV1：preview、start、cancel、reconcile | `perf-targets`、`perf-workloads`、`perf-environments`、`perf-experiments`、`projects` | — |
| `perf-samples` | 归一化逐次样本、缺失与异常注释；PerfSamplesV1：extract、annotate、coverage | `perf-targets`、`perf-runners` | — |
| `perf-profiles` | 固定剖析计划、采样会话及热点报告；PerfProfilesV1：preview、capture、compare、cancel、reconcile | `perf-targets`、`perf-environments`、`perf-runners`、`projects` | — |
| `perf-comparisons` | 可比性、效应大小、统计区间及预算判定；PerfComparisonsV1：evaluate、explain、recompute | `perf-targets`、`perf-workloads`、`perf-environments`、`perf-budgets`、`perf-experiments`、`perf-samples` | — |
| `perf-reports` | 实验汇总、干扰说明、预算结论和证据索引；PerfReportsV1：assemble、seal | `perf-targets`、`perf-environments`、`perf-experiments`、`perf-runners`、`perf-samples`、`perf-profiles`、`perf-comparisons`、`perf-budgets` | — |
| `perf-exchange` | 实验、样本和报告封套及隔离接收；PerfExchangeV1：export、inspectImport、acceptImport | `perf-targets`、`perf-workloads`、`perf-environments`、`perf-experiments`、`perf-runners`、`perf-samples`、`perf-profiles`、`perf-comparisons`、`perf-budgets`、`perf-reports` | — |
| `perf-workbench` | 模板、实验进度、样本对照和热点导航；PerfWorkbenchV1：view、templates | `perf-targets`、`perf-workloads`、`perf-environments`、`perf-experiments`、`perf-runners`、`perf-samples`、`perf-profiles`、`perf-comparisons`、`perf-budgets`、`perf-reports`、`perf-exchange` | — |

工作空间与容量账本归 targets，其余插件直接核对其授权。samples 保存解析后的样本，原始字节仍归 runners。environments 拥有原探测会话，profiles 为单独批准的复测创建自己的会话；不得向已经结束的计时运行补写剖析数据。没有 `delivery-artifacts` 时上传制品即可完成整包流程。

## 3. 完整用户流程

1. 选择计算、序列化或本地请求模板，上传对照和候选制品，固定输入与入口协议。
2. 选择已准备镜像，预览并批准专用探测会话，确认计时、工具和采样能力。保存环境档案及未支持项，并核销原探测资源。
3. 编排规模、预热、重复次数和对照顺序，固定指标、比较方法、预算与停止规则。
4. 预览全部运行单元及资源。批准后按计划创建专用虚拟机，执行交错的对照与候选运行。
5. 检查样本完整性和干扰记录。保留全部原值，对排除样本逐项记录理由，产生新的分析修订。
6. 阅读可比性、变化量和区间；需要定位热点时另行批准剖析复测，核对剖析开销及差异。
7. 按预设预算生成通过、失败或不确定结论，明确未覆盖的规模和环境；确认计时、采样、目标进程及原虚拟机全部清理。
8. 封存包含执行资源清理回执的最终报告，导出指定样本与证据，再核销传输租约。接收端离线重算比较。

## 4. 实验、统计与资源身份

`ExperimentRevision` 固定两类目标摘要、工作负载、资源、重复次数、排列种子、预热和停止条件。`EnvironmentObservation` 保存实际虚拟 CPU、内存、镜像、工具版本和可读取的宿主干扰指标。用户提供的硬件标签与实际探测值分开保存。

每个 `Trial` 记录目标、序号、开始/结束的单调时钟、计量单位、处理数量和状态。延迟记录明确采样方式，吞吐量保留原分子及实际时窗。超时、丢失、零样本及部分完成不能填为零耗时或计入成功样本。

比较规则在执行前封存。首版提供固定实现的均值、中位数、指定分位数及重复抽样区间，方法版本随结果保存。每种方法声明最小样本量、独立性假设和适用粒度；不满足条件时输出不确定。不得因首次结果不好而自动追加运行直至通过。

budgets 拥有预算定义，分别声明绝对上限、允许退化量、指标方向及分母。experiments 在运行前固定 `budgetRevision`。comparisons 读取该修订，拥有逐指标判定和理由，不能修改阈值。后续预算修订不改变已有实验及其结果。

对照值为零、单位不同、样本方式改变或环境不匹配时，拒绝计算百分比结论。多个指标逐项呈现；总体通过要求所有必选指标通过，未覆盖项保留。

剖析复测通常具有不同开销，报告将其单独列出。热点关联只说明观测关系，不直接认定性能变化原因。剖析失败不修改原计时结果；原计划要求剖析证据时，缺项阻止完整报告通过。

拟议 `BenchmarkSessionsV1` 运行固定基准工具；拟议 `PerformanceCaptureV1` 管理固定采样器和原进程身份。两者必须具备有界输出、硬截止和完整后代清理。工具缺少所需能力时拒绝该模式，不能用宿主定时器宣称已终止客户机进程。

定义采用 draft → sealed → archived，实验及清理状态沿用总览。分析修订不可覆盖原始样本；人工排除样本必须同时显示排除前后结果。重跑产生新 trial，重启后先核对旧任务，不能自动补跑缺失次数。

清理待确认的中间报告可以保留观测结论，但不算完整交付。后到清理回执产生新报告修订；原报告保持原状态。导出传输完成与租约核销归后续交接账本，封套不声称包含自身传输完成证明。

## 5. 页面、HTTP 与 CLI

页面包含目标、环境、实验矩阵、逐次样本、比较、预算、剖析和报告。图表可切换原值、分布和时间顺序，并显示缺失数量。CLI 别名为 `perf`，以下命令前缀均为 `sakura`。

| 操作 | 拟议 HTTP | CLI | 返回要点 |
| --- | --- | --- | --- |
| 探测环境 | `/api/perf-environments/probe` | `perf environment probe` | 真实能力及未支持项 |
| 预览实验 | `/api/perf-experiments/preview` | `perf experiment preview` | 全部运行单元、顺序和预算 |
| 开始/核销 | `/api/perf-runners/start`、`/api/perf-runners/reconcile` | `perf run start/reconcile` | 原任务、已完成次数及清理 |
| 比较样本 | `/api/perf-comparisons/evaluate` | `perf compare evaluate` | 方法、变化量、区间及可比性 |
| 剖析复测 | `/api/perf-profiles/capture` | `perf profile capture` | 独立计划及原进程回执 |
| 导出报告 | `/api/perf-exchange/export` | `perf export` | 样本、方法版本与准确材料清单 |

## 6. 容量、异常与恢复

拟定单实验最多 24 个条件、每条件 30 次观测，总计最多 240 次。全包最多 1 个活动工具会话，探测、计时和剖析互斥。比较目标在同一资源档案下顺序运行。单次观测最长 5 分钟，实验最长 2 小时；最多 1 台虚拟机，最多 4 vCPU、8 GiB 内存、16 GiB 虚拟磁盘。

单目标 512 MiB，单次原始样本 64 MiB，单次剖析 256 MiB，总存储 64 GiB，导出 2 GiB。大型样本采用分块读取和有界统计；不在页面装入全部原始记录。包内并发限制无法控制其他宿主任务，报告必须保留可检测到的干扰及未知部分。

| 情况 | 结果与恢复要求 |
| --- | --- |
| 时钟异常、样本缺失或记录截断 | 标注对应 trial 无效，保留原记录；不补造观测 |
| 环境或目标摘要改变 | 比较不可用或计划失效，重新固定输入 |
| 噪声大、样本不足或区间跨阈值 | 结论不确定；扩大实验需要新计划 |
| 采样器不支持或权限不足 | 仅对应剖析模式未支持，禁止伪造空热点报告 |
| 控制器退出、取消或硬截止 | 停止新调度，保留已确认 trial，核销原进程及虚拟机 |
| 清理未知、导出未确认 | 继续保留额度和保护引用，不当作可复用空闲资源 |

## 7. 实施前置与验收

P0 完成两种窄会话的实机门禁和指标协议。P1 完成实验、样本和版本化统计；P2 完成预算、剖析导航及离线重算。比较算法需要独立参考数据验证，设计文档不承诺某个硬件的速度或测量精度。

- 三个模板均产生真实逐次观测，报告可追溯到目标、工具及原虚拟机身份。
- 已知性能变化的受控样例按固定方法得到正确方向；噪声样例能输出不确定。
- 零对照、错单位、未完成 trial 和样本不足不会产生伪造的退化百分比。
- 环境改变、手动排除样本和剖析复测均保留独立修订及原始结果。
- 固定预算对通过、失败、未覆盖分别给出可复核理由，不能运行后改阈值覆盖旧结论。
- 取消及控制器退出后，原目标和全部采样进程核销；遗留占用继续计费。
- 离线重算与线上同方法版本一致；导入结果仍显示外来证据，篡改封套拒绝接收。
