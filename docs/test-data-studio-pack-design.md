# 合成测试数据插件包设计

## 1. 版本与使用结果

设计版本 4.0.0，日期 2026-10-25。核对基线为应用 2.7.0 / `237d7bc`，工作区中的 2.8.0 实施另行验收。包 ID 为 `test-data-studio`，含 12 个拟议插件，运行实现待开始。共同规则见[第四批总览](plugin-pack-next-design.md)。

用户编写字段模式、实体关系和场景，生成可重复的测试数据版本，检查约束并导出给测试环境。结果包括生成配方、固定种子、关系覆盖、预期故障及导出文件。首版完整流程使用人工定义和合成字典，无需连接生产数据库。

[数据工作台](data-lab.md)继续管理既有数据的导入、变换和分析；本包管理生成规格、关系分配、边界样例和预期非法数据。[接口验证](integration-lab.md)可以显式接收导出材料，其运行与断言仍由原包负责。跨包导入不会自动取得目标写入权限。

首版输出 UTF-8 CSV 和 JSONL，支持标量字段及多表引用。固定生成算子涵盖序列、枚举、范围、日期、字符串模板和显式权重。任意脚本、数据库写入、真实账户注册和模型生成不在首版范围。

## 2. 内部插件与直接依赖

下表服务、方法和入口均为拟议接口。完整依赖使用精确插件 ID，`—` 表示无依赖；公共读写、保护引用和清理方法遵循总览。

| 插件 ID | 自有对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `testdata-schemas` | 工作空间、实体字段、类型和局部约束；TestdataSchemasV1：validate、seal、compare | — | — |
| `testdata-dictionaries` | 合成值字典、来源说明和使用许可；TestdataDictionariesV1：upload、inspect、seal | `testdata-schemas` | — |
| `testdata-relations` | 主外键、基数、生成顺序和循环关系规则；TestdataRelationsV1：validate、compile、explain | `testdata-schemas` | — |
| `testdata-recipes` | 算子、权重、种子、数量和分区规则；TestdataRecipesV1：validate、preview、seal | `testdata-schemas`、`testdata-dictionaries`、`testdata-relations` | — |
| `testdata-scenarios` | 边界组合、预期非法项和场景覆盖目标；TestdataScenariosV1：compose、validate、coverage | `testdata-schemas`、`testdata-relations`、`testdata-recipes` | — |
| `testdata-generators` | 有界生成任务、候选字节及逐分区回执；TestdataGeneratorsV1：preview、start、cancel、reconcile | `testdata-schemas`、`testdata-dictionaries`、`testdata-relations`、`testdata-recipes`、`testdata-scenarios` | — |
| `testdata-datasets` | 固定数据版本、分区清单和生成来源；TestdataDatasetsV1：adopt、inspect、compare | `testdata-schemas`、`testdata-generators` | — |
| `testdata-checks` | 全量约束结果、故障匹配和未覆盖项；TestdataChecksV1：evaluate、explain、compare | `testdata-schemas`、`testdata-relations`、`testdata-scenarios`、`testdata-datasets` | — |
| `testdata-profiles` | 实际分布、关联统计和代表性说明；TestdataProfilesV1：measure、compare、explain | `testdata-schemas`、`testdata-recipes`、`testdata-datasets` | — |
| `testdata-releases` | 交付清单、用途标签、检查及分布接受决定；TestdataReleasesV1：preview、accept、seal | `testdata-schemas`、`testdata-recipes`、`testdata-scenarios`、`testdata-generators`、`testdata-datasets`、`testdata-checks`、`testdata-profiles` | — |
| `testdata-exchange` | 配方、数据和检查封套及隔离接收；TestdataExchangeV1：export、inspectImport、acceptImport | `testdata-schemas`、`testdata-dictionaries`、`testdata-relations`、`testdata-recipes`、`testdata-scenarios`、`testdata-generators`、`testdata-datasets`、`testdata-checks`、`testdata-profiles`、`testdata-releases` | — |
| `testdata-workbench` | 模板、关系图、预览、故障清单和交接；TestdataWorkbenchV1：view、templates | `testdata-schemas`、`testdata-dictionaries`、`testdata-relations`、`testdata-recipes`、`testdata-scenarios`、`testdata-generators`、`testdata-datasets`、`testdata-checks`、`testdata-profiles`、`testdata-releases`、`testdata-exchange` | — |

工作空间及容量账本归 schemas。生成任务拥有候选字节，datasets 通过原生成服务的受控发布接口接受固定副本，并建立来源保护。原任务未完成时不能登记完整数据版本。导入数据由 datasets 保存，生成来源保持“外来声明”，不伪造本地生成回执。

## 3. 完整用户流程

1. 新建空间，选择“用户与订单”“边界与空值”或“故意损坏的关系”模板。
2. 固定字段类型、空值、范围、精度及编码，建立主键、外键和实体基数。
3. 选择合成字典和生成算子，设置数量、种子、时区及分区顺序，检查约束是否可满足。
4. 增加边界和故障场景，明确哪些行、哪些规则应当失败；查看覆盖目标及预计数据量。
5. 预览小样，随后批准完整生成计划。小样与全量分别记录，不能从小样推断全量约束通过。
6. 接受完整候选版本，执行全量约束检查和实际分布测量，核对所有预期故障。
7. 审阅分布偏差和未覆盖组合，确认生成、检查及分布任务和暂存已核销，再封存带用途标签的数据交付版本。
8. 导出数据、配方和证据，接收端离线核验；传输结束后核销传输租约，并保存交接回执。

## 4. 模式、生成与数据含义

`EntitySchema` 固定类型、格式、精度、字段约束及行标识规则。`RelationGraph` 记录实体关系和基数，主外键由确定性分配器产生。首版允许可预分配标识的循环关系；依赖未知生成值的循环必须拒绝，并返回循环路径。

`GenerationRecipe` 固定算子实现摘要、种子、数量、字典、时区和顺序规则。重复性要求这些输入全部一致；仅种子相同不足以承诺相同字节。分区编号参与确定性派生，重试同一分区不能重复发布或改变其他分区。

`ScenarioSpec` 区分合法边界与预期非法项。每项故障记录目标行、字段、规则和期望错误类别。`CheckReport` 分开呈现意外违规、预期违规命中及未命中故障；合法版本要求没有意外违规，故障版本还须覆盖全部必需故障。

`DistributionProfile` 报告实际值域、空值、频次和关系覆盖。有限随机样本可以偏离配方权重，验收容差必须先固定。没有真实业务分布依据时，只能说明符合生成规格，不能宣称代表生产流量或业务人群。

用户上传的字典可能包含个人数据。字典保留来源及许可，导出默认列出实际使用的字典字段；合成生成不自动构成匿名化证明。首版不提供“保证匿名”标签，也不使用名称或邮箱格式推断内容安全。

生成、检查和分布计算使用拟议 `SyntheticDataComputeV1` 固定算子接口。接口需要行数、字节、内存、关系边数和截止预算，禁止脚本、网络及任意路径读取。实现必须以独立工作线程或等效受管执行单元提供可确认终止，普通请求超时不能作为清理证明。

CSV 导出明确分隔符、引号、空值和公式处理策略。需要供电子表格查看时生成独立的转义派生版本，并记录变换；原始测试字符串保持原值。故障用例中的公式、路径或脚本始终作为数据，不触发宿主执行。

定义采用 draft → sealed → archived。候选生成采用 queued → running → finalizing → completed，失败与取消单列。交付采用 candidate → reviewed → accepted/declined；任何输入、容差或故障目标改变都产生新修订。导入包中的接受决定不会生效为本地审阅。

releases 接受交付前须核对固定任务的清理回执。未确认时只保留待清理的候选报告；新回执产生新修订，不覆盖旧记录。执行任务回执随交付封存，导出传输的核销另存后续交接账本，封套不包含自身传输完成证明。

## 5. 页面、HTTP 与 CLI

页面包含字段编辑、关系图、配方、场景、生成进度、数据预览、约束与分布、交付和交换。预览最多显示有限行，始终标明总行数和分区数。CLI 别名为 `testdata`，以下命令前缀均为 `sakura`。

| 操作 | 拟议 HTTP | CLI | 返回要点 |
| --- | --- | --- | --- |
| 校验关系 | `/api/testdata-relations/validate` | `testdata relation validate` | 可生成顺序、循环和约束冲突 |
| 生成预览 | `/api/testdata-generators/preview` | `testdata generate preview` | 固定配方、预计数量及峰值预算 |
| 开始生成 | `/api/testdata-generators/start` | `testdata generate start` | 原任务、分区回执和查询入口 |
| 检查约束 | `/api/testdata-checks/evaluate` | `testdata check evaluate` | 预期/意外违规及完整覆盖 |
| 接受交付 | `/api/testdata-releases/accept` | `testdata release accept` | 固定数据、用途及审阅修订 |
| 离线交换 | `/api/testdata-exchange/export` | `testdata export` | 文件格式、准确行数及证据清单 |

## 6. 容量、异常与恢复

拟定每模式最多 32 个实体、每实体 128 个字段、合计 256 条关系。每数据版本最多 1,000,000 行、512 MiB、128 个分区；每场景最多 200 个故障定义，预览最多 100 行。字典单份 16 MiB，字符串单值最多 64 KiB。

单次生成或全量检查最长 15 分钟、内存 512 MiB，全包最多 2 个计算任务；总存储 8 GiB，单次导出 1 GiB。预计行宽不足以保证准入，写入持续核对实际大小。唯一性检查与关系索引必须计入内存和暂存预算，超限明确失败。

| 情况 | 结果与恢复要求 |
| --- | --- |
| 唯一值不足、基数冲突或不可解循环 | 预览拒绝，列出最小已定位冲突及受影响字段 |
| 运行中发现约束不可满足 | 停止对应任务，保存失败原因；不得无限重抽样 |
| 只完成部分分区 | 候选保留为 incomplete，不能封存完整交付 |
| 预期故障未出现或出现额外违规 | 检查失败，分别列出故障缺项与意外问题 |
| 撤权、线程退出、取消或磁盘满 | 停止读取与输出发布，按原任务核销暂存和预留 |
| 导出中断或接收失败 | 保留原意图及隔离空间，核对后确认或显式清理 |

## 7. 实施前置与验收

P0 完成模式编译、关系可满足性检查与固定算子计算接口。P1 完成生成、数据版本、全量检查和分布；P2 完成交付、离线核验及工作台。无需其他新插件包或虚拟机；首版不会为了生成少量数据启动外部环境。

- 三个模板从定义生成真实文件，逐表行数、主外键及故障目标均可离线复核。
- 同工具版本、配方、种子和顺序产生相同字节；改变任一输入产生独立版本说明。
- 有限键空间、不可解循环和超量计划明确拒绝，不挂起、不静默减少行数。
- 全量检查区分合法边界、预期违规及额外违规；小样通过不能替代全量结果。
- 分区重复提交保持同一回执，缺失分区阻止完整发布，取消后没有未核销工作线程。
- 锁定或撤权后拒绝原字典和派生输出读取；保护引用阻止删除仍在使用的材料。
- CSV 转义派生保留来源映射，公式及脚本字段不执行；导入篡改和错误关系引用拒绝。
