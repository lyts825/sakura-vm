# 项目知识与文档工作台

## 使用范围

本模块面向应用 2.7.0，包含 10 个独立插件。知识空间属于当前宿主所有者；账号模式仅允许 `owner`，本机会话锁定后停止读取。创建空间、上传、解析、检索、审阅和离线交接不需要 VM、AI 或外部账号。

材料支持 UTF-8 文本、Markdown、源码文本、JSON、CSV 和静态 HTML。源码与代码块只作为文字。HTML 仅提取文本，不请求网页、图片、脚本或字体。PDF、Office、OCR、网页抓取和模型问答不在本版支持范围内。

插件启用后不执行扫描、解析或示例导入。界面的空间、材料、引用和条目选择默认为空。停用插件保留持久数据，重新启用不会自动重放中断任务。

## 首次完成一份文稿

1. 打开“知识”，点击“刷新空间”，创建空间。也可输入空间名称、选择模板，再导入虚构示例。示例包含相反的操作说明和已更新的来源。
2. 在“材料”上传文件。离线导出许可默认关闭。先查看名称、长度、SHA-256 和敏感提示，再选择要解析的具体修订。
3. 点击“预览解析选中版本”，确认计划。查看解析块的原字节区间、行号、JSON 路径或 CSV 行号。HTML 的丢弃内容会单独提示。
4. 选择解析版本，预览并建立固定索引。在“检索与引用”输入中文或其他词项。空结果显示覆盖和遗漏，不生成答案。
5. 选中一个完整解析块，建立固定引用。四维校验分别报告完整性、当前许可、来源更新和身份真实性；摘要通过不等于事实已证实。
6. 创建条目，选择事实、判断、操作建议或待核实内容。填写适用条件，分别选择支持与相反依据。冲突必须有人工处理说明。
7. 在“文稿”填写模板章节，并选择固定条目修订。新条目不会自动改写旧文稿。并发保存使用 `expectedRevision`，旧基线返回 `REVISION_CONFLICT`。
8. 生成审阅清单。先修复阻断问题，再逐项确认适用范围、待核实内容和图片缺失。填写人工审阅说明，接受此次用途。
9. 预览本机发布，确认后在“本机阅读”查看。阅读请求重新核对来源许可和审阅；撤权后不返回缓存正文。回退也要重新预览，含撤销来源的旧版本不能回退。
10. 选择已接受的审阅，预览导出。阅读包用于阅读与包内字节检查；可复核交接包增加固定原材料、解析位置、引用和领域对象。

四种模板分别为项目交接手册、运维操作手册、决策记录和术语与问答。审阅会检查模板中的每个章节。所有审阅均标为单人分阶段审阅。

## 固定项目捕获与刷新

填写明确的 VM ID、项目 ID、配置修订摘要和相对路径。预览固定 VM 创建身份、运行寿命、boot、项目根、配置和文件摘要。确认使用原票据，不会重新预览后悄悄替换输入。

捕获逐段以不跟随符号链接的文件描述符打开目录。文件必须是普通文件且没有额外硬链接。复制前后检查 inode、大小、时间和路径绑定。预览之后的字节、配置、路径或运行身份变化都会拒绝原计划。回执中的字节已经复制到有界暂存区，读取回执不会重新读取源文件。

捕获依赖已就绪的项目执行身份和客户机已有的 `/usr/bin/python3`。捕获流程不安装工具、不执行项目 setup、不执行用户材料，也不解析项目环境中的可执行声明。依赖缺失时返回失败。

选中原来源并启用“刷新左侧选中来源”，可按唯一文件名建立路径映射。HTTP 的 `refresh` 也可逐项指定路径、来源 ID 和预期修订。刷新创建新修订；旧引文仍指向旧字节。迁移引用先列出相同引文的候选，存在多处相同文字时必须人工选择。迁移不修改已有条目或文稿。

一致性声明为 `selected-file-copies`，只覆盖选定文件副本。该声明不等于跨文件事务或 Git 提交快照。

## 许可、容量和恢复

来源分别声明读取、索引、引用、发布和导出许可。内容修订与许可修订独立。修改许可先生成计划，列出来源修订及保护字节的持有者，再显式提交。查询在计分前过滤撤权来源，返回前再次校验；物理索引尚存也不会返回其片段和命中数。

材料与派生字节只由 sources 保存，其他插件通过公共接口访问。每个插件保存自己的元数据，不读取其他插件目录。所有写入先申请跨空间容量回执；失败且无法确认提交的回执继续计费。清理计划列出保护字节的对象，只有没有持有者的字节才可删除。归档保留历史，不能代替历史删除。

| 限制         | 当前值                                                  |
| ------------ | ------------------------------------------------------- |
| 空间数       | 最多 20 个，包括未完成的隔离空间                        |
| 知识总容量   | 12 GiB，包含持久内容、暂存和保守预留                    |
| 恢复记录预算 | 1 MiB，计入总量，供撤权、取消和清理记录使用             |
| 持久内容预算 | 10 GiB，包含字节与元数据；单空间全部来源修订最多 2 GiB  |
| 元数据预算   | 全局 256 MiB；单空间 32 MiB；未确认写入保守计费         |
| 来源数       | 单空间最多 2000 个来源 ID                               |
| 文本         | 单文件 8 MiB；单行 64 KiB；解析块 8 KiB                 |
| 固定计算     | 每材料 30 s；256 MiB 准入预算；输入、输出与块数另外限额 |
| 索引         | 每代最多 100,000 块；每批最多 256 块                    |
| 项目捕获     | 每批最多 32 MiB，暂存受宿主缓冲区预算管理               |
| 离线包       | 未编码总内容最多 16 MiB；上传 JSON 最多 24 MiB          |

项目捕获和包容量比设计上限更紧，原因是本版使用有界内存副本与 JSON 包，避免大对象占用宿主控制面。达到上限会失败，不截断材料。计算内存属于宿主准入与工作线程堆限制，不宣称限制整个宿主进程的物理内存。

解析和索引会保存任务记录，支持取消并等待工作线程退出。重启后未完成任务标为 `interrupted`；计划票据失效，需要重新预览。发布先构造完整输出，再原子切换活跃指针。写入中断不能激活半成品。

保守保留的容量、受引用保护的历史和未完成隔离空间不会被后台自动删除。清理界面只删除已经确认无引用的字节。实际磁盘空间不足可能使元数据落盘失败；恢复预算不保证抵御宿主其他程序耗尽磁盘。应保留原目录和回执，释放宿主空间后重新核对，不能把失败当作完成。

## 离线包格式与接收

格式标识为 `sakura-knowledge/1`。包是不压缩的 JSON，文件字节使用规范 Base64。只允许以下路径：

- `reading/document.html` 和 `reading/document.md`。
- `objects/knowledge.json`。
- `sources/<来源 UUID>-<修订>.txt`，仅可复核交接包包含。

每个文件记录路径、字节数、SHA-256 和内容。清单摘要只覆盖按路径排序的路径、长度和摘要三元组。规范元数据使用 UTF-8；对象字段按 Unicode 字符串比较顺序排序，数组顺序不变，不输出空白，不写入 `undefined`。字符串和数值采用 JSON 编码。未知字段、版本、额外文件、重复项、大小写冲突、非 NFC 路径和路径穿越会被拒绝。不支持压缩、符号链接或硬链接条目。

HTML 来自固定纯渲染函数。所有用户文本均转义，图片只显示替代文字和缺失提示。内容安全策略禁止脚本、联网、表单和远程资源。本机 UI 用文本组件显示文稿，不插入原始 HTML。

接收前先进入隔离区，重新计算清单、字节、对象图和解析位置。确认接收后创建新空间与新 ID。新空间在整个对象图完成前保持不可读；失败或崩溃保留隔离状态。接收后的导出许可默认关闭，不自动建索引或发布。

原包中的账号、作者和审阅属于未认证来源声明。接收端必须重新审阅，才能发布。阅读包缺少全文证据时，接收文稿会标为待核实。

可以删除隔离包字节并保留摘要回执。在“查看隔离记录与中断恢复”中，系统核对已完成空间与新 ID 映射；完成的接收补记回执，未完成的记录标为拒绝，不自动重放。未完成空间继续隔离并计入容量，可以删除原包字节后重新检查原包。软件不能撤回已经下载、复制或截图的内容。敏感内容检测也不能保证发现所有秘密。

## HTTP 与命令行

每个公开动作使用 `POST /api/knowledge-<领域>/<方法>`。读取动作也要求所有者与有效会话。空间 ID 放在严格请求正文中；不会从 UI 当前 VM 推断。请求与响应定义在 `shared/contracts/knowledge-http.ts`。所有方法都有独立操作策略，内部容量与字节服务不直接暴露为任意 HTTP 动作。

| 领域      | 方法                                                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sources   | createSpace、listSpaces、space、revokeSpace、listSources、getSource、upload、redact、planCapture、capture、read、verify、planPolicy、applyPolicy、capacity、planCleanup、cleanup |
| extract   | plan、run、get、list、jobs、cancel                                                                                                                                               |
| index     | plan、build、search、coverage、jobs、cancel                                                                                                                                      |
| evidence  | create、inspect、check、migrate、list                                                                                                                                            |
| entries   | create、revise、readPinned、list、compare、archive                                                                                                                               |
| documents | templates、create、revise、readPinned、list、compare、archive                                                                                                                    |
| reviews   | open、readPinned、decide、recheck、list                                                                                                                                          |
| publish   | plan、apply、read、withdraw、rollback、list                                                                                                                                      |
| exchange  | planExport、export、download、inspectImport、acceptImport、imports、discardImport                                                                                                |
| workbench | view、preferences、example                                                                                                                                                       |

CLI 是纯 Node 入口，不需要 `tsx`：

```powershell
$env:SAKURA_TOKEN = '<当前所有者令牌>'
node scripts/knowledge.mjs space create --name '项目交接'
node scripts/knowledge.mjs source upload --space '<空间 UUID>' --file README.md --allow-export true
node scripts/knowledge.mjs example --name '虚构项目' --template handover
node scripts/knowledge.mjs search --space '<空间 UUID>' --query '备份恢复'
node scripts/knowledge.mjs extract plan --input extract-request.json
node scripts/knowledge.mjs extract run --space '<空间 UUID>' --plan '<预览 token>'
node scripts/knowledge.mjs documents create --input document-request.json
node scripts/knowledge.mjs reviews open --input review-request.json
node scripts/knowledge.mjs reviews decide --input decision-request.json
node scripts/knowledge.mjs publish plan --input publish-request.json
node scripts/knowledge.mjs publish apply --space '<空间 UUID>' --plan '<预览 token>'
node scripts/knowledge.mjs exchange download --space '<空间 UUID>' --id '<导出 UUID>' --out handover.knowledge
node scripts/knowledge.mjs verify --file handover.knowledge
node scripts/knowledge.mjs import inspect --file handover.knowledge
node scripts/knowledge.mjs import accept --input acceptance.json
```

`extract-request.json` 的形状为：

```json
{ "spaceId": "<空间 UUID>", "sources": [{ "id": "<来源 UUID>", "revision": 1 }] }
```

固定读取使用 `spaceId`、`id`、`revision` 和 `purpose`。创建文稿包含 `title`、`template`、`applicability` 和 `sections`，每章包含 `heading`、`text`、`entries`、`citations`。修订操作另外提供 `id` 与 `expectedRevision`。审阅决定包含 `id`、`expectedRevision`、`decision`、`acknowledgements` 和非空 `note`。接收请求包含隔离记录 `id`、新空间 `name` 和 `acceptUnverified: true`。

CLI 将服务器失败和离线校验失败作为非零退出码。输出文件使用独占创建，不覆盖已有文件。`verify` 不联网，也不需要账号或运行中的 Sakura。它校验包内字节、对象关联和支持的解析定位；来源身份始终为未认证。

## 验证记录与集成边界

本模块已完成零 VM 的四模板流程验证，覆盖两种包的导出、离线复核和新 ID 接收。故障验证覆盖旧修订写入冲突、来源更新、字节篡改、危险包路径、撤权后的检索和发布、会话锁定，以及重启任务中断。另有 12 组故障验证覆盖严格字段校验、取消、消费者代次、发布写入失败、影子索引失败、接收中断、许可变化、容量耗尽、缺失认证身份、接收回执恢复和字节读取期间撤权；失败没有替换既有有效结果。

独立 HTTP 夹具通过了纯 Node CLI 的完整流程，包括上传、解析、索引、引用、文稿、审阅、发布、导出、隔离接收，以及鉴权拒绝和非法输入的非零退出码。在线 CLI 使用宿主受管网络；该夹具不代替完整应用的会话和账号权限验收。

独立创建的 1 GiB、2 vCPU 临时 VM 已验证固定捕获、同一来源刷新为新修订且原副本保留、路径替换为符号链接、预览后改字节、配置变化和运行寿命变化。测试使用的 VM 均已按原创建身份停止并核销。

全局版本、插件目录生成、服务描述符、HTTP Schema 汇总、CLI 分发、构建资产和导航由主任务统一整合。本模块交接清单位于本地 `artifacts/plugin-packs-2.7.0/knowledge/handoff.md`。领域测试通过不代替整包 UI、HTTP、打包和所有者权限的最终集成验收。
