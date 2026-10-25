# 需求与范围规划插件包设计

## 1. 版本与用户结果

设计版本 4.0.0，日期 2026-10-25。包 ID 为 `product-planning`，包含 12 个拟议插件。核对基线为应用 2.7.0 / `237d7bc`；工作区正在实施 2.8.0，不代表已完成验收。运行实现待开始。

本包面向需要确定“做什么、为何做、如何验收”的项目维护者。用户从原始诉求建立需求，记录范围取舍和依赖，形成可追溯的需求基线及变更决定。本文与[第四批总览](plugin-pack-next-design.md)共同作为实施依据。

[知识文档包](knowledge-studio.md)继续保存引用与文稿；本包增加需求身份、验收条款、范围基线和变更影响。已有[流水线](pipeline-graph.md)继续执行项目任务。本包的排期、工作量与完成声明是规划资料，不能证明代码已实现或测试通过。

首版支持手工录入及 UTF-8 文本、Markdown、CSV、JSON 导入。首版不连接工单平台，不发送通知，不创建外部任务；附件脚本和公式均不执行。整个流程可离线完成。

## 2. 内部插件与依赖

表内服务和方法均为拟议接口。每行只拥有自己的对象；共享固定材料、修订、引用、隔离接收和清理规则见总览。所有依赖使用完整插件 ID。

| 插件 ID | 专属对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `planning-sources` | 空间账本、诉求原文、附件字节与许可；PlanningSourcesV1：upload、pin、refresh | — | knowledge-sources |
| `planning-goals` | 用户问题、目标和范围外事项；PlanningGoalsV1：define、linkSource、compare | planning-sources | — |
| `planning-requirements` | 需求条目、优先级理由和来源映射；PlanningRequirementsV1：split、mergeProposal、revise | planning-sources, planning-goals | — |
| `planning-acceptance` | 逐需求验收条款、例子和证据类型；PlanningAcceptanceV1：define、checkCoverage、recordClaim | planning-sources, planning-requirements | — |
| `planning-estimates` | 工作量区间、估算依据和资源假设；PlanningEstimatesV1：estimate、compareAssumptions | planning-sources, planning-requirements | — |
| `planning-dependencies` | 前置关系、外部约束和阻塞说明；PlanningDependenciesV1：link、detectCycles、impact | planning-sources, planning-requirements | — |
| `planning-scopes` | 迭代范围、候选组合和取舍理由；PlanningScopesV1：compose、previewTradeoff、validate | planning-sources, planning-requirements, planning-acceptance, planning-estimates, planning-dependencies | — |
| `planning-baselines` | 固定需求、验收及范围快照；PlanningBaselinesV1：preview、seal、diff | planning-sources, planning-goals, planning-requirements, planning-acceptance, planning-estimates, planning-dependencies, planning-scopes | — |
| `planning-changes` | 基线变更提案、影响和处置记录；PlanningChangesV1：propose、analyze、recordDisposition | planning-sources, planning-baselines, planning-requirements, planning-acceptance, planning-estimates, planning-dependencies, planning-scopes | — |
| `planning-reviews` | 基线审阅项、异议和接受记录；PlanningReviewsV1：prepare、review、accept | planning-sources, planning-baselines, planning-changes | — |
| `planning-exchange` | 需求基线及变更材料封套；PlanningExchangeV1：export、inspectImport、acceptImport、verify | planning-sources, planning-goals, planning-requirements, planning-acceptance, planning-estimates, planning-dependencies, planning-scopes, planning-baselines, planning-changes, planning-reviews | — |
| `planning-workbench` | 诉求收件箱、范围看板和交接导航；PlanningWorkbenchV1：view、templates | planning-sources, planning-goals, planning-requirements, planning-acceptance, planning-estimates, planning-dependencies, planning-scopes, planning-baselines, planning-changes, planning-reviews, planning-exchange | — |

可选的知识材料适配仅请求选定修订的固定副本及当前许可。需要补齐的读取契约须单独验收；提供者存在不等于适配已经可用。缺席时使用本包上传，保留材料声明来源。

`planning-sources` 唯一拥有工作空间元数据和包内额度账本。其余插件通过该服务申请或核销容量，保存各自领域对象；根账本不代写领域记录。容量内部方法不开放 HTTP。

## 3. 完整用户流程

1. 创建空间，选择“兼容修复”“新功能迭代”或“迁移准备”模板，导入选定诉求。
2. 提炼目标和范围外事项。每条需求保留来源位置、适用用户及可观察行为。
3. 编写验收条款，指定正常情况、边界情况和证据类型。无法检验的条款保留为待澄清。
4. 记录工作量区间与依据，建立依赖；缺少估算时明确未知，不补造日期或完成比例。
5. 组合迭代范围，查看未纳入需求、前置缺项、冲突及容量假设，保存取舍理由。
6. 预览完整对象清单并封存基线，逐项审阅。单人审阅如实标记，接受只代表规划认可。
7. 新诉求形成变更提案，比较范围、验收和估算影响；接受后由用户显式建立新基线。
8. 导出选定基线、异议和变更决定，接收端隔离核验；预览并清理无保护引用的暂存材料。

## 4. 对象、状态与业务规则

`RequirementRevision` 固定原文引用、行为、约束、优先级和拆分来源。合并只生成新条目及来源关系，原身份仍可查询。显示编号可调整，稳定 ID 不复用。

`AcceptanceClause` 包含前置条件、操作、预期结果和证据类型。`AcceptanceClaim` 分别记录人工声明、导入报告和本机验证回执；首版不生成本机执行证明。覆盖率仅计算已映射条款，不表示通过率。

`Estimate` 保存单位、下界、上界、依据和假设。工时、故事点和日历时间分别汇总，禁止直接相加。缺值会降低范围分析的覆盖率；没有资源日历时不生成确定交付日。

依赖关系区分阻断前置、参考和互斥。阻断前置禁止成环；参考关系允许循环。范围遗漏必需前置时不能封存为可实施范围，用户可另存带阻塞的研究草稿。

| 对象 | 状态与不可覆盖的记录 |
| --- | --- |
| 需求 | draft → clarified → accepted → retired；每次业务修改建立新修订 |
| 范围基线 | draft → sealed → superseded；封存后保留原需求和验收修订 |
| 变更提案 | proposed → analyzed → accepted/rejected/deferred；决定必须绑定分析摘要 |
| 审阅 | open → recorded → accepted；来源或基线变更使当前适用性失效 |

业务责任人字段仅作规划说明，不授予访问权。读写由实际会话和空间所有者约束。接受变更不会覆盖旧基线；新基线由新的完整预览产生，并记录承接的变更提案。

## 5. 页面、HTTP 与 CLI

工作台提供诉求、目标、需求、验收、依赖、估算、范围、变更和交接视图。看板拖动创建带预期修订的修改；冲突保留本地草稿并显示差异。缺少验收、来源失效和未知估算均可筛选。

下列 HTTP 均为拟议 `POST` 路径；CLI 使用 `sakura planning`。异步操作、分页、稳定错误码和退出码沿用总览。`verify` 是本地只读命令，不调用 export HTTP。

| 操作 | 拟议 HTTP | CLI | 返回结果 |
| --- | --- | --- | --- |
| 检查验收覆盖 | `/api/planning-acceptance/checkCoverage` | `planning acceptance check` | 总条款、缺失项和覆盖口径 |
| 分析依赖 | `/api/planning-dependencies/impact` | `planning dependency impact` | 固定图修订、受影响条目和路径 |
| 预览范围 | `/api/planning-scopes/previewTradeoff` | `planning scope preview` | 完整候选、未知估算和取舍差异 |
| 封存基线 | `/api/planning-baselines/preview`、`/api/planning-baselines/seal` | `planning baseline preview/seal` | 原计划及新基线回执 |
| 变更决定 | `/api/planning-changes/recordDisposition` | `planning change decide` | 原分析摘要、决定及待建基线 |
| 离线交接 | `/api/planning-exchange/export` | `planning export`、`planning verify` | 精确封套清单及可复核范围 |

## 6. 容量、异常与清理

拟定上限：每空间 5000 条需求、20,000 条关系、20,000 条验收条款、200 个基线。单附件 16 MiB，单正文 256 KiB，每次分析最多 5000 个节点、30 秒。全包存储 2 GiB，单封套 256 MiB。所有修订、暂存与导出计入额度，另预留总览规定的控制账本。

| 异常 | 必须呈现的处理结果 |
| --- | --- |
| 导入编号重复或引用缺项 | 隔离报告精确行号和缺项，禁止部分发布对象图 |
| 来源被更新或撤权 | 区分旧字节仍固定与当前读取许可失效；停止显示撤权正文 |
| 分析超时或取消 | 保留固定输入与中断状态，不输出假定完整的影响集合 |
| 封存中断或磁盘满 | 查询原意图及回执，确认前保留暂存和预留，不重复生成基线 |
| 旧修订决定或并发范围调整 | 拒绝旧计划，显示差异后重新预览 |

清理先显示基线、变更、审阅和活动导出的保护引用。归档需求不释放其历史字节；用户先明确解除可解除的引用，再清理对应对象。到期仅产生候选，不自动删除需求历史。

## 7. 实施与验收

实施顺序为来源与条目、验收和依赖、范围与基线、变更审阅、完整工作台及离线交接。前置能力是有界材料、预期修订、跨插件发布恢复和纯 Node 离线核验；无需新增执行型本体接口。

1. 三个模板均能从原诉求形成已审阅基线，并完成导出、隔离接收和离线核验。
2. 将一条需求拆为两条后，旧基线仍指向原身份，新基线能追溯拆分来源。
3. 阻断依赖成环、缺少前置或没有验收条款时，明确阻止可实施范围封存。
4. 未估算条目、混合估算单位和缺少日历分别显示，不生成虚构总工期。
5. 接受变更后旧基线与旧审阅保持不变；新基线必须经历完整预览和审阅。
6. 旧修订、撤权、取消与发布中断都保留恢复入口；重复提交返回原回执。
7. 导入的完成声明保留外来身份；篡改材料、越界引用和受保护清理均被拒绝。
8. 单包启用、可选知识来源缺席、窄屏及夜间主题均能完成上述流程。
