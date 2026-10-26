# 第七批插件成员目录

本目录由 `scripts/seventh-catalog.mjs` 从正式成员表生成，与运行目录共用输入，共 20 个包、285 个内部插件。每行列出独立所有者、领域职责、专有方法与直接必需依赖。包的操作流程及实际容量边界见[使用指南](seventh-plugin-packs.md)。

普通领域还提供严格的空间内保存、封存、固定修订读取、引用查询、归档、清理预览及批准、执行计划、状态、取消和原任务核对接口；交换插件提供导出、上传、检查、接受及原票据恢复。具体请求与响应以当前 HTTP 模式和服务 V1 契约为准。下面的专有方法不代表任意命令或动态调用入口。

## data-quality-studio

数据质量工作室，15 个插件；CLI 别名为 `quality-desk`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `qualitydesk-spaces` · 质量空间 | `QualitydeskSpacesV1` | 空间、授权修订和额度 | `create`、`configure`、`close` | 无 |
| `qualitydesk-sources` · 批次材料 | `QualitydeskSourcesV1` | 原始文件、解析档案和许可 | `upload`、`inspect`、`pin` | `qualitydesk-spaces` |
| `qualitydesk-partitions` · 分区与批次 | `QualitydeskPartitionsV1` | 业务日期、分区键、批次范围和完整性声明 | `define`、`bind`、`seal` | `qualitydesk-spaces`、`qualitydesk-sources` |
| `qualitydesk-profiles` · 批次画像 | `QualitydeskProfilesV1` | 行数、缺失率、有限分布和计算证据 | `preview`、`compute`、`cancel`、`reconcile` | `qualitydesk-spaces`、`qualitydesk-sources`、`qualitydesk-partitions` |
| `qualitydesk-rules` · 门槛版本 | `QualitydeskRulesV1` | 分区覆盖、分布偏移和跨批次门槛 | `define`、`validate`、`seal` | `qualitydesk-spaces`、`qualitydesk-partitions`、`qualitydesk-profiles` |
| `qualitydesk-baselines` · 基线窗口 | `QualitydeskBaselinesV1` | 历史批次选择、排除原因及冻结统计 | `select`、`calculate`、`seal` | `qualitydesk-spaces`、`qualitydesk-partitions`、`qualitydesk-profiles`、`qualitydesk-rules` |
| `qualitydesk-runs` · 批次检查 | `QualitydeskRunsV1` | 固定规则与基线的执行意图和结果 | `preview`、`run`、`cancel`、`reconcile` | `qualitydesk-spaces`、`qualitydesk-sources`、`qualitydesk-partitions`、`qualitydesk-profiles`、`qualitydesk-rules`、`qualitydesk-baselines` |
| `qualitydesk-findings` · 异常处置 | `QualitydeskFindingsV1` | 问题、归类、业务负责人和复查状态 | `collect`、`classify`、`resolve` | `qualitydesk-spaces`、`qualitydesk-runs` |
| `qualitydesk-reconciliation` · 双侧对账 | `QualitydeskReconciliationV1` | 键对齐、重复键、缺项及精确聚合差异 | `define`、`preview`、`compare`、`cancel`、`reconcile` | `qualitydesk-spaces`、`qualitydesk-sources`、`qualitydesk-partitions`、`qualitydesk-rules` |
| `qualitydesk-exceptions` · 限定例外 | `QualitydeskExceptionsV1` | 问题适用范围、理由、批准时点和到期 | `prepare`、`decide`、`expire` | `qualitydesk-spaces`、`qualitydesk-rules`、`qualitydesk-runs`、`qualitydesk-findings`、`qualitydesk-reconciliation` |
| `qualitydesk-releases` · 批次放行 | `QualitydeskReleasesV1` | 固定检查、对账、未决项和人工放行决定 | `preview`、`decide`、`seal` | `qualitydesk-spaces`、`qualitydesk-partitions`、`qualitydesk-runs`、`qualitydesk-findings`、`qualitydesk-reconciliation`、`qualitydesk-exceptions` |
| `qualitydesk-reports` · 质量档案 | `QualitydeskReportsV1` | 趋势、放行范围和原证据索引 | `assemble`、`compare`、`seal` | `qualitydesk-spaces`、`qualitydesk-profiles`、`qualitydesk-baselines`、`qualitydesk-runs`、`qualitydesk-findings`、`qualitydesk-reconciliation`、`qualitydesk-exceptions`、`qualitydesk-releases` |
| `qualitydesk-exchange` · 质量交接 | `QualitydeskExchangeV1` | 材料选择、隔离导入和接收映射 | `export`、`inspectImport`、`acceptImport` | `qualitydesk-spaces`、`qualitydesk-sources`、`qualitydesk-partitions`、`qualitydesk-profiles`、`qualitydesk-rules`、`qualitydesk-baselines`、`qualitydesk-runs`、`qualitydesk-findings`、`qualitydesk-reconciliation`、`qualitydesk-exceptions`、`qualitydesk-releases`、`qualitydesk-reports` |
| `qualitydesk-checklists` · 接收核对单 | `QualitydeskChecklistsV1` | 已封存档案的接收清单和核对意见 | `prepare`、`check`、`seal` | `qualitydesk-spaces`、`qualitydesk-reports`、`qualitydesk-exchange` |
| `qualitydesk-workbench` · 质量工作台 | `QualitydeskWorkbenchV1` | 批次看板、问题筛选和保存视图 | `view`、`saveView`、`templates` | `qualitydesk-spaces`、`qualitydesk-sources`、`qualitydesk-partitions`、`qualitydesk-profiles`、`qualitydesk-rules`、`qualitydesk-baselines`、`qualitydesk-runs`、`qualitydesk-findings`、`qualitydesk-reconciliation`、`qualitydesk-exceptions`、`qualitydesk-releases`、`qualitydesk-reports`、`qualitydesk-exchange`、`qualitydesk-checklists` |

## lineage-atlas

数据血缘与影响分析，13 个插件；CLI 别名为 `lineage-atlas`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `lineageatlas-spaces` · 血缘空间 | `LineageatlasSpacesV1` | 空间、授权和额度 | `create`、`configure`、`close` | 无 |
| `lineageatlas-catalogs` · 来源目录 | `LineageatlasCatalogsV1` | 原始清单、命名空间和来源许可 | `upload`、`inspect`、`pin` | `lineageatlas-spaces` |
| `lineageatlas-assets` · 资产身份 | `LineageatlasAssetsV1` | 系统、数据集、字段和身份别名 | `define`、`matchIdentity`、`seal` | `lineageatlas-spaces`、`lineageatlas-catalogs` |
| `lineageatlas-mappings` · 字段映射 | `LineageatlasMappingsV1` | 源目标字段、变换类别与缺失声明 | `define`、`validate`、`seal` | `lineageatlas-spaces`、`lineageatlas-assets` |
| `lineageatlas-processes` · 处理步骤 | `LineageatlasProcessesV1` | 作业定义、固定输入输出和时段 | `define`、`bind`、`seal` | `lineageatlas-spaces`、`lineageatlas-assets`、`lineageatlas-mappings` |
| `lineageatlas-assertions` · 血缘证据 | `LineageatlasAssertionsV1` | 观察、外来声明、人工补录和相互冲突 | `record`、`compare`、`classify` | `lineageatlas-spaces`、`lineageatlas-catalogs`、`lineageatlas-assets`、`lineageatlas-mappings`、`lineageatlas-processes` |
| `lineageatlas-graphs` · 图版本 | `LineageatlasGraphsV1` | 固定节点边、有效期和完整性缺项 | `compose`、`validate`、`seal` | `lineageatlas-spaces`、`lineageatlas-assets`、`lineageatlas-mappings`、`lineageatlas-processes`、`lineageatlas-assertions` |
| `lineageatlas-impacts` · 变更影响 | `LineageatlasImpactsV1` | 变更集、遍历范围、路径和停止边界 | `preview`、`trace`、`cancel`、`reconcile` | `lineageatlas-spaces`、`lineageatlas-assets`、`lineageatlas-assertions`、`lineageatlas-graphs` |
| `lineageatlas-investigations` · 调查记录 | `LineageatlasInvestigationsV1` | 未知边、冲突问题、业务确认和证据补充 | `open`、`attach`、`resolve` | `lineageatlas-spaces`、`lineageatlas-assertions`、`lineageatlas-graphs`、`lineageatlas-impacts` |
| `lineageatlas-reviews` · 图复核 | `LineageatlasReviewsV1` | 身份合并和影响结论的人工决定 | `prepare`、`decide`、`seal` | `lineageatlas-spaces`、`lineageatlas-assets`、`lineageatlas-graphs`、`lineageatlas-impacts`、`lineageatlas-investigations` |
| `lineageatlas-reports` · 血缘档案 | `LineageatlasReportsV1` | 图差异、调查范围和确认时点 | `assemble`、`compare`、`seal` | `lineageatlas-spaces`、`lineageatlas-graphs`、`lineageatlas-impacts`、`lineageatlas-investigations`、`lineageatlas-reviews` |
| `lineageatlas-exchange` · 血缘交接 | `LineageatlasExchangeV1` | 原目录、图版本与调查档案的隔离交换 | `export`、`inspectImport`、`acceptImport` | `lineageatlas-spaces`、`lineageatlas-catalogs`、`lineageatlas-assets`、`lineageatlas-mappings`、`lineageatlas-processes`、`lineageatlas-assertions`、`lineageatlas-graphs`、`lineageatlas-impacts`、`lineageatlas-investigations`、`lineageatlas-reviews`、`lineageatlas-reports` |
| `lineageatlas-workbench` · 血缘工作台 | `LineageatlasWorkbenchV1` | 分层图、证据面板、影响树和保存视图 | `view`、`saveView`、`templates` | `lineageatlas-spaces`、`lineageatlas-catalogs`、`lineageatlas-assets`、`lineageatlas-mappings`、`lineageatlas-processes`、`lineageatlas-assertions`、`lineageatlas-graphs`、`lineageatlas-impacts`、`lineageatlas-investigations`、`lineageatlas-reviews`、`lineageatlas-reports`、`lineageatlas-exchange` |

## entity-resolution-studio

实体归并工作室，15 个插件；CLI 别名为 `entity-desk`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `entitydesk-spaces` · 归并空间 | `EntitydeskSpacesV1` | 空间、授权和额度 | `create`、`configure`、`close` | 无 |
| `entitydesk-sources` · 原始台账 | `EntitydeskSourcesV1` | 原文件、字段档案、记录定位及许可 | `upload`、`inspect`、`pin` | `entitydesk-spaces` |
| `entitydesk-normalization` · 标准化规则 | `EntitydeskNormalizationV1` | 大小写、空白、单位和有限词典映射 | `define`、`preview`、`seal` | `entitydesk-spaces`、`entitydesk-sources` |
| `entitydesk-blocks` · 候选分组 | `EntitydeskBlocksV1` | 阻塞键、邻域范围和候选覆盖声明 | `define`、`estimate`、`seal` | `entitydesk-spaces`、`entitydesk-sources`、`entitydesk-normalization` |
| `entitydesk-comparators` · 比较器版本 | `EntitydeskComparatorsV1` | 精确匹配、编辑距离及数值容差 | `define`、`validate`、`seal` | `entitydesk-spaces`、`entitydesk-normalization` |
| `entitydesk-candidates` · 候选对 | `EntitydeskCandidatesV1` | 比较任务、逐字段分数和缺失项 | `preview`、`compute`、`cancel`、`reconcile` | `entitydesk-spaces`、`entitydesk-sources`、`entitydesk-normalization`、`entitydesk-blocks`、`entitydesk-comparators` |
| `entitydesk-constraints` · 合并约束 | `EntitydeskConstraintsV1` | 必须同组、禁止同组和互斥来源条件 | `define`、`check`、`seal` | `entitydesk-spaces`、`entitydesk-sources`、`entitydesk-candidates` |
| `entitydesk-clusters` · 候选簇 | `EntitydeskClustersV1` | 簇提议、冲突边和连通性解释 | `propose`、`explain`、`split` | `entitydesk-spaces`、`entitydesk-candidates`、`entitydesk-constraints` |
| `entitydesk-decisions` · 人工裁决 | `EntitydeskDecisionsV1` | 成对及簇级接受、拒绝、暂缓和理由 | `prepare`、`decide`、`seal` | `entitydesk-spaces`、`entitydesk-sources`、`entitydesk-candidates`、`entitydesk-constraints`、`entitydesk-clusters` |
| `entitydesk-evaluations` · 匹配复核 | `EntitydeskEvaluationsV1` | 固定标注对、抽样范围和匹配指标 | `defineSet`、`evaluate`、`compare` | `entitydesk-spaces`、`entitydesk-candidates`、`entitydesk-clusters`、`entitydesk-decisions` |
| `entitydesk-survivors` · 字段取值 | `EntitydeskSurvivorsV1` | 来源优先级、逐字段冲突和取值证据 | `define`、`preview`、`resolve` | `entitydesk-spaces`、`entitydesk-sources`、`entitydesk-normalization`、`entitydesk-decisions` |
| `entitydesk-versions` · 规范实体版本 | `EntitydeskVersionsV1` | 规范记录、原记录映射和拆分历史 | `compose`、`validate`、`seal` | `entitydesk-spaces`、`entitydesk-sources`、`entitydesk-decisions`、`entitydesk-survivors` |
| `entitydesk-reports` · 归并档案 | `EntitydeskReportsV1` | 阈值、覆盖、复核、未决项和版本差异 | `assemble`、`compare`、`seal` | `entitydesk-spaces`、`entitydesk-candidates`、`entitydesk-clusters`、`entitydesk-decisions`、`entitydesk-evaluations`、`entitydesk-versions` |
| `entitydesk-exchange` · 归并交接 | `EntitydeskExchangeV1` | 规范数据、原映射和证据的隔离交换 | `export`、`inspectImport`、`acceptImport` | `entitydesk-spaces`、`entitydesk-sources`、`entitydesk-normalization`、`entitydesk-blocks`、`entitydesk-comparators`、`entitydesk-candidates`、`entitydesk-constraints`、`entitydesk-clusters`、`entitydesk-decisions`、`entitydesk-evaluations`、`entitydesk-survivors`、`entitydesk-versions`、`entitydesk-reports` |
| `entitydesk-workbench` · 归并工作台 | `EntitydeskWorkbenchV1` | 双列比较、簇裁决、取值预览和保存视图 | `view`、`saveView`、`templates` | `entitydesk-spaces`、`entitydesk-sources`、`entitydesk-normalization`、`entitydesk-blocks`、`entitydesk-comparators`、`entitydesk-candidates`、`entitydesk-constraints`、`entitydesk-clusters`、`entitydesk-decisions`、`entitydesk-evaluations`、`entitydesk-survivors`、`entitydesk-versions`、`entitydesk-reports`、`entitydesk-exchange` |

## temporal-data-studio

时间数据工作室，14 个插件；CLI 别名为 `temporal-desk`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `temporaldesk-spaces` · 时间空间 | `TemporaldeskSpacesV1` | 空间、授权和额度 | `create`、`configure`、`close` | 无 |
| `temporaldesk-sources` · 时间材料 | `TemporaldeskSourcesV1` | 原记录、解析档案和来源许可 | `upload`、`inspect`、`pin` | `temporaldesk-spaces` |
| `temporaldesk-calendars` · 日历版本 | `TemporaldeskCalendarsV1` | 时区资料、工作日历及业务日边界 | `define`、`inspect`、`seal` | `temporaldesk-spaces` |
| `temporaldesk-semantics` · 时间语义 | `TemporaldeskSemanticsV1` | 事件时间、记录时间、精度和不确定区间 | `define`、`validate`、`seal` | `temporaldesk-spaces`、`temporaldesk-sources`、`temporaldesk-calendars` |
| `temporaldesk-alignment` · 时间对齐 | `TemporaldeskAlignmentV1` | 时区消歧、单位转换及显式偏移规则 | `define`、`preview`、`seal` | `temporaldesk-spaces`、`temporaldesk-sources`、`temporaldesk-calendars`、`temporaldesk-semantics` |
| `temporaldesk-intervals` · 区间规则 | `TemporaldeskIntervalsV1` | 开闭端点、重叠、间隙与有效期 | `define`、`validate`、`seal` | `temporaldesk-spaces`、`temporaldesk-semantics`、`temporaldesk-alignment` |
| `temporaldesk-windows` · 窗口定义 | `TemporaldeskWindowsV1` | 滚动、滑动、会话及重采样窗口 | `define`、`validate`、`seal` | `temporaldesk-spaces`、`temporaldesk-calendars`、`temporaldesk-semantics`、`temporaldesk-alignment` |
| `temporaldesk-latepolicy` · 迟到策略 | `TemporaldeskLatepolicyV1` | 固定水位序列、迟到阈值和更正办法 | `define`、`validate`、`seal` | `temporaldesk-spaces`、`temporaldesk-semantics`、`temporaldesk-windows` |
| `temporaldesk-runs` · 时间处理 | `TemporaldeskRunsV1` | 对齐、窗口、区间计算和派生数据 | `preview`、`run`、`cancel`、`reconcile` | `temporaldesk-spaces`、`temporaldesk-sources`、`temporaldesk-calendars`、`temporaldesk-semantics`、`temporaldesk-alignment`、`temporaldesk-intervals`、`temporaldesk-windows`、`temporaldesk-latepolicy` |
| `temporaldesk-comparisons` · 时间比较 | `TemporaldeskComparisonsV1` | 规则版本差异、窗口修正和缺口 | `compare`、`explain` | `temporaldesk-spaces`、`temporaldesk-runs`、`temporaldesk-windows`、`temporaldesk-latepolicy` |
| `temporaldesk-reviews` · 语义复核 | `TemporaldeskReviewsV1` | 歧义时刻、估计偏移和适用范围决定 | `prepare`、`decide`、`seal` | `temporaldesk-spaces`、`temporaldesk-semantics`、`temporaldesk-alignment`、`temporaldesk-runs`、`temporaldesk-comparisons` |
| `temporaldesk-reports` · 时间档案 | `TemporaldeskReportsV1` | 处理版本、原值追溯和覆盖说明 | `assemble`、`seal` | `temporaldesk-spaces`、`temporaldesk-runs`、`temporaldesk-comparisons`、`temporaldesk-reviews` |
| `temporaldesk-exchange` · 时间交接 | `TemporaldeskExchangeV1` | 原记录、日历档案及派生版本交换 | `export`、`inspectImport`、`acceptImport` | `temporaldesk-spaces`、`temporaldesk-sources`、`temporaldesk-calendars`、`temporaldesk-semantics`、`temporaldesk-alignment`、`temporaldesk-intervals`、`temporaldesk-windows`、`temporaldesk-latepolicy`、`temporaldesk-runs`、`temporaldesk-comparisons`、`temporaldesk-reviews`、`temporaldesk-reports` |
| `temporaldesk-workbench` · 时间工作台 | `TemporaldeskWorkbenchV1` | 时间轴、歧义队列、窗口预览和保存视图 | `view`、`saveView`、`templates` | `temporaldesk-spaces`、`temporaldesk-sources`、`temporaldesk-calendars`、`temporaldesk-semantics`、`temporaldesk-alignment`、`temporaldesk-intervals`、`temporaldesk-windows`、`temporaldesk-latepolicy`、`temporaldesk-runs`、`temporaldesk-comparisons`、`temporaldesk-reviews`、`temporaldesk-reports`、`temporaldesk-exchange` |

## geospatial-studio

地理数据工作室，15 个插件；CLI 别名为 `geo-desk`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `geodesk-spaces` · 地理空间 | `GeodeskSpacesV1` | 工作空间、授权和额度 | `create`、`configure`、`close` | 无 |
| `geodesk-sources` · 地理材料 | `GeodeskSourcesV1` | 原文件、来源许可和字段档案 | `upload`、`inspect`、`pin` | `geodesk-spaces` |
| `geodesk-crs` · 坐标档案 | `GeodeskCrsV1` | 坐标参考、轴顺序、单位及变换版本 | `define`、`validate`、`seal` | `geodesk-spaces`、`geodesk-sources` |
| `geodesk-validation` · 几何检查 | `GeodeskValidationV1` | 无效坐标、自交、空几何和修复建议 | `preview`、`check`、`cancel`、`reconcile` | `geodesk-spaces`、`geodesk-sources`、`geodesk-crs` |
| `geodesk-layers` · 图层版本 | `GeodeskLayersV1` | 固定要素、属性、范围和父版本 | `compose`、`validate`、`seal` | `geodesk-spaces`、`geodesk-sources`、`geodesk-crs`、`geodesk-validation` |
| `geodesk-operations` · 几何操作 | `GeodeskOperationsV1` | 裁剪、相交、缓冲和变换定义 | `define`、`preview`、`seal` | `geodesk-spaces`、`geodesk-crs`、`geodesk-layers` |
| `geodesk-joins` · 空间连接 | `GeodeskJoinsV1` | 包含、相交、最近邻及多匹配策略 | `define`、`validate`、`seal` | `geodesk-spaces`、`geodesk-crs`、`geodesk-layers` |
| `geodesk-indexes` · 空间索引 | `GeodeskIndexesV1` | 图层固定版本的索引及覆盖账本 | `build`、`inspect`、`cancel`、`reconcile` | `geodesk-spaces`、`geodesk-layers` |
| `geodesk-runs` · 空间计算 | `GeodeskRunsV1` | 固定工具任务、派生图层和逐要素错误 | `preview`、`run`、`cancel`、`reconcile` | `geodesk-spaces`、`geodesk-crs`、`geodesk-validation`、`geodesk-layers`、`geodesk-operations`、`geodesk-joins`、`geodesk-indexes` |
| `geodesk-measures` · 地理计量 | `GeodeskMeasuresV1` | 距离、长度、面积及分组汇总 | `define`、`calculate`、`compare` | `geodesk-spaces`、`geodesk-crs`、`geodesk-layers`、`geodesk-runs` |
| `geodesk-styles` · 地图样式 | `GeodeskStylesV1` | 分类色、标注、图例和显示精度 | `define`、`preview`、`seal` | `geodesk-spaces`、`geodesk-layers`、`geodesk-measures` |
| `geodesk-reviews` · 地图复核 | `GeodeskReviewsV1` | 修复选择、缺失区域和用途限制决定 | `prepare`、`decide`、`seal` | `geodesk-spaces`、`geodesk-validation`、`geodesk-layers`、`geodesk-runs`、`geodesk-measures`、`geodesk-styles` |
| `geodesk-reports` · 地理档案 | `GeodeskReportsV1` | 输入输出、地图视图及计量依据 | `assemble`、`seal` | `geodesk-spaces`、`geodesk-layers`、`geodesk-runs`、`geodesk-measures`、`geodesk-styles`、`geodesk-reviews` |
| `geodesk-exchange` · 图层交接 | `GeodeskExchangeV1` | 图层、坐标档案和地图报告交换 | `export`、`inspectImport`、`acceptImport` | `geodesk-spaces`、`geodesk-sources`、`geodesk-crs`、`geodesk-validation`、`geodesk-layers`、`geodesk-operations`、`geodesk-joins`、`geodesk-indexes`、`geodesk-runs`、`geodesk-measures`、`geodesk-styles`、`geodesk-reviews`、`geodesk-reports` |
| `geodesk-workbench` · 地理工作台 | `GeodeskWorkbenchV1` | 图层树、地图、属性表和保存视图 | `view`、`saveView`、`templates` | `geodesk-spaces`、`geodesk-sources`、`geodesk-crs`、`geodesk-validation`、`geodesk-layers`、`geodesk-operations`、`geodesk-joins`、`geodesk-indexes`、`geodesk-runs`、`geodesk-measures`、`geodesk-styles`、`geodesk-reviews`、`geodesk-reports`、`geodesk-exchange` |

## graph-insight-studio

关系图分析工作室，14 个插件；CLI 别名为 `graph-desk`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `graphdesk-spaces` · 关系空间 | `GraphdeskSpacesV1` | 空间、授权和额度 | `create`、`configure`、`close` | 无 |
| `graphdesk-sources` · 图材料 | `GraphdeskSourcesV1` | 节点边原表、字段档案和许可 | `upload`、`inspect`、`pin` | `graphdesk-spaces` |
| `graphdesk-entities` · 节点目录 | `GraphdeskEntitiesV1` | 稳定节点、类型、属性及别名 | `define`、`validate`、`seal` | `graphdesk-spaces`、`graphdesk-sources` |
| `graphdesk-edges` · 关系目录 | `GraphdeskEdgesV1` | 有向性、多重边、权重与边证据 | `define`、`validate`、`seal` | `graphdesk-spaces`、`graphdesk-sources`、`graphdesk-entities` |
| `graphdesk-projections` · 图投影 | `GraphdeskProjectionsV1` | 节点筛选、边聚合、方向和时间截面 | `compose`、`validate`、`seal` | `graphdesk-spaces`、`graphdesk-entities`、`graphdesk-edges` |
| `graphdesk-queries` · 路径查询 | `GraphdeskQueriesV1` | 有限关系模式、起终点和遍历界限 | `define`、`preview`、`seal` | `graphdesk-spaces`、`graphdesk-entities`、`graphdesk-edges`、`graphdesk-projections` |
| `graphdesk-algorithms` · 算法档案 | `GraphdeskAlgorithmsV1` | 连通分量、度数、最短路径和固定迭代 | `define`、`validate`、`seal` | `graphdesk-spaces`、`graphdesk-projections` |
| `graphdesk-runs` · 图计算 | `GraphdeskRunsV1` | 固定图任务、结果表和收敛记录 | `preview`、`run`、`cancel`、`reconcile` | `graphdesk-spaces`、`graphdesk-projections`、`graphdesk-queries`、`graphdesk-algorithms` |
| `graphdesk-comparisons` · 结构比较 | `GraphdeskComparisonsV1` | 节点边差异、指标适用条件与变化 | `compare`、`explain` | `graphdesk-spaces`、`graphdesk-projections`、`graphdesk-runs` |
| `graphdesk-annotations` · 结果复核 | `GraphdeskAnnotationsV1` | 发现、证据引用、解释和人工意见 | `record`、`review`、`seal` | `graphdesk-spaces`、`graphdesk-entities`、`graphdesk-edges`、`graphdesk-runs`、`graphdesk-comparisons` |
| `graphdesk-views` · 图视图 | `GraphdeskViewsV1` | 布局种子、坐标、聚合和展示范围 | `compose`、`layout`、`save` | `graphdesk-spaces`、`graphdesk-projections`、`graphdesk-runs`、`graphdesk-annotations` |
| `graphdesk-reports` · 图分析档案 | `GraphdeskReportsV1` | 固定投影、算法、结果、解释和图视图 | `assemble`、`seal` | `graphdesk-spaces`、`graphdesk-projections`、`graphdesk-runs`、`graphdesk-comparisons`、`graphdesk-annotations`、`graphdesk-views` |
| `graphdesk-exchange` · 关系图交接 | `GraphdeskExchangeV1` | 原图、投影、结果和说明的隔离交换 | `export`、`inspectImport`、`acceptImport` | `graphdesk-spaces`、`graphdesk-sources`、`graphdesk-entities`、`graphdesk-edges`、`graphdesk-projections`、`graphdesk-queries`、`graphdesk-algorithms`、`graphdesk-runs`、`graphdesk-comparisons`、`graphdesk-annotations`、`graphdesk-views`、`graphdesk-reports` |
| `graphdesk-workbench` · 关系图工作台 | `GraphdeskWorkbenchV1` | 节点边编辑、路径表、算法比较和导航 | `view`、`saveView`、`templates` | `graphdesk-spaces`、`graphdesk-sources`、`graphdesk-entities`、`graphdesk-edges`、`graphdesk-projections`、`graphdesk-queries`、`graphdesk-algorithms`、`graphdesk-runs`、`graphdesk-comparisons`、`graphdesk-annotations`、`graphdesk-views`、`graphdesk-reports`、`graphdesk-exchange` |

## experiment-planner

对照实验规划，14 个插件；CLI 别名为 `experiment-plan`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `trialplan-spaces` · 规划空间 | `TrialplanSpacesV1` | 空间、授权和额度 | `create`、`configure`、`close` | 无 |
| `trialplan-questions` · 研究问题 | `TrialplanQuestionsV1` | 方案对照、目标差异、假设和适用范围 | `define`、`validate`、`seal` | `trialplan-spaces` |
| `trialplan-populations` · 单位与总体 | `TrialplanPopulationsV1` | 单位清单、纳入规则、分层和簇关系 | `upload`、`define`、`seal` | `trialplan-spaces`、`trialplan-questions` |
| `trialplan-outcomes` · 指标定义 | `TrialplanOutcomesV1` | 主要指标、分母、窗口和缺失策略 | `define`、`validate`、`seal` | `trialplan-spaces`、`trialplan-questions`、`trialplan-populations` |
| `trialplan-allocations` · 分组设计 | `TrialplanAllocationsV1` | 分配比例、分层、区组及固定种子策略 | `define`、`validate`、`seal` | `trialplan-spaces`、`trialplan-populations` |
| `trialplan-powerplans` · 规模模拟 | `TrialplanPowerplansV1` | 基线假设、效应场景、模拟和不确定性 | `define`、`preview`、`simulate`、`cancel`、`reconcile` | `trialplan-spaces`、`trialplan-questions`、`trialplan-populations`、`trialplan-outcomes`、`trialplan-allocations` |
| `trialplan-assignments` · 分配版本 | `TrialplanAssignmentsV1` | 固定单位分配表及算法回执 | `preview`、`generate`、`seal` | `trialplan-spaces`、`trialplan-populations`、`trialplan-allocations`、`trialplan-powerplans` |
| `trialplan-observations` · 观测材料 | `TrialplanObservationsV1` | 原资料、实际接触、偏离及数据截止 | `upload`、`validate`、`pin` | `trialplan-spaces`、`trialplan-populations`、`trialplan-outcomes`、`trialplan-assignments` |
| `trialplan-analyses` · 分析计划与结果 | `TrialplanAnalysesV1` | 预设方法、固定观测、估计和覆盖 | `define`、`sealPlan`、`preview`、`run`、`cancel`、`reconcile` | `trialplan-spaces`、`trialplan-questions`、`trialplan-populations`、`trialplan-outcomes`、`trialplan-allocations`、`trialplan-assignments`、`trialplan-observations` |
| `trialplan-sensitivity` · 敏感性分析 | `TrialplanSensitivityV1` | 缺失、异常值和偏离的预设替代场景 | `define`、`run`、`compare` | `trialplan-spaces`、`trialplan-outcomes`、`trialplan-observations`、`trialplan-analyses` |
| `trialplan-reviews` · 设计与结果复核 | `TrialplanReviewsV1` | 计划时序、偏离、解释及限制决定 | `prepare`、`decide`、`seal` | `trialplan-spaces`、`trialplan-questions`、`trialplan-powerplans`、`trialplan-assignments`、`trialplan-observations`、`trialplan-analyses`、`trialplan-sensitivity` |
| `trialplan-reports` · 实验规划档案 | `TrialplanReportsV1` | 设计、模拟、观测、结果和限制的固定索引 | `assemble`、`compare`、`seal` | `trialplan-spaces`、`trialplan-questions`、`trialplan-powerplans`、`trialplan-assignments`、`trialplan-observations`、`trialplan-analyses`、`trialplan-sensitivity`、`trialplan-reviews` |
| `trialplan-exchange` · 实验资料交接 | `TrialplanExchangeV1` | 计划、分配和允许披露的资料交换 | `export`、`inspectImport`、`acceptImport` | `trialplan-spaces`、`trialplan-questions`、`trialplan-populations`、`trialplan-outcomes`、`trialplan-allocations`、`trialplan-powerplans`、`trialplan-assignments`、`trialplan-observations`、`trialplan-analyses`、`trialplan-sensitivity`、`trialplan-reviews`、`trialplan-reports` |
| `trialplan-workbench` · 实验规划工作台 | `TrialplanWorkbenchV1` | 假设编辑、规模曲线、分组及偏离检查 | `view`、`saveView`、`templates` | `trialplan-spaces`、`trialplan-questions`、`trialplan-populations`、`trialplan-outcomes`、`trialplan-allocations`、`trialplan-powerplans`、`trialplan-assignments`、`trialplan-observations`、`trialplan-analyses`、`trialplan-sensitivity`、`trialplan-reviews`、`trialplan-reports`、`trialplan-exchange` |

## feature-engineering-studio

特征工程工作室，15 个插件；CLI 别名为 `features`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `feat-spaces` · 特征空间 | `FeatSpacesV1` | 空间、额度及模板选择 | `create`、`templates`、`archive` | 无 |
| `feat-sources` · 表格来源 | `FeatSourcesV1` | 原始 CSV/JSONL 字节、固定修订与列摘要 | `upload`、`pin`、`read` | `feat-spaces` |
| `feat-schemas` · 特征类型 | `FeatSchemasV1` | 列角色、缺失标记、类别和数值域 | `define`、`validate` | `feat-spaces`、`feat-sources` |
| `feat-partitions` · 样本分区 | `FeatPartitionsV1` | 训练/验证/测试成员、实体组与时间界限 | `define`、`checkOverlap` | `feat-spaces`、`feat-sources`、`feat-schemas` |
| `feat-transforms` · 变换配方 | `FeatTransformsV1` | 固定运算节点、类型推导和依赖顺序 | `compose`、`checkGraph` | `feat-spaces`、`feat-schemas` |
| `feat-joins` · 关联配方 | `FeatJoinsV1` | 关联键、基数、重复处理与来源时点 | `define`、`checkCardinality` | `feat-spaces`、`feat-sources`、`feat-schemas`、`feat-partitions` |
| `feat-windows` · 历史窗口 | `FeatWindowsV1` | 观察时点、回看区间与边界约定 | `define`、`checkAvailability` | `feat-spaces`、`feat-schemas`、`feat-partitions` |
| `feat-fits` · 拟合参数 | `FeatFitsV1` | 仅由训练成员计算的统计量、词表和参数摘要 | `fit`、`inspect` | `feat-spaces`、`feat-sources`、`feat-schemas`、`feat-partitions`、`feat-transforms`、`feat-joins`、`feat-windows` |
| `feat-selections` · 特征选择 | `FeatSelectionsV1` | 固定列集合、筛选标准及训练域分数 | `rank`、`select` | `feat-spaces`、`feat-partitions`、`feat-fits` |
| `feat-runs` · 特征生成 | `FeatRunsV1` | 固定计划、工具任务与输出矩阵字节 | `preview`、`start`、`status`、`cancel`、`reconcile` | `feat-spaces`、`feat-sources`、`feat-schemas`、`feat-partitions`、`feat-transforms`、`feat-joins`、`feat-windows`、`feat-fits`、`feat-selections` |
| `feat-checks` · 泄漏与结果检查 | `FeatChecksV1` | 分区交叉、未来信息、未知类别及输出统计 | `evaluate`、`explain` | `feat-spaces`、`feat-schemas`、`feat-partitions`、`feat-joins`、`feat-windows`、`feat-fits`、`feat-runs` |
| `feat-artifacts` · 特征版本 | `FeatArtifactsV1` | 配方、拟合参数及矩阵的固定引用图 | `assemble`、`seal`、`compare` | `feat-spaces`、`feat-sources`、`feat-schemas`、`feat-partitions`、`feat-transforms`、`feat-joins`、`feat-windows`、`feat-fits`、`feat-selections`、`feat-runs`、`feat-checks` |
| `feat-reviews` · 使用复核 | `FeatReviewsV1` | 数据适用域、人工例外及接受记录 | `review`、`decide` | `feat-spaces`、`feat-artifacts`、`feat-checks` |
| `feat-exchange` · 特征交接 | `FeatExchangeV1` | 有界封套、隔离接收与本地 ID 映射 | `export`、`inspectImport`、`acceptImport` | `feat-spaces`、`feat-sources`、`feat-schemas`、`feat-partitions`、`feat-transforms`、`feat-joins`、`feat-windows`、`feat-fits`、`feat-selections`、`feat-runs`、`feat-checks`、`feat-artifacts`、`feat-reviews` |
| `feat-workbench` · 特征工作台 | `FeatWorkbenchV1` | 配方画布、列来源、运行与版本导航 | `view`、`templates` | `feat-spaces`、`feat-sources`、`feat-schemas`、`feat-partitions`、`feat-transforms`、`feat-joins`、`feat-windows`、`feat-fits`、`feat-selections`、`feat-runs`、`feat-checks`、`feat-artifacts`、`feat-reviews`、`feat-exchange` |

## classical-training-lab

经典模型训练实验，15 个插件；CLI 别名为 `trainlab`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `ctrain-spaces` · 训练空间 | `CtrainSpacesV1` | 空间、额度、模板及访问修订 | `create`、`templates`、`archive` | 无 |
| `ctrain-datasets` · 训练材料 | `CtrainDatasetsV1` | CSV/JSONL 原始字节、列角色和固定样本 | `upload`、`pin`、`inspect` | `ctrain-spaces` |
| `ctrain-targets` · 学习目标 | `CtrainTargetsV1` | 任务类型、标签、类别及度量方向 | `define`、`check` | `ctrain-spaces`、`ctrain-datasets` |
| `ctrain-partitions` · 评估分区 | `CtrainPartitionsV1` | 训练、验证、测试、实体组和交叉验证成员 | `define`、`checkOverlap` | `ctrain-spaces`、`ctrain-datasets`、`ctrain-targets` |
| `ctrain-estimators` · 算法配方 | `CtrainEstimatorsV1` | 固定算法、参数类型、预处理和工具摘要 | `configure`、`validate` | `ctrain-spaces`、`ctrain-targets`、`ctrain-partitions` |
| `ctrain-searches` · 候选搜索 | `CtrainSearchesV1` | 有界候选表、选择规则及预算分配 | `expand`、`freeze` | `ctrain-spaces`、`ctrain-estimators`、`ctrain-partitions` |
| `ctrain-runs` · 训练任务 | `CtrainRunsV1` | 训练意图、原工具票据、模型字节与日志 | `preview`、`start`、`status`、`cancel`、`reconcile` | `ctrain-spaces`、`ctrain-datasets`、`ctrain-targets`、`ctrain-partitions`、`ctrain-estimators`、`ctrain-searches` |
| `ctrain-predictions` · 固定预测 | `CtrainPredictionsV1` | 模型版本对应的逐行预测、概率及推理票据 | `predict`、`read`、`cancel`、`reconcile` | `ctrain-spaces`、`ctrain-datasets`、`ctrain-partitions`、`ctrain-runs` |
| `ctrain-metrics` · 评估指标 | `CtrainMetricsV1` | 逐分区指标、混淆表、残差和样本缺项 | `calculate`、`slice` | `ctrain-spaces`、`ctrain-datasets`、`ctrain-targets`、`ctrain-partitions`、`ctrain-predictions` |
| `ctrain-comparisons` · 候选比较 | `CtrainComparisonsV1` | 固定验证域排序、平局规则及差异 | `compare`、`select` | `ctrain-spaces`、`ctrain-searches`、`ctrain-runs`、`ctrain-metrics` |
| `ctrain-explanations` · 模型解释 | `CtrainExplanationsV1` | 系数、树结构或有限扰动观察 | `inspect`、`explain` | `ctrain-spaces`、`ctrain-datasets`、`ctrain-runs`、`ctrain-predictions`、`ctrain-metrics` |
| `ctrain-registry` · 模型登记 | `CtrainRegistryV1` | 模型引用、输入约定、预处理及适用域 | `register`、`seal`、`compare` | `ctrain-spaces`、`ctrain-datasets`、`ctrain-targets`、`ctrain-partitions`、`ctrain-estimators`、`ctrain-runs`、`ctrain-comparisons` |
| `ctrain-reports` · 训练报告 | `CtrainReportsV1` | 数据/工具/候选摘要、限制与人工接受 | `assemble`、`review`、`seal` | `ctrain-spaces`、`ctrain-datasets`、`ctrain-targets`、`ctrain-partitions`、`ctrain-estimators`、`ctrain-searches`、`ctrain-runs`、`ctrain-predictions`、`ctrain-metrics`、`ctrain-comparisons`、`ctrain-explanations`、`ctrain-registry` |
| `ctrain-exchange` · 模型交接 | `CtrainExchangeV1` | 白名单模型格式、报告封套及隔离映射 | `export`、`inspectImport`、`acceptImport` | `ctrain-spaces`、`ctrain-datasets`、`ctrain-targets`、`ctrain-partitions`、`ctrain-estimators`、`ctrain-searches`、`ctrain-runs`、`ctrain-predictions`、`ctrain-metrics`、`ctrain-comparisons`、`ctrain-explanations`、`ctrain-registry`、`ctrain-reports` |
| `ctrain-workbench` · 训练工作台 | `CtrainWorkbenchV1` | 目标配置、候选矩阵、误差与模型导航 | `view`、`templates` | `ctrain-spaces`、`ctrain-datasets`、`ctrain-targets`、`ctrain-partitions`、`ctrain-estimators`、`ctrain-searches`、`ctrain-runs`、`ctrain-predictions`、`ctrain-metrics`、`ctrain-comparisons`、`ctrain-explanations`、`ctrain-registry`、`ctrain-reports`、`ctrain-exchange` |

## constraint-solver-studio

约束求解工作室，14 个插件；CLI 别名为 `solve`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `csolve-spaces` · 求解空间 | `CsolveSpacesV1` | 空间、模板、额度及访问修订 | `create`、`templates`、`archive` | 无 |
| `csolve-variables` · 决策变量 | `CsolveVariablesV1` | 稳定变量 ID、中文说明、单位和取值类型 | `define`、`list` | `csolve-spaces` |
| `csolve-domains` · 取值域 | `CsolveDomainsV1` | 布尔/整数边界、候选集合及界限来源 | `define`、`validate` | `csolve-spaces`、`csolve-variables` |
| `csolve-constraints` · 约束模型 | `CsolveConstraintsV1` | 线性关系、基数和固定时段冲突 | `compose`、`checkTypes` | `csolve-spaces`、`csolve-variables`、`csolve-domains` |
| `csolve-objectives` · 目标模型 | `CsolveObjectivesV1` | 线性目标、方向、分层优先级和系数 | `define`、`validate` | `csolve-spaces`、`csolve-variables`、`csolve-domains` |
| `csolve-scenarios` · 情景版本 | `CsolveScenariosV1` | 固定参数替换、启用约束与比较基线 | `derive`、`diff` | `csolve-spaces`、`csolve-variables`、`csolve-domains`、`csolve-constraints`、`csolve-objectives` |
| `csolve-runs` · 求解任务 | `CsolveRunsV1` | 完整模型计划、求解器票据、日志与状态 | `preview`、`start`、`status`、`cancel`、`reconcile` | `csolve-spaces`、`csolve-variables`、`csolve-domains`、`csolve-constraints`、`csolve-objectives`、`csolve-scenarios` |
| `csolve-solutions` · 候选方案 | `CsolveSolutionsV1` | 变量赋值、目标值、界限及求解来源 | `capture`、`compare` | `csolve-spaces`、`csolve-variables`、`csolve-objectives`、`csolve-runs` |
| `csolve-validation` · 独立验证 | `CsolveValidationV1` | 按原模型重新计算的逐约束结果 | `verify`、`explain` | `csolve-spaces`、`csolve-variables`、`csolve-domains`、`csolve-constraints`、`csolve-objectives`、`csolve-scenarios`、`csolve-solutions` |
| `csolve-conflicts` · 冲突解释 | `CsolveConflictsV1` | 不可满足候选子集、最小性范围与核验轨迹 | `analyze`、`read` | `csolve-spaces`、`csolve-constraints`、`csolve-scenarios`、`csolve-runs` |
| `csolve-sensitivity` · 情景比较 | `CsolveSensitivityV1` | 有界参数扰动、重新求解意图及结果差异 | `preview`、`compare` | `csolve-spaces`、`csolve-scenarios`、`csolve-runs`、`csolve-solutions`、`csolve-validation` |
| `csolve-decisions` · 方案接受 | `CsolveDecisionsV1` | 人工选择、未满足前提、例外和封存引用 | `review`、`decide`、`seal` | `csolve-spaces`、`csolve-scenarios`、`csolve-solutions`、`csolve-validation`、`csolve-conflicts`、`csolve-sensitivity` |
| `csolve-exchange` · 方案交接 | `CsolveExchangeV1` | 模型及证据封套、隔离映射与核验 | `export`、`inspectImport`、`acceptImport` | `csolve-spaces`、`csolve-variables`、`csolve-domains`、`csolve-constraints`、`csolve-objectives`、`csolve-scenarios`、`csolve-runs`、`csolve-solutions`、`csolve-validation`、`csolve-conflicts`、`csolve-sensitivity`、`csolve-decisions` |
| `csolve-workbench` · 求解工作台 | `CsolveWorkbenchV1` | 变量表、约束编辑、方案比较与冲突定位 | `view`、`templates` | `csolve-spaces`、`csolve-variables`、`csolve-domains`、`csolve-constraints`、`csolve-objectives`、`csolve-scenarios`、`csolve-runs`、`csolve-solutions`、`csolve-validation`、`csolve-conflicts`、`csolve-sensitivity`、`csolve-decisions`、`csolve-exchange` |

## document-extraction-studio

文档结构提取，14 个插件；CLI 别名为 `extractdoc`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `dextract-spaces` · 提取空间 | `DextractSpacesV1` | 空间、额度、模板与访问修订 | `create`、`templates`、`archive` | 无 |
| `dextract-sources` · 原文材料 | `DextractSourcesV1` | PDF/PNG/JPEG 原字节、许可和摘要 | `upload`、`pin`、`inspect` | `dextract-spaces` |
| `dextract-pages` · 页面拆解 | `DextractPagesV1` | 页索引、尺寸、旋转、文本层与页图字节 | `prepare`、`status`、`cancel`、`reconcile` | `dextract-spaces`、`dextract-sources` |
| `dextract-layouts` · 版面区域 | `DextractLayoutsV1` | 段落、标题、表格候选与阅读顺序 | `detect`、`edit`、`validate` | `dextract-spaces`、`dextract-pages` |
| `dextract-ocr` · 字符识别 | `DextractOcrV1` | 固定语言模型、区域识别任务和字符位置 | `preview`、`start`、`status`、`cancel`、`reconcile` | `dextract-spaces`、`dextract-pages`、`dextract-layouts` |
| `dextract-tables` · 表格重建 | `DextractTablesV1` | 行列、合并单元格、跨页候选与来源框 | `reconstruct`、`edit`、`check` | `dextract-spaces`、`dextract-pages`、`dextract-layouts`、`dextract-ocr` |
| `dextract-schemas` · 字段约定 | `DextractSchemasV1` | 字段名、类型、必填及有限提取规则 | `define`、`validate` | `dextract-spaces` |
| `dextract-fields` · 字段提取 | `DextractFieldsV1` | 字段候选、标准值、来源片段及歧义 | `extract`、`explain` | `dextract-spaces`、`dextract-pages`、`dextract-layouts`、`dextract-ocr`、`dextract-tables`、`dextract-schemas` |
| `dextract-checks` · 结果检查 | `DextractChecksV1` | 缺项、类型、总和约束与重复候选发现 | `evaluate`、`listFindings` | `dextract-spaces`、`dextract-tables`、`dextract-schemas`、`dextract-fields` |
| `dextract-corrections` · 人工纠错 | `DextractCorrectionsV1` | 原值、修订值、原因、页内证据及编辑历史 | `propose`、`apply`、`compare` | `dextract-spaces`、`dextract-pages`、`dextract-ocr`、`dextract-tables`、`dextract-fields`、`dextract-checks` |
| `dextract-datasets` · 数据版本 | `DextractDatasetsV1` | 按固定纠错修订组装的文本、表格及字段结果 | `assemble`、`seal`、`read` | `dextract-spaces`、`dextract-sources`、`dextract-pages`、`dextract-layouts`、`dextract-ocr`、`dextract-tables`、`dextract-schemas`、`dextract-fields`、`dextract-checks`、`dextract-corrections` |
| `dextract-reviews` · 提取复核 | `DextractReviewsV1` | 页覆盖、抽检范围、人工决定与未决项 | `review`、`decide` | `dextract-spaces`、`dextract-datasets`、`dextract-checks`、`dextract-corrections` |
| `dextract-exchange` · 提取交接 | `DextractExchangeV1` | 原件选择、结构数据与映射封套 | `export`、`inspectImport`、`acceptImport` | `dextract-spaces`、`dextract-sources`、`dextract-pages`、`dextract-layouts`、`dextract-ocr`、`dextract-tables`、`dextract-schemas`、`dextract-fields`、`dextract-checks`、`dextract-corrections`、`dextract-datasets`、`dextract-reviews` |
| `dextract-workbench` · 提取工作台 | `DextractWorkbenchV1` | 源页/结果对照、区域编辑与复核导航 | `view`、`templates` | `dextract-spaces`、`dextract-sources`、`dextract-pages`、`dextract-layouts`、`dextract-ocr`、`dextract-tables`、`dextract-schemas`、`dextract-fields`、`dextract-checks`、`dextract-corrections`、`dextract-datasets`、`dextract-reviews`、`dextract-exchange` |

## design-system-studio

设计系统工作室，13 个插件；CLI 别名为 `designsys`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `dsys-spaces` · 系统空间 | `DsysSpacesV1` | 空间、模板及访问修订 | `create`、`templates`、`archive` | 无 |
| `dsys-tokens` · 设计变量 | `DsysTokensV1` | 类型化颜色、间距、圆角、层级及引用 | `define`、`resolve`、`diff` | `dsys-spaces` |
| `dsys-themes` · 主题集合 | `DsysThemesV1` | 主题继承、语义别名与覆盖规则 | `compose`、`validate` | `dsys-spaces`、`dsys-tokens` |
| `dsys-typography` · 排版规格 | `DsysTypographyV1` | 字体档案、字阶、行距与回退约定 | `define`、`preview` | `dsys-spaces`、`dsys-tokens`、`dsys-themes` |
| `dsys-icons` · 图标资源 | `DsysIconsV1` | 受限 SVG 字节、命名、许可和可见范围 | `upload`、`sanitize`、`inspect` | `dsys-spaces` |
| `dsys-components` · 组件规格 | `DsysComponentsV1` | 固定组件树、属性、插槽和变量引用 | `compose`、`validate` | `dsys-spaces`、`dsys-tokens`、`dsys-themes`、`dsys-typography`、`dsys-icons` |
| `dsys-states` · 状态矩阵 | `DsysStatesV1` | 组件状态、允许组合、触发语义与示例值 | `define`、`expand`、`checkCoverage` | `dsys-spaces`、`dsys-components` |
| `dsys-layouts` · 版式样例 | `DsysLayoutsV1` | 布局容器、断点及固定组件组合 | `compose`、`preview` | `dsys-spaces`、`dsys-themes`、`dsys-components`、`dsys-states` |
| `dsys-checks` · 系统检查 | `DsysChecksV1` | 引用完整性、主题覆盖、对比度及静态尺寸约束 | `evaluate`、`explain` | `dsys-spaces`、`dsys-tokens`、`dsys-themes`、`dsys-typography`、`dsys-icons`、`dsys-components`、`dsys-states`、`dsys-layouts` |
| `dsys-builds` · 产物编译 | `DsysBuildsV1` | 固定编译计划、变量/CSS 字节及输出清单 | `preview`、`start`、`status`、`cancel`、`reconcile` | `dsys-spaces`、`dsys-tokens`、`dsys-themes`、`dsys-typography`、`dsys-icons`、`dsys-components`、`dsys-states`、`dsys-layouts`、`dsys-checks` |
| `dsys-reviews` · 版本复核 | `DsysReviewsV1` | 版本差异、例外、接受与不可变发布记录 | `review`、`decide`、`seal` | `dsys-spaces`、`dsys-checks`、`dsys-builds` |
| `dsys-exchange` · 系统交接 | `DsysExchangeV1` | 设计源、编译产物及许可封套 | `export`、`inspectImport`、`acceptImport` | `dsys-spaces`、`dsys-tokens`、`dsys-themes`、`dsys-typography`、`dsys-icons`、`dsys-components`、`dsys-states`、`dsys-layouts`、`dsys-checks`、`dsys-builds`、`dsys-reviews` |
| `dsys-workbench` · 系统工作台 | `DsysWorkbenchV1` | 变量编辑、主题预览、状态矩阵与版本导航 | `view`、`templates` | `dsys-spaces`、`dsys-tokens`、`dsys-themes`、`dsys-typography`、`dsys-icons`、`dsys-components`、`dsys-states`、`dsys-layouts`、`dsys-checks`、`dsys-builds`、`dsys-reviews`、`dsys-exchange` |

## form-flow-studio

表单流程工作室，13 个插件；CLI 别名为 `forms`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `fform-spaces` · 表单空间 | `FformSpacesV1` | 空间、模板、额度与访问修订 | `create`、`templates`、`archive` | 无 |
| `fform-fields` · 字段目录 | `FformFieldsV1` | 稳定字段 ID、输入类型、标签与帮助文本 | `define`、`validate` | `fform-spaces` |
| `fform-schemas` · 数据约定 | `FformSchemasV1` | 类型、枚举、默认值、必填和规范化规则 | `define`、`check` | `fform-spaces`、`fform-fields` |
| `fform-logic` · 条件逻辑 | `FformLogicV1` | 显隐、计算与跳转的有限表达式图 | `compose`、`checkGraph` | `fform-spaces`、`fform-fields`、`fform-schemas` |
| `fform-pages` · 步骤编排 | `FformPagesV1` | 页面、字段顺序、导航和可达性 | `compose`、`checkReachability` | `fform-spaces`、`fform-fields`、`fform-logic` |
| `fform-fixtures` · 样例材料 | `FformFixturesV1` | 合成试填值、路径期望和边界案例 | `define`、`generate` | `fform-spaces`、`fform-fields`、`fform-schemas`、`fform-pages` |
| `fform-validations` · 校验执行 | `FformValidationsV1` | 字段/跨字段规则结果、路径覆盖和错误顺序 | `preview`、`run`、`status`、`cancel`、`reconcile` | `fform-spaces`、`fform-fields`、`fform-schemas`、`fform-logic`、`fform-pages`、`fform-fixtures` |
| `fform-previews` · 交互预览 | `FformPreviewsV1` | 固定定义预览会话、草稿及导航轨迹 | `open`、`answer`、`navigate`、`close` | `fform-spaces`、`fform-fields`、`fform-schemas`、`fform-logic`、`fform-pages`、`fform-validations` |
| `fform-submissions` · 试填记录 | `FformSubmissionsV1` | 明示为本地样例的提交、错误和字段来源 | `capture`、`read`、`erasePreview` | `fform-spaces`、`fform-schemas`、`fform-previews` |
| `fform-versions` · 表单版本 | `FformVersionsV1` | 定义、提示、样例及覆盖结果的固定引用图 | `assemble`、`seal`、`diff` | `fform-spaces`、`fform-fields`、`fform-schemas`、`fform-logic`、`fform-pages`、`fform-fixtures`、`fform-validations`、`fform-submissions` |
| `fform-reviews` · 表单复核 | `FformReviewsV1` | 业务要求、人工体验意见及发布接受 | `review`、`decide` | `fform-spaces`、`fform-versions`、`fform-validations` |
| `fform-exchange` · 表单交接 | `FformExchangeV1` | 定义与样例封套、模式检查及本地映射 | `export`、`inspectImport`、`acceptImport` | `fform-spaces`、`fform-fields`、`fform-schemas`、`fform-logic`、`fform-pages`、`fform-fixtures`、`fform-validations`、`fform-previews`、`fform-submissions`、`fform-versions`、`fform-reviews` |
| `fform-workbench` · 表单工作台 | `FformWorkbenchV1` | 字段/步骤编辑、路径图、预览与版本导航 | `view`、`templates` | `fform-spaces`、`fform-fields`、`fform-schemas`、`fform-logic`、`fform-pages`、`fform-fixtures`、`fform-validations`、`fform-previews`、`fform-submissions`、`fform-versions`、`fform-reviews`、`fform-exchange` |

## notification-template-studio

通知模板工作室，14 个插件；CLI 别名为 `notifytpl`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `ntpl-spaces` · 通知空间 | `NtplSpacesV1` | 空间、模板、额度和访问修订 | `create`、`templates`、`archive` | 无 |
| `ntpl-variables` · 变量约定 | `NtplVariablesV1` | 字段类型、必填、默认值和敏感标记 | `define`、`validate` | `ntpl-spaces` |
| `ntpl-channels` · 渠道档案 | `NtplChannelsV1` | 站内、纯文本和受限邮件的长度/内容规则 | `define`、`check` | `ntpl-spaces` |
| `ntpl-templates` · 内容模板 | `NtplTemplatesV1` | 标题、正文、片段及有限条件语法 | `compose`、`parse`、`diff` | `ntpl-spaces`、`ntpl-variables`、`ntpl-channels` |
| `ntpl-locales` · 语言变体 | `NtplLocalesV1` | 语言、格式约定、回退顺序和变量覆盖 | `define`、`checkCoverage` | `ntpl-spaces`、`ntpl-variables`、`ntpl-templates` |
| `ntpl-assets` · 模板资产 | `NtplAssetsV1` | 本地 PNG/JPEG、尺寸、替代文本与许可 | `upload`、`inspect`、`pin` | `ntpl-spaces` |
| `ntpl-audiences` · 合成收件人 | `NtplAudiencesV1` | 明示为合成的成员、变量、偏好和边界样例 | `define`、`generate` | `ntpl-spaces`、`ntpl-variables`、`ntpl-locales` |
| `ntpl-rules` · 内容选择 | `NtplRulesV1` | 模板/语言/渠道选择及本地抑制规则 | `compose`、`simulate` | `ntpl-spaces`、`ntpl-channels`、`ntpl-templates`、`ntpl-locales`、`ntpl-audiences` |
| `ntpl-renders` · 固定渲染 | `NtplRendersV1` | 完整渲染计划、文本/HTML 字节及逐样例来源 | `preview`、`start`、`status`、`cancel`、`reconcile` | `ntpl-spaces`、`ntpl-variables`、`ntpl-channels`、`ntpl-templates`、`ntpl-locales`、`ntpl-assets`、`ntpl-audiences`、`ntpl-rules` |
| `ntpl-inboxes` · 虚拟收件箱 | `NtplInboxesV1` | 本地模拟投递意图、去重记录及渲染引用 | `previewDelivery`、`deliverLocal`、`list`、`reconcile` | `ntpl-spaces`、`ntpl-audiences`、`ntpl-rules`、`ntpl-renders` |
| `ntpl-checks` · 内容检查 | `NtplChecksV1` | 未定义变量、转义、长度、链接及语言缺项 | `evaluate`、`explain` | `ntpl-spaces`、`ntpl-variables`、`ntpl-channels`、`ntpl-templates`、`ntpl-locales`、`ntpl-assets`、`ntpl-renders`、`ntpl-inboxes` |
| `ntpl-releases` · 模板版本 | `NtplReleasesV1` | 固定来源、覆盖、人工复核和接受记录 | `assemble`、`review`、`seal` | `ntpl-spaces`、`ntpl-variables`、`ntpl-channels`、`ntpl-templates`、`ntpl-locales`、`ntpl-assets`、`ntpl-audiences`、`ntpl-rules`、`ntpl-renders`、`ntpl-inboxes`、`ntpl-checks` |
| `ntpl-exchange` · 通知交接 | `NtplExchangeV1` | 模板、资产和选定模拟证据的封套 | `export`、`inspectImport`、`acceptImport` | `ntpl-spaces`、`ntpl-variables`、`ntpl-channels`、`ntpl-templates`、`ntpl-locales`、`ntpl-assets`、`ntpl-audiences`、`ntpl-rules`、`ntpl-renders`、`ntpl-inboxes`、`ntpl-checks`、`ntpl-releases` |
| `ntpl-workbench` · 通知工作台 | `NtplWorkbenchV1` | 模板编辑、渠道/语言矩阵和虚拟收件箱导航 | `view`、`templates` | `ntpl-spaces`、`ntpl-variables`、`ntpl-channels`、`ntpl-templates`、`ntpl-locales`、`ntpl-assets`、`ntpl-audiences`、`ntpl-rules`、`ntpl-renders`、`ntpl-inboxes`、`ntpl-checks`、`ntpl-releases`、`ntpl-exchange` |

## schedule-semantics-lab

调度语义实验，14 个插件；CLI 别名为 `schedule-lab`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `schedlab-spaces` · 调度空间 | `SchedlabSpacesV1` | 空间、授权修订和额度根账本 | `create`、`list`、`archive` | 无 |
| `schedlab-calendars` · 日历集合 | `SchedlabCalendarsV1` | 工作日、排除日期和显式节假日材料 | `save`、`validate`、`seal` | `schedlab-spaces` |
| `schedlab-clocks` · 时钟档案 | `SchedlabClocksV1` | 时区数据库版本、墙上时间与单调时间映射 | `save`、`resolve`、`seal` | `schedlab-spaces` |
| `schedlab-rules` · 周期规则 | `SchedlabRulesV1` | 固定间隔和受限五字段周期表达式 | `save`、`expand`、`seal` | `schedlab-spaces`、`schedlab-calendars`、`schedlab-clocks` |
| `schedlab-policies` · 触发策略 | `SchedlabPoliciesV1` | 重叠、错过、重试和退避策略 | `save`、`validate`、`seal` | `schedlab-spaces` |
| `schedlab-workloads` · 工作负载 | `SchedlabWorkloadsV1` | 固定任务时长、确定性失败点与幂等键模型 | `save`、`validate`、`seal` | `schedlab-spaces` |
| `schedlab-scenarios` · 场景编排 | `SchedlabScenariosV1` | 时钟跳变、暂停、重启和规则修订时间表 | `compose`、`preview`、`seal` | `schedlab-spaces`、`schedlab-clocks`、`schedlab-rules`、`schedlab-policies`、`schedlab-workloads` |
| `schedlab-simulations` · 虚拟推进 | `SchedlabSimulationsV1` | 虚拟事件队列、触发原因与模拟回执 | `preview`、`run`、`cancel`、`reconcile` | `schedlab-spaces`、`schedlab-calendars`、`schedlab-clocks`、`schedlab-rules`、`schedlab-policies`、`schedlab-workloads`、`schedlab-scenarios` |
| `schedlab-harness` · 固定调度器 | `SchedlabHarnessV1` | 专属客户机工具会话、真实时钟探针与资源票据 | `preview`、`start`、`cancel`、`reconcile` | `schedlab-spaces`、`schedlab-rules`、`schedlab-policies`、`schedlab-workloads`、`schedlab-scenarios`、`projects` |
| `schedlab-observations` · 触发观察 | `SchedlabObservationsV1` | 原始触发流、序号、丢失声明与时间换算 | `capture`、`readEvents`、`coverage` | `schedlab-spaces`、`schedlab-clocks`、`schedlab-simulations`、`schedlab-harness` |
| `schedlab-checks` · 语义判断 | `SchedlabChecksV1` | 漏发、重复、顺序、延迟和退避比较 | `evaluate`、`compare`、`explain` | `schedlab-spaces`、`schedlab-rules`、`schedlab-policies`、`schedlab-scenarios`、`schedlab-observations` |
| `schedlab-reports` · 调度报告 | `SchedlabReportsV1` | 规则版本、覆盖范围、人工说明和核销索引 | `assemble`、`review`、`seal` | `schedlab-spaces`、`schedlab-scenarios`、`schedlab-simulations`、`schedlab-harness`、`schedlab-observations`、`schedlab-checks` |
| `schedlab-exchange` · 调度交接 | `SchedlabExchangeV1` | 规则、场景与报告的隔离交换 | `export`、`inspectImport`、`acceptImport` | `schedlab-spaces`、`schedlab-calendars`、`schedlab-clocks`、`schedlab-rules`、`schedlab-policies`、`schedlab-workloads`、`schedlab-scenarios`、`schedlab-simulations`、`schedlab-harness`、`schedlab-observations`、`schedlab-checks`、`schedlab-reports` |
| `schedlab-workbench` · 调度工作台 | `SchedlabWorkbenchV1` | 日历、双时钟轨迹、差异和恢复导航 | `view`、`templates` | `schedlab-spaces`、`schedlab-calendars`、`schedlab-clocks`、`schedlab-rules`、`schedlab-policies`、`schedlab-workloads`、`schedlab-scenarios`、`schedlab-simulations`、`schedlab-harness`、`schedlab-observations`、`schedlab-checks`、`schedlab-reports`、`schedlab-exchange` |

## extension-authoring-studio

社区扩展开发工坊，16 个插件；CLI 别名为 `extension-forge`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `extforge-spaces` · 开发空间 | `ExtforgeSpacesV1` | 空间授权、模板修订和额度根账本 | `create`、`list`、`archive` | 无 |
| `extforge-sources` · 源码材料 | `ExtforgeSourcesV1` | 固定源码树、文件修订和源摘要 | `upload`、`edit`、`pin` | `extforge-spaces` |
| `extforge-manifests` · 扩展声明 | `ExtforgeManifestsV1` | 插件标识、版本、描述和发布者公钥引用 | `save`、`validate`、`seal` | `extforge-spaces` |
| `extforge-interfaces` · 表单接口 | `ExtforgeInterfacesV1` | 路由、面板、字段及输入约束 | `save`、`preview`、`seal` | `extforge-spaces`、`extforge-manifests` |
| `extforge-toolchains` · 工具档案 | `ExtforgeToolchainsV1` | 固定离线编译器、SDK、参数与支持范围 | `importProfile`、`inspect`、`seal` | `extforge-spaces` |
| `extforge-builds` · 受控编译 | `ExtforgeBuildsV1` | 专属客户机、构建意图、WASM 与诊断字节 | `preview`、`start`、`cancel`、`reconcile` | `extforge-spaces`、`extforge-sources`、`extforge-toolchains`、`projects` |
| `extforge-inspections` · 模块检查 | `ExtforgeInspectionsV1` | 导入、导出、内存、函数表及大小判断 | `inspect`、`explain` | `extforge-spaces`、`extforge-builds` |
| `extforge-cases` · 用例材料 | `ExtforgeCasesV1` | JSON 输入、结果断言、边界与错误期望 | `save`、`validate`、`seal` | `extforge-spaces`、`extforge-interfaces` |
| `extforge-trials` · 沙箱试运行 | `ExtforgeTrialsV1` | 固定产物的原调用、输出和清理回执 | `preview`、`run`、`cancel`、`reconcile` | `extforge-spaces`、`extforge-builds`、`extforge-inspections`、`extforge-cases` |
| `extforge-signatures` · 签名核对 | `ExtforgeSignaturesV1` | 待签字节、公钥指纹、外部签名及验证结果 | `prepareEnvelope`、`importSignature`、`verify` | `extforge-spaces`、`extforge-manifests`、`extforge-interfaces`、`extforge-builds` |
| `extforge-bundles` · 发行候选 | `ExtforgeBundlesV1` | WASM、目录条目、相对 URL 与不可变版本集合 | `assemble`、`validate`、`seal` | `extforge-spaces`、`extforge-manifests`、`extforge-interfaces`、`extforge-builds`、`extforge-inspections`、`extforge-signatures` |
| `extforge-reviews` · 发布审阅 | `ExtforgeReviewsV1` | 用例结论、描述适用性、未覆盖项和人工决定 | `review`、`compare`、`seal` | `extforge-spaces`、`extforge-inspections`、`extforge-trials`、`extforge-bundles` |
| `extforge-reports` · 开发报告 | `ExtforgeReportsV1` | 构建环境、检查、试运行和审阅证据 | `assemble`、`seal` | `extforge-spaces`、`extforge-builds`、`extforge-inspections`、`extforge-trials`、`extforge-signatures`、`extforge-bundles`、`extforge-reviews` |
| `extforge-exchange` · 工坊交接 | `ExtforgeExchangeV1` | 源码、开发档案和发行候选的隔离交换 | `export`、`inspectImport`、`acceptImport` | `extforge-spaces`、`extforge-sources`、`extforge-manifests`、`extforge-interfaces`、`extforge-toolchains`、`extforge-builds`、`extforge-inspections`、`extforge-cases`、`extforge-trials`、`extforge-signatures`、`extforge-bundles`、`extforge-reviews`、`extforge-reports` |
| `extforge-catalogs` · 目录预演 | `ExtforgeCatalogsV1` | 多候选目录、版本碰撞和同源路径检查 | `compose`、`validate`、`exportCatalog` | `extforge-spaces`、`extforge-manifests`、`extforge-bundles`、`extforge-reviews` |
| `extforge-workbench` · 开发工作台 | `ExtforgeWorkbenchV1` | 源码、表单、构建、用例、签名和目录导航 | `view`、`templates` | `extforge-spaces`、`extforge-sources`、`extforge-manifests`、`extforge-interfaces`、`extforge-toolchains`、`extforge-builds`、`extforge-inspections`、`extforge-cases`、`extforge-trials`、`extforge-signatures`、`extforge-bundles`、`extforge-reviews`、`extforge-reports`、`extforge-exchange`、`extforge-catalogs` |

## dependency-resolution-studio

依赖求解工作室，13 个插件；CLI 别名为 `dependency-solve`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `depsolve-spaces` · 求解空间 | `DepsolveSpacesV1` | 空间、授权修订及额度根账本 | `create`、`list`、`archive` | 无 |
| `depsolve-catalogs` · 固定仓库 | `DepsolveCatalogsV1` | 包版本、依赖边、平台标记和内容摘要材料 | `upload`、`validate`、`pin` | `depsolve-spaces` |
| `depsolve-roots` · 根需求 | `DepsolveRootsV1` | 直接需求、能力请求和替代候选 | `save`、`validate`、`seal` | `depsolve-spaces` |
| `depsolve-platforms` · 目标档案 | `DepsolvePlatformsV1` | 操作系统、架构、运行版本及显式条件 | `save`、`validate`、`seal` | `depsolve-spaces` |
| `depsolve-constraints` · 约束模型 | `DepsolveConstraintsV1` | 版本域、冲突、同伴依赖和多实例策略 | `compile`、`explain`、`seal` | `depsolve-spaces`、`depsolve-catalogs`、`depsolve-roots`、`depsolve-platforms` |
| `depsolve-candidates` · 候选策略 | `DepsolveCandidatesV1` | 旧锁偏好、更新范围和确定性排序规则 | `save`、`preview`、`seal` | `depsolve-spaces`、`depsolve-catalogs`、`depsolve-roots`、`depsolve-platforms` |
| `depsolve-solves` · 求解运行 | `DepsolveSolvesV1` | 固定模型、搜索轨迹、候选赋值和任务回执 | `preview`、`run`、`cancel`、`reconcile` | `depsolve-spaces`、`depsolve-constraints`、`depsolve-candidates` |
| `depsolve-proofs` · 结果核验 | `DepsolveProofsV1` | 逐约束复查、冲突子集与完备性标记 | `checkAssignment`、`explainConflict`、`coverage` | `depsolve-spaces`、`depsolve-constraints`、`depsolve-candidates`、`depsolve-solves` |
| `depsolve-comparisons` · 方案对比 | `DepsolveComparisonsV1` | 候选版本、直接/传递变化和排除原因 | `compare`、`annotate` | `depsolve-spaces`、`depsolve-catalogs`、`depsolve-solves`、`depsolve-proofs` |
| `depsolve-locks` · 锁定计划 | `DepsolveLocksV1` | 中立精确版本集合、依赖边及固定输入摘要 | `assemble`、`validate`、`seal` | `depsolve-spaces`、`depsolve-catalogs`、`depsolve-roots`、`depsolve-platforms`、`depsolve-solves`、`depsolve-proofs`、`depsolve-comparisons` |
| `depsolve-reports` · 求解报告 | `DepsolveReportsV1` | 决策说明、冲突、范围和人工接受记录 | `assemble`、`review`、`seal` | `depsolve-spaces`、`depsolve-constraints`、`depsolve-solves`、`depsolve-proofs`、`depsolve-comparisons`、`depsolve-locks` |
| `depsolve-exchange` · 求解交接 | `DepsolveExchangeV1` | 元数据、约束、锁定计划和报告的隔离交换 | `export`、`inspectImport`、`acceptImport` | `depsolve-spaces`、`depsolve-catalogs`、`depsolve-roots`、`depsolve-platforms`、`depsolve-constraints`、`depsolve-candidates`、`depsolve-solves`、`depsolve-proofs`、`depsolve-comparisons`、`depsolve-locks`、`depsolve-reports` |
| `depsolve-workbench` · 依赖工作台 | `DepsolveWorkbenchV1` | 需求编辑、选择路径、冲突定位和对比导航 | `view`、`templates` | `depsolve-spaces`、`depsolve-catalogs`、`depsolve-roots`、`depsolve-platforms`、`depsolve-constraints`、`depsolve-candidates`、`depsolve-solves`、`depsolve-proofs`、`depsolve-comparisons`、`depsolve-locks`、`depsolve-reports`、`depsolve-exchange` |

## protocol-state-lab

协议状态实验，15 个插件；CLI 别名为 `protocol-state`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `protostate-spaces` · 协议空间 | `ProtostateSpacesV1` | 空间、授权修订和额度根账本 | `create`、`list`、`archive` | 无 |
| `protostate-grammars` · 消息语法 | `ProtostateGrammarsV1` | 固定字段、长度、枚举和有限重复规则 | `save`、`validate`、`seal` | `protostate-spaces` |
| `protostate-messages` · 消息材料 | `ProtostateMessagesV1` | 原始字节、字段解析和固定消息样本 | `upload`、`encode`、`decode` | `protostate-spaces`、`protostate-grammars` |
| `protostate-machines` · 状态模型 | `ProtostateMachinesV1` | 起始/结束状态、转换及允许消息集合 | `save`、`validate`、`seal` | `protostate-spaces`、`protostate-grammars` |
| `protostate-guards` · 条件约束 | `ProtostateGuardsV1` | 字段比较、变量绑定和有界定时条件 | `save`、`validate`、`seal` | `protostate-spaces`、`protostate-grammars`、`protostate-machines` |
| `protostate-scenarios` · 对话场景 | `ProtostateScenariosV1` | 请求序列、分片边界、关闭和期望分支 | `compose`、`preview`、`seal` | `protostate-spaces`、`protostate-messages`、`protostate-machines`、`protostate-guards` |
| `protostate-generators` · 有界变体 | `ProtostateGeneratorsV1` | 固定种子、边界变值、重排及覆盖计划 | `define`、`expand`、`seal` | `protostate-spaces`、`protostate-grammars`、`protostate-messages`、`protostate-scenarios` |
| `protostate-targets` · 目标制品 | `ProtostateTargetsV1` | 用户提供的固定服务字节、启动档案与端口声明 | `upload`、`inspect`、`pin` | `protostate-spaces` |
| `protostate-runs` · 协议运行 | `ProtostateRunsV1` | 专属工具会话、原目标进程和逐连接回执 | `preview`、`start`、`cancel`、`reconcile` | `protostate-spaces`、`protostate-grammars`、`protostate-messages`、`protostate-machines`、`protostate-guards`、`protostate-scenarios`、`protostate-generators`、`protostate-targets`、`projects` |
| `protostate-traces` · 对话轨迹 | `ProtostateTracesV1` | 双向字节、顺序、解析投影与丢失声明 | `decode`、`readFrames`、`coverage` | `protostate-spaces`、`protostate-grammars`、`protostate-runs` |
| `protostate-properties` · 性质判断 | `ProtostatePropertiesV1` | 状态合法性、响应约定和终止性质 | `evaluate`、`compare`、`explain` | `protostate-spaces`、`protostate-machines`、`protostate-guards`、`protostate-scenarios`、`protostate-runs`、`protostate-traces` |
| `protostate-reductions` · 失败缩减 | `ProtostateReductionsV1` | 固定失败判据、候选序列及重复观察 | `preview`、`reduce`、`cancel`、`reconcile` | `protostate-spaces`、`protostate-scenarios`、`protostate-generators`、`protostate-targets`、`protostate-runs`、`protostate-traces`、`protostate-properties` |
| `protostate-reports` · 协议报告 | `ProtostateReportsV1` | 规格、覆盖、反例、人工说明及核销证据 | `assemble`、`review`、`seal` | `protostate-spaces`、`protostate-grammars`、`protostate-machines`、`protostate-scenarios`、`protostate-runs`、`protostate-traces`、`protostate-properties`、`protostate-reductions` |
| `protostate-exchange` · 协议交接 | `ProtostateExchangeV1` | 规格、场景、轨迹与反例的隔离交换 | `export`、`inspectImport`、`acceptImport` | `protostate-spaces`、`protostate-grammars`、`protostate-messages`、`protostate-machines`、`protostate-guards`、`protostate-scenarios`、`protostate-generators`、`protostate-targets`、`protostate-runs`、`protostate-traces`、`protostate-properties`、`protostate-reductions`、`protostate-reports` |
| `protostate-workbench` · 协议工作台 | `ProtostateWorkbenchV1` | 字节与字段联动、状态图、轨迹和失败导航 | `view`、`templates` | `protostate-spaces`、`protostate-grammars`、`protostate-messages`、`protostate-machines`、`protostate-guards`、`protostate-scenarios`、`protostate-generators`、`protostate-targets`、`protostate-runs`、`protostate-traces`、`protostate-properties`、`protostate-reductions`、`protostate-reports`、`protostate-exchange` |

## replica-sync-lab

副本同步实验，14 个插件；CLI 别名为 `replica-lab`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `replab-spaces` · 副本空间 | `ReplabSpacesV1` | 空间、授权修订及额度根账本 | `create`、`list`、`archive` | 无 |
| `replab-schemas` · 数据模型 | `ReplabSchemasV1` | 有限键、值类型、删除标记和字段约束 | `save`、`validate`、`seal` | `replab-spaces` |
| `replab-replicas` · 副本定义 | `ReplabReplicasV1` | 副本标识、初始数据和持久游标模型 | `save`、`validate`、`seal` | `replab-spaces`、`replab-schemas` |
| `replab-operations` · 操作历史 | `ReplabOperationsV1` | 固定写入、删除、增量和原始操作身份 | `upload`、`compose`、`seal` | `replab-spaces`、`replab-schemas`、`replab-replicas` |
| `replab-clocks` · 因果时钟 | `ReplabClocksV1` | 逻辑时钟、版本向量及墙钟偏差档案 | `save`、`validate`、`seal` | `replab-spaces`、`replab-replicas` |
| `replab-channels` · 传递模型 | `ReplabChannelsV1` | 方向、断连、延迟、重复和重排计划 | `save`、`validate`、`seal` | `replab-spaces`、`replab-replicas` |
| `replab-policies` · 合并策略 | `ReplabPoliciesV1` | 明确规则、相同时间决胜和墓碑保留条件 | `save`、`validate`、`seal` | `replab-spaces`、`replab-schemas`、`replab-clocks` |
| `replab-scenarios` · 实验编排 | `ReplabScenariosV1` | 固定事件计划、交付边界及待证性质 | `compose`、`preview`、`seal` | `replab-spaces`、`replab-replicas`、`replab-operations`、`replab-clocks`、`replab-channels`、`replab-policies` |
| `replab-runs` · 有限重放 | `ReplabRunsV1` | 原始事件轨迹、逐副本快照和执行回执 | `preview`、`run`、`cancel`、`reconcile` | `replab-spaces`、`replab-schemas`、`replab-replicas`、`replab-operations`、`replab-clocks`、`replab-channels`、`replab-policies`、`replab-scenarios` |
| `replab-conflicts` · 冲突解释 | `ReplabConflictsV1` | 并发写关系、规则选择与人工裁决候选 | `inspect`、`proposeResolution`、`seal` | `replab-spaces`、`replab-operations`、`replab-clocks`、`replab-policies`、`replab-runs` |
| `replab-judgments` · 性质判断 | `ReplabJudgmentsV1` | 收敛、保留、顺序及反例的可重算判断 | `evaluate`、`compare`、`explain` | `replab-spaces`、`replab-schemas`、`replab-scenarios`、`replab-runs`、`replab-conflicts` |
| `replab-reports` · 同步报告 | `ReplabReportsV1` | 模型范围、固定历史、判断及人工说明 | `assemble`、`review`、`seal` | `replab-spaces`、`replab-replicas`、`replab-clocks`、`replab-channels`、`replab-policies`、`replab-scenarios`、`replab-runs`、`replab-conflicts`、`replab-judgments` |
| `replab-exchange` · 同步交接 | `ReplabExchangeV1` | 模型、历史和报告的隔离交换 | `export`、`inspectImport`、`acceptImport` | `replab-spaces`、`replab-schemas`、`replab-replicas`、`replab-operations`、`replab-clocks`、`replab-channels`、`replab-policies`、`replab-scenarios`、`replab-runs`、`replab-conflicts`、`replab-judgments`、`replab-reports` |
| `replab-workbench` · 同步工作台 | `ReplabWorkbenchV1` | 副本时间轴、数据对比、冲突及反例导航 | `view`、`templates` | `replab-spaces`、`replab-schemas`、`replab-replicas`、`replab-operations`、`replab-clocks`、`replab-channels`、`replab-policies`、`replab-scenarios`、`replab-runs`、`replab-conflicts`、`replab-judgments`、`replab-reports`、`replab-exchange` |

## service-virtualization-studio

多服务模拟工作室，15 个插件；CLI 别名为 `service-virtualization`。

| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |
| --- | --- | --- | --- | --- |
| `virtservice-spaces` · 模拟空间 | `VirtserviceSpacesV1` | 空间、授权修订和额度根账本 | `create`、`list`、`archive` | 无 |
| `virtservice-contracts` · 服务目录 | `VirtserviceContractsV1` | 服务身份、操作、请求与响应合同 | `upload`、`validate`、`seal` | `virtservice-spaces` |
| `virtservice-payloads` · 响应材料 | `VirtservicePayloadsV1` | 固定正文、字段映射及虚构数据集 | `upload`、`compose`、`pin` | `virtservice-spaces`、`virtservice-contracts` |
| `virtservice-matchers` · 匹配规则 | `VirtserviceMatchersV1` | 方法、路径、字段条件及显式优先级 | `save`、`validate`、`seal` | `virtservice-spaces`、`virtservice-contracts` |
| `virtservice-states` · 服务状态 | `VirtserviceStatesV1` | 各服务初始键值、状态模式及重置基线 | `save`、`validate`、`seal` | `virtservice-spaces`、`virtservice-contracts`、`virtservice-payloads` |
| `virtservice-transitions` · 联动规则 | `VirtserviceTransitionsV1` | 局部状态变化、固定内部调用及联合提交次序 | `save`、`validate`、`seal` | `virtservice-spaces`、`virtservice-contracts`、`virtservice-matchers`、`virtservice-states` |
| `virtservice-faults` · 故障档案 | `VirtserviceFaultsV1` | 指定服务/操作的延迟、错误与断连脚本 | `save`、`validate`、`seal` | `virtservice-spaces`、`virtservice-contracts`、`virtservice-matchers` |
| `virtservice-scenarios` · 消费者场景 | `VirtserviceScenariosV1` | 固定请求、跨服务期望、分支点与检查点要求 | `compose`、`preview`、`seal` | `virtservice-spaces`、`virtservice-contracts`、`virtservice-payloads`、`virtservice-states`、`virtservice-transitions`、`virtservice-faults` |
| `virtservice-packages` · 环境版本 | `VirtservicePackagesV1` | 服务拓扑、端点槽位、完整定义和工具要求 | `assemble`、`validate`、`seal` | `virtservice-spaces`、`virtservice-contracts`、`virtservice-payloads`、`virtservice-matchers`、`virtservice-states`、`virtservice-transitions`、`virtservice-faults`、`virtservice-scenarios` |
| `virtservice-sessions` · 环境会话 | `VirtserviceSessionsV1` | 原客户机、内部监听、联合检查点及分支回执 | `preview`、`start`、`checkpoint`、`fork`、`cancel`、`reconcile` | `virtservice-spaces`、`virtservice-packages`、`virtservice-scenarios`、`projects` |
| `virtservice-traffic` · 请求证据 | `VirtserviceTrafficV1` | 原请求序号、服务间因果关联和选定正文 | `capture`、`readRequests`、`coverage` | `virtservice-spaces`、`virtservice-contracts`、`virtservice-sessions` |
| `virtservice-assertions` · 场景判断 | `VirtserviceAssertionsV1` | 合同匹配、联合状态、分支差异及覆盖 | `evaluate`、`compare`、`explain` | `virtservice-spaces`、`virtservice-contracts`、`virtservice-scenarios`、`virtservice-packages`、`virtservice-sessions`、`virtservice-traffic` |
| `virtservice-reports` · 模拟报告 | `VirtserviceReportsV1` | 环境版本、固定分支、判断和原资源核销索引 | `assemble`、`review`、`seal` | `virtservice-spaces`、`virtservice-packages`、`virtservice-sessions`、`virtservice-traffic`、`virtservice-assertions` |
| `virtservice-exchange` · 模拟交接 | `VirtserviceExchangeV1` | 环境定义、联合快照和报告的隔离交换 | `export`、`inspectImport`、`acceptImport` | `virtservice-spaces`、`virtservice-contracts`、`virtservice-payloads`、`virtservice-matchers`、`virtservice-states`、`virtservice-transitions`、`virtservice-faults`、`virtservice-scenarios`、`virtservice-packages`、`virtservice-sessions`、`virtservice-traffic`、`virtservice-assertions`、`virtservice-reports` |
| `virtservice-workbench` · 模拟工作台 | `VirtserviceWorkbenchV1` | 服务图、联动编辑、检查点树和逐请求导航 | `view`、`templates` | `virtservice-spaces`、`virtservice-contracts`、`virtservice-payloads`、`virtservice-matchers`、`virtservice-states`、`virtservice-transitions`、`virtservice-faults`、`virtservice-scenarios`、`virtservice-packages`、`virtservice-sessions`、`virtservice-traffic`、`virtservice-assertions`、`virtservice-reports`、`virtservice-exchange` |
