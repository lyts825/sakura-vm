# 第七批二十包使用指南

应用版本为 **2.12.0**，宿主插件 API 为 **5**。本批增加 20 个完整包、285 个内部插件和独立领域服务；当前完整目录为 486 个插件、46 个包。每个包提供独立工作台、固定模板、严格 HTTP、纯 Node CLI、原任务恢复及离线交接。默认选择仍为空，在插件中心选入需要的包后重启服务。

## 包与内部插件

包只组合成员；材料、定义、计算、审阅、版本及交换分别由表中链接列出的独立插件拥有。各新包之间没有必需依赖；四类客户机执行成员使用原基础项目能力。可以单独选入一个包，也可以选择完整兼容包。完整成员见[插件成员目录](seventh-plugin-members.md)；机器目录为源码中的 `shared/seventh-catalog.json` 与运行包中的 `.sakura-server/seventh-catalog.json`，具体请求与响应以生成契约为准。

| 序号 | 包 | 内部插件数 | CLI 别名 | 可完成的工作 | 完整内部插件 |
| --- | --- | ---: | --- | --- | --- |
| 1 | `data-quality-studio` · 数据质量工作室 | 15 | `quality-desk` | 数据剖析、质量规则、批次基线、精确十进制账目核对、问题与本地质量版本 | [成员、服务和直接依赖](seventh-plugin-members.md#data-quality-studio) |
| 2 | `lineage-atlas` · 数据血缘与影响分析 | 13 | `lineage-atlas` | 资产与字段映射、关系图、变更影响、调查记录及血缘证据版本 | [成员、服务和直接依赖](seventh-plugin-members.md#lineage-atlas) |
| 3 | `entity-resolution-studio` · 实体归并工作室 | 15 | `entity-desk` | 字段规范化、分块候选、比较器、受约束归并、可解释拆分和归并映射 | [成员、服务和直接依赖](seventh-plugin-members.md#entity-resolution-studio) |
| 4 | `temporal-data-studio` · 时间数据工作室 | 14 | `temporal-desk` | 固定时区分段、日历、时间对齐、区间、窗口和迟到数据规则 | [成员、服务和直接依赖](seventh-plugin-members.md#temporal-data-studio) |
| 5 | `geospatial-studio` · 地理数据工作室 | 15 | `geo-desk` | 坐标转换、几何检查、真实布尔叠加、缓冲区、空间连接和测量 | [成员、服务和直接依赖](seventh-plugin-members.md#geospatial-studio) |
| 6 | `graph-insight-studio` · 关系图分析工作室 | 14 | `graph-desk` | 节点与边投影、路径、连通分量、中心性、注释和图分析版本 | [成员、服务和直接依赖](seventh-plugin-members.md#graph-insight-studio) |
| 7 | `experiment-planner` · 对照实验规划 | 14 | `experiment-plan` | 固定假设、合成总体、分配、样本量、指标和有限重采样分析 | [成员、服务和直接依赖](seventh-plugin-members.md#experiment-planner) |
| 8 | `feature-engineering-studio` · 特征工程工作室 | 15 | `features` | 按训练分区拟合、缺失值与类别处理、数值转换、连接、窗口和特征产物 | [成员、服务和直接依赖](seventh-plugin-members.md#feature-engineering-studio) |
| 9 | `classical-training-lab` · 经典模型训练实验 | 15 | `trainlab` | 受隔离的真实分类、回归、聚类训练及预测、指标、比较和本地模型登记 | [成员、服务和直接依赖](seventh-plugin-members.md#classical-training-lab) |
| 10 | `constraint-solver-studio` · 约束求解工作室 | 14 | `solve` | 变量、域、约束、目标、真实混合整数求解、解验证及冲突分析 | [成员、服务和直接依赖](seventh-plugin-members.md#constraint-solver-studio) |
| 11 | `document-extraction-studio` · 文档结构提取 | 14 | `extractdoc` | PDF/图片页处理、真实 OCR、布局与表格、字段提取、修订和数据集 | [成员、服务和直接依赖](seventh-plugin-members.md#document-extraction-studio) |
| 12 | `design-system-studio` · 设计系统工作室 | 13 | `designsys` | 设计变量解析、主题和状态检查、图标检查、HTML/CSS 构建及本地审阅 | [成员、服务和直接依赖](seventh-plugin-members.md#design-system-studio) |
| 13 | `form-flow-studio` · 表单流程工作室 | 13 | `forms` | 字段和模式、条件图、页面可达性、合成样例、本地问答及表单版本 | [成员、服务和直接依赖](seventh-plugin-members.md#form-flow-studio) |
| 14 | `notification-template-studio` · 通知模板工作室 | 14 | `notifytpl` | 受限模板、语言覆盖、合成受众、规则、本地渲染、持久去重收件箱 | [成员、服务和直接依赖](seventh-plugin-members.md#notification-template-studio) |
| 15 | `schedule-semantics-lab` · 调度语义实验 | 14 | `schedule-lab` | 时间规则与队列语义模型、真实客户机调度探针、观测和检查报告 | [成员、服务和直接依赖](seventh-plugin-members.md#schedule-semantics-lab) |
| 16 | `extension-authoring-studio` · 社区扩展开发工坊 | 16 | `extension-forge` | 固定 C 到 WASM 编译、导入检查、有界试跑、真实签名及扩展封套 | [成员、服务和直接依赖](seventh-plugin-members.md#extension-authoring-studio) |
| 17 | `dependency-resolution-studio` · 依赖求解工作室 | 13 | `dependency-solve` | 版本与平台约束、特性选择、确定性依赖求解、锁定和证明核验 | [成员、服务和直接依赖](seventh-plugin-members.md#dependency-resolution-studio) |
| 18 | `protocol-state-lab` · 协议状态实验 | 15 | `protocol-state` | 消息语法、增量解析、状态与属性模型、真实 TCP 分片场景及缩减 | [成员、服务和直接依赖](seventh-plugin-members.md#protocol-state-lab) |
| 19 | `replica-sync-lab` · 副本同步实验 | 14 | `replica-lab` | 复制操作、向量时钟、冲突与合并策略、有界副本演算和一致性判断 | [成员、服务和直接依赖](seventh-plugin-members.md#replica-sync-lab) |
| 20 | `service-virtualization-studio` · 多服务模拟工作室 | 15 | `service-virtualization` | 多服务路由、共享状态、故障、真实 HTTP 交互、静止检查点与分支 | [成员、服务和直接依赖](seventh-plugin-members.md#service-virtualization-studio) |

## 从材料到结果

1. 在本包工作台创建空间，选择三个内置模板之一。模板是可编辑的完整输入，不能代替自己的材料和审阅。
2. 在“材料与版本”选择原材料提供者，上传普通文件。系统按原始字节分块保存并核对 SHA-256；文本上传不会转换 PDF、WASM 或图片字节。读取和导出许可分别管理。
3. 选择固定修订。引用格式为 `{domain,id,revision}`；只有本执行领域直接声明的提供者可以绑定。对 JSON 和结果记录明确选择字段路径，例如 `output.rows`，路径不会被系统猜测。二进制输入显式选择 base64。
4. 编辑方案后预览，核对完整解析输入、输入摘要、原修订及权限、工具身份和镜像预算。输入变化会使页面丢弃旧预览；服务端在提交和结果发布前复核原授权。
5. 执行原计划，在“运行与恢复”查看状态、结果、检查结论和清理。检查未通过也是可复查的业务结果。保存定义与封存修订分别操作；审阅只记录本次用途的意见。
6. 通过领域发布动作形成固定版本。版本只引用原证据，不把导入的意见当成本地批准。最后从交换入口导出选定的完整引用子图。

结构化编辑器按字段和列表编辑；高级 JSON 支持较深输入。结果表分页展示，折叠和预览上限不裁剪持久结果。切换空间、身份或插件代次会撤销原客户端并清除私有缓存。

## HTTP 与 CLI

每个内部插件使用 `POST /api/<插件ID>/<动作的短横线形式>`，鉴权沿用本机控制器或原账户令牌。请求和响应均采用同一正式模式；空间、固定引用、计划和清理票据不能由请求指定所有者或代次。

以下例子使用数据质量包。先保存 `create-space.json` 为 `{"name":"批次质量"}`，再运行：

```powershell
npm run sakura -- pack enable data-quality-studio
# 重启服务后
npm run sakura -- quality-desk spaces create create-space.json
npm run sakura -- quality-desk templates
npm run sakura -- quality-desk run-template <workspaceId> <返回的templateId>
npm run sakura -- quality-desk upload <workspaceId> D:\data\batch.json --export
```

其他固定方法采用 `sakura <别名> <领域> <动作> 参数.json`。例如 `profiles preview-action` 的输入为：

```json
{"workspaceId":"空间UUID","method":"compute","input":{"rows":[{"id":1}]},"references":[],"bindings":{}}
```

执行用 `execute-action`，只提交原 `workspaceId`、`planId` 和 `digest`。查询、取消和核对用原领域的 `status`、`cancel`、`reconcile`，参数为 `{"workspaceId":"空间UUID","planId":"原计划UUID"}`。同一个已完成计划重复提交返回原结果；消费后中断的计划不会自动重放业务。

普通上传支持 `--domain <本包材料领域>`、`--format <格式>`、`--resume <原上传ID>`；精确用法见当前 `help`。CLI 退出码：0 为操作完成，1 为已知业务失败，2 为输入或传输错误，3 为不确定或不支持，4 为清理未确认，130 为用户中断。执行成功仍应查看具体检查结论。

## 原生工具和客户机

训练、约束求解和文档提取使用随发行包核验的固定 CPython、领域依赖和 Windows AppContainer/Job 辅助程序。当前实际执行边界为 Windows x64。计划固定清单、Python 工作器和辅助程序三份摘要；执行时重新校验。客户机不能访问宿主私有文件或网络，工作目录和结果均有界，取消与超时等待原进程树退出。

同一安装目录一次运行一个宿主。并行开发或验证使用各自完整的工具目录副本，避免多个宿主同时增删工具 ACL；严格身份探针会拒绝校验期间发生的元数据变化。源码构建准备见[原生工具说明](../native/seventh-creation-sandbox/README.md)，发行安装直接使用包内副本。

调度、扩展编译、协议和多服务包分别使用四个固定客户机档案。镜像须经显式准备或导入；运行阶段使用隔离副本，默认断网。准备、续传、校验和选择镜像见 [固定工具镜像](seventh-tool-images.md)。实际工具版本记录在原会话回执，导入字节完整不能替代工具探针。

宿主默认套件总容量为 8 GiB。完整工具 VM 的虚拟磁盘、镜像和暂存需要更高预留；使用前根据计划预算显式配置 `SAKURA_SUITE_CAPACITY_BYTES`，例如本地顺序运行的验证环境使用 32 GiB。该配置不改变实际内存上限。每个客户机档案全局最多 1 个活动或未核销会话。

## 容量和计算边界

| 项目 | 当前实施边界 |
| --- | --- |
| 单个原始材料 | 256 MiB；分块 512 KiB |
| 单材料进入计算的解析绑定 | 1 MiB，较大材料可以保存和交接 |
| 完整解析计划 | 2 MiB、100 个直接固定引用、16 个字段绑定，字段路径最多 16 段 |
| 普通领域计算 | 每任务 448 MiB 受管线程预算，最多 60 秒；同一包单个计算分区 |
| WASM 试跑 | 固定隔离线程，最多 1 秒，可终止无限循环 |
| 原生工具 | 1 GiB Job 上限、独立 120 秒期限，暂存及解释器另记容量 |
| 离线交接 | 64 MiB，完整引用子图最多 1,000 个对象 |
| 本地通知去重 | 每空间最多 10,000 个历史去重键；未决意图继续占用键 |

领域输入还有各自严格上限。时间处理使用输入固定的时区分段；地理处理限定已实现的坐标类型与几何集合。实验分析记录估计方法及适用设计，数据不足或不支持时返回明确结论。特征拟合和训练保留训练分区，预测不能悄悄重新拟合。求解超时不声称最优；OCR 和版面提取保留页坐标及机器不确定性。

## 恢复、交接和升级

计划和任务结果保存在原领域。页面请求断开后按原计划查询；取消请求和资源清理分别确认。原生任务保留原意图、工具身份、Job 身份和结果核销；客户机任务保留精确 VM 身份、原输出摘要和清理回执。核对只处理原资源，清理不确定时继续保留预算和原关联。

交换先预览导出，再下载完整字节。新机器可用 `sakura <别名> verify <封套.zip>` 纯 Node 离线核验，无需服务、源码或 TypeScript。导入先上传及检查，再批准原接受计划；恢复沿用原上传和接受票据。完整性和可重算性分别记录，来源身份保持未经认证。批准、账号、活动 VM、进程、凭据和未决执行意图不迁移；缺少引用的子图会明确拒绝接受为完整任务。

升级沿用原插件命名空间和修订存储。旧五类执行服务继续使用冻结的旧 DTO，新增四类采用独立接口；新包的 22 个固定本体端口分别登记。停用或升级时先等待活动资源完成清理，未知资源保留原代次，不能把重新激活当作核销。

领域、整包、安装态的实际验收和 Git 版本记录见 [2.12.0 版本说明](release-2.12.0.md)。源码仓库另在 `PROJECT_STATUS.md` 记录版本和交付证据。
