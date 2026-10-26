# 依赖求解工作室插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；应用保持 2.8.1，核对基线为 `4afb3b9a`。包 ID 为 `dependency-resolution-studio`，含 13 个拟议插件，运行实现待开始。共同约定见[第七批总览](plugin-pack-seventh-design.md)。

用户固定仓库元数据、根需求及平台条件，计算可满足的版本集合，解释冲突，比较候选并导出中立锁定计划。完整结果包含精确版本、内容摘要、选择理由、排除理由及未验证条件。

本包负责有限依赖模型的求解。[供应审查](supply-audit-pack-design.md)负责来源及许可判断，[可重复构建](reproducible-builds-pack-design.md)负责构建字节比较。安装、下载或执行脚本均不属于求解动作，不能从有解推导可安装。

## 2. 内部插件与直接依赖

下列服务均为拟议 V1，依赖使用完整 ID，不依赖其他新包。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `depsolve-spaces` 求解空间 | 空间、授权修订及额度根账本；DepsolveSpacesV1：create、list、archive | — | — |
| `depsolve-catalogs` 固定仓库 | 包版本、依赖边、平台标记和内容摘要材料；DepsolveCatalogsV1：upload、validate、pin | `depsolve-spaces` | — |
| `depsolve-roots` 根需求 | 直接需求、能力请求和替代候选；DepsolveRootsV1：save、validate、seal | `depsolve-spaces` | — |
| `depsolve-platforms` 目标档案 | 操作系统、架构、运行版本及显式条件；DepsolvePlatformsV1：save、validate、seal | `depsolve-spaces` | — |
| `depsolve-constraints` 约束模型 | 版本域、冲突、同伴依赖和多实例策略；DepsolveConstraintsV1：compile、explain、seal | `depsolve-spaces`, `depsolve-catalogs`, `depsolve-roots`, `depsolve-platforms` | — |
| `depsolve-candidates` 候选策略 | 旧锁偏好、更新范围和确定性排序规则；DepsolveCandidatesV1：save、preview、seal | `depsolve-spaces`, `depsolve-catalogs`, `depsolve-roots`, `depsolve-platforms` | — |
| `depsolve-solves` 求解运行 | 固定模型、搜索轨迹、候选赋值和任务回执；DepsolveSolvesV1：preview、run、cancel、reconcile | `depsolve-spaces`, `depsolve-constraints`, `depsolve-candidates` | — |
| `depsolve-proofs` 结果核验 | 逐约束复查、冲突子集与完备性标记；DepsolveProofsV1：checkAssignment、explainConflict、coverage | `depsolve-spaces`, `depsolve-constraints`, `depsolve-candidates`, `depsolve-solves` | — |
| `depsolve-comparisons` 方案对比 | 候选版本、直接/传递变化和排除原因；DepsolveComparisonsV1：compare、annotate | `depsolve-spaces`, `depsolve-catalogs`, `depsolve-solves`, `depsolve-proofs` | — |
| `depsolve-locks` 锁定计划 | 中立精确版本集合、依赖边及固定输入摘要；DepsolveLocksV1：assemble、validate、seal | `depsolve-spaces`, `depsolve-catalogs`, `depsolve-roots`, `depsolve-platforms`, `depsolve-solves`, `depsolve-proofs`, `depsolve-comparisons` | — |
| `depsolve-reports` 求解报告 | 决策说明、冲突、范围和人工接受记录；DepsolveReportsV1：assemble、review、seal | `depsolve-spaces`, `depsolve-constraints`, `depsolve-solves`, `depsolve-proofs`, `depsolve-comparisons`, `depsolve-locks` | — |
| `depsolve-exchange` 求解交接 | 元数据、约束、锁定计划和报告的隔离交换；DepsolveExchangeV1：export、inspectImport、acceptImport | `depsolve-spaces`, `depsolve-catalogs`, `depsolve-roots`, `depsolve-platforms`, `depsolve-constraints`, `depsolve-candidates`, `depsolve-solves`, `depsolve-proofs`, `depsolve-comparisons`, `depsolve-locks`, `depsolve-reports` | — |
| `depsolve-workbench` 依赖工作台 | 需求编辑、选择路径、冲突定位和对比导航；DepsolveWorkbenchV1：view、templates | `depsolve-spaces`, `depsolve-catalogs`, `depsolve-roots`, `depsolve-platforms`, `depsolve-constraints`, `depsolve-candidates`, `depsolve-solves`, `depsolve-proofs`, `depsolve-comparisons`, `depsolve-locks`, `depsolve-reports`, `depsolve-exchange` | — |

仓库材料只有 catalogs 保存原始字节，constraints 保存规范化模型及来源映射。锁定计划固定赋值和来源，不自行补齐缺失仓库元数据。

## 3. 模板与完整流程

| 模板 | 输入特征 | 目标产物 |
| --- | --- | --- |
| 最小升级 | 已有中立锁、一个受限升级范围 | 保持尽量多旧版本的可行候选及变化理由 |
| 同伴冲突 | 两个根包要求不同同伴版本 | 可复查冲突集合与需要修改的根约束 |
| 多平台矩阵 | Linux/Windows、两种架构和可选依赖 | 逐平台独立解及缺少制品的范围 |

1. 上传固定仓库 JSON 或首版支持的 npm 元数据快照，并记录来源与采集时点。
2. 编辑根需求、运行平台和安装模型；在完整版本表中检查缺失或重复标识。
3. 固定版本范围、同伴条件、可选边及多实例策略，生成规范化约束。
4. 选择更新目标和稳定排序，预览候选数量、全部输入摘要、预算与截止。
5. 执行求解，展示当前候选、搜索截止和不可满足的证据等级。
6. 独立核对每条约束，对比候选后人工接受；超时仍保留已找到的可行解和未证明目标。
7. 封存中立锁定计划及报告，导出、离线核验并隔离接收。

## 4. 求解语言与正确性

规范输入采用 `sakura-dependency-model/1` JSON。版本范围只支持明确列出的精确版本、比较区间、并集及预发布选择规则；未支持的生态语法拒绝导入。npm 适配器须固定语义档案并保留原字段，不能宣称等同所有 npm 版本的解析器。

包身份包含生态、名称、版本及内容摘要。同名同版本的摘要不一致产生冲突，不按最后一条覆盖。缺失摘要的版本可参与探索，但锁定计划必须标记材料不完整，不能显示可复现就绪。

首版模型显式区分单实例和可并存实例。循环依赖允许作为有限图被检查；无效约束、缺少被引用版本、未知平台条件和无法界定的可选边均阻止“完整有解”结论。

拟议本体接口 `DependencyConstraintComputeV1` 提供有界有限域求解、确定性排序和赋值校验。目标按保留旧锁、最小直接变化、最小传递变化、版本排序的固定优先级求值；用户选择其他顺序须产生新计划。

可行赋值必须逐约束重验。只有搜索完成或带可复查证据时才标记无解；截止后无候选记为不确定。冲突缩减记录是否最小，未证明最小的集合不得标成最小冲突核心。

下载可达性、源码兼容、构建脚本、漏洞与许可不由求解判断。首版输出为中立锁定计划，不直接写 package-lock.json 或其他生态原生锁文件。后续适配器须另行证明对应解析器与格式兼容。

## 5. 页面、HTTP 与 CLI

工作台提供仓库版本表、根需求、平台矩阵、约束图、搜索进度、冲突解释和锁定计划对比。大图显示折叠范围；节点详情能回到原元数据字段和约束编号。

| 拟议 HTTP | 对应服务方法 | 用途 |
| --- | --- | --- |
| `POST /api/depsolve-catalogs/validate` | DepsolveCatalogsV1.validate | 核对身份、摘要和元数据缺项 |
| `POST /api/depsolve-constraints/compile` | DepsolveConstraintsV1.compile | 生成有来源的有限约束模型 |
| `POST /api/depsolve-solves/preview` | DepsolveSolvesV1.preview | 固定模型、目标和计算上限 |
| `POST /api/depsolve-solves/run` | DepsolveSolvesV1.run | 提交有界求解 |
| `POST /api/depsolve-proofs/checkAssignment` | DepsolveProofsV1.checkAssignment | 独立复核候选的全部约束 |
| `POST /api/depsolve-locks/seal` | DepsolveLocksV1.seal | 固定经复核的锁定计划 |
| `POST /api/depsolve-exchange/acceptImport` | DepsolveExchangeV1.acceptImport | 接受完整隔离对象图 |

CLI 拟为 `sakura dependency-solve`，提供 catalog、roots、platform、solve、explain、compare、lock、exchange 和 verify。离线 verify 检查固定赋值与约束，不运行包脚本、不下载版本。

## 6. 容量、权限与恢复

设计上限为每空间 2000 个包身份、20,000 个版本、100,000 条依赖边、每计划 20 个平台。单模型不超过 32 MiB，单次求解最多 120 秒、100 万个搜索节点；达到任一上限保留未完成标记。

包持久上限拟为 512 MiB，含 32 MiB 恢复账本，另受拟接入的现有 8 GiB 宿主共同额度限制。模型、索引、候选、证明、隔离导入及导出暂存均计费。普通封套默认 256 MiB，须独立实测；完整引用子图可分批，缺失引用的档案仅供只读参考。

权限沿现有 owner 模型，服务端绑定空间、actor 和 generation。输入修订或求解目标变化使旧计划失效；并发编辑使用 expectedRevision，保留原草稿供比较。

取消和撤权停止新搜索及结果发布，再确认原计算 worker 退出。中断后的部分候选可读，但须重新校验后才能封存；未知运行不自动重启。清理只删除无引用的本包派生对象。

交接格式为 `sakura-dependency-resolution-studio/1`。接收者重算结构、摘要和赋值约束，人工接受不继承原批准。模式升级保存旧约束语言和证据；无法理解旧语义时只能保留原文读取，不偷换求解含义。

## 7. 实施与验收

实施先完成中立语言与编辑，再完成有界求解、独立校验和锁定交接。所有运行任务待开始，设计示例不算生态兼容承诺。

| 场景 | 必须观察的结果 |
| --- | --- |
| 唯一可行解 | 每条直接、传递、同伴及平台约束都被独立验证 |
| 无解与截止 | 已证无解和截止未知分别显示；不可把未找到解当成无解 |
| 循环与并存 | 合法循环保留，单实例冲突与可并存解按所选模型区分 |
| 元数据冲突 | 同版本不同摘要拒绝固定，缺少材料的解保留缺项 |
| 更新目标 | 固定目标顺序产生确定结果，改变优先级后原计划失效 |
| 冲突解释 | 每个冲突项可回到原需求；未完成缩减不标记最小核心 |
| 平台差异 | 不支持的原生制品条件显式保留，不能从另一平台结果补齐 |
| 撤权与交接 | worker 实际退出后释放额度；篡改赋值、旧审批和外来脚本均不生效 |
