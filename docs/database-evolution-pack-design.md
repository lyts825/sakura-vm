# 数据库变更演练插件包设计

## 1. 版本与使用结果

设计 3.0.0，2026-10-24；设计基线 2.7.0 / `912287a`。`database-evolution` 的 10 个插件已在 2.8.0 实施，并完成真实 PostgreSQL、服务代理、独立恢复及交接验证。实际入口、限制和验证边界见[数据库演进演练使用说明](database-evolution.md)。共同协议见[第三批总览](plugin-pack-suite-design.md)。下文保留原设计；容量和服务方法以使用说明及已生成契约为准。

用户在独立数据库副本中检查结构变更、数据回填、约束和恢复，取得逐阶段证据。本包不写入来源数据库，不切换生产连接，也不替代[应用包](app-runtime-pack.md)的数据恢复或[数据包](data-lab.md)的查询分析。

首版使用固定 PostgreSQL 17.11 运行档案，计划绑定工具摘要。输入为严格结构 JSON、CSV 和变更声明；不执行任意 SQL 脚本、原生数据库转储中的程序、扩展或宿主命令。

## 2. 内部插件与依赖

短依赖前缀为 `database-`。

| 插件 ID | 专属对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `database-sources` | 固定结构、合成/已审阅数据与来源许可；DatabaseSourcesV1：upload、generate、pin | — | @data-datasets |
| `database-schemas` | 类型、键、索引、约束和结构差异；DatabaseSchemasV1：validate、compare | sources | — |
| `database-changes` | 有序变更和回填声明；DatabaseChangesV1：compile、riskSummary | schemas | — |
| `database-fixtures` | 独立镜像副本、数据库和恢复基线；DatabaseFixturesV1：prepare、checkpoint、cleanupPreview、cleanup | sources, @projects | — |
| `database-runners` | 固定数据库工具、逐条操作意图与回执；DatabaseRunnersV1：preview、execute、cancel、reconcile | fixtures, schemas, changes | — |
| `database-checks` | 行数、键、约束、摘要和锁等待判定；DatabaseChecksV1：evaluate、explain | runners | — |
| `database-rehearsals` | 基线、变更、检查、独立恢复编排；DatabaseRehearsalsV1：preview、start、cancel、recover | fixtures, runners, checks | — |
| `database-reports` | 变更和恢复结论、可比性及证据；DatabaseReportsV1：seal、compare | rehearsals, checks | — |
| `database-exchange` | 变更、数据许可与报告交换；DatabaseExchangeV1：export、inspectImport、acceptImport | sources, schemas, changes, fixtures, runners, checks, rehearsals, reports | — |
| `database-workbench` | 结构差异、演练时间线、恢复和交接；DatabaseWorkbenchV1：view、templates | * | — |

fixtures 持有原 VM 与数据库资源。runners 仅取得绑定本次消费者、计划和动作范围的短期执行票据。查询到数据库名称不意味着可操作；跨插件不能通过手写票据访问副本。

## 3. 完整用户流程

1. 选择“新增字段与回填”“唯一约束冲突”或“失败后的独立恢复”，导入结构与合成数据。
2. 封存基线，填写有序变更；编译器列出数据丢失、不可逆动作、锁等待及支持缺项。
3. 选择固定预备镜像，显式创建隔离副本，确认初始结构和数据摘要。
4. 预览整个演练，批准后执行逐条变更和检查。发生错误按已保存策略停止后续变更。
5. 明确选择恢复：从固定基线创建新副本，读回数据和约束。逆向变更测试与基线恢复分开判定。
6. 封存结果、交接计划和证据，核销两个副本及原工具进程。

## 4. 变更语义与恢复模型

首版声明支持创建表、添加/重命名列、显式类型转换、创建索引、添加约束，以及固定表达式回填。删除操作必须单列并获得本次批准。编译器采用白名单语法，不把用户字符串拼接成标识符或 SQL。

工具只连接本次副本的私有数据库，使用专用账号；拒绝程序执行、外部连接和未声明扩展。事务能力按动作记录，不承诺所有变更可统一回滚。每条动作保留 `intent → sent → observed/unknown`，响应丢失时只检查原数据库事实，不自动重试写入。

检查使用固定类型和规范编码。主键、空值、精确小数、时区及排序规则写入摘要算法版本。不能用首行或抽样相同证明全表相同；若选择抽样模式，报告明确标记覆盖范围。无稳定主键时，只允许声明的有界多重集合校验。

恢复回执绑定基线磁盘、来源创建身份和新副本身份。旧副本存在未知写入时保留原记录，不能把新副本通过推导为旧副本已清理。恢复后的行集合必须来自原基线，不能再次生成样例冒充恢复。

## 5. 入口与资源边界

页面包含来源、结构、变更、演练、恢复、报告和待处理资源。CLI 别名为 `database`。

| 操作 | 拟议 HTTP | CLI | 输出 |
| --- | --- | --- | --- |
| 结构/变更检查 | `/api/database-schemas/compare`、`/api/database-changes/compile` | `database schema compare`、`database change compile` | 类型差异、顺序、危险动作 |
| 演练预览/执行 | `/api/database-rehearsals/preview`、`start` | `database rehearsal preview/start` | 固定阶段、预算、执行回执 |
| 独立恢复 | `/api/database-rehearsals/recover` | `database rehearsal recover` | 新计划、原基线、新实例及检查 |
| 核销/交接 | `/api/database-fixtures/cleanup`、`/api/database-exchange/export` | `database fixture cleanup`、`database export` | 原资源证明与导出材料 |

原设计拟定输入 2 GiB、100 张表、每表 128 列、总计 1,000,000 行；变更最多 200 步。单条动作 60 秒、锁等待 5 秒、一次演练 30 分钟。最多两个 2 vCPU / 2 GiB 副本，每台虚拟磁盘 24 GiB；总持久与暂存 64 GiB，导出 2 GiB。实施已收紧这些上限，实际以[使用说明的容量表](database-evolution.md#实际容量与验证范围)为准。全部数据导出须重新确认许可。

## 6. 实施与验收

先完成结构/变更纯校验，再实现 DatabaseRehearsalV1 与副本委派门禁，最后接通恢复、报告、工作台与交换。直接调用现有通用数据库命令不能代替专用票据和停止证明。

必须实测：三个模板、约束失败不继续执行、类型转换的数据损失检测、锁超时、取消、客户端断线后的未知写入、宿主重启后只读核对、新副本恢复、同名数据库身份变化拒绝、配额耗尽和导入重复接受。停用期间不能释放未确认的副本额度。

包的通过结论只覆盖指定数据库档案和固定数据规模。生产变更执行、在线同步、跨引擎迁移和生产回滚不属于本版验收范围。
