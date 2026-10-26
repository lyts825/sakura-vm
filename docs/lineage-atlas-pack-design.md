# 数据血缘与影响分析插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；当前应用保持 2.8.1，基线为 `4afb3b9a`。包 ID 为 `lineage-atlas`，含 13 个拟议插件，当前分支运行实现待开始。共同规则见[第七批总览](plugin-pack-seventh-design.md)。

用户将多个系统的资产清单、字段映射和执行声明整理为可追溯图，定位变更可能影响的下游，并保存证据与人工确认。完整离线流程从上传清单开始，以影响档案和可接收的图版本结束。

[数据工作台](data-lab.md)的 `data-lineage` 继续管理本包数据版本父链和执行比较。本包新增跨系统身份对照、字段级映射、互相冲突的来源声明及影响调查。它不复制原执行账本，也不把上传的血缘声明当成本地真实执行证据。

## 2. 内部插件与直接依赖

所有服务为拟议接口。外部资产名称只是资料字段，不自动访问相应系统。

| 插件 ID 与名称 | 独立对象、核心功能和服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `lineageatlas-spaces` 血缘空间 | 空间、授权和额度；LineageatlasSpacesV1：create、configure、close | — | — |
| `lineageatlas-catalogs` 来源目录 | 原始清单、命名空间和来源许可；LineageatlasCatalogsV1：upload、inspect、pin | `lineageatlas-spaces` | — |
| `lineageatlas-assets` 资产身份 | 系统、数据集、字段和身份别名；LineageatlasAssetsV1：define、matchIdentity、seal | `lineageatlas-spaces`, `lineageatlas-catalogs` | — |
| `lineageatlas-mappings` 字段映射 | 源目标字段、变换类别与缺失声明；LineageatlasMappingsV1：define、validate、seal | `lineageatlas-spaces`, `lineageatlas-assets` | — |
| `lineageatlas-processes` 处理步骤 | 作业定义、固定输入输出和时段；LineageatlasProcessesV1：define、bind、seal | `lineageatlas-spaces`, `lineageatlas-assets`, `lineageatlas-mappings` | — |
| `lineageatlas-assertions` 血缘证据 | 观察、外来声明、人工补录和相互冲突；LineageatlasAssertionsV1：record、compare、classify | `lineageatlas-spaces`, `lineageatlas-catalogs`, `lineageatlas-assets`, `lineageatlas-mappings`, `lineageatlas-processes` | — |
| `lineageatlas-graphs` 图版本 | 固定节点边、有效期和完整性缺项；LineageatlasGraphsV1：compose、validate、seal | `lineageatlas-spaces`, `lineageatlas-assets`, `lineageatlas-mappings`, `lineageatlas-processes`, `lineageatlas-assertions` | — |
| `lineageatlas-impacts` 变更影响 | 变更集、遍历范围、路径和停止边界；LineageatlasImpactsV1：preview、trace、cancel、reconcile | `lineageatlas-spaces`, `lineageatlas-assets`, `lineageatlas-assertions`, `lineageatlas-graphs` | — |
| `lineageatlas-investigations` 调查记录 | 未知边、冲突问题、业务确认和证据补充；LineageatlasInvestigationsV1：open、attach、resolve | `lineageatlas-spaces`, `lineageatlas-assertions`, `lineageatlas-graphs`, `lineageatlas-impacts` | — |
| `lineageatlas-reviews` 图复核 | 身份合并和影响结论的人工决定；LineageatlasReviewsV1：prepare、decide、seal | `lineageatlas-spaces`, `lineageatlas-assets`, `lineageatlas-graphs`, `lineageatlas-impacts`, `lineageatlas-investigations` | — |
| `lineageatlas-reports` 血缘档案 | 图差异、调查范围和确认时点；LineageatlasReportsV1：assemble、compare、seal | `lineageatlas-spaces`, `lineageatlas-graphs`, `lineageatlas-impacts`, `lineageatlas-investigations`, `lineageatlas-reviews` | — |
| `lineageatlas-exchange` 血缘交接 | 原目录、图版本与调查档案的隔离交换；LineageatlasExchangeV1：export、inspectImport、acceptImport | `lineageatlas-spaces`, `lineageatlas-catalogs`, `lineageatlas-assets`, `lineageatlas-mappings`, `lineageatlas-processes`, `lineageatlas-assertions`, `lineageatlas-graphs`, `lineageatlas-impacts`, `lineageatlas-investigations`, `lineageatlas-reviews`, `lineageatlas-reports` | — |
| `lineageatlas-workbench` 血缘工作台 | 分层图、证据面板、影响树和保存视图；LineageatlasWorkbenchV1：view、saveView、templates | `lineageatlas-spaces`, `lineageatlas-catalogs`, `lineageatlas-assets`, `lineageatlas-mappings`, `lineageatlas-processes`, `lineageatlas-assertions`, `lineageatlas-graphs`, `lineageatlas-impacts`, `lineageatlas-investigations`, `lineageatlas-reviews`, `lineageatlas-reports`, `lineageatlas-exchange` | — |

图版本持有固定声明引用；原目录由 catalogs 唯一保存。调查补证形成新声明，已封存图不会自动吸收补证。

## 3. 模板与完整流程

| 模板 | 输入和重点 | 完成交付 |
| --- | --- | --- |
| 分析报表影响 | 表、字段、作业和报表清单 | 字段变更的下游路径及未知边界 |
| 数据迁移对照 | 新旧命名空间及身份对照 | 身份合并意见和两版图差异 |
| 计算结果追溯 | 固定输入、处理声明及结果清单 | 上游证据路径和缺失来源 |

1. 上传 JSON 或 CSV 目录，登记来源系统和资料时点。
2. 检查同名不同系统、别名和已删除资产，人工处理身份冲突。
3. 定义字段映射与处理步骤；无法解析的表达式保留原文和未知标记。
4. 登记每条边的来源、有效区间及证据类别，比较冲突声明。
5. 冻结一版图，查看孤立节点、未知边界和循环关系。
6. 选择变更集与时间范围，预览完整遍历预算后分析影响。
7. 对重要路径逐项调查、补证并复核，形成新图及报告。
8. 导出允许交接的子图；接收端核对缺失边界后生成本地版本。

## 4. 身份、证据与影响语义

资产身份包含来源命名空间、外部 ID 和版本。名称相同不能自动合并。重命名需要显式身份对应；来源无法提供稳定 ID 时，映射属于人工声明。

字段映射首版支持复制、重命名、有限算术、聚合和未知变换类别。原表达式只作为文本保存，不在宿主执行，不用任意 SQL 解析结果宣称完整血缘。

同一资产允许多个来源声明并存。相互冲突的路径不能按上传时间覆盖。复核可以接受某一声明用于指定图，但保留另一声明及选择理由。

图允许真实反馈和周期作业形成环。遍历用访问集合防止无限循环，并报告强连通分量。版本时间和业务有效时间分别记录，不能用记录时间代替数据发生时间。

影响表示已声明关系下的可达范围。它不证明下游一定失败，也不证明图外没有影响。遇到未知变换、缺失资产、未声明输出或深度上限时明确停止原因。

拟议 `LineageGraphComputeV1` 提供有界图构造、差异、路径及强连通分量计算。实施须验证大图分页、路径数量上限、确定性排序、取消和暂存清理。可复用纯图算法，不能复用其他插件的私有数据目录。

## 5. 页面、HTTP 与 CLI

工作台以资产列表为主，图只按选定范围展开。每条边可查看证据原文、来源类别和有效期；被筛掉的节点数量持续显示。图提供可访问的路径表和键盘导航。

下表均为拟议 POST 路径，CLI 前缀为 `sakura lineage-atlas`。

| 服务方法 | HTTP 路径 | CLI 子命令 |
| --- | --- | --- |
| Assets.matchIdentity | `/api/lineageatlas-assets/matchIdentity` | `asset match` |
| Assertions.compare | `/api/lineageatlas-assertions/compare` | `assertion compare` |
| Graphs.seal | `/api/lineageatlas-graphs/seal` | `graph seal` |
| Impacts.preview/trace | `/api/lineageatlas-impacts/preview`、`/api/lineageatlas-impacts/trace` | `impact preview`、`impact trace` |
| Reviews.decide | `/api/lineageatlas-reviews/decide` | `review decide` |
| Exchange.export/acceptImport | `/api/lineageatlas-exchange/export`、`/api/lineageatlas-exchange/acceptImport` | `export`、`import accept` |

上传与分段正文读取使用独立有界通道。任务提供原状态查询、等待、取消及恢复；离线 `verify` 只核对封套、图引用及可重算路径，不连接声明中的系统。

## 6. 容量、权限与恢复

拟定每空间 50 个来源目录，一版图最多 100,000 个节点、500,000 条边。单次路径请求最多 100 个起点、深度 100 和 10,000 条展开路径；遍历超限报告部分范围，不能返回无影响。

单目录 64 MiB，单记录 64 KiB，单计算 3 分钟。包总额 1 GiB，含 32 MiB 恢复账本、图索引、原资料、隔离和暂存；交接封套 128 MiB。现有宿主 8 GiB 共同额度尚未登记本包，实施必须接入，超额时拒绝准入。

空间 owner 控制读取和写入。外部负责人、系统名称和复核标签不产生访问权。导出预览列出节点、字段、声明原文及有意缺失的边界，不自动带出引用祖先。

构图失败时保留原目录与错误定位，不发布半幅图。重启后核对原计算意图及对象摘要，未知输出不自动重算。取消后确认索引与暂存释放，再归还预算。

接收生成新本地 ID 和来源映射；外来确认保留外来类别。模式升级先校验引用完整性并保存旧字节；降级不理解新关系类型时拒绝写入。归档不解除图、调查和报告持有的保护引用。

## 7. 实施与验收

P0 完成身份与证据账本、图计算和引用保护；P1 完成影响调查、复核和交换；集成维护负责独立安装及页面验收。

1. 三个模板均完成资料导入、图版本、影响调查、复核和离线交接。
2. 两个系统的同名表保持两个身份；人工映射可复查且不改写原名。
3. 两份相互冲突的来源声明同时保留，指定选择后才进入封存图。
4. 环形关系终止遍历并列出环；深度或路径超限显示未展开范围。
5. 只有部分子图时不得声称全系统无影响；未知表达式阻止完整字段推导。
6. 同图、同时间范围和同起点重算得到相同排序及路径摘要。
7. 撤权、旧修订、取消和磁盘满不发布半份图；保护引用阻止过早清理。
8. 导入不能触发外部系统连接，篡改边引用被拒绝，纯 Node 离线核验可用。
