# 容量与资源预算规划插件包设计

## 1. 版本与使用结果

设计版本 4.0.0，日期 2026-10-25。包 ID 为 `capacity-planner`，含 11 个拟议插件，运行实现待开始。基线为应用 2.7.0 / `237d7bc`；工作区中的 2.8.0 实施不作为本包已验证能力。共同约定见[第四批总览](plugin-pack-next-design.md)。

用户导入资源清单、使用时序和工作负载需求，比较扩容、合并、维护排空及增长假设。交付物包括可重算的容量场景、约束冲突、资源余量、用户价格假设下的估算和决策报告。

现有[主机资源评分](host-peers.md)提供瞬时放置建议，[宿主持久容量](suite-capacity.md)负责真实占用准入。本包评估跨时间窗口的假设与约束，不预留资源、调度实例或修改宿主额度。

## 2. 内部插件与依赖

以下服务和方法均为拟议接口。首版全部使用显式导入材料，无必需或可选外部插件；后续在线读取须另行提供窄接口。

| 插件 ID | 专属对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `capacity-inputs` | 空间、清单和时序原始字节、单位映射；CapacityInputsV1：upload、inspect、normalize | — | — |
| `capacity-inventory` | 固定主机、资源池、失效域与保留量；CapacityInventoryV1：validate、sealInventory、compare | capacity-inputs | — |
| `capacity-demand` | 工作负载需求曲线、增长及相关性假设；CapacityDemandV1：derive、editAssumptions、coverage | capacity-inputs, capacity-inventory | — |
| `capacity-constraints` | 亲和、反亲和、平台及故障余量约束；CapacityConstraintsV1：validate、explainConflict | capacity-inputs, capacity-inventory | — |
| `capacity-scenarios` | 时间窗口、候选资源和固定需求组合；CapacityScenariosV1：compose、fork、preview | capacity-inputs, capacity-inventory, capacity-demand, capacity-constraints | — |
| `capacity-simulations` | 有界求解运行、分配方案与逐时段余量；CapacitySimulationsV1：preview、run、cancel、reconcile | capacity-inputs, capacity-inventory, capacity-demand, capacity-constraints, capacity-scenarios | — |
| `capacity-estimates` | 用户价目、计费单位、有效期及估算；CapacityEstimatesV1：saveRates、validateRates、estimate | capacity-inputs, capacity-inventory, capacity-scenarios, capacity-simulations | — |
| `capacity-recommendations` | 候选方案比较、权衡和人工选择；CapacityRecommendationsV1：compare、rank、recordChoice | capacity-inputs, capacity-scenarios, capacity-simulations, capacity-estimates, capacity-constraints | — |
| `capacity-reports` | 容量结论、覆盖不足与敏感性报告；CapacityReportsV1：preview、sealReport、compare | capacity-inputs, capacity-demand, capacity-scenarios, capacity-simulations, capacity-estimates, capacity-recommendations | — |
| `capacity-exchange` | 固定场景、假设、结果与价目封套；CapacityExchangeV1：export、inspectImport、acceptImport | capacity-inputs, capacity-inventory, capacity-demand, capacity-constraints, capacity-scenarios, capacity-simulations, capacity-estimates, capacity-recommendations, capacity-reports | — |
| `capacity-workbench` | 数据缺口、场景比较、余量图和交接；CapacityWorkbenchV1：view、templates | capacity-inputs, capacity-inventory, capacity-demand, capacity-constraints, capacity-scenarios, capacity-simulations, capacity-estimates, capacity-recommendations, capacity-reports, capacity-exchange | — |

求解器拥有运行和数值结果，估算插件拥有价格及计费转换。报告引用二者的固定修订，不能在用户改变价目后静默改写历史方案。

空间根账本唯一归 `capacity-inputs`，负责空间状态、额度预留和发布恢复。其他插件经该直接依赖核对空间及额度，再发布自己拥有的领域对象；资源方案中的预算不会写入真实宿主额度账本。

## 3. 完整用户流程

1. 新建空间，选择“开发环境整合”“单主机维护排空”或“存储增长”模板。
2. 上传资源清单和时序数据，检查单位、时间范围、采样间隔、重复点及缺失点。
3. 定义工作负载峰值、保留量、增长假设和时段相关性，核对数据覆盖范围。
4. 录入平台兼容、亲和、故障域及维护窗口约束，固定候选资源集合。
5. 建立基准、扩容或故障场景，预览全部输入、算法版本、运行预算，再提交模拟。
6. 查看不可满足的约束、逐时段余量及不确定项；显式输入价目后比较资源费用估算。
7. 审阅敏感性变化并记录选择理由，封存报告；导出可重算材料，再清理无引用版本。

模板只带合成数据和示例价格，显示“示例假设”。打开模板不扫描实际主机，不查询价格，不执行迁移。

## 4. 数据模型与分析边界

`ResourceInventory` 区分物理容量、可分配上限、已承诺量和当前使用量。CPU 核数、CPU 时间、内存字节、存储容量和 I/O 速率分别建模，禁止混用。虚拟磁盘逻辑容量与当前物理占用并列记录。

`TimeSeriesCoverage` 保存时区、原始时间、采样间隔、缺失区间和归一化方法。原始点不覆盖；插值和重采样生成派生版本。计数器重置、负值和乱序点必须解释或排除，并列出影响范围。

`DemandProfile` 区分观察、用户假设和推演结果。首版支持固定峰值、同时间窗叠加和用户指定增长系数；历史分位数只能在明确窗口内计算，不能直接相加为整体峰值。

跨负载缺少同步观测时，用户须选择保守同时峰值或显式相关性假设。报告列出该选择及敏感性范围，不把历史区间外推当作有保证的预测。

`PlacementConstraint` 区分硬约束与软偏好。平台不兼容、保留容量不足、反亲和冲突均可阻断可行方案。求解超时只能返回已找到的候选及搜索范围，不能断言不存在方案或已达到全局最优。

模拟状态为 `queued → running → finalizing → completed`，另有 `cancelled/failed/interrupted`。业务结果分为 `feasible/infeasible/inconclusive`；只有完整穷举或明确数学矛盾证明才输出 `infeasible`，附可复核原因。

`RateCard` 记录来源说明、货币、单位、时区、有效期和计费规则。首版只支持固定单价乘明确用量与显式固定项；阶梯、税费、折扣和汇率若未建模，必须列为未覆盖。

不同货币不直接相加。价目过期、缺项或单位不一致时，资源方案仍可查看，费用结论为不完整。用户录入的价格不作为实时价格或真实账单，也不触发采购操作。

## 5. 页面与操作入口

工作台包含输入质量、资源清单、需求、约束、场景、运行、价格和报告。余量图可切换时间段；鼠标或键盘定位显示实际来源和假设。缺失区间留空，不能补成零值。CLI 别名为 `capacity`。

| 操作 | 拟议 HTTP | CLI（均以 `sakura` 开头） | 返回要点 |
| --- | --- | --- | --- |
| 检查材料 | `/api/capacity-inputs/inspect` | `capacity input inspect` | 单位、时间覆盖、缺失与越界项 |
| 需求建模 | `/api/capacity-demand/derive` | `capacity demand derive` | 固定窗口、聚合方式和假设来源 |
| 模拟预览/运行 | `/api/capacity-simulations/preview`、`/api/capacity-simulations/run` | `capacity simulation preview/run` | 算法、预算、原运行回执 |
| 费用估算 | `/api/capacity-estimates/estimate` | `capacity estimate calculate` | 用量、价目修订、未覆盖成本 |
| 比较方案 | `/api/capacity-recommendations/compare` | `capacity recommendation compare` | 相同基线、硬约束及排序依据 |
| 报告及交接 | `/api/capacity-reports/sealReport`、`/api/capacity-exchange/export` | `capacity report seal`、`capacity export` | 假设、搜索范围、固定封套 |

排序权重必须在比较前固定。变化后生成新比较，不覆盖原选择。离线 `capacity verify` 在相同算法及范围下复核材料和可重算结果，不连接主机或价格服务。

## 6. 预算、失败与恢复

拟定单空间上限：200 台资源节点、1000 个工作负载、200 万个时序点、100 个场景及每场景 1000 条约束。单场景最多 500 万次候选检查、120 秒和 512 MiB 内存，全包并发 2 个计算。

单输入 64 MiB；归一化时序最多 128 MiB，场景结果 32 MiB。本包持久总量 2 GiB，导出 256 MiB。图表按受控聚合读取，原始数据另分页，不能把下采样图上的点数当作输入总数。

以上为待实测的设计上限。实际准入取本包与宿主剩余额度中的更小值，不提高现有共同默认 8 GiB 总额。

| 异常 | 必须呈现及保留的结果 |
| --- | --- |
| 缺失数据、单位混合或时钟不一致 | 拒绝不合法计算，保存缺项及可处理范围 |
| 观察不足以支持相关性或增长 | 要求显式假设，报告给出敏感性范围 |
| 求解超时或取消 | 结果为不确定；候选方案标记搜索未完成 |
| 价目缺项、过期或混合货币 | 保留资源结果，费用部分明确不完整 |
| 重启或工作线程失联 | 查询原运行；再次计算须新计划，不覆盖原中断记录 |
| 磁盘满、撤权或交接中断 | 拒绝新增发布，保留原账本、保护引用和接收回执 |

## 7. 实施前置与验收

先交付输入模式、单位与覆盖检查，再实现固定需求及约束、有界求解、估算和比较，最后补齐图表及交接。求解器须提供算法版本、确定性排序、运行计数和取消检查点；首版不加载用户代码或第三方求解插件。

验收用例：

1. 三个模板从数据检查到场景、模拟、方案选择和交接完整通过。
2. 用已知小规模场景验证硬约束、保留量与人工可复核结果；不可满足结论带证据。
3. 缺失区间不当作零值；不同时间窗分位数不直接相加，相关性假设进入报告。
4. 相同输入与算法重算一致；改变单位、窗口、权重或价目产生新修订。
5. 超时不宣称最优或无解；取消后原计算退出，部分结果不能标记完整通过。
6. 已知价目样例逐项核对单位换算、固定项和有效期；不同货币及未建模税费明确列出。
7. 最大时序规模下分页、图表下采样及离线复核通过；撤权、重复接收和受保护历史清理符合总览。
