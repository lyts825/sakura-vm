# 项目知识与文档工作台插件包设计

## 1. 版本、读者与交付目标

设计版本：**2.0.0**。设计日期：**2026-10-23**。应用基线：**2.6.0 / 86f589a**。本轮应用保持 **2.6.0**，宿主插件 API 保持 **5**。**运行实现：待开始**。本文中的 `knowledge-*` 插件、服务、界面、命令和错误码均为拟议项，尚未注册到运行目录。当前已实现的 69 个插件、13 个插件包不变。

本文面向插件开发、界面设计和验收人员。交付目标是让用户把固定的本地材料整理成可追溯的知识条目和文档，完成审阅、本机阅读和离线交接。接收者能复核引用对应的材料版本，并看到缺失材料、撤销许可和未核实陈述。

包 ID 拟为 `knowledge-studio`，名称为“项目知识与文档工作台”。它包含 10 个知识插件。总览见[第二批插件包设计](plugin-pack-expansion-design.md)。本轮不修改应用版本、插件清单、服务描述符或运行配置。

## 2. 使用范围与完整性标准

### 2.1 首版完成什么

首版提供一条不依赖虚拟机、模型或外部账号的完整流程：创建知识空间，上传本地材料，核对解析结果，检索固定版本，建立引用，编写条目和文档，审阅后发布到本机，导出后在另一台安装了本包的 Sakura 中离线复核。

知识空间由当前 Sakura 的宿主所有者管理，沿用本地档案的授权方式。未启用账号模式时使用宿主会话锁；启用账号模式时仅 `owner` 可用。首版审阅支持同一用户分阶段完成，并明确标记“单人审阅”，不宣称实现多人独立审批。项目成员共享和多主体审批需要独立的权限设计，不属于首版承诺。

材料首版接受 UTF-8 文本、Markdown、常见源码文本、JSON、CSV 和静态 HTML。JSON、CSV 按可读材料处理，不计算统计结果。HTML 只提取文本，不加载网页、图片、脚本、样式、iframe 或远程字体。代码片段和 Markdown 指令均作为文字，导入后不执行。扫描 PDF、Office 文件、OCR、网页抓取和模型问答留待后续适配，选择这些格式时明确报告不支持。

### 2.2 与现有能力的关系

| 现有能力 | 当前职责 | 本包新增的职责 |
| --- | --- | --- |
| `project-search` | 搜索当前项目中的文件名和文本，结果有扫描上限 | 对已经封存的材料建索引；返回固定版本、定位和遗漏情况 |
| `files` | 浏览、下载、编辑和保留文件历史 | 知识材料的许可、引用和衍生关系由本包管理；项目捕获需要新增显式契约 |
| `data-lab` | 数据集、转换、质量、实验和数据血缘 | 整理人可阅读的材料、陈述和文档；引用数据报告时保留报告摘要，不重复数据计算 |
| `repair` / 本地助手 | 预览模型上下文、生成修复建议、验证单文件补丁 | 首版不用模型；检索片段不能自动升级为已核实知识 |
| `delivery-artifacts` / `delivery-releases` | 项目制品、软件交付、门禁和可信发行 | 保存知识空间自身的材料与文稿；导出文档包不等于软件发行，也不继承发行签名 |
| `app-runtime` | 常驻应用、路由、健康和恢复 | 发布为本机认证阅读视图和离线静态文件，不启动应用、开放端口或部署公共站点 |

“完整”要求每个插件具备持久对象、公共服务、错误恢复、界面、HTTP 与 CLI 入口。整包还必须具备空态、随包示例、取消、重启恢复、清理预览、导出复核和卸载后的数据说明。不能只交付功能目录或演示页面。

## 3. 包内插件与依赖

所有新公共服务暂以 `V1` 命名，表示拟议的首版契约，不能据此调用现有运行时。表中必需、可选依赖均为插件 ID。宿主服务和能力在第 10 节单列。

| 插件 ID | 职责 | 自有持久对象 | 拟议公共服务 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- | --- | --- |
| `knowledge-sources` | 创建知识空间、导入或固定捕获材料、维护许可和内容引用 | `KnowledgeSpace`、`SourceRevision`、`SourcePolicy`、`BlobReceipt`、`CapturePlan` | `KnowledgeSourcesV1` | `projects`、`files` | `project-search`、`delivery-artifacts` |
| `knowledge-extract` | 将固定材料解析成有位置映射的文本块，保留解析警告 | `ExtractionRevision`、`ParserReceipt`、`ExtractionJob` | `KnowledgeExtractV1` | `knowledge-sources` | 无 |
| `knowledge-index` | 建立固定版本的本地词项索引，提供过滤、排序和覆盖说明 | `IndexGeneration`、`QueryReceipt`、`IndexJob` | `KnowledgeIndexV1` | `knowledge-sources`、`knowledge-extract` | 无 |
| `knowledge-evidence` | 固定引文、定位、完整性证据和当前许可状态 | `CitationRevision`、`EvidenceCheck` | `KnowledgeEvidenceV1` | `knowledge-sources`、`knowledge-extract` | 无 |
| `knowledge-entries` | 编写事实、操作步骤、决策和待核实问题，关联支持或冲突材料 | `EntryRevision`、`Assertion`、`ConflictSet` | `KnowledgeEntriesV1` | `knowledge-sources`、`knowledge-index`、`knowledge-evidence` | 无 |
| `knowledge-documents` | 使用模板组织条目、章节、术语和显式引用，保存文稿修订 | `DocumentRevision`、`TemplateRevision`、`DocumentOutline` | `KnowledgeDocumentsV1` | `knowledge-sources`、`knowledge-entries`、`knowledge-evidence` | 无 |
| `knowledge-reviews` | 对固定文稿和证据集记录人工审阅，生成可复核的问题清单 | `ReviewRevision`、`ReviewIssue`、`ReviewDecision` | `KnowledgeReviewsV1` | `knowledge-sources`、`knowledge-evidence`、`knowledge-entries`、`knowledge-documents` | 无 |
| `knowledge-publish` | 渲染固定文稿，发布本机认证阅读版本，撤回或切换已审阅版本 | `PublicationRevision`、`PublishPlan`、`ActivePublication` | `KnowledgePublishV1` | `knowledge-sources`、`knowledge-evidence`、`knowledge-entries`、`knowledge-documents`、`knowledge-reviews` | 无 |
| `knowledge-exchange` | 预览离线包内容，导出、隔离导入、校验并建立新空间 | `ExportPlan`、`KnowledgeBundle`、`ImportQuarantine`、`ImportReceipt` | `KnowledgeExchangeV1` | `knowledge-sources`、`knowledge-extract`、`knowledge-evidence`、`knowledge-entries`、`knowledge-documents`、`knowledge-reviews` | 无 |
| `knowledge-workbench` | 组合知识空间首页、流程导航、问题列表和跨插件任务视图 | 只保存界面偏好和向导进度，不复制领域对象 | `KnowledgeWorkbenchV1` | `knowledge-sources`、`knowledge-extract`、`knowledge-index`、`knowledge-evidence`、`knowledge-entries`、`knowledge-documents`、`knowledge-reviews`、`knowledge-publish`、`knowledge-exchange` | 无 |

整合包显式包含上述 10 个插件。解析器会带入 `projects`、`files` 及 `files` 的 `transfers` 依赖，去重后为 13 个插件实例。可选依赖不自动启用。禁用 `project-search` 时仍可手工选择项目相对路径；禁用 `delivery-artifacts` 时仅移除“从交付制品复制”的入口。

知识空间的字节仓库归 `knowledge-sources` 所有。持有其直接依赖的插件通过公共内容读写、保留和释放接口存放派生字节，不能打开它的目录。条目和文稿使用各自元数据保存结构，通过 sources 复核许可，并通过 evidence 读取引用证明。`knowledge-publish` 不拥有另一份来源库；`knowledge-exchange` 不接管发布状态。下游仅用上游接口，不反向调用工作台；来源撤销通过每次访问校验和持久许可修订生效，无需建立依赖环。

## 4. 用户流程、空态与模板

### 4.1 零 VM 首次使用

1. 在插件中心启用本包，重启服务后打开顶级“知识”页面。空态显示“创建知识空间”“导入知识包”和“使用随包示例”。启用本包本身不扫描文件、不建索引、不访问网络。
2. 创建空间并选择“项目交接手册”模板。用户拖入 README、操作说明和一份决策记录；每个文件都显示名称、字节数、摘要、允许用途和敏感内容提示。
3. 预览解析后的章节和原文位置。异常编码、丢弃的 HTML 内容和超过限制的文件单独列出；用户排除或更换文件后提交材料版本。
4. 点击“建立索引”。检索结果展示词项命中、材料修订、引用片段和索引覆盖率。没有命中时可查看过滤条件、未解析材料和索引日期，不编造答案。
5. 选择片段建立引用，创建“备份恢复步骤”条目。条目区分原文事实、作者判断、操作建议和待核实内容，支持相反证据和适用条件。
6. 将条目加入文稿，补充目的、前提和失败处理。章节引用固定条目修订，条目更新后只出现“有新版本”，不会静默改写文稿。
7. 生成审阅清单，逐项核对来源定位、冲突、适用范围、敏感内容和读者需要的材料。完成后形成固定审阅回执，再预览并发布本机阅读版本。
8. 导出“可复核交接包”，核对导出清单和用途。另一台离线 Sakura 验证完整性、导入隔离区、审阅接收后建立新空间。原机可撤回本机发布，但不能收回已下载文件。

随包示例为人工编写的虚构项目材料，不含外网链接资源、凭据或真实个人信息。示例包括一处相互冲突的步骤和一个已更新来源，用户可实际体验冲突解决与重新审阅。示例属于正式产品资源；验收截图、临时测试材料不入库。

### 4.2 项目捕获与刷新

项目捕获选择固定 `vmId`、VM 创建身份、`projectId`、项目配置修订和相对路径清单。界面预览排除项、待复制字节和授权含义：用户把这些字节复制成宿主所有者管理的资料，不建立跨用户共享授权。源项目的删除或权限变化不会远程抹去已获准副本；来源状态会显示“无法继续核对当前项目”。

材料更新操作总是产生新 `SourceRevision`。旧引用仍指向旧内容，并显示“存在更新版本”。“迁移引用”创建候选映射，用户逐项确认后生成新条目或文稿修订。相同文字出现在多个位置时标记歧义，禁止自动择一。移动文件但内容相同可建议新的来源标签，不改变旧引用证明。

### 4.3 首版模板

| 模板 | 固定结构 | 必填检查 |
| --- | --- | --- |
| 项目交接手册 | 目的、目录、环境、关键入口、运行步骤、已知问题、接手检查 | 每条运行步骤的来源或人工验证说明；适用版本 |
| 运维操作手册 | 触发条件、前提、操作、预期结果、失败处理、停止条件 | 风险操作有人工提示；禁止把代码块作为执行按钮 |
| 决策记录 | 问题、约束、候选方案、决定、依据、影响、复议条件 | 区分事实与判断；保留相反依据和未解决问题 |
| 术语与问答 | 术语、定义、适用范围、引用、待核实项 | 无来源的定义显式标记；同名不同义提示冲突 |

## 5. 持久对象与引用证明

### 5.1 身份与修订

`spaceId` 是服务器生成的空间 ID，不能替换为伪造的 VM ID。每个领域对象同时保存所属空间、对象 ID、修订号、内容摘要、创建时间和写入者。写入者来自宿主请求身份，不接受客户端自由填入。未启用账号模式时记录“本地所有者会话”，不伪造姓名。

可编辑对象使用 `expectedRevision` 比较并交换。内容修订和许可修订分开保存；内容固定不表示永久允许读取。计划还绑定实际调用插件实例、代次、请求者、操作 ID、目标空间及各输入摘要。工作台不能借自己的权限替代真实内容消费者。

| 对象 | 固定内容 | 可变状态及归属 |
| --- | --- | --- |
| `SourceRevision` | 原字节摘要、长度、材料格式、来源类型、项目捕获回执或上传回执 | 标签、当前许可和撤销状态归 sources；任何新字节另建修订 |
| `ExtractionRevision` | 来源摘要、解析器版本与选项、解析文本摘要、位置映射、遗漏清单 | 当前解析推荐版本归 extract；旧版本保持可复核 |
| `IndexGeneration` | 完整材料集合、解析修订、分词规则版本、覆盖范围和索引摘要 | 当前索引指针与重建任务归 index |
| `CitationRevision` | 来源摘要、解析摘要、UTF-8 字节区间、引文摘要、显示定位 | 读取时派生完整性与许可状态；不修改引文来追随新来源 |
| `EntryRevision` | 陈述、陈述类别、适用条件、支持和冲突引用、人工判断说明 | 草稿指针和归档状态归 entries |
| `DocumentRevision` | 章节顺序、固定条目和引用、人工补充内容、模板版本 | 当前草稿指针归 documents；不自动升级子对象 |
| `ReviewRevision` | 文稿摘要、引用集合、许可修订、检查规则版本、人工决定 | 撤销决定和失效原因归 reviews；发布时再次复核 |
| `PublicationRevision` | 文稿、审阅、渲染器版本、输出摘要和来源许可依赖集合 | 活跃指针、撤回原因归 publish |

### 5.2 引用能证明什么

引用校验先读取固定源字节，再验证完整摘要，随后验证解析规则和固定文本摘要，最后按明确的 UTF-8 字节区间重算引文摘要。换行规范化、HTML 实体转换和 CSV 单元格展开必须保留映射及规则版本。界面显示行号、标题或表格坐标只用于阅读，真正的定位依据是固定内容和区间。

文本和源码可直接保存原始字节区间。HTML 引用指向提取文本区间，同时保存构成该文本的原文区间列表；不会声称提取结果与视觉排版完全一致。受限格式只允许引用已验证解析文本，缺少原字节的交接包显示“仅核验引文摘要”，不显示“来源全文已核验”。

完整性通过表示“这些引文字节来自这个固定材料”。它不能证明材料可信、事实正确、陈述与引用之间的推理成立，或原始作者同意使用。人工审阅必须分别确认语义支撑、适用范围和引用许可。检索分数只用于排序，不显示为事实置信度。

首版检索提供中文字符及双字词、拉丁词项、代码标识符、短语和来源过滤，全部在本机计算。分词、大小写归一和排序规则固定版本；查询回执列出实际应用的规则。未来增加向量检索时必须另列模型与索引版本，不改变旧查询的含义。

### 5.3 冲突、变更和失效

支持与反对引用均可保留在一个 `ConflictSet` 中。用户选择“暂不解决”“采用某方案”或“需要补充材料”，必须填写适用条件和理由。系统不能因为一个来源时间较新就自动裁定事实。

状态分开显示：`integrity` 为 `verified/missing/mismatch/unsupported`，`permission` 为 `allowed/revoked/unknown`，`freshness` 为 `current/superseded/uncheckable`，`semanticReview` 为 `unreviewed/accepted/disputed`。四项不能合并为一个绿色“可信”徽标。

## 6. 生命周期、并发与恢复

| 对象或动作 | 状态流 | 中断、并发与取消规则 |
| --- | --- | --- |
| 材料捕获 | `planned → copying → verified → accepted`；异常进入 `failed/interrupted` | 验证前写暂存区；取消保留诊断并移除未引用暂存字节；不得发布部分材料 |
| 解析 | `queued → parsing → ready` 或 `unsupported/failed` | 解析器只消费固定内容；硬超时或取消后不提交结果；旧解析版本仍可用 |
| 索引 | `planned → building → ready → active`；失败为 `failed/interrupted` | 先建完整影子索引，再用预期修订切换指针；禁止原地覆盖活跃索引 |
| 条目和文稿 | `draft → review-requested → reviewed`；修改后新建 `draft` | 相同基线的并发保存只允许一个成功，另一方得到差异及 `REVISION_CONFLICT` |
| 审阅 | `open → changes-requested/accepted → invalidated/revoked` | 文稿、引用集、许可或规则版本改变后旧决定不适用于新版本 |
| 发布 | `planned → rendering → staged → active → withdrawn` | 先写固定输出再切换活跃指针；取消不能使不完整版本变为 active |
| 导出 | `planned → packaging → ready → downloaded/expired` | 出包和下载时再次核对许可；下载租约保护存活，不授予额外内容权限 |
| 导入 | `uploading → quarantined → checked → accepted` 或 `rejected` | 接收产生新空间和新本地对象 ID；导入包不能覆盖原空间或激活发布 |
| 清理 | `planned → retiring → completed/cleanup-pending` | 只释放本领域持有的引用；物理删除未确认时保持 pending 和容量占用 |

计划默认有效 10 min，最长 30 min，一次性消费。重复请求携带同一幂等键时返回原结果或原任务；输入摘要不同则拒绝。元数据更新经过串行队列和预期修订检查，长任务不持有全空间写锁。

新来源到达时旧索引继续服务，并显示它覆盖的固定材料列表。许可撤销与来源删除不同：撤销先持久提交拒绝状态，再清理索引。每次查询在排序前过滤无权文档，分数仅按获准集合计算，返回前再次核对许可；不得泄漏撤销材料的命中数、片段、标题、路径或补全词。物理索引清理失败时保持撤销有效，并显示待清理数量。

进程崩溃后先核对任务日志、暂存摘要和引用账本。已经提交的不可变结果可复用；只存在半成品则标记 `interrupted`，由用户显式重试。发布指针只有旧版或完整新版两种结果。无法确认引用是否提交时保留 `recovery-required`，禁止按“文件存在”猜测业务完成。

停用插件先撤销新操作，取消任务并收尾受管存储句柄。停用保留持久材料和文档。重新启用要读取原数据版本并重建可丢弃索引，不能把空索引覆盖为“没有材料”。依赖停用或来源许可不明时，发布内容暂停读取并保留可恢复的版本记录。

## 7. 界面、HTTP 与 CLI

顶级“知识”页包含空间列表、材料、检索、条目、文稿、审阅、发布和交接。空间首页显示未解析材料、过期索引、待核实陈述、引用问题和待清理任务。详情页始终展示空间、对象修订、来源状态和最近操作结果。

以下均为拟议入口。HTTP 统一使用 `/api/knowledge/{spaceId}/...`，创建空间使用 `/api/knowledge/spaces`。CLI 拟使用 `sakura knowledge ... --space <id>`。命令不从当前 UI 选择推断空间或项目；导入文件路径仅在运行 CLI 的本机读取并流式上传，服务端不接受任意宿主路径。

| 用户动作 | 拟议 HTTP | 拟议 CLI 子命令 | 结果 |
| --- | --- | --- | --- |
| 创建与查看空间 | `POST /api/knowledge/spaces`；`GET /api/knowledge/{spaceId}` | `space create/show` | 空间身份、许可默认值、统计和错误状态 |
| 上传材料 | `POST .../sources/uploads`；`PUT .../sources/uploads/{id}/chunks`；`POST .../sources/uploads/{id}/finish` | `source upload <file>` | 完整摘要和新材料修订 |
| 项目捕获或刷新 | `POST .../sources/capture-plan`；`POST .../sources/capture` | `source plan/capture/refresh` | 固定输入清单、计划和捕获回执 |
| 解析、索引 | `POST .../extract`；`POST .../index/plans`；`POST .../index/build` | `extract run`；`index plan/build` | 可查询任务 ID、覆盖清单和警告 |
| 检索与查看定位 | `POST .../search`；`GET .../citations/{id}` | `search <terms>`；`citation inspect` | 固定片段、过滤条件、索引版本、校验状态 |
| 创建引用与条目 | `POST .../citations`；`POST .../entries`；`PUT .../entries/{id}` | `citation create`；`entry create/edit` | 引用证明和带预期修订的内容更新 |
| 编写文稿 | `POST .../documents`；`PUT .../documents/{id}`；`GET .../documents/{id}/compare` | `document create/edit/compare` | 固定章节与子对象修订 |
| 审阅 | `POST .../reviews`；`POST .../reviews/{id}/decide` | `review open/decide` | 人工问题清单、决定及失效条件 |
| 本机发布、撤回和回退 | `POST .../publish/plans`；`POST .../publish/apply`；`POST .../publications/{id}/withdraw` | `publish plan/apply/withdraw/rollback` | 不可变输出与活跃指针；回退同样生成计划 |
| 导出与导入 | `POST .../exchange/export-plan`；`POST .../exchange/export`；`GET .../exchange/exports/{id}/download`；`POST .../exchange/imports`；`POST .../exchange/imports/{id}/accept` | `export plan/create/download`；`import inspect/accept` | 出包清单、隔离检查和接收回执 |
| 取消和清理 | `POST .../jobs/{id}/cancel`；`POST .../cleanup/plan`；`POST .../cleanup/apply` | `job cancel`；`cleanup plan/apply` | 真实任务状态和保留原因 |
| 许可撤销 | `POST .../sources/{id}/policy-plan`；`POST .../sources/{id}/policy-apply` | `source policy plan/apply` | 影响到的引用、文稿、发布与导出列表 |

每个动作需有严格请求和响应模式、显式操作策略及服务描述符。读取也要求当前所有者身份、会话和空间许可，不因 `GET` 而放宽。长任务用已有 Jobs 查询和取消流程；任务失败返回原错误码、阶段和恢复入口，不把任务接受响应当作完成。

本机阅读路由只返回通过许可复核的安全文稿结构，由现有认证应用中的固定渲染组件展示。原始 HTML 不进入 `innerHTML`。离线 HTML 使用随包固定样式，内容安全策略禁止脚本、连接、表单和远程资源；外部链接只作为普通文字地址显示。不开新监听端口，不生成匿名分享令牌。

获准下载原始材料时，响应使用附件下载、二进制媒体类型和禁止嗅探声明，文件名经过校验。原始 HTML 不能以可执行网页的媒体类型从 Sakura 域打开。下载后的文件由接收者自行保管，软件不能约束其他应用如何打开它。

## 8. 配额、秘密和保留

以下为**首版拟定硬上限，实施前资源实测可收紧，不是当前性能保证**。界面在复制或处理前给出估算，执行过程累计实际用量。达到上限必须失败或报告显式不完整结果，不能静默少收材料。

| 项目 | 默认值或上限 | 超限行为 |
| --- | --- | --- |
| 空间与全宿主持久容量 | 最多 20 个空间；全部知识持久内容合计 10 GiB，包含所有历史和元数据 | 空间数量或容量满时拒绝新空间及新增写入；不删除仍有引用的内容 |
| 元数据与历史对象 | 每空间 32 MiB、10,000 个对象修订；全宿主 256 MiB、50,000 个对象修订 | 字节数或对象数先达上限即拒绝提交；计划、审阅、诊断和历史同样计入 |
| 单空间材料 | 2000 个当前来源、全部修订合计 2 GiB | 拒绝新捕获，提供清理预览 |
| 单文件 | 16 MiB 原字节；纯文本最大 8 MiB；文本行最大 64 KiB | 拒绝或要求用户在外部拆分，不自动截取 |
| 解析 | 每份材料 30 s、输出 16 MiB、最大嵌套 64 层 | `EXTRACT_LIMIT`，无可发布的部分结果 |
| 索引 | 每代 100,000 个文本块；单块 8 KiB；最多 2 个构建任务 | 拒绝超额任务，旧索引仍可查询 |
| 搜索 | 查询 500 个字符，单页 50 项，最多返回 500 项 | 返回结果上限和覆盖信息，不给出虚构精确总数 |
| 条目和文稿 | 单条目 128 KiB、单文稿 2 MiB、单文稿 2000 条引用 | 保存前拒绝，保留本地未提交编辑内容 |
| 导入导出 | 包 512 MiB、解包总量 1 GiB、最多 5000 项、压缩比最多 50 | 拒绝隔离包，不接收部分对象 |
| 并发与暂存 | 全宿主最多 4 个知识重任务；每空间 2 个；总暂存 2 GiB | 排队或明确拒绝；退出真实资源后再返还额度 |
| 暂存保留 | 未完成上传 24 h、失败任务诊断 7 天 | 首版仅在用户确认清理时删除，不启用隐式定时任务 |

持久字节与暂存字节统一计入全宿主知识目录 12 GiB 总上限，影子索引、失败包和待清理内容均占用额度。额度检查使用跨空间串行账本与真实文件核对，不能只按当前空间估算。满额仍允许撤销许可、查询、取消和清理；这些操作预留固定的恢复记录空间，预留也计入总量。

sources 提供容量预留回执，各领域在写元数据或字节前预留上界，提交后按实际量结算。跨插件元数据不声称具有同一文件事务：每次写入保留操作 ID 和原预留回执，重启后按已提交修订核对。无法确定写入结果时保守计费并进入恢复状态，不因任务失败直接归还容量。

上传、捕获和导出均预览敏感信息命中项。默认排除 `.git`、依赖缓存、私钥、常见凭据文件和 `.env`；公开模板需用户明确选择。识别器只是提示，不能保证发现所有秘密。用户可建立脱敏副本；副本具有新摘要和遮盖清单，原始字节不混入默认导出。引用必须指向实际可导出的脱敏版本，不能用原文摘要冒充脱敏证据。

日志记录对象 ID、摘要、状态、字节数和错误类别。默认不记录全文、检索词、引文或宿主绝对路径。原始材料可能含敏感信息，保存在本机数据目录不等于静态加密；宿主文件系统权限和磁盘加密仍由部署环境提供。

每个文稿、引用、发布和导出持有准确的内容保留引用。清理预览列出保护它的对象，不能仅因文件“未索引”就删除。用户删除来源时先撤销新读取和导出，再确认受影响发布、移除业务引用并清理字节。仍需保留的审阅记录只保留身份和摘要；若正文必须删除，不能借审计保留重新暴露全文。

## 9. 发布、离线交接与导入隔离

### 9.1 发布规则

发布计划绑定固定文稿、审阅、模板、渲染器、引用集合、来源许可修订和输出预算。任何引用完整性失败、许可不明、未解决的敏感内容问题都会阻止发布。允许保留“待核实”陈述，但必须出现在文稿和导出显著位置，并由审阅者明确接受其用途；它不能显示为已确认事实。

本机发布每次读取都复核依赖来源的许可。已经撤销的发布返回不可读状态和原因，且不回传缓存正文。浏览器响应不使用共享缓存；会话锁定、空间撤销时清空当前界面中的内容缓存。已有截图、复制文本和已经下载的文件无法远程撤回，这不在权限撤销的保证范围内。

回退只是将活跃指针切回某个仍有有效许可、完整内容和适用审阅的版本。历史版本有撤销引用时，回退计划必须失败；不能借回退恢复被撤销的材料。

### 9.2 两种导出模式

| 模式 | 内容 | 复核范围 |
| --- | --- | --- |
| 阅读包 | 固定 HTML、Markdown、静态样式、出处清单、摘要和缺失说明 | 验证包内字节；没有原材料时不能证明引文确实来自全文 |
| 可复核交接包 | 阅读包内容、获准的固定来源、解析结果和位置映射、引用、条目、文稿、审阅和导出清单 | 复核完整字节、解析定位和引用关联；事实与身份真实性仍需人工判断 |

导出器从允许字段构造新的包，不打包整个空间目录。默认排除搜索日志、暂存、索引数据库、历史正文、未选择来源、账号配置和宿主绝对路径。首版只支持文本材料，图片、SVG、嵌入 HTML 和外部资源均不进入包。Markdown 图片语法仅显示替代文字与“图片未收录”提示；用户必须在审阅中确认文稿无需该图片即可理解。图片净化和引用另做后续适配。

发布与导出共用经过审核的纯渲染函数及格式规则，不互相读取私有领域对象。exchange 自行从已声明的 documents、evidence 和 reviews 公共服务取得固定内容并重新核对；不能从某次网页缓存提取“已发布正文”。

一个获准文稿引用了禁止导出的来源时，不允许默认降级为“仅摘录”。导出计划会列出冲突；用户应先获得许可、替换材料或删除该部分并重新审阅。正文中手工复制的内容也可能泄漏；导出前的全文敏感检查和人工预览仍不可省略。识别不到的秘密属于明确的剩余风险。

首版包使用固定文件清单、每文件 SHA-256 和清单摘要，无签名。接收者看到“完整性通过，来源身份未认证”。包内声称的作者、账号和审阅者均作为未认证来源声明，不可冒充接收端的账号或审批。需要签名交付时须另做明确的签名格式和信任策略，不能沿用软件发行签名含义。

### 9.3 导入与接收

导入先落入独立隔离区。检查格式版本、总量、重复项、大小写和 Unicode 路径冲突、路径穿越、绝对路径、符号链接、硬链接、压缩炸弹及未列出的文件。任何一项失败均不创建可阅读空间，也不执行 HTML、Markdown 或源码。

离线校验不依赖出包机器：重新计算全部摘要，校验对象引用图、解析位置和已支持的解析器版本。首版标准化元数据的字段顺序和编码必须写入格式规范，不能只依赖任意对象的序列化顺序。未知高版本格式拒绝，不能跳过未知字段后显示通过。

接收计划显示将创建的对象、缺失来源、许可声明、敏感内容和未认证审阅。用户明确接收后新建本地空间和 ID 映射，保留原包 ID 及摘要作为来源。导入审阅只作参考；接收端需要重新审阅才能发布。索引在接收后由用户显式重建，不能执行包内携带的索引代码或插件。

## 10. 现有接口复用与最小新增契约

### 10.1 已核对的现有边界

| 已有入口 | 复用方式 | 不能据此假设的能力 |
| --- | --- | --- |
| [PluginContext 与实例能力](../server/plugin-api.ts)、[PluginCapabilities](../server/plugin-capabilities.ts) | 注册自有服务、Jobs、元数据、存储占用和退出清理 | 不能在可信 manifest 中虚构 `permissions` 或任意宿主路径权限 |
| [WorkspacesV1](../server/service-contracts/v1.ts) 的 `projects.inScope/resolveProject/readCommittedConfig` | 在明确的项目作用域中读取配置，用固定配置内容生成捕获修订摘要 | 不运行项目 setup，不执行构建，不从当前选择隐式确定范围 |
| [FilesV1](../server/service-contracts/v1.ts)、[Files 实现](../server/files.ts) | 沿用流式读取、取消、文件完整性和路径校验的实现经验 | `info/download` 现有签名没有固定项目根、完整文件集及一致性回执 |
| [ProjectFilesV1](../server/service-contracts/v1.ts)、[项目搜索实现](../server/project-files.ts) | 可选辅助用户挑选路径，必须显示 `truncated` | 当前项目搜索不是固定版本索引，也不是完整来源快照 |
| [DeliveryArtifactsV1](../server/service-contracts/delivery-storage.ts) | 可选从明确交付范围复制已核验材料；保留原清单摘要 | `DeliveryScope` 要求 `vmId/projectId`，不可用伪造 VM ID 承载零 VM 空间 |
| [ArtifactStore](../server/artifact-store.ts) | 提取可复用的分块、摘要、持久引用和清理算法，保持存储及授权实例独立 | 不直接导入另一插件服务实例，不复用交付目录，不把数据格式冒充兼容 |
| [ComputeRuntime](../server/compute-runtime.ts) 与[固定计算适配器约束](plugin-design-contract.md#17-计算统管) | 为解析和索引新增受审核的固定计算适配器；先申请预算，再加载输入，取消后确认 worker 退出 | 插件不能提交任意 worker 源码；声明的内存预算不等于整个宿主进程的物理内存硬上限 |
| [OperationAuthority](../server/operation-authority.ts)、[插件授权上下文](../server/plugin-authority.ts) | 读取和修改均走明确策略；等待后重检会话和真实消费者代次 | 单次开始校验不能覆盖长期任务和最后下载 |
| [LocalAssistantV1](../server/service-contracts/v1.ts)、[本地助手](../server/local-assistant.ts) | 后续可选问答适配仍需预览精确片段及独立发送确认 | 现有 `generate` 不提供引用真实性验证；当前知识包不依赖它，也不自动调用 |

项目捕获应复用现有项目执行身份校验，但不得为读文件安装工具或运行用户命令。权限检查、VM 生命周期、元数据与回执规则沿用[插件设计契约](plugin-design-contract.md)。

### 10.2 新增插件契约

`KnowledgeSourcesV1` 同时负责空间内的原始和派生字节，提供 `createSpace/listSources/getSource/planCapture/capture/upload/read/retain/release/verify/planPolicy/applyPolicy/planCleanup/cleanup`，以及 `reserveCapacity/commitCapacity/releaseCapacity`。字节写入请求绑定内容种类和实际消费者，派生内容不能伪装成原始来源。每份内容都有明确的固定输入摘要；空间来源许可变化必须能沿内容依赖集合传导到读取检查。

其余服务只暴露自己的领域动作：extract 的 `plan/run/get`，index 的 `plan/build/search/coverage`，evidence 的 `create/inspect/check`，entries 和 documents 的 `create/revise/readPinned/compare/archive`，reviews 的 `open/readPinned/decide/recheck`，publish 的 `plan/apply/read/withdraw`，exchange 的 `planExport/export/inspectImport/acceptImport`。工作台仅组合这些接口与 Jobs，不重复实现许可校验。

`readPinned` 必须显式传入 `spaceId`、对象 ID、固定修订和用途，返回该修订的内容、摘要、子对象引用与准确来源依赖集合。提供者在读取前和异步等待后复核当前所有者、真实消费者及对应用途的许可；固定修订不绕过撤销。publish、exchange 和 reviews 通过这些公共读取方法取得文稿、条目和审阅，不能读取私有元数据目录。读取过程中依赖变化时拒绝提交渲染或导出结果，保留原固定版本用于诊断。

下面是拟议的 `files` 插件 **FilesV2** 核心形状，不是已经存在的接口。V1 保持不变。实际契约文件、服务键、严格模式、操作目录和描述符须在实施阶段一起增加。

```ts
type ProjectCaptureRequest = {
  vmId: string;
  projectId: string;
  configRevision: string;
  relativePaths: readonly string[];
  maxBytes: number;
};
type ProjectCaptureReceipt = {
  token: string;
  manifestDigest: string;
  expiresAt: string;
  consistency: 'selected-file-copies';
  files: readonly { path: string; sha256: string; bytes: number }[];
};
type ProjectCapturePlan = {
  token: string;
  expiresAt: string;
  manifestDigest: string;
  files: readonly { path: string; sha256: string; bytes: number }[];
};
interface FilesV2 {
  planCapture(request: ProjectCaptureRequest, signal?: AbortSignal): Promise<ProjectCapturePlan>;
  capture(input: { planToken: string }, signal?: AbortSignal): Promise<ProjectCaptureReceipt>;
  readCaptured(token: string, path: string, offset: number, length: number): Promise<{
    data: string; offset: number; eof: boolean;
  }>;
  releaseCapture(token: string): Promise<void>;
}
```

`planCapture` 在首次异步读取前捕获 VM 创建、运行、boot 身份和项目作用域，再生成内容清单。它把这些身份、项目根、配置摘要、输入清单、预算、真实消费者代次及所有者授权固定在服务端票据中。客户端只能持有不透明令牌，不能填写替代身份。知识层的 CapturePlan 引用这张准确票据；用户确认后不能临时重做一张新票据继续执行。

`capture` 一次性消费原计划，在开始复制、等待返回和提交回执前均核对原 VM 与项目身份及授权。所有检查使用同一原运行寿命和项目执行作用域。VM 重建、重启、项目切换或配置变化使计划失效；不得因为 `vmId` 相同而重新绑定。复制后的完整摘要必须与预览清单一致。

只接受显式普通文件，相对路径不可越界，逐段拒绝链接；检测到源文件在复制期间变化时拒绝该次结果。回执指向已经复制并校验的有界暂存字节，不在 `readCaptured` 时重读可变源文件。

`consistency` 明示为“选定文件副本”。首版不声称跨文件具有数据库事务或 Git 提交快照的一致性；即使前后文件检查通过，外部程序仍可能改回原值。用户需要提交级一致性时，应先提供已经固定的交付输入或本地归档。`capture` 的来源证明只覆盖实际捕获到的字节。

知识服务复制完毕后归还 FilesV2 回执。过期回执停止读取；暂存清理未完成保留原归属和额度。宿主最低改动为注册新契约、受管存储原语及固定解析和索引计算适配器，不增加知识业务系统服务。若无法在现有受管读取适配中落实路径竞态检查，项目捕获不得验收通过；纯本地上传流程仍可独立验收。

解析器和索引器只接收数据与固定选项，不能接受脚本、模块路径或动态加载声明。每份材料的计算适配器使用 30 s 执行截止时间；索引按有界批次提交，不用一个不可取消任务处理整个空间。适配器使用 256 MiB 内存准入预算并限制输入、输出和中间块数，具体物理内存限制随宿主运行时能力验收；超时清理失败沿用 `COMPUTE_CLEANUP_PENDING`，不能提前归还预算。

## 11. 错误与恢复入口

| 拟议错误码 | 触发条件 | 用户动作及恢复规则 |
| --- | --- | --- |
| `SOURCE_CHANGED` | 捕获前后身份、字节或配置改变 | 重做捕获预览；旧计划不能继续 |
| `SOURCE_FORMAT_UNSUPPORTED` | 未支持格式、编码或解析器版本 | 换为受支持文本，保留原上传诊断 |
| `EXTRACT_LIMIT` | 大小、嵌套、处理时限超限 | 拆分或排除材料；不发布部分解析 |
| `INDEX_STALE` | 查询要求的来源集合与活跃索引不一致 | 显式查询旧集合或重建；不能混合新旧结果 |
| `CITATION_MISMATCH` | 原文、解析或引文摘要不匹配 | 隔离引用；重新导入或重建，不自动重定位 |
| `SOURCE_USE_REVOKED` | 空间内材料许可已撤销 | 停止引用阅读、发布和导出；由所有者重新授权或替换材料 |
| `REVISION_CONFLICT` | 并发编辑使用旧修订 | 显示差异，人工合并后提交新修订 |
| `REVIEW_STALE` | 文稿、证据或许可已改变 | 重新审阅受影响项，再生成发布计划 |
| `EXPORT_POLICY_CONFLICT` | 出包包含不获准材料或未处理敏感项 | 修订内容或用途后重新预览，禁止静默摘录 |
| `BUNDLE_UNVERIFIED` | 缺失字节、未知格式、摘要错误或危险路径 | 保持隔离，允许下载诊断和删除该隔离记录 |
| `PLAN_EXPIRED` | 计划过期或身份已改变 | 重新生成计划；幂等键不能延长授权 |
| `KNOWLEDGE_CLEANUP_PENDING` | 索引或字节真实清理未确认 | 保留禁止访问状态和容量记录，仅重试原清理 |

## 12. 实施里程碑与验收

以下负责人为实施职责，不代表已安排独立人员或后台任务。不虚构工期。每个里程碑先实现，再执行必要验证、修复并更新状态。

| 优先级 / 里程碑 | 负责人 | 依赖 | 可验收交付物 |
| --- | --- | --- | --- |
| P0 / K1：身份和材料 | 资料存储负责人 | 既有身份、Jobs、元数据与存储能力 | sources、FilesV2、空间 schema；零 VM 上传和固定项目文件捕获；来源许可与引用账本 |
| P0 / K2：解析、检索和证据 | 检索与引用负责人 | K1 | extract、index、evidence；固定位置映射；可取消索引；错误和覆盖说明；权限撤销即时过滤 |
| P0 / K3：条目、文稿与审阅 | 文稿流程负责人 | K2 | entries、documents、reviews；4 类模板；并发比较；人工冲突说明；审阅失效规则 |
| P0 / K4：发布与交接 | 发布与格式负责人 | K3 | publish、exchange；认证阅读；两种离线包；隔离导入和独立复核；撤回及回退 |
| P0 / K5：整包交付 | 集成与验收负责人 | K1～K4 | workbench、HTTP、CLI、插件包与服务登记；空态、示例、卸载恢复、文档和版本记录 |
| P1 / 后续独立扩展 | 后续迭代负责人 | K5 已验收 | PDF 或 Office 解析、模型草稿辅助、项目成员共享、独立审批、签名交接；各自另设边界与验收 |

### 12.1 必须通过的成功流程

| 编号 | 验收场景 | 必须看到的结果 |
| --- | --- | --- |
| K-S1 | 无 VM、无模型、无外网，从示例到导出再导入 | 10 个插件的完整流程可用；无隐式网络、工具安装或执行 |
| K-S2 | 捕获项目文件后改名并修改源文件 | 旧引文仍可按旧摘要复核；更新候选明确；新旧版本不混淆 |
| K-S3 | 在另一台离线安装中检查可复核交接包 | 重新计算全部摘要和定位；显示来源身份未认证；导入不自动发布 |
| K-S4 | 文稿使用相互矛盾的材料 | 显示冲突和人工理由；搜索排序不会自动解决冲突 |
| K-S5 | 分别用 UI、HTTP、CLI 创建、审阅、发布和导出 | 对相同输入得到同一许可判断与状态；CLI 正确返回失败状态 |
| K-S6 | 未启用可选交付制品或项目搜索插件 | 默认流程完整；关联入口明确不可用；不自动启用依赖 |

### 12.2 必须覆盖的故障流程

| 编号 | 故障注入 | 必须看到的结果 |
| --- | --- | --- |
| K-F1 | 文件复制中替换路径为链接，或更换 VM 运行身份 | 捕获失败；没有越界字节、半成品来源或成功回执 |
| K-F2 | 文本哈希被篡改、解析器版本未知、定位偏移损坏 | 引用失败或不可复核；禁止把校验跳过当作通过 |
| K-F3 | 索引构建、发布指针提交或导出期间断电式退出 | 旧版本仍完整或任务明确中断；重启不发布半成品 |
| K-F4 | 两个客户端同时修改文稿，或审阅后更改来源许可 | 一个旧修订写入失败；旧审阅不能通过新发布计划 |
| K-F5 | 查询或下载等待期间锁定会话、撤销来源许可 | 返回前和每个受管分块重新检查；停止新的正文与片段输出 |
| K-F6 | 撤销来源后索引物理删除失败 | 搜索、补全、命中数和发布仍隐藏它；保持清理待恢复 |
| K-F7 | 导入危险 HTML、跨目录项、重复路径、超高压缩比 | 全部停在隔离区；零脚本执行、零隐式网络请求 |
| K-F8 | 文稿手工复制了秘密、来源不允许导出 | 导出预览和敏感提示可见；未解决项阻止出包；不得宣称识别器无遗漏 |
| K-F9 | 取消任务、关闭依赖或磁盘空间耗尽 | 原引用和租约保留到真实收尾；错误可恢复；旧有效版本不丢失 |
| K-F10 | 导入他机审阅或回退到含撤销来源的旧发布 | 他机审阅不成为本机审批；回退被拒绝 |

验收优先复用现有静态契约、插件依赖和任务生命周期检查，再执行上述最短集成流程。专用测试脚本、样本、截图和报告按精确规则留在本地；Git 仅保留正式代码、示例资源、使用文档与简短验证结论。

## 13. 设计状态与实施前检查

本文完成的是包边界、10 个插件及其直接依赖、对象和生命周期、拟议接口、错误恢复与验收设计。运行实现仍为待开始。设计复核不等于格式解析、权限撤销、导出安全或故障恢复已经通过运行验收。

实施前应先确认 FilesV2 的固定文件捕获边界和知识内容仓库的独立作用域，再冻结首版离线格式。存储或权限缺口未解决时，不用伪造项目 ID、自动放宽来源许可、忽略索引遗漏或跳过导入核验来替代设计要求。
