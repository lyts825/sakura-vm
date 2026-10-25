# 搜索质量实验插件包设计

## 1. 版本与用户结果

设计版本 5.0.0，日期 2026-10-25；应用基线 2.7.0 / `5726601`。包 ID 为 `search-relevance-lab`，含 12 个拟议插件，运行实现待开始。共同规则见[第五批总览](plugin-pack-specialist-design.md)。

用户固定语料、查询与人工相关性判断，比较分词、字段权重及排序方案，交付可重算的排名和质量报告。首版提供本地词法检索，不调用外部搜索引擎或嵌入模型。

[知识文档](knowledge-studio.md)继续提供实际内容检索，[模型评测](model-evaluation-pack-design.md)负责模型输出。本包专门管理检索实验和评判口径，不替换知识索引或推断生成式回答质量。

## 2. 内部插件与直接依赖

短名统一补上 `relevance-`，服务和方法均待实现。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `relevance-sources` 来源空间 | 根账本、原文和许可；RelevanceSourcesV1：upload、pin | — | @knowledge-sources |
| `relevance-corpora` 固定语料 | 文档身份、字段、重复及版本集合；RelevanceCorporaV1：compose、deduplicate、seal | sources | — |
| `relevance-analyzers` 文本分析 | 分词、停用词、同义词及字段权重配方；RelevanceAnalyzersV1：define、previewTokens | sources, corpora | — |
| `relevance-indexes` 实验索引 | 固定工具建索引任务、索引材料与原回执；RelevanceIndexesV1：preview、build、cancel、reconcile | sources, corpora, analyzers | — |
| `relevance-queries` 查询集合 | 查询、分组、意图标签及开发/保留划分；RelevanceQueriesV1：define、partition、seal | sources | — |
| `relevance-judgments` 相关性判断 | 查询到文档的分级标签、分歧和裁决；RelevanceJudgmentsV1：record、compareOpinions、adjudicate | sources, corpora, queries | — |
| `relevance-experiments` 实验定义 | 对照/候选索引、固定查询和指标口径；RelevanceExperimentsV1：compose、preview、seal | sources, corpora, indexes, queries, judgments | — |
| `relevance-runs` 检索运行 | 有界查询任务、逐查询排名和耗时；RelevanceRunsV1：preview、start、cancel、reconcile | sources, indexes, queries, experiments | — |
| `relevance-metrics` 排名判断 | 精确率、已知相关项召回和分级排名指标；RelevanceMetricsV1：evaluate、slice、compare | sources, queries, judgments, experiments, runs | — |
| `relevance-reports` 实验报告 | 指标、查询退化、判断覆盖及复现材料；RelevanceReportsV1：assemble、seal | sources, corpora, analyzers, indexes, queries, judgments, experiments, runs, metrics | — |
| `relevance-exchange` 实验交接 | 语料、排名、判断及报告交换；RelevanceExchangeV1：export、inspectImport、acceptImport | * | — |
| `relevance-workbench` 搜索实验台 | 查询对照、词项解释、标注与切片图表；RelevanceWorkbenchV1：view、templates | * | — |

可选知识来源只取得选定修订的固定材料和许可；不读取原索引私有文件。judgments 的人工标签与运行相关性得分分开保存。

## 3. 完整使用流程

1. 从“帮助文档”“商品目录”或“代码说明”模板创建空间，上传 UTF-8 文本/JSONL。
2. 固定文档 ID、字段和去重规则，建立开发集与保留查询集。
3. 设置词法分析配方，在预览中核对中文词项、停用词及同义词作用。
4. 建立多个独立索引；录入逐查询相关性标签，保留未标注、分歧和裁决。
5. 固定对照、候选、截取深度及指标，预览后运行完整查询集合。
6. 按查询类型比较排名，检查退化用例、判断覆盖和耗时环境；每次调参建立新实验。
7. 封存结果及复现配方，核销计算任务和临时索引文件。
8. 导出选定语料和报告，离线重算指标；接收端重建索引需独立计划。

## 4. 排名与评价规则

首版固定一种词法评分算法及其版本，分词器、词典、浮点策略和并列排序按文档 ID 的规则随索引保存。拟议 `RetrievalIndexTasksV1` 只开放固定建索引及查询操作，不接受自定义执行脚本。

`QueryPartition` 固定开发集和保留集。保留查询用于比较时记录访问，不因候选表现差而自动移动查询。首版不承诺强制盲测；报告显示实际查看及人工修改记录。

判断等级拟定为 0～3，未标注使用独立状态。首版报告 P@k（前 k 项精确率）、已知相关项 Recall@k、MRR（首个相关项倒数排名）和 nDCG@k（归一化折损累计增益）。实现必须固定相关阈值、等级增益、折损公式和零分母规则，并提供可核对的逐查询计算明细。

未标注默认不强制视为不相关。精确率展示可计算下界及已判定覆盖率；召回明确只针对已知相关集合，不声称总体召回。没有已知相关项时标为不可评估；nDCG 的理想增益为零时不填虚假满分。

所有总体指标同时报告分母、排除项和切片样本数。候选与对照必须使用相同查询、判断修订和指标版本；不满足时拒绝直接判定退化。延迟只报告本实验观察，不推导生产容量。

## 5. 页面、HTTP 与 CLI

页面包括语料、配方、词项、索引、查询、判断、实验、排名对照和报告。CLI 别名为 `relevance`。

| 操作 | 拟议 POST 路径 | CLI（前缀 sakura） |
| --- | --- | --- |
| 分词预览 | `/api/relevance-analyzers/previewTokens` | `relevance analyzer preview` |
| 建索引 | `/api/relevance-indexes/preview`、`/api/relevance-indexes/build` | `relevance index preview/build` |
| 裁决判断 | `/api/relevance-judgments/adjudicate` | `relevance judgment decide` |
| 执行查询 | `/api/relevance-runs/start` | `relevance run start` |
| 比较指标 | `/api/relevance-metrics/compare` | `relevance metrics compare` |
| 交接 | `/api/relevance-exchange/export` | `relevance export`、`relevance verify` |

## 6. 容量、异常与恢复

拟定上限：50,000 篇文档、单文档 1 MiB、语料总计 256 MiB；5000 个查询、每查询前 100 项、200,000 条判断。建索引最多 10 分钟及 1 GiB，单次检索最多 5 分钟。包总额 4 GiB，封套 512 MiB。

索引构建中断保留任务回执，未发布索引不可查询。撤权使相关语料和派生排名停止向当前调用者展示；导出复核原许可。超限、损坏索引和词典缺失为明确失败，不自动改配方或减小语料。

## 7. 实施与验收

先实现语料、查询和判断，再实现固定索引及检索，最后完成指标、报告和交接。

1. 三个模板均真实建立两个索引并完成固定查询比较。
2. 同一工具与固定输入生成稳定排名；并列分数有明确顺序。
3. 未判断、零相关项、空结果和不同 k 的指标规则均有可复核结果。
4. 对照与候选使用不同判断修订时拒绝直接比较；保留集修改留下记录。
5. 指标可由导出的排名及判断重算，查询原始结果不因指标修订改变。
6. 构建取消、满盘、撤权和损坏索引不暴露半成品，不误删活动索引。
7. 可选知识来源缺席仍可独立完成流程；没有实际执行不得标为真实索引结果。
