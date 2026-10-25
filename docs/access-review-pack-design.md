# 身份与权限复核插件包设计

## 1. 版本与使用结果

设计版本 4.0.0，日期 2026-10-25。包 ID 为 `access-review`，含 11 个拟议插件，运行实现待开始。基线为应用 2.7.0 / `237d7bc`；工作区中的 2.8.0 实施不作为本包已验证能力。共同约定见[第四批总览](plugin-pack-next-design.md)。

管理员导入固定身份和授权快照，查出孤立授权、到期访问和职责冲突，再逐项记录保留、移除建议或限时例外。交付物是可追溯的复核档案、整改清单和后续快照比较报告。

现有[账户与项目权限](access-control.md)继续负责真实账户、角色、会话和权限写入。本包管理审查证据与决定，首版不修改账户或权限。审阅标签不授予宿主角色，也不读取密码、令牌或私钥。

## 2. 内部插件与依赖

以下服务和方法均为拟议接口。依赖使用完整 ID；`—` 表示无依赖。基础查询、固定修订和清理方法沿用总览。

| 插件 ID | 专属对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `accessrev-snapshots` | 空间、原始身份及授权快照、字段清单；AccessReviewSnapshotsV1：upload、inspect、sealSnapshot | — | — |
| `accessrev-identities` | 来源主体、人工映射与冲突；AccessReviewIdentitiesV1：normalize、proposeMatch、acceptMatch | accessrev-snapshots | — |
| `accessrev-entitlements` | 资源、角色、直接授权与继承路径；AccessReviewEntitlementsV1：buildGraph、explainAccess | accessrev-snapshots, accessrev-identities | — |
| `accessrev-policies` | 到期、孤立授权和职责冲突规则；AccessReviewPoliciesV1：validate、previewCoverage | accessrev-snapshots | — |
| `accessrev-evaluations` | 固定规则评估、发现及覆盖缺项；AccessReviewEvaluationsV1：preview、evaluate、explain | accessrev-snapshots, accessrev-identities, accessrev-entitlements, accessrev-policies | — |
| `accessrev-campaigns` | 复核批次、范围、期限和分组；AccessReviewCampaignsV1：createCampaign、freezeScope、previewScope | accessrev-snapshots, accessrev-identities, accessrev-entitlements, accessrev-evaluations | — |
| `accessrev-decisions` | 逐项决定、理由和限时例外；AccessReviewDecisionsV1：decide、supersede、expire | accessrev-snapshots, accessrev-campaigns, accessrev-evaluations, accessrev-identities | — |
| `accessrev-remediation` | 整改建议、人工处理声明和后续核对；AccessReviewRemediationV1：plan、recordClaim、compareFollowup | accessrev-decisions, accessrev-evaluations, accessrev-entitlements, accessrev-snapshots | — |
| `accessrev-reports` | 固定复核结果、缺项与覆盖统计；AccessReviewReportsV1：preview、sealReport、compare | accessrev-snapshots, accessrev-campaigns, accessrev-decisions, accessrev-evaluations, accessrev-remediation, accessrev-identities, accessrev-entitlements | — |
| `accessrev-exchange` | 复核材料封套、隔离接收与映射；AccessReviewExchangeV1：export、inspectImport、acceptImport | accessrev-snapshots, accessrev-identities, accessrev-entitlements, accessrev-policies, accessrev-evaluations, accessrev-campaigns, accessrev-decisions, accessrev-remediation, accessrev-reports | — |
| `accessrev-workbench` | 导入、冲突处理、复核队列与交接；AccessReviewWorkbenchV1：view、templates | accessrev-snapshots, accessrev-identities, accessrev-entitlements, accessrev-policies, accessrev-evaluations, accessrev-campaigns, accessrev-decisions, accessrev-remediation, accessrev-reports, accessrev-exchange | — |

身份映射与授权解释分别持久化。修改映射产生新图修订，不能覆盖已用于决定的解释。决定插件不依赖整改插件；后续核对生成新结果，不回写旧决定。工作台从批次范围和决定服务汇总进度，批次服务不反向读取决定。

空间根账本唯一归 `accessrev-snapshots`，负责空间状态、额度预留和发布恢复。其他插件声明其直接依赖，经根服务核对空间及额度；各自仍拥有表内领域对象和保护引用。

## 3. 完整用户流程

1. 新建空间，选择“项目成员周期复核”“临时授权到期”或“孤立身份检查”模板。
2. 上传管理员已导出的 JSON 或 CSV 快照，确认采集时间、来源范围、字段和导出许可。
3. 处理重复标识和身份映射冲突，检查角色继承及缺失资源。无法确认的主体保留为未匹配。
4. 固定规则和复核范围，预览所有主体、授权及覆盖缺项，再运行评估。
5. 按主体或发现逐项复核，记录理由、证据和决定；例外必须设置结束时间及适用对象。
6. 生成整改建议，在原权限管理界面处理。返回本包记录人工声明，再导入后续快照核对。
7. 封存含未决项的报告，选择导出字段，交接后预览并清理没有保护引用的材料。

首版只要求本包和导入材料。所有模板含合成快照，打开模板不会扫描真实账号或自动发出提醒。

## 4. 数据模型、判定与权限

`IdentitySnapshot` 固定来源命名空间、导出范围、采集时间和字段缺项。身份键使用来源命名空间与外部 ID；同名、同邮箱只能提出匹配候选，不能自动合并。人工映射记录操作者和理由。

`EntitlementGraph` 区分直接授权、组继承、角色继承和未知关系。继承环必须报告具体边，不能截断后宣称没有权限。来源未提供拒绝优先级时，结果只列候选有效权限，不推断真实系统决策。

`ReviewFinding` 保存规则修订、解释路径与输入摘要。最后活动时间缺失不等于长期未用；缺少离职状态不等于在职；过期快照不能证明当前授权。分析缺项采用 `inconclusive`，不混入通过数。

批次状态为 `draft → frozen → reviewing → sealed`。封存允许保留未决项，但报告必须列明数量和范围。决定为 `retain/revoke-proposed/exception/unresolved`；“建议移除”不表示真实权限已撤销。

例外到期仅失效并进入待复核队列。服务重启后按绝对时间重算，不自动修改权限。后续快照只能证明该来源在该采集时点的授权变化；人工处理声明与快照证据分开显示。

首版工作空间按现有 owner 权限开放。批次中的审阅人字段是责任记录，不是新登录角色。单人完成提出与复核时必须标记同一操作者，不能显示为双人批准。

脱敏导出生成独立映射版本，保留匿名引用的一致性；未选择的真实姓名、邮箱和外部账号 ID 不进入导出。摘要一致只证明材料未变，不能证明身份归属正确。

## 5. 页面与操作入口

工作台包含快照、身份冲突、授权解释、规则、复核队列、整改和报告。每个发现可以展开完整授权路径。空状态展示合成模板，未决项与“未覆盖”独立显示。CLI 别名为 `access-review`。

| 操作 | 拟议 HTTP | CLI（均以 `sakura` 开头） | 返回要点 |
| --- | --- | --- | --- |
| 接收前检查 | `/api/accessrev-snapshots/inspect` | `access-review snapshot inspect` | 范围、未知字段、计数及拒绝原因 |
| 权限解释 | `/api/accessrev-entitlements/explainAccess` | `access-review access explain` | 固定主体、资源、解释路径与未知关系 |
| 固定评估 | `/api/accessrev-evaluations/preview`、`/api/accessrev-evaluations/evaluate` | `access-review evaluation preview/evaluate` | 完整计划、运行回执、覆盖缺项 |
| 复核决定 | `/api/accessrev-decisions/decide` | `access-review decision record` | 预期修订、新决定和替代关系 |
| 后续核对 | `/api/accessrev-remediation/compareFollowup` | `access-review remediation compare` | 观察到的变化、未确认项和时间范围 |
| 导出交接 | `/api/accessrev-exchange/export` | `access-review export` | 字段投影、固定清单和封套摘要 |

写入决定需要预期修订与理由。批量决定先预览准确条目和排除项，不能把分页中未显示的授权默认批准。离线 `access-review verify` 复核完整性和可重算规则，不访问真实权限系统。

## 6. 容量、失败与恢复

拟定单空间上限：50 个快照、20,000 个主体、100,000 条授权边、1000 条规则和 100 个批次。单次规则评估最多 500 万次有界比较，计算 120 秒、512 MiB 内存，全包同时 2 个评估。

单文件 64 MiB，单报告 20 MiB；本包持久总量 2 GiB，导出 256 MiB。结果按主体和发现分页。控制账本预算及宿主总量另遵循总览，不能通过拆分空间绕过总额。

以上为待实测的设计上限。实际准入取本包与宿主剩余额度中的更小值，不提高现有共同默认 8 GiB 总额。

| 异常 | 必须呈现及保留的结果 |
| --- | --- |
| 来源范围缺失或身份冲突 | 保存缺项，阻断依赖该身份的确定性决定 |
| 快照过期或规则改变 | 新建评估修订，保留原批次引用 |
| 并发复核同一项 | 拒绝旧修订，展示已经提交的决定 |
| 取消或计算中断 | 保留运行回执；部分发现不可作为完整评估 |
| 导入损坏或字段越界 | 隔离材料，拒绝发布空间；清理按原接收回执核销 |
| 撤权或导出中断 | 停止读取及后续发送，保留引用与未知占用供核对 |

## 7. 实施前置与验收

先实现快照、身份及授权图，再实现固定规则、批次、决定和整改核对，最后接通报告、交接和工作台。图遍历与规则求值必须使用有界计算接口；首版不支持用户脚本或任意表达式求值。

实施须补齐权限快照导入模式及规则解释格式。后续若增加真实系统采集，须另行设计原提供者的只读接口、字段授权和来源证明，不能直接读账户存储目录。

验收用例：

1. 三个模板从导入到报告、离线核验和清理完整通过，报告保留未决项。
2. 同名不同 ID 不自动合并；身份映射变更后，旧决定仍能解释原授权路径。
3. 继承环、缺失拒绝规则和无活动时间均显示不确定，不能统计为合规通过。
4. 旧修订决定与批量范围篡改被拒绝；例外到期不会修改真实账户。
5. 人工“已整改”声明不会自动确认关闭；后续快照逐项显示变化和来源时点。
6. 最大主体与边数下，分页、取消、超限拒绝及工作线程退出有实际证据。
7. 撤权、封套篡改、重复接收和受保护历史清理均符合总览；不泄露未选字段。
