# 数据契约管理插件包设计

## 1. 版本与用户结果

设计版本 5.0.0，日期 2026-10-25；应用基线 2.7.0 / `5726601`。包 ID 为 `data-contract-studio`，含 13 个拟议插件，运行实现待开始。共同规则见[第五批总览](plugin-pack-specialist-design.md)。

用户定义生产者和消费者之间的数据结构、业务含义、质量条件和演进规则，交付固定契约、影响分析及样本验证。首版处理 CSV、JSON 和 JSONL，使用本包有限类型系统；不声称兼容任意外部模式语言。

[数据工作台](data-lab.md)继续负责变换和实验，[数据库演练](database-evolution-pack-design.md)负责数据库迁移。本包增加双方约定、消费者兼容方向及接受决定，不连接生产数据库或修改实时数据。

## 2. 内部插件与直接依赖

短名统一补上 `dcontract-`，所有服务为拟议接口。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `dcontract-sources` 材料空间 | 根账本、契约原稿及许可；DcontractSourcesV1：upload、pin、inspect | — | — |
| `dcontract-schemas` 结构模式 | 字段类型、嵌套、可空和未知字段策略；DcontractSchemasV1：define、validate | sources | — |
| `dcontract-semantics` 业务语义 | 单位、时间含义、枚举和词汇定义；DcontractSemanticsV1：define、linkField | sources, schemas | — |
| `dcontract-rules` 数据规则 | 唯一性、范围、关联和有限跨字段条件；DcontractRulesV1：define、validate | sources, schemas, semantics | — |
| `dcontract-consumers` 消费档案 | 消费字段、解析要求、容错及版本范围；DcontractConsumersV1：define、checkRequirements | sources, schemas, semantics | — |
| `dcontract-versions` 契约版本 | 生产者声明、固定模式和适用消费者集合；DcontractVersionsV1：compose、preview、seal | sources, schemas, semantics, rules, consumers | — |
| `dcontract-compatibility` 演进分析 | 方向明确的兼容证明、反例及未知项；DcontractCompatibilityV1：compare、explain | sources, schemas, semantics, rules, consumers, versions | — |
| `dcontract-samples` 样本档案 | 固定记录、来源批次、抽样和敏感范围；DcontractSamplesV1：upload、profile、pin | sources, schemas | — |
| `dcontract-validations` 样本验证 | 检查任务、逐记录错误与覆盖；DcontractValidationsV1：preview、run、cancel、reconcile | sources, schemas, semantics, rules, versions, samples | — |
| `dcontract-reviews` 接受与例外 | 消费方意见、限时例外及争议决定；DcontractReviewsV1：prepare、decide、recordException | sources, consumers, versions, compatibility, validations | — |
| `dcontract-reports` 契约报告 | 版本矩阵、证据范围及未满足条件；DcontractReportsV1：assemble、seal | sources, versions, compatibility, validations, reviews | — |
| `dcontract-exchange` 契约交接 | 版本、样本及判断材料交换；DcontractExchangeV1：export、inspectImport、acceptImport | * | — |
| `dcontract-workbench` 契约工作台 | 字段、消费者、演进和问题定位；DcontractWorkbenchV1：view、templates | * | — |

消费者档案是用户声明，不能据此认定外部服务真正采用该模式。reviews 保存人工接受；compatibility 的技术结论不会因接受或例外而改写。

## 3. 完整使用流程

1. 选择“订单记录”“遥测记录”或“分析表交接”模板，导入原稿和固定样本。
2. 定义字段、空值和未知字段行为，补充单位、时区、枚举及字段含义。
3. 配置范围、唯一性和关联条件，逐消费者记录读取及解析需求。
4. 封存候选契约，与指定旧版按“新生产者到旧消费者”等明确方向比较。
5. 查看确定兼容、确定冲突和无法判断的变化；定位反例及受影响消费者。
6. 预览并运行样本检查，查看逐行错误、总体范围和未检查规则。
7. 记录消费者意见和例外，封存契约报告；例外不改写原检查失败。
8. 导出选定契约及允许交接的样本，隔离接受后重新检查；清理无保护引用的材料。

## 4. 兼容、样本与语义

首版类型包括布尔、定长范围整数、精确十进制、字符串、日期时间、数组和记录；十进制使用精确表示，禁止经浮点隐式改值。CSV 明确编码、分隔符、引号和空值标记。未知类型保留不支持结论。

`CompatibilityRequest` 固定源契约、目标消费规则及方向。旧消费者拒绝未知字段时，新增字段也可能不兼容；字段重命名不能靠名称相似自动认定等价。单位、时间语义及可空性改变需单独判定。

拟议 `DataContractCheckV1` 在有限规则范围内给出证明或反例。复杂约束无法推出结论时返回 inconclusive；不能仅因样本没有失败就声称所有未来数据兼容。报告分别列出静态分析和样本观察。

样本档案固定总体声明、实际行数、选择方法、批次及摘要。唯一性和外键检查注明全集范围；只有部分样本时不能声称跨全库唯一或引用完整。缺少对照集合须为未覆盖。

数据时效规则使用样本事件时间和显式比较时点，不读取当前时间隐式改变历史结果。解析时间缺少时区时拒绝需要绝对时刻的规则。验证错误默认展示有限字段，敏感列按样本声明遮盖。

契约封存不等于生产发布。人工接受绑定消费者档案与候选修订，来源撤权或引用改变后当前适用性失效；旧记录仍可作为当时决定的证据。

## 5. 页面、HTTP 与 CLI

页面包括字段树、语义词典、规则、消费者矩阵、版本差异、样本错误、审阅和交接。CLI 别名为 `data-contract`。

| 操作 | 拟议 POST 路径 | CLI（前缀 sakura） |
| --- | --- | --- |
| 封存契约 | `/api/dcontract-versions/seal` | `data-contract version seal` |
| 兼容比较 | `/api/dcontract-compatibility/compare` | `data-contract compatibility compare` |
| 样本计划/检查 | `/api/dcontract-validations/preview`、`/api/dcontract-validations/run` | `data-contract validation preview/run` |
| 记录例外 | `/api/dcontract-reviews/recordException` | `data-contract review exception` |
| 封存报告 | `/api/dcontract-reports/seal` | `data-contract report seal` |
| 交接 | `/api/dcontract-exchange/export` | `data-contract export`、`data-contract verify` |

## 6. 容量、异常与恢复

拟定上限：每契约 2000 个字段、500 条规则和 100 个消费者；单样本 64 MiB、200,000 条记录，单条 256 KiB，嵌套 16 层。单次验证 2 分钟，错误明细最多 10,000 条，保留总计和截断说明。包总额 2 GiB，封套 256 MiB。

结构损坏隔离整个输入批次；可定位的业务错误保留逐行报告。规则不支持、部分样本和验证中断均不得转为通过。全部错误数需完整扫描才能给出，截断明细不截断计数；扫描未完成则总计为下界。

## 7. 实施与验收

先实现模式、语义与消费档案，再实现有限兼容分析和样本工具，最后完成审阅报告及交换。

1. 三个模板均可完成契约、比较、样本检查、接受和交接。
2. 验证新增必填字段、未知字段、类型收窄、单位改变和字段重命名的方向差异。
3. 大整数和十进制边界保持精确，缺时区和空值标记不被静默转换。
4. 样本全部通过但静态兼容未知时，报告仍保留未知结论。
5. 部分样本无法证明总体唯一；错误明细截断和扫描中断分别表示。
6. 例外到期、旧修订决定、撤权和中断均能定位固定对象，不能改写历史。
7. 只启用本包即可离线完成流程，接收外来报告不产生生产发布权限。
