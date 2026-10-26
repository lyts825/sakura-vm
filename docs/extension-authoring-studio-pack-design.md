# 社区扩展开发工坊插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；应用保持 2.8.1，核对基线为 `4afb3b9a`。包 ID 为 `extension-authoring-studio`，含 16 个拟议插件，运行实现待开始。共同约定见[第七批总览](plugin-pack-seventh-design.md)。

用户从纯计算模板创建社区扩展，编辑声明与源码，受控编译、检查应用二进制接口、运行用例，并核对外部签名。最终交付固定 WASM、目录条目、扩展表单、执行证据和签名候选包。

目标严格沿用[现有社区协议](community-plugins.md)。本包自身是官方 API 5 插件集合，所生产的社区扩展使用独立 WASM 协议；两者权限和版本分别管理。目录信任、安装、订阅与卸载仍由原社区管理器负责。

## 2. 内部插件与直接依赖

每个服务均为拟议 V1。表中列出全部直接依赖；`@projects` 表示基线插件。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `extforge-spaces` 开发空间 | 空间授权、模板修订和额度根账本；ExtforgeSpacesV1：create、list、archive | — | — |
| `extforge-sources` 源码材料 | 固定源码树、文件修订和源摘要；ExtforgeSourcesV1：upload、edit、pin | `extforge-spaces` | — |
| `extforge-manifests` 扩展声明 | 插件标识、版本、描述和发布者公钥引用；ExtforgeManifestsV1：save、validate、seal | `extforge-spaces` | — |
| `extforge-interfaces` 表单接口 | 路由、面板、字段及输入约束；ExtforgeInterfacesV1：save、preview、seal | `extforge-spaces`, `extforge-manifests` | — |
| `extforge-toolchains` 工具档案 | 固定离线编译器、SDK、参数与支持范围；ExtforgeToolchainsV1：importProfile、inspect、seal | `extforge-spaces` | — |
| `extforge-builds` 受控编译 | 专属客户机、构建意图、WASM 与诊断字节；ExtforgeBuildsV1：preview、start、cancel、reconcile | `extforge-spaces`, `extforge-sources`, `extforge-toolchains`, `@projects` | — |
| `extforge-inspections` 模块检查 | 导入、导出、内存、函数表及大小判断；ExtforgeInspectionsV1：inspect、explain | `extforge-spaces`, `extforge-builds` | — |
| `extforge-cases` 用例材料 | JSON 输入、结果断言、边界与错误期望；ExtforgeCasesV1：save、validate、seal | `extforge-spaces`, `extforge-interfaces` | — |
| `extforge-trials` 沙箱试运行 | 固定产物的原调用、输出和清理回执；ExtforgeTrialsV1：preview、run、cancel、reconcile | `extforge-spaces`, `extforge-builds`, `extforge-inspections`, `extforge-cases` | — |
| `extforge-signatures` 签名核对 | 待签字节、公钥指纹、外部签名及验证结果；ExtforgeSignaturesV1：prepareEnvelope、importSignature、verify | `extforge-spaces`, `extforge-manifests`, `extforge-interfaces`, `extforge-builds` | — |
| `extforge-bundles` 发行候选 | WASM、目录条目、相对 URL 与不可变版本集合；ExtforgeBundlesV1：assemble、validate、seal | `extforge-spaces`, `extforge-manifests`, `extforge-interfaces`, `extforge-builds`, `extforge-inspections`, `extforge-signatures` | — |
| `extforge-reviews` 发布审阅 | 用例结论、描述适用性、未覆盖项和人工决定；ExtforgeReviewsV1：review、compare、seal | `extforge-spaces`, `extforge-inspections`, `extforge-trials`, `extforge-bundles` | — |
| `extforge-reports` 开发报告 | 构建环境、检查、试运行和审阅证据；ExtforgeReportsV1：assemble、seal | `extforge-spaces`, `extforge-builds`, `extforge-inspections`, `extforge-trials`, `extforge-signatures`, `extforge-bundles`, `extforge-reviews` | — |
| `extforge-exchange` 工坊交接 | 源码、开发档案和发行候选的隔离交换；ExtforgeExchangeV1：export、inspectImport、acceptImport | `extforge-spaces`, `extforge-sources`, `extforge-manifests`, `extforge-interfaces`, `extforge-toolchains`, `extforge-builds`, `extforge-inspections`, `extforge-cases`, `extforge-trials`, `extforge-signatures`, `extforge-bundles`, `extforge-reviews`, `extforge-reports` | — |
| `extforge-catalogs` 目录预演 | 多候选目录、版本碰撞和同源路径检查；ExtforgeCatalogsV1：compose、validate、exportCatalog | `extforge-spaces`, `extforge-manifests`, `extforge-bundles`, `extforge-reviews` | — |
| `extforge-workbench` 开发工作台 | 源码、表单、构建、用例、签名和目录导航；ExtforgeWorkbenchV1：view、templates | `extforge-spaces`, `extforge-sources`, `extforge-manifests`, `extforge-interfaces`, `extforge-toolchains`, `extforge-builds`, `extforge-inspections`, `extforge-cases`, `extforge-trials`, `extforge-signatures`, `extforge-bundles`, `extforge-reviews`, `extforge-reports`, `extforge-exchange`, `extforge-catalogs` | — |

catalogs 的最终目录独立导出，不被 exchange 的开发档案隐式收集。工作台必须分别显示开发档案、单扩展发行候选和目录三种产物。

## 3. 模板与完整流程

| 模板 | 初始计算 | 必备边界用例 |
| --- | --- | --- |
| JSON 字段摘要 | 固定字段计数和缺失统计 | 空输入、超深 JSON 与输出越界 |
| 单位换算表单 | 数值及明确单位换算 | 非有限数、未知单位和精度说明 |
| 任务事件分类 | 固定元数据分类和结果标签 | 缺少字段、未知事件种类与幂等输入 |

1. 创建空间，选择模板并编辑纯计算源码与插件声明。
2. 定义路由和纯表单面板，预览输入映射，不执行任意前端脚本。
3. 固定离线工具档案，预览源码、参数、预算及目标 WASM 配置。
4. 在专属客户机编译，保留原诊断；核销原构建资源后固定产物摘要。
5. 检查模块结构，通过后在受限沙箱逐用例运行并比较结果。
6. 固定发行字段，导出准确待签字节；由用户在外部完成签名，再导入签名及公钥核验。
7. 审阅用例与能力说明，封存有有效签名的发行候选，生成目录 JSON。
8. 导出开发档案或目录候选，离线核验；用户后续通过原管理器独立登记信任与安装。

## 4. 协议与本体边界

首版编译模板采用固定的 C 子集与离线 SDK。源码只能进入新建专属客户机；编译器、参数白名单、头文件和 SDK 摘要进入工具档案。用户不得上传构建脚本来调用宿主工具，不读取宿主环境变量或任意目录。

目标必须满足当前社区边界：WASM 不超过 512 KiB，无宿主导入或函数表；导出有最大值的 memory、`alloc(i32): i32` 和 `run(i32, i32): i32`。memory 最大 256 页，即 16 MiB。结果地址指向 4 字节小端长度和 JSON 字节。

试运行输入最多 32 KiB，输出最多 64 KiB，单次 1 秒；并发最多 4，且服从宿主更严格额度。路由最多 8 个，面板最多 4 个，每面板最多 8 个文本、数字或布尔字段。工坊不得放宽这些既有限制。

签名原文及字段顺序完全沿社区协议，含扩展时使用对应规范序列化。签名核对只接收公钥、签名与固定字节，不接收私钥。改变名称、版本、产物摘要或表单后，原签名立即失效。

未签产物可作为开发草稿导出，明确标记不可安装；完整发行候选必须验签成功。签名通过只证明来源与字节匹配，试运行通过只覆盖所选用例。目录 URL 的真实 HTTPS 可达性留给原管理器验证。

拟议本体接口 `ExtensionBuildSessionsV1` 负责固定编译和原 VM 核销；`ExtensionTrialRuntimeV1` 提供复用原社区限制的候选试运行。当前社区运行入口要求已安装插件，不能假设已经支持未安装产物试跑。

## 5. 页面、HTTP 与 CLI

页面按源码、声明、接口、构建、模块检查、用例、签名、审阅和目录分组。错误定位到文件或声明路径；敏感签名操作只展示待签字节和公钥指纹，不提供私钥输入框。

| 拟议 HTTP | 对应服务方法 | 用途 |
| --- | --- | --- |
| `POST /api/extforge-builds/preview` | ExtforgeBuildsV1.preview | 固定源码与工具计划 |
| `POST /api/extforge-builds/start` | ExtforgeBuildsV1.start | 执行原计划编译 |
| `POST /api/extforge-inspections/inspect` | ExtforgeInspectionsV1.inspect | 检查产物结构与限额 |
| `POST /api/extforge-trials/run` | ExtforgeTrialsV1.run | 执行已检查候选的固定用例 |
| `POST /api/extforge-signatures/prepareEnvelope` | ExtforgeSignaturesV1.prepareEnvelope | 生成准确待签字节与摘要 |
| `POST /api/extforge-signatures/importSignature` | ExtforgeSignaturesV1.importSignature | 导入外部签名并绑定原候选 |
| `POST /api/extforge-catalogs/exportCatalog` | ExtforgeCatalogsV1.exportCatalog | 导出已审阅目录，不上传 |

CLI 拟为 `sakura extension-forge`，提供 source、manifest、build、inspect、trial、signing-envelope、signature、bundle、catalog 和 verify。产物下载使用独立有界路径；所有读写都沿 owner 会话策略。

## 6. 容量、恢复与交接

设计上限为每空间 100 个候选、单源码树 256 文件/8 MiB、单文件 256 KiB、每候选 200 条用例。每次编译最长 120 秒，单空间最多 1 个编译；诊断保留最多 4 MiB，截断必须标记。

包持久上限拟为 512 MiB，含 32 MiB 恢复账本。工具镜像、原 VM、构建暂存、WASM、试运行流及导出暂存均计入对应所有者；新增包尚未接入现有 8 GiB 共同准入。额度不足不启动编译。

跨服务封存固定来源修订，先持久化意图。编译或试运行中断保留原任务，重新连接查询原票据；未知动作不重发。取消、撤权和插件停用均先停新准入，再确认原 worker、进程及 VM 退出。

交接采用 `sakura-extension-authoring-studio/1`。源码档案、签名候选与目录分别标记种类；接收不自动信任发布者、安装插件、运行源码或登记调度。导入的历史用例结果标为外来声明。

升级保留旧源码、产物、签名原文和协议版本，不能重新序列化旧签名后声称仍有效。清理须复核发行候选对产物的保护引用；归档不删除可复查的签名材料。

## 7. 实施与验收

实施先完成源码及声明，再实现固定编译、候选沙箱和交接。真实编译及试跑通过前，工坊保持未完成；外部签名使用公开测试公钥与真实签名材料验证。

| 场景 | 必须观察的结果 |
| --- | --- |
| 三个模板编译 | 固定离线工具输出可检查 WASM，SDK 版本与实际工具回执一致 |
| ABI 和资源越界 | 导入宿主函数、函数表、无最大内存或超大产物均拒绝试运行 |
| 沙箱异常 | 越界地址、非法 JSON、超时和超长结果分别报告，原 worker 确认退出 |
| 扩展声明 | 未声明路由或第 9 个字段明确拒绝，不生成有效候选 |
| 签名绑定 | 修改一项签名字段后核验失败；旧签名不绑定新产物 |
| 未签与已签导出 | 未签只导出草稿，有效签名和审阅后才显示安装候选 |
| 目录预演 | 重复版本、跨源绝对 wasmUrl 和路径穿越拒绝；不向外上传 |
| 中断与导入 | 未知构建不重跑，导入不执行；升级失败仍保留原签名字节 |
