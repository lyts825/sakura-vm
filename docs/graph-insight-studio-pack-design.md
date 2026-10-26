# 关系图分析工作室插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；当前应用保持 2.8.1，基线为 `4afb3b9a`。包 ID 为 `graph-insight-studio`，含 14 个拟议插件，当前分支运行实现待开始。共同规则见[第七批总览](plugin-pack-seventh-design.md)。

用户把设备、零件、文档或任务关系整理成图，选择明确的投影和算法，查看路径、连通性和结构差异，交付可复查的分析结果及图版本。完整流程支持本地节点表和边表。

本包提供通用关系图分析；[架构设计](architecture-studio-pack-design.md)保留系统结构及决策，数据血缘包保留来源证据与变更影响。图中的关系标签由用户定义，不能自动推导因果、真实性或个人身份。

## 2. 内部插件与直接依赖

下列服务均为拟议接口；图对象和可视化布局分别拥有版本。

| 插件 ID 与名称 | 独立对象、核心功能和服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `graphdesk-spaces` 关系空间 | 空间、授权和额度；GraphdeskSpacesV1：create、configure、close | — | — |
| `graphdesk-sources` 图材料 | 节点边原表、字段档案和许可；GraphdeskSourcesV1：upload、inspect、pin | `graphdesk-spaces` | — |
| `graphdesk-entities` 节点目录 | 稳定节点、类型、属性及别名；GraphdeskEntitiesV1：define、validate、seal | `graphdesk-spaces`, `graphdesk-sources` | — |
| `graphdesk-edges` 关系目录 | 有向性、多重边、权重与边证据；GraphdeskEdgesV1：define、validate、seal | `graphdesk-spaces`, `graphdesk-sources`, `graphdesk-entities` | — |
| `graphdesk-projections` 图投影 | 节点筛选、边聚合、方向和时间截面；GraphdeskProjectionsV1：compose、validate、seal | `graphdesk-spaces`, `graphdesk-entities`, `graphdesk-edges` | — |
| `graphdesk-queries` 路径查询 | 有限关系模式、起终点和遍历界限；GraphdeskQueriesV1：define、preview、seal | `graphdesk-spaces`, `graphdesk-entities`, `graphdesk-edges`, `graphdesk-projections` | — |
| `graphdesk-algorithms` 算法档案 | 连通分量、度数、最短路径和固定迭代；GraphdeskAlgorithmsV1：define、validate、seal | `graphdesk-spaces`, `graphdesk-projections` | — |
| `graphdesk-runs` 图计算 | 固定图任务、结果表和收敛记录；GraphdeskRunsV1：preview、run、cancel、reconcile | `graphdesk-spaces`, `graphdesk-projections`, `graphdesk-queries`, `graphdesk-algorithms` | — |
| `graphdesk-comparisons` 结构比较 | 节点边差异、指标适用条件与变化；GraphdeskComparisonsV1：compare、explain | `graphdesk-spaces`, `graphdesk-projections`, `graphdesk-runs` | — |
| `graphdesk-annotations` 结果复核 | 发现、证据引用、解释和人工意见；GraphdeskAnnotationsV1：record、review、seal | `graphdesk-spaces`, `graphdesk-entities`, `graphdesk-edges`, `graphdesk-runs`, `graphdesk-comparisons` | — |
| `graphdesk-views` 图视图 | 布局种子、坐标、聚合和展示范围；GraphdeskViewsV1：compose、layout、save | `graphdesk-spaces`, `graphdesk-projections`, `graphdesk-runs`, `graphdesk-annotations` | — |
| `graphdesk-reports` 图分析档案 | 固定投影、算法、结果、解释和图视图；GraphdeskReportsV1：assemble、seal | `graphdesk-spaces`, `graphdesk-projections`, `graphdesk-runs`, `graphdesk-comparisons`, `graphdesk-annotations`, `graphdesk-views` | — |
| `graphdesk-exchange` 关系图交接 | 原图、投影、结果和说明的隔离交换；GraphdeskExchangeV1：export、inspectImport、acceptImport | `graphdesk-spaces`, `graphdesk-sources`, `graphdesk-entities`, `graphdesk-edges`, `graphdesk-projections`, `graphdesk-queries`, `graphdesk-algorithms`, `graphdesk-runs`, `graphdesk-comparisons`, `graphdesk-annotations`, `graphdesk-views`, `graphdesk-reports` | — |
| `graphdesk-workbench` 关系图工作台 | 节点边编辑、路径表、算法比较和导航；GraphdeskWorkbenchV1：view、saveView、templates | `graphdesk-spaces`, `graphdesk-sources`, `graphdesk-entities`, `graphdesk-edges`, `graphdesk-projections`, `graphdesk-queries`, `graphdesk-algorithms`, `graphdesk-runs`, `graphdesk-comparisons`, `graphdesk-annotations`, `graphdesk-views`, `graphdesk-reports`, `graphdesk-exchange` | — |

## 3. 模板与完整流程

| 模板 | 输入和重点 | 完成交付 |
| --- | --- | --- |
| 零件依赖分析 | 零件节点、装配关系和版本 | 依赖路径、环和变更结构 |
| 文档关联整理 | 文档节点和显式引用边 | 连通组、孤立文档和路径证据 |
| 任务协作关系 | 任务、先后条件和有限权重 | 不可达项、路径和投影差异 |

1. 导入节点表与边表，明确 ID 命名空间、关系方向和属性类型。
2. 检查悬空边、重复 ID、权重及自环，保存修正后的新图。
3. 定义投影，明确多重边聚合、节点过滤和时间范围。
4. 选择路径问题与算法，预览范围、迭代界限及输出规模。
5. 执行计算，检查未收敛、截断和无路径等不同结果。
6. 比较两个固定投影或算法结果，逐项记录条件差异。
7. 保存图布局与人工解释，封存报告及结果表。
8. 导出图和必要证据，接收端验证引用并隔离接受。

## 4. 图模型与解释边界

首版接受节点 CSV、边 CSV、扁平 JSONL 和本包 JSON。节点 ID 区分大小写，按声明命名空间唯一；显示名称不是身份。缺少端点的边必须报错或显式隔离，不能创建无来源节点。

多重边、自环、有向性和权重语义由图定义固定。投影折叠边时保存聚合规则及原边映射；不能把有向图直接当无向图计算后沿用相同结果标签。

路径查询只支持有限关系类型序列、长度界限、节点属性筛选及明确起终点。不提供任意脚本或通用查询执行器。无路径仅针对完整遍历范围；达到预算时结果为未知或部分。

首版最短路径只接受非负有限权重，另有无权路径模式。负数、缺失值、非数值和无穷值须拒绝或采用事先声明的缺失策略，不能临时替换成 0。

连通分量与度数输出确切定义；固定迭代类指标保留容差、迭代数和收敛情况。中心性、相似或连接不能直接解释成业务重要性、真实性或因果。布局距离只用于展示，不作为领域距离。

拟议 `RelationGraphComputeV1` 提供有界建图、路径、分量和固定迭代计算。实施须验证同输入的稳定排序、确定种子、超时停止、取消及临时索引清理。算法结果与渲染布局分开缓存和计费。

## 5. 页面、HTTP 与 CLI

页面以节点表、边表、路径表和图视图配合使用。大图先显示规模和选定范围，聚合节点可展开，始终显示隐藏数量；键盘用户可完成图以外的全部操作。

下表均为拟议 POST，CLI 前缀为 `sakura graph-desk`。

| 服务方法 | HTTP 路径 | CLI 子命令 |
| --- | --- | --- |
| Edges.validate | `/api/graphdesk-edges/validate` | `edge validate` |
| Projections.seal | `/api/graphdesk-projections/seal` | `projection seal` |
| Queries.preview | `/api/graphdesk-queries/preview` | `query preview` |
| Runs.preview/run | `/api/graphdesk-runs/preview`、`/api/graphdesk-runs/run` | `run preview`、`run start` |
| Comparisons.compare | `/api/graphdesk-comparisons/compare` | `comparison create` |
| Exchange.export/acceptImport | `/api/graphdesk-exchange/export`、`/api/graphdesk-exchange/acceptImport` | `export`、`import accept` |

任务另有 status、wait、cancel 和 reconcile。上传及大结果读取走有界通道；离线 `verify` 不运行导入代码，只核验结构、摘要及明确支持的可重算结果。

## 6. 容量、权限与恢复

拟定单图 100,000 节点、500,000 边、128 MiB；节点或边属性 32 KiB。单查询最多 100 个起点、深度 100、10,000 条路径；单计算 5 分钟，迭代最多 1000 轮。

包总额 2 GiB，含 32 MiB 恢复账本、索引、结果、布局和导入隔离；封套 256 MiB。接入宿主既有 8 GiB 共同额度后才可启用计算，各层额度取最严格者。

所有资料和布局按空间 owner 鉴权，属性和边证据均计入导出范围。公开名称或图中标签不意味着原材料可以外发；页面锁定后清除私有节点、路径和缓存。

计算中断保留原投影和迭代位置记录，但不自动恢复使用新的图。只有明确支持且校验完整的检查点可用于新计划；否则新运行重新计算，旧结果标为中断。未知索引未清理时保持占用。

导入生成新 ID，旧执行状态和批准不生效。升级算法或投影语义须产生新版本；迁移先备份原字节，失败保持旧模式。图归档仍保留报告引用，删除须由原所有者按固定修订核销。

## 7. 实施与验收

P0 完成图身份、投影及固定计算；P1 完成比较、复核和视图；集成维护验证独立安装、页面和交换。

1. 三模板完成材料、投影、计算、解释、封存和交接，无其他新包前置。
2. 悬空边和重复节点 ID 被明确拒绝；同名不同 ID 保持两个节点。
3. 有向与无向投影产生各自预期路径，多重边聚合可还原来源。
4. 负权或非法权重不能进入首版最短路径；无路径与遍历超限分别报告。
5. 固定迭代未收敛时不输出通过，改变布局不改变分析结果摘要。
6. 比较的节点集合或权重语义不同必须列出条件差异。
7. 输出爆炸、撤权、取消和磁盘满不发布半份完整图，索引清理可核对。
8. 交接缺端点或篡改映射被拒绝；安装态离线核验不加载任意代码。
