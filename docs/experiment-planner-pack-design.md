# 对照实验规划插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；当前应用保持 2.8.1，基线为 `4afb3b9a`。包 ID 为 `experiment-planner`，含 14 个拟议插件，当前分支运行实现待开始。共同规则见[第七批总览](plugin-pack-seventh-design.md)。

用户为软件方案、处理流程或设备配置比较预先固定问题、分组、指标和分析规则，评估假设下的样本规模，再核对导入观测，交付设计版本、分配表和有适用范围的分析档案。首版仅处理本地计划与资料，不组织临床试验或自动控制外部实验。

[数据工作台](data-lab.md)的参数实验保留代码与参数组合执行，[性能实验](performance-lab-pack-design.md)保留真实程序测量。本包增加实验单位、随机分配、主要指标、预设分析和偏离记录，上传观测不构成真实随机试验证明。

## 2. 内部插件与直接依赖

表中服务均为拟议接口。计划、模拟、分配表和真实观测具有不同来源类别。

| 插件 ID 与名称 | 独立对象、核心功能和服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `trialplan-spaces` 规划空间 | 空间、授权和额度；TrialplanSpacesV1：create、configure、close | — | — |
| `trialplan-questions` 研究问题 | 方案对照、目标差异、假设和适用范围；TrialplanQuestionsV1：define、validate、seal | `trialplan-spaces` | — |
| `trialplan-populations` 单位与总体 | 单位清单、纳入规则、分层和簇关系；TrialplanPopulationsV1：upload、define、seal | `trialplan-spaces`, `trialplan-questions` | — |
| `trialplan-outcomes` 指标定义 | 主要指标、分母、窗口和缺失策略；TrialplanOutcomesV1：define、validate、seal | `trialplan-spaces`, `trialplan-questions`, `trialplan-populations` | — |
| `trialplan-allocations` 分组设计 | 分配比例、分层、区组及固定种子策略；TrialplanAllocationsV1：define、validate、seal | `trialplan-spaces`, `trialplan-populations` | — |
| `trialplan-powerplans` 规模模拟 | 基线假设、效应场景、模拟和不确定性；TrialplanPowerplansV1：define、preview、simulate、cancel、reconcile | `trialplan-spaces`, `trialplan-questions`, `trialplan-populations`, `trialplan-outcomes`, `trialplan-allocations` | — |
| `trialplan-assignments` 分配版本 | 固定单位分配表及算法回执；TrialplanAssignmentsV1：preview、generate、seal | `trialplan-spaces`, `trialplan-populations`, `trialplan-allocations`, `trialplan-powerplans` | — |
| `trialplan-observations` 观测材料 | 原资料、实际接触、偏离及数据截止；TrialplanObservationsV1：upload、validate、pin | `trialplan-spaces`, `trialplan-populations`, `trialplan-outcomes`, `trialplan-assignments` | — |
| `trialplan-analyses` 分析计划与结果 | 预设方法、固定观测、估计和覆盖；TrialplanAnalysesV1：define、sealPlan、preview、run、cancel、reconcile | `trialplan-spaces`, `trialplan-questions`, `trialplan-populations`, `trialplan-outcomes`, `trialplan-allocations`, `trialplan-assignments`, `trialplan-observations` | — |
| `trialplan-sensitivity` 敏感性分析 | 缺失、异常值和偏离的预设替代场景；TrialplanSensitivityV1：define、run、compare | `trialplan-spaces`, `trialplan-outcomes`, `trialplan-observations`, `trialplan-analyses` | — |
| `trialplan-reviews` 设计与结果复核 | 计划时序、偏离、解释及限制决定；TrialplanReviewsV1：prepare、decide、seal | `trialplan-spaces`, `trialplan-questions`, `trialplan-powerplans`, `trialplan-assignments`, `trialplan-observations`, `trialplan-analyses`, `trialplan-sensitivity` | — |
| `trialplan-reports` 实验规划档案 | 设计、模拟、观测、结果和限制的固定索引；TrialplanReportsV1：assemble、compare、seal | `trialplan-spaces`, `trialplan-questions`, `trialplan-powerplans`, `trialplan-assignments`, `trialplan-observations`, `trialplan-analyses`, `trialplan-sensitivity`, `trialplan-reviews` | — |
| `trialplan-exchange` 实验资料交接 | 计划、分配和允许披露的资料交换；TrialplanExchangeV1：export、inspectImport、acceptImport | `trialplan-spaces`, `trialplan-questions`, `trialplan-populations`, `trialplan-outcomes`, `trialplan-allocations`, `trialplan-powerplans`, `trialplan-assignments`, `trialplan-observations`, `trialplan-analyses`, `trialplan-sensitivity`, `trialplan-reviews`, `trialplan-reports` | — |
| `trialplan-workbench` 实验规划工作台 | 假设编辑、规模曲线、分组及偏离检查；TrialplanWorkbenchV1：view、saveView、templates | `trialplan-spaces`, `trialplan-questions`, `trialplan-populations`, `trialplan-outcomes`, `trialplan-allocations`, `trialplan-powerplans`, `trialplan-assignments`, `trialplan-observations`, `trialplan-analyses`, `trialplan-sensitivity`, `trialplan-reviews`, `trialplan-reports`, `trialplan-exchange` | — |

分析计划可以先封存后导入观测。服务依赖存在不意味着必须已有观测对象；运行时才要求固定观测引用。

## 3. 模板与完整流程

| 模板 | 输入和重点 | 完成交付 |
| --- | --- | --- |
| 两种处理流程 | 合成单位、连续指标和缺失场景 | 分组表、规模模拟及固定分析 |
| 软件方案对照 | 任务单位、成功计数和比例指标 | 分母核对、方案差异及偏离说明 |
| 分层设备配置 | 设备类型、分层分配和响应记录 | 层内分配及层间适用范围 |

1. 定义要比较的方案、实验单位和目标总体，填写范围限制。
2. 固定主要指标、数据截止、缺失处理、排除标准及停止规则。
3. 设定分组、分层或区组，运行明确假设下的规模模拟。
4. 封存设计和分析计划，生成固定分配表；分配不触发外部执行。
5. 导入观测和实际方案接触记录，检查单位重复、缺失及分配偏离。
6. 按预设分析运行，查看估计、区间、方法条件和未知项。
7. 对预设敏感性场景单独分析，新增探索分析标记为事后。
8. 复核证据范围、封存报告，并隔离交接可披露资料。

## 4. 设计、模拟与解释约束

首版支持两组独立单位的连续或二元指标，可按固定分层分配。簇、交叉和重复测量可登记结构，但未实现相应估计时明确不支持；不能当独立观测直接计算。

首版估计限定为算术平均差和成功比例差，方向固定为方案 B 减方案 A。分层汇总使用计划预先固定且和为 1 的层权重，输出各层及总体的分子、分母、估计和缺失数。缺失默认不填补；排除后的分析范围必须单列。

区间方法限定为组内、层内独立有放回重采样的百分位区间。默认区间水平 95%、重复 2000 次，最高 10,000 次；固定种子、分位插值规则和算法版本。每个参与层的每组至少 2 个有效单位；空组、零分母或退化到单一点的重采样分布只报告描述量和不可用原因。

规模模拟限定为独立正态连续资料或独立伯努利二元资料，输入均值与正标准差，或 0 至 1 的成功概率。每场景用固定重采样判定规则报告区间未覆盖 0 的次数、有效次数和失败次数。此比率称为模拟检出率，不充当真实实验的保证；失败模拟不能从输出中隐藏。

模拟与分析共用无权限的固定数值库，不互相调用对方插件。计划预先计算场景、模拟和重采样的乘积，单任务最多 100 万次重采样，超过即拒绝；不能在运行中悄悄减少次数或扩大区间水平。

分配固定单位列表、算法版本、种子与比例。分层和区组的余数处理须预先定义，重复生成同计划返回原回执。新增单位需要新计划，不能反复抽取直到得到期望分组。

规模模拟展示所选分布、基线、效应、缺失假设及有限重复次数。结果只在这些假设下适用，不保证真实实验达到某种结果。模拟资料和观测资料分别标记，禁止混为真实样本。

主要指标、分析方法和停止规则在观测前封存。导入时间不是外部数据生成时间；本地先封存只能证明本地顺序。已有观测后修改计划形成新版本，报告明确标为事后修改。

分析区分预分配组与实际接触组，列出重复单位、缺失结果及交叉接触。人工补录的随机化说明仅为声明。软件不凭分配表或统计结果自动写出因果结论，解释由复核记录限定证据与条件。

多指标和多次查看保留完整次数与预设策略，不能只展示最有利结果。未预设的筛选、排除和停止分别列入偏离；敏感性分析保留全部场景及失败，不选择性替换主结果。

拟议 `ControlledExperimentComputeV1` 提供固定分配、有限规模模拟和明确支持的估计方法。实施须固定算法版本、精度、随机源和重复次数，验证数值稳定、退化输入、取消及暂存核销；不接受任意统计脚本。

## 5. 页面、HTTP 与 CLI

工作台提供设计时间线、假设卡、规模曲线、分组平衡、单位核对和结果表。图形显示假设与误差范围，不能仅用通过色替代不确定性说明；所有图有表格替代。

下表均为拟议 POST，CLI 前缀为 `sakura experiment-plan`。

| 服务方法 | HTTP 路径 | CLI 子命令 |
| --- | --- | --- |
| Powerplans.preview/simulate | `/api/trialplan-powerplans/preview`、`/api/trialplan-powerplans/simulate` | `power preview`、`power simulate` |
| Assignments.generate | `/api/trialplan-assignments/generate` | `assignment generate` |
| Analyses.sealPlan | `/api/trialplan-analyses/sealPlan` | `analysis seal-plan` |
| Observations.validate | `/api/trialplan-observations/validate` | `observation validate` |
| Analyses.preview/run | `/api/trialplan-analyses/preview`、`/api/trialplan-analyses/run` | `analysis preview`、`analysis run` |
| Exchange.export/acceptImport | `/api/trialplan-exchange/export`、`/api/trialplan-exchange/acceptImport` | `export`、`import accept` |

CLI 支持原状态、等待、取消和恢复；离线 `verify` 只检查字节、计划时序声明及可重算分配，不验证外部随机化或真实方案执行。

## 6. 容量、权限与恢复

拟定每设计 100,000 个单位、20 个指标、100 个分层、200 个规模场景，单场景最多 10,000 次模拟。一次计算最多 5 分钟，观测资料 128 MiB、单记录 64 KiB；超预算在计划时拒绝，运行中到界则保留未完成状态。

包总额 1 GiB，含 32 MiB 恢复账本、分配表、观测、模拟结果和隔离；封套 128 MiB。实施须接入宿主既有 8 GiB 共同额度，敏感原资料和派生资料各自保留引用责任。

空间 owner 控制读写，实验负责人和复核人是业务标签。单位 ID 可使用外部提供的非直接标识，但此做法不自动证明匿名。导出预览列明原观测、种子、映射和允许披露范围。

运行先持久化固定计划与种子，取消不产生完整模拟结论。恢复查询原意图及原算法回执，不通过换种子重做未知运行。磁盘满时保留设计和恢复账本，不发布部分分配表。

交接生成新 ID，外来预登记和随机化记录保持来源声明。升级方法产生新结果并保留原结果，迁移失败保留旧字节；降级不理解方法时拒绝写入。归档不删除仍被报告引用的单位映射。

## 7. 实施与验收

P0 完成预设计划、单位校验和固定数值计算；P1 完成观测核对、偏离与敏感性分析；集成维护验证交接和独立安装。真实外部执行始终不计入本包已验证范围。

1. 三模板都能完成设计、模拟、分配、资料核对、分析和交接。
2. 同单位、种子和版本产生相同分配；重复提交返回原回执，不重新抽组。
3. 重复单位、无分母、全缺失或退化数值输入不产生正常估计。
4. 簇或重复测量资料没有支持方法时明确拒绝，不能伪装独立样本。
5. 观测后修改主要指标保留事后标记，偏离和所有敏感性场景持续可见。
6. 模拟、人工声明和导入观测分别标记，报告不宣称外部实验已随机执行。
7. 撤权、旧修订、取消和磁盘满不发布半份分配表或完整分析。
8. 篡改种子、分配或计划引用的封套被拒绝，离线核验不推断外部真实性。
