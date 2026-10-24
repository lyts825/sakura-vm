# 软件供应审查插件包设计

## 1. 版本与使用结果

设计 3.0.0，2026-10-24；代码基线 2.7.0 / `912287a`。`supply-audit` 含 10 个拟议插件，实现待开始。共同约定见[第三批总览](plugin-pack-suite-design.md)。

用户固定依赖材料，核对组件、漏洞公告、许可证声明和来源证明，处理例外后交接审查档案。既有[安全扫描](security-scan.md)负责工具运行；本包管理证据适用范围、审阅和版本变化。首版不安装依赖、不执行包脚本、不自动升级或发布软件。

支持 npm 锁文件的明确版本子集、带精确版本和哈希的 Python 依赖清单，以及本包严格组件 JSON。具体解析版本由适配器声明；无法解析的格式明确拒绝。公告采用离线数据集导入，过期或无匹配均不能推导“没有漏洞”。

## 2. 内部插件与依赖

短依赖前缀为 `supply-`。服务方法和依赖符号遵守总览。

| 插件 ID | 专属对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `supply-sources` | 锁文件、公告原包及许可文本；SupplySourcesV1：upload、planCapture、capture、pin | — | @files |
| `supply-inventory` | 组件身份、直接/间接关系和覆盖缺项；SupplyInventoryV1：parse、compare | sources | — |
| `supply-advisories` | 公告快照、版本规则、匹配证据；SupplyAdvisoriesV1：importDataset、match、freshness | sources, inventory | — |
| `supply-licenses` | 许可证声明、原文和无法判定项；SupplyLicensesV1：classify、reviewExpression | inventory, sources | — |
| `supply-provenance` | 来源声明、签名检查和信任状态；SupplyProvenanceV1：inspect、verify | inventory, sources | @delivery-releases |
| `supply-policies` | 固定门槛、覆盖要求和判定；SupplyPoliciesV1：evaluate、explain | inventory, advisories, licenses, provenance | — |
| `supply-reviews` | 人工结论和限时例外；SupplyReviewsV1：open、decide、recheck | policies | — |
| `supply-reports` | 审查档案、版本比较和完整性；SupplyReportsV1：seal、compare | inventory, policies, reviews | — |
| `supply-exchange` | 证据导出、隔离接收与引用重建；SupplyExchangeV1：export、inspectImport、acceptImport | sources, inventory, advisories, licenses, provenance, policies, reviews, reports | — |
| `supply-workbench` | 导入、问题审阅、例外到期和交接；SupplyWorkbenchV1：view、templates | * | — |

没有必需的外部插件。FilesV2 缺席时直接上传；交付版本服务缺席时，来源证明以用户导入材料为准。签名是否有效与是否信任签发者分别呈现。

## 3. 完整用户流程

1. 选择“前端锁文件”“Python 固定依赖”或“公告更新比较”模板，导入明确文件。
2. 固定组件清单和解析器版本，查看缺失哈希、未知生态、循环与不可解析项。
3. 导入公告快照及来源声明，选择允许的时效；运行匹配，检查命中规则与未覆盖组件。
4. 审阅许可证文本和来源证据，封存本次门槛，再生成判定。
5. 对例外填写理由、精确组件/问题范围和绝对到期时间；接受此次用途。
6. 封存报告并导出。后续公告或清单变化生成新评估，保留旧报告。

## 4. 数据与判定规则

组件身份由生态、规范名称、精确版本、来源和可用内容摘要组成。相同名称不意味着相同组件；无法确定版本关系时保留 unknown。锁文件遗漏的系统库不自动计入覆盖范围。

公告记录发布时间、修订、撤回状态、获取时间与数据集摘要。仅计算明确支持的版本规则；未知规则不做字符串大小比较。公告更新产生新数据集，不覆盖旧匹配结果。

许可证结果分别记录检测到的文本、声明表达式和用户项目策略。自定义许可证与含糊声明交给人工审阅；本包不提供法律合规保证。来源签名验证要求已登记公钥和信任规则，不能相信包内自带公钥的自我声明。

例外状态为 `proposed → accepted → expired/revoked`，绑定问题、组件、策略修订和用途。读取当前结论时重新核对到期与撤回；旧报告仍反映当时状态，不作为当前通过凭据。差异报告保留新增、消失、未覆盖和规则变化四类原因。

## 5. 页面、HTTP 与 CLI

工作台提供材料、依赖图、公告、许可、来源、门槛、例外和报告。所有模板使用虚构组件。CLI 别名为 `supply`。

| 操作 | 拟议 HTTP | CLI | 输出 |
| --- | --- | --- | --- |
| 解析清单 | `/api/supply-inventory/parse` | `supply inventory parse` | 组件、关系、缺项、解析修订 |
| 匹配公告 | `/api/supply-advisories/match` | `supply advisory match` | 精确匹配依据及不支持项 |
| 评估/例外 | `/api/supply-policies/evaluate`、`/api/supply-reviews/decide` | `supply policy evaluate`、`supply review decide` | 固定判定和到期范围 |
| 导出/核验 | `/api/supply-exchange/export` | `supply export`、`supply verify` | 字节一致性、来源及可重算覆盖 |

## 6. 预算、故障与验收

拟定单锁文件 32 MiB、公告文件 64 MiB；最多 50,000 个组件、250,000 条关系和 100,000 条公告。解析分段执行，每任务 5 分钟；总存储 2 GiB、元数据 128 MiB、导出 256 MiB。超限拒绝，不截断后给出通过结论。

错误编码、恶意嵌套、重复组件冲突和路径逃逸必须拒绝。解析中断保留输入，派生清单不发布。公告过期、来源撤回、例外到期和策略改变会使当前判断需要重新评估。原文撤销许可后，检索与导出不得继续返回缓存文本。

实施按材料与解析、公告及许可/来源、策略审阅、报告交换推进。共同前置为有界解析、保护引用和原子发布；不存在必须启动 VM 的阶段。

验收包括未知版本规则不误匹配、同名不同源组件区分、公告撤回、例外跨作用域/到期拒绝、缺少覆盖不通过、并发修订、磁盘满恢复、纯 Node 离线重算和篡改拒绝。导入“无风险”报告不改变本地策略，也不能直接满足交付门禁。
