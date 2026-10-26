# 数据质量工作室插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；当前应用保持 2.8.1，核对提交为 `4afb3b9a`。包 ID 为 `data-quality-studio`，含 15 个拟议插件，当前分支运行实现待开始。共同约束见[第七批总览](plugin-pack-seventh-design.md)。

本包面向持续交接数据批次的团队。用户固定多批次数据、质量门槛和对账范围，处理异常与例外，交付可复查的批次放行版本。首版接受本地文件，完整流程无需外部数据库。

[数据工作台](data-lab.md)的 `data-quality` 继续拥有单次规则执行及样本画像。本包新增跨批次基线、双侧对账、异常分派、例外到期和放行决定。[数据契约](data-contract-studio-pack-design.md)继续拥有生产者与消费者的约定和演进判断。导入它们的报告只形成固定参考，不接管原结果。

## 2. 内部插件与直接依赖

表中服务均为拟议 V1。每个领域插件直接依赖空间根账本，成员与依赖使用完整 ID。

| 插件 ID 与名称 | 独立对象、核心功能和服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `qualitydesk-spaces` 质量空间 | 空间、授权修订和额度；QualitydeskSpacesV1：create、configure、close | — | — |
| `qualitydesk-sources` 批次材料 | 原始文件、解析档案和许可；QualitydeskSourcesV1：upload、inspect、pin | `qualitydesk-spaces` | — |
| `qualitydesk-partitions` 分区与批次 | 业务日期、分区键、批次范围和完整性声明；QualitydeskPartitionsV1：define、bind、seal | `qualitydesk-spaces`, `qualitydesk-sources` | — |
| `qualitydesk-profiles` 批次画像 | 行数、缺失率、有限分布和计算证据；QualitydeskProfilesV1：preview、compute、cancel、reconcile | `qualitydesk-spaces`, `qualitydesk-sources`, `qualitydesk-partitions` | — |
| `qualitydesk-rules` 门槛版本 | 分区覆盖、分布偏移和跨批次门槛；QualitydeskRulesV1：define、validate、seal | `qualitydesk-spaces`, `qualitydesk-partitions`, `qualitydesk-profiles` | — |
| `qualitydesk-baselines` 基线窗口 | 历史批次选择、排除原因及冻结统计；QualitydeskBaselinesV1：select、calculate、seal | `qualitydesk-spaces`, `qualitydesk-partitions`, `qualitydesk-profiles`, `qualitydesk-rules` | — |
| `qualitydesk-runs` 批次检查 | 固定规则与基线的执行意图和结果；QualitydeskRunsV1：preview、run、cancel、reconcile | `qualitydesk-spaces`, `qualitydesk-sources`, `qualitydesk-partitions`, `qualitydesk-profiles`, `qualitydesk-rules`, `qualitydesk-baselines` | — |
| `qualitydesk-findings` 异常处置 | 问题、归类、业务负责人和复查状态；QualitydeskFindingsV1：collect、classify、resolve | `qualitydesk-spaces`, `qualitydesk-runs` | — |
| `qualitydesk-reconciliation` 双侧对账 | 键对齐、重复键、缺项及精确聚合差异；QualitydeskReconciliationV1：define、preview、compare、cancel、reconcile | `qualitydesk-spaces`, `qualitydesk-sources`, `qualitydesk-partitions`, `qualitydesk-rules` | — |
| `qualitydesk-exceptions` 限定例外 | 问题适用范围、理由、批准时点和到期；QualitydeskExceptionsV1：prepare、decide、expire | `qualitydesk-spaces`, `qualitydesk-rules`, `qualitydesk-runs`, `qualitydesk-findings`, `qualitydesk-reconciliation` | — |
| `qualitydesk-releases` 批次放行 | 固定检查、对账、未决项和人工放行决定；QualitydeskReleasesV1：preview、decide、seal | `qualitydesk-spaces`, `qualitydesk-partitions`, `qualitydesk-runs`, `qualitydesk-findings`, `qualitydesk-reconciliation`, `qualitydesk-exceptions` | — |
| `qualitydesk-reports` 质量档案 | 趋势、放行范围和原证据索引；QualitydeskReportsV1：assemble、compare、seal | `qualitydesk-spaces`, `qualitydesk-profiles`, `qualitydesk-baselines`, `qualitydesk-runs`, `qualitydesk-findings`, `qualitydesk-reconciliation`, `qualitydesk-exceptions`, `qualitydesk-releases` | — |
| `qualitydesk-exchange` 质量交接 | 材料选择、隔离导入和接收映射；QualitydeskExchangeV1：export、inspectImport、acceptImport | `qualitydesk-spaces`, `qualitydesk-sources`, `qualitydesk-partitions`, `qualitydesk-profiles`, `qualitydesk-rules`, `qualitydesk-baselines`, `qualitydesk-runs`, `qualitydesk-findings`, `qualitydesk-reconciliation`, `qualitydesk-exceptions`, `qualitydesk-releases`, `qualitydesk-reports` | — |
| `qualitydesk-checklists` 接收核对单 | 已封存档案的接收清单和核对意见；QualitydeskChecklistsV1：prepare、check、seal | `qualitydesk-spaces`, `qualitydesk-reports`, `qualitydesk-exchange` | — |
| `qualitydesk-workbench` 质量工作台 | 批次看板、问题筛选和保存视图；QualitydeskWorkbenchV1：view、saveView、templates | `qualitydesk-spaces`, `qualitydesk-sources`, `qualitydesk-partitions`, `qualitydesk-profiles`, `qualitydesk-rules`, `qualitydesk-baselines`, `qualitydesk-runs`, `qualitydesk-findings`, `qualitydesk-reconciliation`, `qualitydesk-exceptions`, `qualitydesk-releases`, `qualitydesk-reports`, `qualitydesk-exchange`, `qualitydesk-checklists` | — |

放行是本包的人工业务决定，不向数据库写入，也不自动解除其他系统的门禁。接收核对单在交接后独立形成，不能回写已导出的报告。

## 3. 模板与完整流程

| 模板 | 输入和重点 | 完成交付 |
| --- | --- | --- |
| 每日订单批次 | 多日 CSV、分区覆盖和重复批次 | 当日缺项、历史偏移及放行档案 |
| 迁移前后对账 | 两份 JSONL、业务键和十进制列 | 缺行、重复键和逐组差额 |
| 供应数据接收 | 外来文件、来源声明和接受门槛 | 例外范围、接收决定和核对单 |

1. 创建空间，上传文件并明确编码、空值标记、业务时区和来源许可。
2. 登记批次及预期分区；将未收到的分区保留为缺项。
3. 预览画像范围并计算；对截断或样本结果保持范围标识。
4. 冻结门槛与历史窗口，明确排除批次和阈值选择依据。
5. 执行批次检查或双侧对账，定位失败记录及未覆盖规则。
6. 逐项处理异常；需要例外时限定问题、批次、时限和理由。
7. 在固定比较时点生成放行预览，人工决定并封存报告。
8. 导出选定材料；接收端隔离核验、接受并填写本地核对单。

## 4. 数据判断与本体边界

首版输入为 UTF-8 CSV、扁平 JSONL 和本包版本化 JSON。业务键按明确的类型和排序规则比较，空值与空字符串分开。金额等精确量使用十进制字符串，禁止隐式浮点近似。

跨批次比较要求列语义、分区范围和解析档案相容。变化的样本选择、字段单位或缺失策略必须作为条件差异显示。基线只能使用计划已固定的历史批次，不能把待检批次混入历史窗口。

分布偏移只输出所选统计量及阈值结果。它不自动解释业务原因，不由样本合格率推断总体合格率。完整计数须扫描全部声明输入；提前取消时数量为已观察下界。

首版画像固定为总数、缺失数、不同值数及最多 32 个固定桶的频数。跨批次规则支持缺失率变化、行数比例、类别占比绝对差之和及固定桶差异。桶边界与分母策略在基线中封存；空分母或不相容的桶返回不可比较，不临时改桶获得通过。

对账预先定义一对一或分组聚合语义。一对一出现重复键时阻止比较，不能任取一行。没有匹配的记录保留在左侧缺项或右侧缺项中，不能靠内连接隐藏差异。

拟议宿主接口 `BatchQualityComputeV1` 提供固定聚合、有限比较和有界排序。实施须验证精确十进制、外部排序暂存、取消及临时资源核销。现有通用计算能力不等于本接口已可调用。

同一问题的后续修复会生成新检查。异常标为已处理或放行时，原检查失败仍保留；到期例外不再支持新放行，但不会改写历史放行时点的决定。

## 5. 页面、HTTP 与 CLI

页面提供批次日历、分区缺项、基线编辑、对账差异、异常队列、放行预览和接收核对。列表分页，支持明暗主题、390 px 窄屏、键盘操作及锁定后的私有缓存清理。

所有下表接口均为拟议 POST 路径，逐项声明严格请求、响应及 owner 策略。CLI 前缀为 `sakura quality-desk`。

| 操作与服务方法 | HTTP 路径 | CLI 子命令 |
| --- | --- | --- |
| 批次固定，Partitions.seal | `/api/qualitydesk-partitions/seal` | `batch seal` |
| 检查计划与执行，Runs.preview/run | `/api/qualitydesk-runs/preview`、`/api/qualitydesk-runs/run` | `check preview`、`check run` |
| 双侧对账，Reconciliation.compare | `/api/qualitydesk-reconciliation/compare` | `reconciliation compare` |
| 放行决定，Releases.decide | `/api/qualitydesk-releases/decide` | `release decide` |
| 导出与接受，Exchange.export/acceptImport | `/api/qualitydesk-exchange/export`、`/api/qualitydesk-exchange/acceptImport` | `export`、`import accept` |
| 接收核对，Checklists.check | `/api/qualitydesk-checklists/check` | `checklist check` |

大文件通过独立有界上传和读租约传输。CLI 另有 `status`、`wait`、`cancel`、`reconcile` 和离线 `verify`；离线核验不重新执行输入、不联网。

## 6. 容量、权限与恢复

拟定上限：一个空间 1000 个批次、每批 128 个文件，单批 256 MiB、100 万行，单行 256 KiB。一次对账两侧合计 512 MiB，最多 200 条规则和 32 个基线窗口；一次计算 5 分钟。

包总额拟定 2 GiB，包含 32 MiB 恢复账本、原材料、排序暂存、派生结果和交接隔离。导出封套最多 256 MiB；超过时须拆成独立且声明缺失引用的材料集合，不能悄悄截断。现有宿主 8 GiB 共同额度尚未登记本包，实施必须接入并取最严格上限。

服务端绑定 actor、空间、修订和插件代次。业务负责人字段不授予账户权限。所有者提供保护引用及清理预览；放行引用中的材料不能因归档或例外到期自动删除。

运行先记原意图，输出完成后才发布固定结果。取消、重启或磁盘满保留原回执；查询原任务，不重跑未知计算。部分输出不能作为完整画像发布，清理未知继续占用预算。

导入先隔离，核对完整对象图后生成新 ID。外来放行只保留来源声明，不成为本地批准。模式升级保留原字节和可恢复副本，失败保留旧模式；降级无法解释新模式时拒绝写入。

## 7. 实施与验收

P0 先完成材料、批次、固定计算及引用账本；P1 完成基线、对账与异常决定；最后完成工作台、接收和独立安装验收。责任分别归存储、质量领域及集成维护。

1. 三个模板各完成输入、检查、决定、交接和核对单，单包启用无其他新包依赖。
2. 缺一个预期分区时，行数正常也必须报告缺项。
3. 待检批次不进入已冻结历史窗口；修改窗口产生新基线。
4. 一对一对账遇重复键时拒绝；十进制金额差额保持精确。
5. 例外到期后新放行失败，历史放行和原失败仍可复查。
6. 明细达到上限只截断展示；全量计数与中断下界分别输出。
7. 撤权、旧修订、取消及磁盘满均保留原意图，不发布半份放行。
8. 篡改交接、缺失引用和重复接受均有确定结果；安装态离线核验不启动宿主。
