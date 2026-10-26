# 约束求解工作室插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；应用保持 2.8.1，核对基线为 `4afb3b9a`。包 ID 为 `constraint-solver-studio`，包含 14 个拟议插件，运行实现待开始。共同约定见[第七批总览](plugin-pack-seventh-design.md)。

用户把有限分配、排程或选型任务表示为变量、约束和目标，求出候选方案，独立核对可行性，解释冲突并比较情景，交付带前提和求解界限的方案。本包支持离线建模与求解，不执行方案中的真实采购、排班通知或资源调度。

[容量规划](capacity-planner-pack-design.md)负责容量假设和负载范围；本包负责有限离散决策及线性目标。使用同一材料时保留来源与单位，不把规划条件推导成真实资源保证。

## 2. 内部插件与直接依赖

所有服务均为拟议；根空间拥有授权与额度，其他插件拥有各自模型或结果。依赖使用完整 ID。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `csolve-spaces` 求解空间 | 空间、模板、额度及访问修订；CsolveSpacesV1：create、templates、archive | — | — |
| `csolve-variables` 决策变量 | 稳定变量 ID、中文说明、单位和取值类型；CsolveVariablesV1：define、list | `csolve-spaces` | — |
| `csolve-domains` 取值域 | 布尔/整数边界、候选集合及界限来源；CsolveDomainsV1：define、validate | `csolve-spaces`, `csolve-variables` | — |
| `csolve-constraints` 约束模型 | 线性关系、基数和固定时段冲突；CsolveConstraintsV1：compose、checkTypes | `csolve-spaces`, `csolve-variables`, `csolve-domains` | — |
| `csolve-objectives` 目标模型 | 线性目标、方向、分层优先级和系数；CsolveObjectivesV1：define、validate | `csolve-spaces`, `csolve-variables`, `csolve-domains` | — |
| `csolve-scenarios` 情景版本 | 固定参数替换、启用约束与比较基线；CsolveScenariosV1：derive、diff | `csolve-spaces`, `csolve-variables`, `csolve-domains`, `csolve-constraints`, `csolve-objectives` | — |
| `csolve-runs` 求解任务 | 完整模型计划、求解器票据、日志与状态；CsolveRunsV1：preview、start、status、cancel、reconcile | `csolve-spaces`, `csolve-variables`, `csolve-domains`, `csolve-constraints`, `csolve-objectives`, `csolve-scenarios` | — |
| `csolve-solutions` 候选方案 | 变量赋值、目标值、界限及求解来源；CsolveSolutionsV1：capture、compare | `csolve-spaces`, `csolve-variables`, `csolve-objectives`, `csolve-runs` | — |
| `csolve-validation` 独立验证 | 按原模型重新计算的逐约束结果；CsolveValidationV1：verify、explain | `csolve-spaces`, `csolve-variables`, `csolve-domains`, `csolve-constraints`, `csolve-objectives`, `csolve-scenarios`, `csolve-solutions` | — |
| `csolve-conflicts` 冲突解释 | 不可满足候选子集、最小性范围与核验轨迹；CsolveConflictsV1：analyze、read | `csolve-spaces`, `csolve-constraints`, `csolve-scenarios`, `csolve-runs` | — |
| `csolve-sensitivity` 情景比较 | 有界参数扰动、重新求解意图及结果差异；CsolveSensitivityV1：preview、compare | `csolve-spaces`, `csolve-scenarios`, `csolve-runs`, `csolve-solutions`, `csolve-validation` | — |
| `csolve-decisions` 方案接受 | 人工选择、未满足前提、例外和封存引用；CsolveDecisionsV1：review、decide、seal | `csolve-spaces`, `csolve-scenarios`, `csolve-solutions`, `csolve-validation`, `csolve-conflicts`, `csolve-sensitivity` | — |
| `csolve-exchange` 方案交接 | 模型及证据封套、隔离映射与核验；CsolveExchangeV1：export、inspectImport、acceptImport | `csolve-spaces`, `csolve-variables`, `csolve-domains`, `csolve-constraints`, `csolve-objectives`, `csolve-scenarios`, `csolve-runs`, `csolve-solutions`, `csolve-validation`, `csolve-conflicts`, `csolve-sensitivity`, `csolve-decisions` | — |
| `csolve-workbench` 求解工作台 | 变量表、约束编辑、方案比较与冲突定位；CsolveWorkbenchV1：view、templates | `csolve-spaces`, `csolve-variables`, `csolve-domains`, `csolve-constraints`, `csolve-objectives`, `csolve-scenarios`, `csolve-runs`, `csolve-solutions`, `csolve-validation`, `csolve-conflicts`, `csolve-sensitivity`, `csolve-decisions`, `csolve-exchange` | — |

求解器负责产生候选和求解状态，验证服务独立核对赋值。人工接受只记录业务决定，不能把未经证明的最优性或不可满足性改为已证明。

## 3. 模板与完整流程

| 模板 | 变量与条件 | 结果 |
| --- | --- | --- |
| 有限任务分配 | 人员/任务的布尔分配、容量及资格 | 分配表、未分配项与目标成本 |
| 固定时段排程 | 任务开始时段、时长及资源冲突 | 时段表、冲突定位和可行性验证 |
| 资源组合选择 | 候选数量、预算及最低覆盖 | 组合方案、约束余量及比较 |

1. 创建空间，填写变量、单位、取值界限及来源，选择模板。
2. 编辑约束和目标，检查未定义变量、单位不一致及界限矛盾。
3. 固定基准情景，预览模型规模、求解器、候选数量和截止。
4. 批准求解，显示可行解、当前界限、实际停止原因及剩余缺项。
5. 独立验证候选；不可满足时生成有范围说明的冲突解释。
6. 显式建立有限扰动情景，分别批准重算并比较方案变化。
7. 人工选择方案，保留不确定项与前提，封存模型和证据引用。
8. 导出 JSON 模型、方案 CSV 和报告，接收端核验后建立新空间。

## 4. 建模规则与求解边界

首版支持有界布尔/整数变量、整数系数线性约束、有限候选集合和离散时段。小数需显式比例转为整数，记录原值和精度；系数运算超过实现整数范围即拒绝，不靠舍入掩盖溢出。

目标可单一或按声明顺序分层求解。每层只有在已证明前层最优后才能声称严格字典序最优；超时得到的可行候选保留界限与停止原因。不同目标权重的方案不能直接按未声明的总分排序。

拟议宿主接口 `ConstraintSolveSessionsV1` 首版使用固定原生隔离进程，只接收受限模型和固定求解器配置。进程无出站网络，只访问准入材料及专属暂存句柄，不创建 VM。实施须证明模型解析限额、确定的取消与独立截止、线程上限及临时文件核销；不得加载用户求解脚本或回调。

状态分别为可行、已证明最优、已证明不可满足、未知和模型不支持。独立赋值验证可以证明该候选满足已列约束；它不能单独证明最优。求解器的不可满足声明须保存工具、模型与证明能力范围。

冲突解释区分一个冲突子集、包含意义的最小子集和最小条数集合；没有对应证明时只使用前一种表述。参数扰动结果仅适用于已运行情景，不推导未求解区间的稳定性。

## 5. 页面、HTTP 与 CLI

页面包括变量、约束、目标、情景、求解、方案、验证、冲突和交接。约束错误定位到变量及表达式；甘特图和方案图均提供键盘表格。人工接受页面显示模型前提和证据缺项。

拟议 HTTP 逐方法声明严格合同并鉴权，CLI 前缀为 `sakura solve`。

| 操作 | HTTP POST 路径 | CLI 动作 |
| --- | --- | --- |
| 模型检查 | `/api/csolve-constraints/checkTypes` | `model check` |
| 求解计划/执行 | `/api/csolve-runs/preview`、`/api/csolve-runs/start` | `run preview/start` |
| 原任务查询/停止 | `/api/csolve-runs/status`、`/api/csolve-runs/cancel`、`/api/csolve-runs/reconcile` | `run status/cancel/reconcile` |
| 候选核验 | `/api/csolve-validation/verify` | `solution verify` |
| 冲突分析 | `/api/csolve-conflicts/analyze` | `conflicts analyze` |
| 接受与交接 | `/api/csolve-decisions/decide`、`/api/csolve-exchange/export` | `decide`、`export` |

离线 `verify` 重新核对有限赋值及约束，明确输出“未重新证明最优”。求解或冲突缩减必须另建本地受限任务。

## 6. 容量、恢复与交接

拟定上限为 5,000 个变量、20,000 条约束、100,000 个非零项、3 层目标和 20 个扰动情景。每次求解最多 10 分钟，情景集合最多 30 分钟；同时一个工具任务，最多 2 个求解线程。

单包 1 GiB，单模型 16 MiB、日志 32 MiB、封套 128 MiB；32 MiB 控制账本包含在总额中。数值均待实测，须纳入共同额度，不能把现有宿主 8 GiB 当作本包已可使用的承诺。

空域、非法变量和溢出在求解前拒绝。超时保留已验证候选并明确未知最优性；重启核对原求解器退出与原暂存，不自动重跑。输出字节上限先于解数量上限生效，截断必须保留范围。

现有 owner 权限控制读取和计算。封存方案保护模型及验证引用；清理预览同时列出原任务占用。升级保留原整数比例和模型版本；接收不继承批准、活动票据或真实业务执行权。

完整求解定义必须在同一封套中带齐变量、约束、目标和情景。缺少引用或超出封套上限时只接受只读参考档案；不允许跨封套隐式拼接模型。

## 7. 实施与验收

先完成受限模型及独立验证，再接入求解与冲突工具，最后交付情景比较、工作台及安装态核验。

1. 三种模板用真实求解器产生方案，并通过独立逐约束核验。
2. 人工可穷举的小模型得到相同最优值；两个同值方案都能保留。
3. 空域、矛盾约束、单位错误及整数溢出分别给出准确原因。
4. 达到截止但仅有可行解时，报告不得显示已证明最优。
5. 冲突子集中的无关约束可排除；未完成最小化时保留范围声明。
6. 伪造一个变量值或目标值后，离线核验定位差异并拒绝接受。
7. 取消、控制器退出、满盘和清理失败保留原责任，不重放求解。
8. 单包独立完成模型、方案、交接与清理，导入材料不会触发真实调度。
