# 副本同步实验插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；应用保持 2.8.1，核对基线为 `4afb3b9a`。包 ID 为 `replica-sync-lab`，含 14 个拟议插件，运行实现待开始。共同约定见[第七批总览](plugin-pack-seventh-design.md)。

用户建立有限副本模型，编排并发写入、断连、重复投递与恢复，检查冲突和收敛。交付同步模型、事件历史、合并决定、反例和条件化结论，供同步功能开发者比较策略。

本包在内存与受管计算空间重放固定模型，不连接用户真实副本，不修改备份。[同步合并](sync-merge-drivers.md)及原 `sync` 插件继续负责项目文件同步，现有快照与复制服务保留原数据权威。

## 2. 内部插件与直接依赖

下列服务均为拟议 V1，依赖使用完整 ID，无其他业务包必需依赖。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `replab-spaces` 副本空间 | 空间、授权修订及额度根账本；ReplabSpacesV1：create、list、archive | — | — |
| `replab-schemas` 数据模型 | 有限键、值类型、删除标记和字段约束；ReplabSchemasV1：save、validate、seal | `replab-spaces` | — |
| `replab-replicas` 副本定义 | 副本标识、初始数据和持久游标模型；ReplabReplicasV1：save、validate、seal | `replab-spaces`, `replab-schemas` | — |
| `replab-operations` 操作历史 | 固定写入、删除、增量和原始操作身份；ReplabOperationsV1：upload、compose、seal | `replab-spaces`, `replab-schemas`, `replab-replicas` | — |
| `replab-clocks` 因果时钟 | 逻辑时钟、版本向量及墙钟偏差档案；ReplabClocksV1：save、validate、seal | `replab-spaces`, `replab-replicas` | — |
| `replab-channels` 传递模型 | 方向、断连、延迟、重复和重排计划；ReplabChannelsV1：save、validate、seal | `replab-spaces`, `replab-replicas` | — |
| `replab-policies` 合并策略 | 明确规则、相同时间决胜和墓碑保留条件；ReplabPoliciesV1：save、validate、seal | `replab-spaces`, `replab-schemas`, `replab-clocks` | — |
| `replab-scenarios` 实验编排 | 固定事件计划、交付边界及待证性质；ReplabScenariosV1：compose、preview、seal | `replab-spaces`, `replab-replicas`, `replab-operations`, `replab-clocks`, `replab-channels`, `replab-policies` | — |
| `replab-runs` 有限重放 | 原始事件轨迹、逐副本快照和执行回执；ReplabRunsV1：preview、run、cancel、reconcile | `replab-spaces`, `replab-schemas`, `replab-replicas`, `replab-operations`, `replab-clocks`, `replab-channels`, `replab-policies`, `replab-scenarios` | — |
| `replab-conflicts` 冲突解释 | 并发写关系、规则选择与人工裁决候选；ReplabConflictsV1：inspect、proposeResolution、seal | `replab-spaces`, `replab-operations`, `replab-clocks`, `replab-policies`, `replab-runs` | — |
| `replab-judgments` 性质判断 | 收敛、保留、顺序及反例的可重算判断；ReplabJudgmentsV1：evaluate、compare、explain | `replab-spaces`, `replab-schemas`, `replab-scenarios`, `replab-runs`, `replab-conflicts` | — |
| `replab-reports` 同步报告 | 模型范围、固定历史、判断及人工说明；ReplabReportsV1：assemble、review、seal | `replab-spaces`, `replab-replicas`, `replab-clocks`, `replab-channels`, `replab-policies`, `replab-scenarios`, `replab-runs`, `replab-conflicts`, `replab-judgments` | — |
| `replab-exchange` 同步交接 | 模型、历史和报告的隔离交换；ReplabExchangeV1：export、inspectImport、acceptImport | `replab-spaces`, `replab-schemas`, `replab-replicas`, `replab-operations`, `replab-clocks`, `replab-channels`, `replab-policies`, `replab-scenarios`, `replab-runs`, `replab-conflicts`, `replab-judgments`, `replab-reports` | — |
| `replab-workbench` 同步工作台 | 副本时间轴、数据对比、冲突及反例导航；ReplabWorkbenchV1：view、templates | `replab-spaces`, `replab-schemas`, `replab-replicas`, `replab-operations`, `replab-clocks`, `replab-channels`, `replab-policies`, `replab-scenarios`, `replab-runs`, `replab-conflicts`, `replab-judgments`, `replab-reports`, `replab-exchange` | — |

人工裁决生成新的操作候选，由用户显式另建场景重放。conflicts 不回写原轨迹；reports 不把提出裁决等同于裁决已应用。

## 3. 模板与完整流程

| 模板 | 初始条件 | 目标结果 |
| --- | --- | --- |
| 离线清单 | 两副本同时修改与删除同一键 | 并发冲突、删除保留和显式裁决路径 |
| 重复投递计数 | 多个增量操作及重复/乱序传递 | 操作身份去重与最终数值差异 |
| 长期离线恢复 | 旧副本在墓碑清理后重新加入 | 数据复活反例与安全保留前提 |

1. 创建空间，选定有限数据模型及副本初始状态。
2. 导入操作 JSONL，校验原操作身份、目标键、类型和声明的因果关系。
3. 设置逻辑时钟、传递规则和合并策略，编排分区与恢复时点。
4. 预览全部事件、传递顺序、变体种子、性质和预算，固定实验计划。
5. 运行模型，逐事件查看副本变化、待交付操作、冲突及丢弃理由。
6. 比较策略或顺序变体；需要人工处理时输出新操作候选并新建运行。
7. 复核可证范围，封存模型和结果；导出、离线核验并隔离接收。

## 4. 模型与判断边界

首版输入为 UTF-8 JSON 模型及 JSONL 操作。数据限定有界键值映射、集合和整数计数；首版不含任意文本协同编辑、外部数据库事务或用户脚本。操作身份固定为副本、单调序号和内容摘要。

同一操作身份出现不同字节时拒绝重放。并发性依据完整的声明因果关系判定，缺少前驱标为不完整；墙上时间的先后不替代因果顺序。固定时钟偏差是模型参数，不能作为实际设备时钟证据。

合并规则包括显式人工冲突、固定字段优先、带决胜规则的时间优先、操作身份去重的增量，以及有限集合增删。每种规则说明适用值类型与删除语义，不自动给规则贴上普遍收敛标签。

收敛判断只比较达到声明交付终点的副本。仍有未交付操作、被截断轨迹或未知初始状态时，结论为不确定。局部数据相等、相同操作集合及可证明的因果一致分别报告。

拟议本体接口 `ReplicaModelComputeV1` 提供固定合并算子、有限事件重放、快照和性质重算。算子不能读取网络、文件或运行导入代码。它是受管模型计算，不是原同步服务的远程控制器。

墓碑清理必须声明已知副本集合、确认边界及离线副本策略。模型可产生删除后数据复活的反例；只在当前有限历史中通过不能证明任意历史安全。全面状态枚举须明确上限和覆盖比例。

## 5. 页面、HTTP 与 CLI

工作台提供副本图、操作表、因果关系、传递时间轴、逐事件数据差异、冲突裁决和报告。时间轴分别标记模型时刻和原材料时间；过滤器始终显示隐藏条目数量。

| 拟议 HTTP | 对应服务方法 | 用途 |
| --- | --- | --- |
| `POST /api/replab-operations/compose` | ReplabOperationsV1.compose | 编辑固定操作及因果前驱 |
| `POST /api/replab-policies/validate` | ReplabPoliciesV1.validate | 检查合并规则和类型边界 |
| `POST /api/replab-scenarios/preview` | ReplabScenariosV1.preview | 固定全部事件与性质 |
| `POST /api/replab-runs/run` | ReplabRunsV1.run | 提交有限模型重放 |
| `POST /api/replab-conflicts/proposeResolution` | ReplabConflictsV1.proposeResolution | 生成不覆盖原历史的裁决候选 |
| `POST /api/replab-judgments/evaluate` | ReplabJudgmentsV1.evaluate | 复核交付边界内的性质 |
| `POST /api/replab-exchange/acceptImport` | ReplabExchangeV1.acceptImport | 接受完整固定对象图 |

CLI 拟为 `sakura replica-lab`，提供 model、operations、channel、policy、scenario、run、conflicts、compare、exchange 和 verify。离线 verify 可重算受支持模型的固定有限历史，但不连接或修改真实同步端点。

## 6. 容量、权限与恢复

设计上限为每空间 32 个副本、10,000 个键、100,000 个操作、每场景 500,000 个传递事件。单值不超过 4 KiB，单模型最多 32 MiB；每运行最多 120 秒、100 个顺序变体，按实际展开总量准入。

包持久上限拟为 1 GiB，含 32 MiB 恢复账本。初始数据、事件、快照、索引及交换暂存全部计费，不能只计算原始输入。新增包需接入既有 8 GiB 共同容量，达到最严格上限即拒绝新运行。

沿现有 owner 权限和空间授权修订。带 expectedRevision 的编辑冲突保留原内容；模型、规则或事件变化使旧计划失效。业务“副本负责人”标签不创建访问角色。

取消和撤权停止计算与结果发布，确认原 worker 退出后归还额度。中断轨迹保留实际完成范围；恢复不能将未完成运行改判为通过，也不自动追加新事件继续旧历史。

交接采用 `sakura-replica-sync-lab/1`。普通封套默认上限遵循总览，完整引用子图可分批导出；存在缺失外部引用的档案只能只读查看，不能接受为可运行场景。升级固定旧算子版本，旧结果不被新算法覆盖。

## 7. 实施与验收

先实现固定算子、模型与材料，再完成有界重放、独立性质检查、界面和交接。原文件同步功能不在本包验证范围内。

| 场景 | 必须观察的结果 |
| --- | --- |
| 重复与重排 | 同一操作重复不被当成新操作，顺序差异能重现对应规则结果 |
| 操作身份冲突 | 同副本同序号不同内容明确拒绝，不覆盖原操作 |
| 并发修改 | 完整因果关系区分先后与并发，人工冲突保留全部候选 |
| 未交付事件 | 副本暂时相等但仍有待交付事件时，不标记最终收敛 |
| 删除后恢复 | 墓碑过早清理产生可定位反例，修正策略后在同历史复核 |
| 裁决候选 | 生成候选不改原结果，新运行清楚关联原冲突及裁决 |
| 预算与中断 | 达上限停止并显示未覆盖范围，worker 退出后释放占用 |
| 模式和交接 | 篡改、缺失前驱或未知算子拒绝可运行接收，旧结果保持可读 |
