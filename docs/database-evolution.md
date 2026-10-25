# 数据库演进演练

## 用途与插件

`database-evolution` 是 2.8.0 的实验性插件包。它在独立 PostgreSQL 副本中执行固定声明，核对全部选定数据，并从实际读回的基线恢复到新副本。生产数据库连接、任意 SQL、扩展、原生转储程序和宿主命令不属于本包入口。

| 插件                  | 功能                                                   |
| --------------------- | ------------------------------------------------------ |
| `database-sources`    | 上传 JSON、CSV，生成合成数据，明确审阅输入及材料许可。 |
| `database-schemas`    | 验证结构、列类型、键、索引和结构差异。                 |
| `database-changes`    | 编译有序声明，标注删除、覆盖和类型转换风险。           |
| `database-fixtures`   | 预览、创建、取消和核销独立副本，保存原工具回执。       |
| `database-runners`    | 执行固定变更，读取原状态，批准独立恢复。               |
| `database-checks`     | 核对完整数据摘要、步骤覆盖、失败和未知写入。           |
| `database-rehearsals` | 保存变更、检查和恢复之间的固定引用。                   |
| `database-reports`    | 封存已核销的结果，比较基线和最终摘要。                 |
| `database-exchange`   | 导出完整引用图，隔离接收外来声明。                     |
| `database-workbench`  | 提供模板、操作页面、固定修订与待处理资源入口。         |

## 准备与执行

在插件管理中安装整包，再打开“数据库演进演练”。工作台提供“新增字段与回填”“唯一约束冲突”和“转换失败与独立恢复”三个示例。选择示例只填入声明；生成数据、创建副本、执行和恢复均需明确操作。

先创建工作区，再生成合成数据或上传材料。JSON 输入必须符合 `sakura-database-dataset/1`，CSV 必须提供单表结构，首行按顺序列出全部列名。CSV 空值固定写成 `\N`。整数和精确小数使用 JSON 字符串，布尔值使用 JSON 布尔值，时间戳使用 UTC ISO 字符串。

验证固定输入后，编译变更声明。支持建表、增列、列改名、无损类型转换、删列、索引、主键、唯一约束和非空约束。回填表达式限于常量、列复制、大小写转换和 `coalesce`。示例如下：

```json
[
  {
    "kind": "add-column",
    "table": "accounts",
    "column": { "name": "email_normalized", "type": "text", "nullable": true }
  },
  {
    "kind": "backfill",
    "table": "accounts",
    "column": "email_normalized",
    "expression": { "kind": "lower", "column": "email" },
    "onlyNull": true
  },
  {
    "kind": "add-constraint",
    "table": "accounts",
    "constraint": { "name": "normalized_required", "kind": "not-null", "columns": ["email_normalized"] }
  }
]
```

副本使用已准备的镜像资产及其 SHA-256。固定工具档案要求 PostgreSQL 17.11，以及 `python3`、`postgres`、`initdb`、`pg_ctl` 和 `psql`。本版已在 Alpine 3.23 的官方 PostgreSQL 17.11 包和 Python 3.12.15 上验证。镜像准备阶段可以明确联网安装工具，执行阶段关闭外网。

准备镜像时，先在专用副本中安装工具，再清除该副本的首次启动缓存，并重新启用 `tiny-cloud-boot`、`tiny-cloud-early`、`tiny-cloud-main` 和 `tiny-cloud-final`。Sakura 的首次启动优化会停用这些服务，直接捕获已启动的磁盘会使新副本无法读取自己的启动身份。镜像工厂已提供同类固定重置流程。不要修改用户已有实例或原镜像。

批准“创建基线”后，读取原副本状态。工具启动私有 PostgreSQL 集群，加载固定数据，读回结构、索引、约束及全部行。只有基线完成后，才能预览变更。每条操作单独提交，第一条失败后停止后续操作。删除列或覆盖全部行需要本次明确勾选确认。

## 检查、恢复与清理

检查展示 `passed`、`failed` 或 `inconclusive`，同时单独展示资源清理状态。尚未收到完整工具结果时，不能认定写入成功。取消只停止原执行；核销只处理原副本和原进程，不重发数据库写入。工作区撤权、来源材料撤权和原消费者代次变化都会阻止继续访问。

类型转换先在实际数据库内做往返比较，丢失精度或改变值时拒绝转换。私有数据库设置锁等待和语句超时。工具只使用受限声明生成标识符和表达式，通过私有 Unix 套接字连接；数据库角色不具备超级用户、建库或创建角色权限。

独立恢复使用原工具捕获的完整逻辑基线。恢复计划固定原基线摘要，在新的虚拟机中重建数据库，再比较全部行、列类型、键、约束和索引。无主键的表按完整行多重集合比较，保留重复行。新副本通过恢复检查，不会把旧副本的清理状态改为已确认。

本版恢复证据类型为 `canonical-logical-baseline`，不是磁盘快照恢复。摘要算法为 `postgres-canonical-rows-v1`，覆盖全部选定数据，使用 UTF-8、UTC 和 C 排序规则。报告明确记录这两项边界，也不构成生产变更批准。

关闭尚未执行的批准预览时，工作台释放该预览的输入额度。清理记录前先归档，存在保护引用时拒绝删除。最后一个副本修订清理时，才释放原执行的持久输入和输出。原虚拟机清理未确认时，相关资源和额度继续保留。

## 报告与交接

封存报告要求检查对应同一固定运行窗口，且原副本已核销。失败或不确定结果可以封存，但不能改写为通过。填写实际观察和未解决项后，再批准导出原始材料的许可。

交接只接受封存报告作为导出根，携带其完整引用图和获准的材料字节。导出投影移除执行计划、会话票据、虚拟机身份和进程凭据。接收端生成新对象 ID，并把结果标为来源声明。外来报告不能取得本机执行权限，也不能替代本机数据库检查。

离线核验检查封套、摘要、引用闭合、声明编译结果、完整行摘要、步骤覆盖和报告一致性。核验通过只证明交接内部一致，不认证发送方身份或原工具确实执行。

## HTTP 与命令行

HTTP 方法均为经过认证的 `POST /api/database-<领域>/<动作>`。动作使用短横线形式，例如 `seal-report`、`preview-restore` 和 `discard-preview`。请求、响应和读写策略来自 `shared/contracts/database-http.ts`。

```text
sakura database help
sakura database sources generate 参数.json
sakura database schemas validate 参数.json
sakura database changes compile 参数.json
sakura database fixtures prepare 参数.json
sakura database fixtures checkpoint 批准.json
sakura database runners preview 参数.json
sakura database runners execute 批准.json
sakura database runners inspect 参数.json
sakura database checks evaluate 参数.json
sakura database runners preview-restore 参数.json
sakura database runners restore 批准.json
sakura database reports seal-report 参数.json
sakura database verify 交接.zip
```

以 CLI 帮助列出的动作拼写为准。批准请求包含 `workspaceId`、`planId` 和 `digest`；固定引用包含 `domain`、`id` 和 `revision`。离线命令只依赖完整运行包的编译核验器，不启动数据库或请求网络。

## 实际容量与验证范围

首版每份材料最多 8 MiB，工作台文本上传最多 1 MiB，较大文件使用分块上传。结构最多 20 张表、每表 32 列，所有表合计最多 5,000 行。一个变更最多 50 步，单行单元格最多 4,096 个字符。交接包最多 16 MiB。

固定运行档案使用 2 vCPU、2 GiB 内存和有界虚拟磁盘。计划同时核算镜像、虚拟磁盘、输入和输出，仍受本体共享容量限制。单次执行最长 600 秒，单条语句默认 10 秒，锁等待默认 2 秒。达到上限会拒绝新计划或保留不确定结果，不截取首行来声称完整校验。

这些限制收紧了设计阶段的容量设想。真实 PostgreSQL 验证覆盖全部八类声明操作、唯一冲突、有损转换、锁超时、时间精度及完整基线恢复；5,000 行容量验证通过独立执行和恢复副本，完整输出分片读回且两台副本均已核销。真实服务代理另外贯通基线创建、变更、检查、独立恢复及报告交接。

领域验证覆盖重复批准、并发重入、预览撤销、来源撤权、未知运行核销及其固定基线恢复、交接字节与隔离导入。页面验证覆盖显式批准、撤销和撤权后的迟到响应。具体本地验证材料保存在被 Git 忽略的 `artifacts/plugin-packs-2.8.0/`，正式仓库只保留验证结论。

PostgreSQL 的连接与初始化行为参见 [17 版连接设置](https://www.postgresql.org/docs/17/runtime-config-connection.html)、[initdb](https://www.postgresql.org/docs/17/app-initdb.html) 和 [trust 认证](https://www.postgresql.org/docs/17/auth-trust.html)。包来源可在 [Alpine 官方软件包索引](https://pkgs.alpinelinux.org/packages?branch=v3.23&name=postgresql%3F%3F) 核对。
