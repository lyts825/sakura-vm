# 特征工程工作室插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；应用保持 2.8.1，核对基线为 `4afb3b9a`。包 ID 为 `feature-engineering-studio`，包含 15 个拟议插件，运行实现待开始。共同约定见[第七批总览](plugin-pack-seventh-design.md)。

用户从固定表格生成可重复的特征矩阵，保存训练阶段拟合参数，检查时间与标签泄漏，再交付变换配方、矩阵和适用范围。首版覆盖缺失处理、数值缩放、类别编码、有限关联、历史窗口与特征选择。

本包拥有特征定义及拟合产物。[数据工作台](data-lab.md)继续负责通用数据实验，[数据契约](data-contract-studio-pack-design.md)负责交换约定，[模型评测](model-evaluation-pack-design.md)负责模型输出比较。首版支持上传表格独立完成流程，无其他新包的必需依赖。

## 2. 内部插件与直接依赖

以下服务、方法和插件均为拟议。表中依赖使用完整 ID；每行唯一拥有对应对象。根空间管理授权与额度，不接管材料字节。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `feat-spaces` 特征空间 | 空间、额度及模板选择；FeatSpacesV1：create、templates、archive | — | — |
| `feat-sources` 表格来源 | 原始 CSV/JSONL 字节、固定修订与列摘要；FeatSourcesV1：upload、pin、read | `feat-spaces` | — |
| `feat-schemas` 特征类型 | 列角色、缺失标记、类别和数值域；FeatSchemasV1：define、validate | `feat-spaces`, `feat-sources` | — |
| `feat-partitions` 样本分区 | 训练/验证/测试成员、实体组与时间界限；FeatPartitionsV1：define、checkOverlap | `feat-spaces`, `feat-sources`, `feat-schemas` | — |
| `feat-transforms` 变换配方 | 固定运算节点、类型推导和依赖顺序；FeatTransformsV1：compose、checkGraph | `feat-spaces`, `feat-schemas` | — |
| `feat-joins` 关联配方 | 关联键、基数、重复处理与来源时点；FeatJoinsV1：define、checkCardinality | `feat-spaces`, `feat-sources`, `feat-schemas`, `feat-partitions` | — |
| `feat-windows` 历史窗口 | 观察时点、回看区间与边界约定；FeatWindowsV1：define、checkAvailability | `feat-spaces`, `feat-schemas`, `feat-partitions` | — |
| `feat-fits` 拟合参数 | 仅由训练成员计算的统计量、词表和参数摘要；FeatFitsV1：fit、inspect | `feat-spaces`, `feat-sources`, `feat-schemas`, `feat-partitions`, `feat-transforms`, `feat-joins`, `feat-windows` | — |
| `feat-selections` 特征选择 | 固定列集合、筛选标准及训练域分数；FeatSelectionsV1：rank、select | `feat-spaces`, `feat-partitions`, `feat-fits` | — |
| `feat-runs` 特征生成 | 固定计划、工具任务与输出矩阵字节；FeatRunsV1：preview、start、status、cancel、reconcile | `feat-spaces`, `feat-sources`, `feat-schemas`, `feat-partitions`, `feat-transforms`, `feat-joins`, `feat-windows`, `feat-fits`, `feat-selections` | — |
| `feat-checks` 泄漏与结果检查 | 分区交叉、未来信息、未知类别及输出统计；FeatChecksV1：evaluate、explain | `feat-spaces`, `feat-schemas`, `feat-partitions`, `feat-joins`, `feat-windows`, `feat-fits`, `feat-runs` | — |
| `feat-artifacts` 特征版本 | 配方、拟合参数及矩阵的固定引用图；FeatArtifactsV1：assemble、seal、compare | `feat-spaces`, `feat-sources`, `feat-schemas`, `feat-partitions`, `feat-transforms`, `feat-joins`, `feat-windows`, `feat-fits`, `feat-selections`, `feat-runs`, `feat-checks` | — |
| `feat-reviews` 使用复核 | 数据适用域、人工例外及接受记录；FeatReviewsV1：review、decide | `feat-spaces`, `feat-artifacts`, `feat-checks` | — |
| `feat-exchange` 特征交接 | 有界封套、隔离接收与本地 ID 映射；FeatExchangeV1：export、inspectImport、acceptImport | `feat-spaces`, `feat-sources`, `feat-schemas`, `feat-partitions`, `feat-transforms`, `feat-joins`, `feat-windows`, `feat-fits`, `feat-selections`, `feat-runs`, `feat-checks`, `feat-artifacts`, `feat-reviews` | — |
| `feat-workbench` 特征工作台 | 配方画布、列来源、运行与版本导航；FeatWorkbenchV1：view、templates | `feat-spaces`, `feat-sources`, `feat-schemas`, `feat-partitions`, `feat-transforms`, `feat-joins`, `feat-windows`, `feat-fits`, `feat-selections`, `feat-runs`, `feat-checks`, `feat-artifacts`, `feat-reviews`, `feat-exchange` | — |

配方只描述受支持算子，不执行用户脚本。`feat-fits` 拥有拟合参数，`feat-runs` 拥有派生矩阵，特征版本仅保护引用；交接复制时重新登记来源及存储责任。

## 3. 模板与完整流程

| 模板 | 输入与目标 | 必须显示的结果 |
| --- | --- | --- |
| 数值与类别基线 | 一张含缺失值的表格和固定分区 | 缩放参数、编码词表、未知类别与输出列 |
| 实体历史特征 | 实体事件表、观察时点和回看区间 | 每行可用事件范围、时间边界及排除计数 |
| 多表静态特征 | 主表、维表和关联约定 | 关联基数、未匹配项及重复处理证据 |

1. 创建空间，上传材料并固定解析方式、来源许可及修订。
2. 指定标签、实体键、观察时点与可用时点；先固定分区，再建立配方。
3. 编辑变换、关联和窗口，查看类型、输出列数及资源估计。
4. 对训练成员拟合参数；选择特征后冻结配方、参数及完整输入计划。
5. 批准生成任务，分别变换各分区；未知类别按预先声明规则处理。
6. 查看泄漏检查、缺失与分布摘要，修改时建立新配方修订。
7. 复核适用范围，封存特征版本，导出配方、参数、列说明及选定矩阵。
8. 接收端核验后新建空间；清理前核对历史版本、活动读取及导出引用。

## 4. 领域规则与工具边界

输入限定 UTF-8 CSV 和 JSONL，固定分隔符、编码、空值及数值解析。拒绝重复列名和未声明的类型转换；行 ID 在首次解析时固定，排序不能改变成员身份。大整数可保留字符串，不能静默转换并损失精度。

首版运算包括常数填充、训练均值/中位数填充、标准化、截断、独热编码、频数编码、等值关联和有限历史聚合。标签编码、用户函数及外部查询留待独立设计。历史特征同时要求事件时间与可用时间不晚于观察时点。

拟议宿主接口 `FeatureTransformComputeV1` 在受管有界计算 worker 中接收固定算子图、数据租约和分区，提供拟合与变换。实施须证明无任意文件/网络访问、稀疏矩阵维度约束、取消与临时字节核销；不能直接借用通用脚本执行入口。

训练分区以外的数据不得影响拟合与筛选。关联导致的重复样本、同实体跨分区和未来信息分别报告；缺少来源可用时点时结论为范围不足，不能自动宣称无泄漏。检查只覆盖已声明关系。

复现记录固定工具版本、种子、排序及数值容差。字节一致、数值容差一致和人工认可分开保存。没有真实数据生成回执时，导入矩阵只标为外来材料。

## 5. 页面、HTTP 与 CLI

页面包括来源、分区、配方、拟合、生成、检查、特征版本和交接。画布提供等价的键盘表格；列详情可追溯输入、参数及所属分区。大矩阵采用分页预览，始终显示总行列与截断范围。

所有路径均为拟议鉴权 POST 操作，逐方法登记严格合同。CLI 前缀为 `sakura features`，支持 JSON、分页及固定修订。

| 操作 | HTTP 路径 | CLI 动作 |
| --- | --- | --- |
| 分区检查 | `/api/feat-partitions/checkOverlap` | `partitions check` |
| 配方检查 | `/api/feat-transforms/checkGraph` | `recipe check` |
| 训练域拟合 | `/api/feat-fits/fit` | `fit` |
| 预览与生成 | `/api/feat-runs/preview`、`/api/feat-runs/start` | `run preview/start` |
| 查询与停止 | `/api/feat-runs/status`、`/api/feat-runs/cancel`、`/api/feat-runs/reconcile` | `run status/cancel/reconcile` |
| 版本与交接 | `/api/feat-artifacts/seal`、`/api/feat-exchange/export` | `version seal`、`export` |

`verify` 离线核对封套、配方、成员引用和参数结构，不执行任意导入代码。重新生成矩阵属于新本地计算计划。

## 6. 容量、恢复与交接

设计上限为每空间 10 张表、合计 100,000 行、500 个输入列、2,000 个输出列和 64 个算子；单包 2 GiB，单次输入 128 MiB、输出 256 MiB、封套 256 MiB。每次计算最多 10 分钟、一个活动任务；稠密展开必须先核对乘积及峰值内存。

这些上限尚未实测。需接入[共同容量](suite-capacity.md)后取最严格额度；现有 8 GiB 不表示本包已登记。包内预留 32 MiB 恢复账本，拟合参数、矩阵、隔离接收与暂存均计费。

旧修订、分区变化和来源撤权使计划失效；类别爆炸、关联倍增及超限输出在发布前停止。中断保留原任务、暂存与参数摘要，核对原结果后继续确认，不自动重新拟合。未确认资源仍占额度。

只有真实 owner 权限，业务复核标签不授予访问权。升级先保存原对象及迁移预览，失败保持原字节；交接不携带批准、凭证或活动任务。清理按原修订核对引用，正式特征版本默认保留。

完整可执行定义必须在同一封套中带齐材料及固定引用。缺少输入或超出封套上限时，只接受明确标记的只读参考档案；不允许隐式拼接多份封套补全任务。

## 7. 实施与验收

先完成解析、分区与配方，再实现拟合/变换工具，最后接通版本、复核、工作台及独立安装交接。

1. 三个模板分别完成真实拟合和生成，矩阵每列可回溯到输入及参数。
2. 修改验证集的极端值，训练均值、词表和选择分数保持不变。
3. 同实体跨分区、重复行及未来可用事件分别定位到具体记录。
4. 关联一对多使输出翻倍时，预览显示准确增量，超限拒绝发布。
5. 未知类别、全空列、零方差及大整数按声明处理，不静默丢列。
6. 固定参数重复变换满足声明的精度范围，工具差异出现在报告中。
7. 取消、满盘及重启不会发布半矩阵；恢复核销原资源且保留原失败。
8. 单独启用本包完成离线导入、核验、重算和清理，伪造分区引用拒绝接受。
