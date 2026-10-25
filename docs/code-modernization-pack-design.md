# 代码改造与升级插件包设计

## 1. 版本与使用结果

设计版本 4.0.0，日期 2026-10-25。核对基线为应用 2.7.0 / `237d7bc`，工作区中的 2.8.0 实施另行验收。包 ID 为 `code-modernization`，含 11 个拟议插件，运行实现待开始。本文与[第四批总览](plugin-pack-next-design.md)共同作为实施依据。

用户固定源码、升级规则和兼容要求，在独立副本中执行改造，检查差异并交付补丁。结果包含原文件摘要、逐项改造记录、兼容检查和人工审阅。补丁只描述指定输入的变化，用户另行决定应用位置。

[开发检查](development-workbench.md)继续负责日常诊断，[交付包](delivery-workbench.md)继续负责构建与发行。本包管理一次跨文件改造的范围、顺序、变更归因和补丁接收条件。[修复会话](repair-sessions.md)保留交互式修复；本包首版只执行固定工具配方。

首版支持 UTF-8 文本树、声明式重命名规则和已登记的语法转换器。每种语言、语法版本和转换器都必须单独验收。未知语法、生成文件、子模块、符号链接及二进制修改明确列为未支持；不得跳过后宣称全仓库改造完成。

## 2. 内部插件与直接依赖

下表服务、方法及所有入口均为拟议接口。完整依赖使用精确插件 ID，`—` 表示无依赖。定义读写、保护引用和清理方法遵循总览。

| 插件 ID | 自有对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `modernize-sources` | 工作空间、固定源码树和捕获清单；ModernizeSourcesV1：upload、capture、sealTree | — | `files` |
| `modernize-inventory` | 语言、符号和引用索引及未解析范围；ModernizeInventoryV1：analyze、querySymbols、coverage | `modernize-sources` | — |
| `modernize-recipes` | 转换器档案、规则顺序、兼容要求与支持矩阵；ModernizeRecipesV1：validate、compile、listTools | `modernize-sources` | — |
| `modernize-plans` | 改造范围、步骤依赖、冲突和预期影响；ModernizePlansV1：compose、preview、seal | `modernize-sources`、`modernize-inventory`、`modernize-recipes` | — |
| `modernize-runners` | 专用虚拟机、原工具进程、改造树及逐步回执；ModernizeRunnersV1：preview、start、cancel、reconcile | `modernize-sources`、`modernize-recipes`、`modernize-plans`、`projects` | — |
| `modernize-checks` | 固定检查任务、检查产物和兼容差异；ModernizeChecksV1：preview、run、compare、cancel、reconcile | `modernize-sources`、`modernize-inventory`、`modernize-recipes`、`modernize-plans`、`modernize-runners`、`projects` | — |
| `modernize-patches` | 文件级补丁、重命名关系和原摘要前置条件；ModernizePatchesV1：build、inspect、verifyTarget | `modernize-sources`、`modernize-runners` | — |
| `modernize-reviews` | 按文件及规则的人工判断、待处理意见和批准；ModernizeReviewsV1：comment、decide、coverage | `modernize-sources`、`modernize-plans`、`modernize-checks`、`modernize-patches` | — |
| `modernize-reports` | 改造覆盖、检查证据、审阅结果和交付结论；ModernizeReportsV1：assemble、seal、compare | `modernize-sources`、`modernize-inventory`、`modernize-plans`、`modernize-runners`、`modernize-checks`、`modernize-patches`、`modernize-reviews` | — |
| `modernize-exchange` | 配方、补丁和报告封套及隔离接收；ModernizeExchangeV1：export、inspectImport、acceptImport | `modernize-sources`、`modernize-inventory`、`modernize-recipes`、`modernize-plans`、`modernize-runners`、`modernize-checks`、`modernize-patches`、`modernize-reviews`、`modernize-reports` | — |
| `modernize-workbench` | 模板、进度视图、差异导航和待处理项；ModernizeWorkbenchV1：view、templates | `modernize-sources`、`modernize-inventory`、`modernize-recipes`、`modernize-plans`、`modernize-runners`、`modernize-checks`、`modernize-patches`、`modernize-reviews`、`modernize-reports`、`modernize-exchange` | — |

工作空间及容量账本归 sources。其余插件直接核对 sources 的授权。checks 拥有检查记录，检查进程也由 checks 的独立工具会话负责；它只读取 runners 封存的改造树，不能继续操作原改造进程。缺少 `files` 时使用上传固定树的完整流程。

## 3. 完整用户流程

1. 新建空间，选择“符号重命名”“配置格式升级”或“接口替换”模板，查看支持的输入范围。
2. 上传固定文件树，或从已授权项目捕获指定文件；核对排除项、原摘要和来源许可。
3. 生成符号索引，逐项处理解析失败、动态引用和跨文件冲突。未解析文件可以保留，但覆盖范围必须如实缩小。
4. 固定配方及兼容要求，预览每步输入、目标文件、工具、预算和不能自动判定的项。
5. 批准后创建专用虚拟机，执行改造。每步从已确认的前一步产物读取，失败时停止后续步骤。
6. 在新的隔离会话检查原树和改造树，比较诊断及接口差异，生成带原摘要的补丁。
7. 审阅全部变更或明确标注的审阅范围，处理检查失败，再确认转换、检查会话及原虚拟机清理。修改配方后产生新运行，旧结果保留。
8. 封存包含执行资源清理回执的最终报告，导出指定补丁和证据，再核销传输租约。接收端先检查目标树摘要，再由用户决定是否另行应用。

## 4. 对象、执行与权限

`SourceTree` 固定路径、文件摘要、编码和大小写规则。`RewriteRecipe` 固定转换器摘要、参数模式、规则顺序和支持语法。`RewritePlan` 引用准确树修订，列出全部目标与排除范围。客户端不能提交任意命令或可执行转换脚本。

`RewriteStepReceipt` 记录输入树、输出树、退出状态及真实工具版本。转换器声称成功后，运行器仍须核对输出树。修改了范围外文件、文件路径碰撞或输出上限突破，均使本步失败；已生成材料作为失败证据保存。

拟议 `ModernizationSessionsV1` 提供固定转换和固定检查两类会话。默认断网，源码只读装入输入区，输出写入独立目录。项目中的安装脚本、Git 钩子和构建配置不得因为读取源码而执行。需要执行项目检查时，计划明确列出固定检查入口和代码执行范围。

`CompatibilityPolicy` 归 recipes，运行前封存应保持的接口、允许变化和检查范围。plans 固定该策略修订，checks 只建立检查任务与结果。静态检查、编译结果及人工判断分别呈现。无法解析的动态调用只能记为未覆盖；通过已选检查不证明全部运行行为相同。

补丁记录 `baseTreeDigest`、逐文件前后摘要和规范化路径。首版不在宿主工作树应用补丁，也不创建提交或推送。`verifyTarget` 检查上传的目标摘要清单，仅给出匹配结论；接收端应用工具仍须在写入前重新核对真实文件。

定义采用 draft → sealed → archived。运行沿用总览任务状态；补丁采用 candidate → reviewed → accepted/declined。接受后修改配方或输入不会改变旧补丁；新补丁需要新审阅。导入批准只保存为来源记录，不取得本地批准效力。

清理未确认时可以保存中间报告，必须标记待清理，不能标为完整交付。后到清理回执产生新报告修订，不能改写旧报告。导出传输的完成与租约核销写入后续交接账本，封套不包含自身传输完成证明。

## 5. 页面、HTTP 与 CLI

工作台提供源码覆盖、配方、步骤图、运行、检查对照、文件差异、审阅和交接。空页面不扫描仓库；大差异按文件及片段分页，始终显示总文件数和未审阅数。CLI 别名为 `modernize`，下表命令前缀均为 `sakura`。

| 操作 | 拟议 HTTP | CLI | 返回要点 |
| --- | --- | --- | --- |
| 索引源码 | `/api/modernize-inventory/analyze` | `modernize inventory analyze` | 索引修订、解析覆盖及遗漏 |
| 预览改造 | `/api/modernize-plans/preview` | `modernize plan preview` | 固定步骤、影响范围和冲突 |
| 执行与核销 | `/api/modernize-runners/start`、`/api/modernize-runners/reconcile` | `modernize run start/reconcile` | 原运行与清理状态 |
| 检查兼容 | `/api/modernize-checks/run` | `modernize check run` | 两个固定树及检查任务回执 |
| 审阅补丁 | `/api/modernize-reviews/decide` | `modernize review decide` | 当前补丁修订及待处理意见 |
| 导出交付 | `/api/modernize-exchange/export` | `modernize export` | 补丁、报告和准确材料清单 |

## 6. 容量、异常与恢复

拟定每树最多 20,000 个文件、合计 256 MiB，单文件 8 MiB。每配方最多 100 步，单次改造或检查最长 30 分钟。全包同时最多 2 个专用虚拟机，每台 2 vCPU、4 GiB 内存、12 GiB 虚拟磁盘；总存储 48 GiB，单次导出 1 GiB。解析深度、符号数、补丁行数另设硬上限。

| 情况 | 结果与恢复要求 |
| --- | --- |
| 重命名碰撞、语法不支持 | 提交前拒绝；保留具体文件和规则位置 |
| 转换器失败或只改完部分文件 | 记录失败及已确认步骤，禁止导出“已通过”补丁 |
| 原树或检查要求改变 | 原计划失效，重新预览；不修补旧批准 |
| 进程失联、控制器退出 | 标记 interrupted，按原回执核销；重新运行须新计划 |
| 补丁文件已被用户修改 | 目标核对失败，列出冲突；不自动模糊匹配或覆盖 |
| 磁盘满、导出中断 | 保留原预留与已发布对象；恢复只核对原发布意图 |

## 7. 实施前置与验收

P0 先完成固定文件树解析、独立转换/检查会话和工具支持矩阵。P1 再完成步骤计划、差异与审阅；P2 交付离线交换和完整工作台。现有项目执行能力只提供资源基础，不能视为 ModernizationSessionsV1 已实现。

验收至少覆盖以下结果：

- 三个模板均从固定树产生真实补丁，接收端能复核前后摘要。
- 跨文件符号重命名保持关联；冲突或动态引用显示明确未覆盖范围。
- 源码中的安装脚本、Git 钩子和未声明命令不执行；专用环境拒绝未授权外连。
- 检查失败、未解析文件和未审阅变更均按预先固定的交付规则阻止通过。
- 旧计划、旧补丁批准和错误目标摘要拒绝提交，已有用户文件保持原样。
- 取消及控制器退出后，原转换和检查子进程均完成核销；未知资源保持待清理。
- 离线篡改、路径碰撞和导入旧批准拒绝；再次接收不会覆盖已接受对象。
