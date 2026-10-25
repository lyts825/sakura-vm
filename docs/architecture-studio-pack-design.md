# 架构建模与决策插件包设计

## 1. 版本与用户结果

设计版本 4.0.0，日期 2026-10-25。包 ID 为 `architecture-studio`，包含 11 个拟议插件。核对基线为应用 2.7.0 / `237d7bc`；工作区 2.8.0 的实现进度不作为本包验收依据。运行实现待开始。

用户描述系统组成、接口和部署关系，比较改造方案，记录架构决策与适用条件，交付固定模型、视图、规则检查及影响分析。本文与[第四批总览](plugin-pack-next-design.md)共同作为实施依据。

[知识文档包](knowledge-studio.md)继续负责原文与文稿；本包保存可检验的结构模型和决策状态。[架构说明](architecture.md)与源码仍是既有系统的事实来源。本包区分人工模型、导入声明和有来源的观察，模型图不能自动证明运行时结构。

首版支持手工建模、固定 JSON 模型及经过确认的文件清单。图中链接只作文本引用，不自动请求网络。首版不扫描仓库、不运行架构描述脚本、不修改源码或部署配置。

## 2. 内部插件与依赖

以下服务与方法均为拟议接口；对象修订、材料引用和隔离交换规则见总览。可选提供者的适配缺席时，手工录入与上传流程仍可用。

| 插件 ID | 专属对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `architecture-sources` | 空间账本、图纸原文、文件清单与许可；ArchitectureSourcesV1：upload、pin、refresh | — | knowledge-sources |
| `architecture-components` | 系统、组件、责任和边界；ArchitectureComponentsV1：define、split、compare | architecture-sources | — |
| `architecture-interfaces` | 接口版本、输入输出和兼容声明；ArchitectureInterfacesV1：define、diff、checkReferences | architecture-components, architecture-sources | — |
| `architecture-relations` | 调用、包含、部署和数据流关系；ArchitectureRelationsV1：link、validate、trace | architecture-sources, architecture-components, architecture-interfaces | — |
| `architecture-views` | 固定模型视图、筛选与布局；ArchitectureViewsV1：compose、render、exportView | architecture-sources, architecture-components, architecture-interfaces, architecture-relations | — |
| `architecture-decisions` | 架构决策、候选方案和后果；ArchitectureDecisionsV1：propose、review、accept、supersede | architecture-sources, architecture-components, architecture-interfaces, architecture-relations | — |
| `architecture-scenarios` | 基于固定模型的变更假设与影响集合；ArchitectureScenariosV1：branch、analyze、compare | architecture-sources, architecture-components, architecture-interfaces, architecture-relations, architecture-decisions | — |
| `architecture-checks` | 层次约束、环检查与规则发现；ArchitectureChecksV1：defineRules、evaluate、explain | architecture-sources, architecture-components, architecture-interfaces, architecture-relations, architecture-decisions, architecture-scenarios | — |
| `architecture-reports` | 模型快照、检查覆盖与人工审阅；ArchitectureReportsV1：assemble、review、seal | architecture-sources, architecture-components, architecture-interfaces, architecture-relations, architecture-views, architecture-decisions, architecture-scenarios, architecture-checks | — |
| `architecture-exchange` | 模型、视图、决策和报告封套；ArchitectureExchangeV1：export、inspectImport、acceptImport、verify | architecture-sources, architecture-components, architecture-interfaces, architecture-relations, architecture-views, architecture-decisions, architecture-scenarios, architecture-checks, architecture-reports | — |
| `architecture-workbench` | 模型编辑、方案比较和决策导航；ArchitectureWorkbenchV1：view、templates | architecture-sources, architecture-components, architecture-interfaces, architecture-relations, architecture-views, architecture-decisions, architecture-scenarios, architecture-checks, architecture-reports, architecture-exchange | — |

视图插件仅保存布局和固定对象引用，布局调整不改模型语义。检查器只输出发现，不更改决策；接受决策也不改写原检查结果。知识材料在线适配需要固定字节及许可读取契约，未验收前显示适配未就绪。

`architecture-sources` 唯一拥有工作空间元数据和包内额度账本。其余插件通过该服务申请或核销容量，保存各自领域对象；根账本不代写领域记录。容量内部方法不开放 HTTP。

## 3. 完整用户流程

1. 创建空间，选择“分层应用”“服务拆分”或“数据流边界”模板，查看模板假设。
2. 上传明确来源，建立系统与组件，逐项填写责任、数据种类及已有证据。
3. 建立接口与有方向的关系，区分逻辑调用和部署位置，检查悬空引用与非法包含关系。
4. 保存上下文图、组件图和数据流图；图中筛选必须展示隐藏对象数量。
5. 创建架构决策记录，写明问题、候选方案、取舍、条件及未决问题。
6. 从固定模型建立变更场景，比较接口删除、组件拆分或边界变化，运行预先固定的规则。
7. 审阅检查覆盖、未知关系和人工判断，接受或驳回决策，封存模型报告。
8. 导出选定模型、视图与来源；接收端核验并重新审阅，清理无引用的草稿和渲染暂存。

## 4. 模型、决策与判断边界

`ComponentRevision` 记录类型、所属系统、责任和来源。`InterfaceRevision` 保存协议标签、字段描述、版本及兼容声明；兼容声明必须区分人工判断与规则检查。首版不模拟任意协议，也不宣称能证明二进制兼容。

`RelationRevision` 记录起点、终点、关系类型、方向、适用环境和来源状态。包含关系必须形成森林；调用图允许环，由选择的规则判定。缺少关系与明确不存在关系分别记录，不能把未画出的调用当作不存在。

变更场景保存 `baseModelDigest`、修改集合和假设。影响分析沿已选关系类型传播，返回所有可达对象、传播路径及未覆盖关系。分析结果只适用于固定模型；实际代码和运行环境未验证时须显示对应缺口。

架构决策记录采用 `proposed → accepted/rejected → superseded`。接受只绑定候选内容摘要、固定模型和人工决定；替代已有决策创建新记录，并建立单向替代关系。替代链禁止循环，旧决定与依据保持可读。

决策服务不调用规则检查器。报告服务汇总固定决策及检查结果；正式报告要达到通过，必须满足预先固定的检查要求。人工接受决定不能覆盖实际失败、未知结果或未覆盖项。

| 检查类别 | 可以判断的内容 | 必须保留的限制 |
| --- | --- | --- |
| 结构完整性 | 悬空端点、非法包含、重复身份 | 不证明组件确实存在 |
| 边界与分层 | 固定模型中禁止的跨层调用或数据流 | 未建模调用显示未覆盖 |
| 接口变更 | 字段移除、必填声明及版本差异 | 业务语义需人工判断 |
| 决策一致性 | 决策适用对象、替代关系和过期条件 | 不自动选择“最佳”架构 |

首版规则采用有限声明项，不提供脚本、表达式求值或远程插件入口。所有审阅由真实会话记录；人员名称仅作说明。多人独立审批不在首版权限能力中，单人多阶段审阅如实标注。

## 5. 页面、HTTP 与 CLI

页面包含模型树、接口表、关系图、方案差异、决策记录、检查和交接。图表同时提供可键盘操作的表格视图；大图分组呈现，用户可查看固定模型总数与当前显示数量。

下列 HTTP 均为拟议 `POST` 路径；CLI 使用 `sakura architecture`。图形导出仅生成静态 SVG 或 PNG，SVG 不含脚本、外部资源和可执行链接。清洗后预览与导出使用相同字节摘要。

| 操作 | 拟议 HTTP | CLI | 返回结果 |
| --- | --- | --- | --- |
| 校验关系 | `/api/architecture-relations/validate` | `architecture relation validate` | 悬空引用、包含环及固定图摘要 |
| 保存视图 | `/api/architecture-views/compose` | `architecture view compose` | 模型修订、布局修订和隐藏范围 |
| 分析变更 | `/api/architecture-scenarios/analyze` | `architecture scenario analyze` | 假设、传播路径及未覆盖项 |
| 执行规则 | `/api/architecture-checks/evaluate` | `architecture check evaluate` | 规则修订、发现及判定范围 |
| 接受决策 | `/api/architecture-decisions/accept` | `architecture decision accept` | 当前内容摘要和人工决定 |
| 封存及交接 | `/api/architecture-reports/seal`、`/api/architecture-exchange/export` | `architecture report seal`、`architecture export` | 固定报告与材料清单 |

## 6. 容量、失败与清理

拟定上限：每空间 2000 个组件、5000 个接口、20,000 条关系、500 个决策。单次检查最多 30 秒，单视图显示 500 个节点，图像导出最多 16,000,000 像素。单材料 16 MiB，全包存储 2 GiB，单封套 256 MiB。渲染在受管计算中限制内存、时间及输出；超限时提供表格结果。

| 异常 | 必须呈现的处理结果 |
| --- | --- |
| 模型引用缺失或包含成环 | 定位具体对象，允许草稿保存，阻止正式报告封存 |
| 分析取消、超时或达到节点上限 | 返回不完整状态和已处理数量，不给出“无影响”结论 |
| 来源撤权或模型更新 | 停止返回撤权内容，标记报告当前适用性，不改旧摘要 |
| 决策并发接受或旧场景提交 | 拒绝旧修订，要求基于当前内容重新分析与审阅 |
| 导入中断或渲染失败 | 原封套留在隔离区；查询原发布意图，渲染失败不丢模型 |

报告持有原模型、决策、检查与来源的保护引用。删除布局不删除对应模型。清理先列出所有持有者，保留受保护历史和未知提交占用；停用仅撤销任务与读租约。

## 7. 实施与验收

先完成固定模型与关系校验，再实现有限规则、决策与变更场景，最后接入图表、报告和交换。前置能力为材料租约、受管计算与渲染、跨插件发布恢复及离线核验。渲染器只能处理规范模型，不能接收任意 HTML 或脚本。

1. 三个模板均能形成模型、视图、决策、检查及封存报告，并往返交接。
2. 缺失端点、包含环和调用环分别按定义处理，不能用同一条规则混淆。
3. 删除接口后，影响集合包含全部已建模调用方，并列出未知或未覆盖关系。
4. 仅调整布局不会改变模型语义摘要；隐藏节点数量和表格总数保持一致。
5. 接受与替代决策保留旧依据；旧修订、替代环和来源撤权均被拒绝。
6. 大图超限、取消与计算中断显示不完整结果，表格和恢复入口仍可用。
7. 含脚本或外部资源的图形输入不执行；导出图只包含批准的固定内容。
8. 单包、无知识适配、窄屏与夜间主题完成流程；离线核验清楚区分字节一致与架构事实。
