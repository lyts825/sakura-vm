# 发布审查与准入插件包设计

## 1. 版本与用户结果

设计版本 4.0.0，日期 2026-10-25。包 ID 为 `release-governance`，包含 11 个拟议插件。核对基线为应用 2.7.0 / `237d7bc`；工作区 2.8.0 的未完成实现不作为验收证据。运行实现待开始。

用户为固定发布候选整理验证、恢复和变更证据，检查其适用性，记录人工准入决定，交付可复核的发布审查档案。本文与[第四批总览](plugin-pack-next-design.md)共同作为实施依据。

[交付包](delivery-workbench.md)继续负责构建、制品、交付门禁、本地版本和签名；[应用运行包](app-runtime-pack.md)负责实际部署。本包增加跨领域证据要求、发布窗口、限时例外和审查决定。准入决定只表示审查结论，不改变既有发布服务的权限与门禁。

首版完成离线审查及本机只读证据适配，不自动部署、切换通道、发布公告或发送消息。实际发布必须回到原提供者，重新取得适用于具体目标的计划与授权。

## 2. 内部插件与依赖

表内服务和方法均为拟议接口。每个插件保存自己的记录，并按总览处理固定修订、保护引用、身份和恢复。

| 插件 ID | 专属对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `releasegov-candidates` | 空间账本、候选身份、变更范围与目标声明；ReleaseGovCandidatesV1：register、pin、compare | — | delivery-releases |
| `releasegov-evidence` | 证据字节、适用对象和来源证明；ReleaseGovEvidenceV1：upload、capture、checkApplicability | releasegov-candidates | delivery-reports |
| `releasegov-policies` | 证据要求、有效期和不可豁免规则；ReleaseGovPoliciesV1：define、validate、seal | releasegov-candidates | — |
| `releasegov-windows` | 固定发布时段、冻结区间和时区说明；ReleaseGovWindowsV1：define、checkConflict、resolveInterval | releasegov-candidates | — |
| `releasegov-exceptions` | 限时例外、风险理由和补偿条件；ReleaseGovExceptionsV1：propose、review、revoke | releasegov-candidates, releasegov-policies | — |
| `releasegov-evaluations` | 固定输入的规则结果和缺证清单；ReleaseGovEvaluationsV1：preview、evaluate、explain | releasegov-candidates, releasegov-evidence, releasegov-policies, releasegov-windows, releasegov-exceptions | — |
| `releasegov-reviews` | 人工检查项、异议和审阅记录；ReleaseGovReviewsV1：prepare、record、complete | releasegov-candidates, releasegov-evaluations, releasegov-evidence | — |
| `releasegov-decisions` | 准入决定、期限与当前有效性；ReleaseGovDecisionsV1：preview、issue、recheck、withdraw | releasegov-candidates, releasegov-evidence, releasegov-policies, releasegov-windows, releasegov-exceptions, releasegov-evaluations, releasegov-reviews | — |
| `releasegov-handoffs` | 操作交接说明和人工执行反馈；ReleaseGovHandoffsV1：prepare、acknowledge、recordOutcome | releasegov-candidates, releasegov-decisions, releasegov-evidence | — |
| `releasegov-exchange` | 审查档案及交接封套；ReleaseGovExchangeV1：export、inspectImport、acceptImport、verify | releasegov-candidates, releasegov-evidence, releasegov-policies, releasegov-windows, releasegov-exceptions, releasegov-evaluations, releasegov-reviews, releasegov-decisions, releasegov-handoffs | — |
| `releasegov-workbench` | 候选收件箱、证据矩阵和准入导航；ReleaseGovWorkbenchV1：view、templates | releasegov-candidates, releasegov-evidence, releasegov-policies, releasegov-windows, releasegov-exceptions, releasegov-evaluations, releasegov-reviews, releasegov-decisions, releasegov-handoffs, releasegov-exchange | — |

可选适配仅请求原提供者公开的固定候选描述和报告副本，保留原身份与读取许可。需要新增的读取契约须单独验收，不能读取提供者目录或调用其私有实现。无适配时可上传固定材料，证据等级保持外来声明。

`releasegov-candidates` 唯一拥有工作空间元数据和包内额度账本。其余插件通过该服务申请或核销容量，保存各自领域对象；根账本不代写领域记录。容量内部方法不开放 HTTP。

## 3. 完整用户流程

1. 创建空间，选择“常规版本”“紧急修复”或“数据变更审查”模板，检查默认规则与证据要求。
2. 登记固定候选、目标声明及变更范围，核对来源身份和候选摘要。
3. 上传或明确采集选定证据，将每项证据映射到候选、目标和规则；缺失项进入待补清单。
4. 固定规则版本、发布时段和冻结区间。必要时提交限时例外，列出风险与补偿条件。
5. 预览全部输入并评估，检查不适用、过期、未知和失败结果，保存逐规则解释。
6. 完成人工审阅，处理异议；预览后签发有期限的准入决定，或记录拒绝与补证要求。
7. 生成交接说明，实际操作者回到原发布入口。反馈区分人工声明和可核对的原执行回执。
8. 封存审查档案并导出，接收端离线核验；到期后复核决定，清理无保护引用的暂存材料。

## 4. 证据、例外与准入语义

候选身份至少固定来源命名空间、候选 ID、内容摘要、版本说明摘要和目标集合摘要。版本名称相同不代表同一候选；目标变更、制品变化或规则变化都要求新评估。

`EvidenceBinding` 保存来源类型、候选摘要、目标范围、产生时间、有效期、规则用途及原回执引用。来源类型区分人工声明、外来报告和已核对的本机提供者回执。相同字节上传不会获得本机回执身份。

有效期按服务端绝对时间判断，缺少可信产生时间的证据保持未知。发布时段保存绝对起止、输入时区和当时偏移；含歧义的本地时间必须先解析为确定区间。窗口只约束准入，不创建定时任务。

| 结果 | 含义与后续动作 |
| --- | --- |
| eligible | 所选规则和人工检查满足，可进入准入预览 |
| eligible-with-exceptions | 仅违反允许豁免的规则，例外有效且补偿条件已记录 |
| blocked | 有失败、不可豁免问题或开放异议，必须处理后重新评估 |
| inconclusive | 缺证、结果未知、来源不满足或覆盖不足，不能签发准入 |

例外只能作用于明列的业务规则，绑定候选、规则修订、理由、补偿条件和到期时间。候选身份、当前权限、来源完整性、未知执行结果和不可豁免规则不能以例外绕过。例外撤销不覆盖历史评估。

准入决定采用 `issued → expired/withdrawn`。决定的有效期取证据、例外、窗口及自身期限的最早截止。查询当前有效性时重新核对来源许可与固定输入；历史记录仍显示签发时结论。

首版按空间所有者权限运行，审阅记录明确为单人多阶段审阅。要求独立审批人的规则显示 `not-supported` 并阻止准入，不能用填写两个人名满足。交接确认不能授予部署权限，导入决定也不取得本地效力。

## 5. 页面、HTTP 与 CLI

工作台包含候选、证据矩阵、规则、时段、例外、评估、审阅、决定和交接。用户可从每个缺项跳转到具体对象。决定页同时显示签发时结果与当前有效性，不用单一绿色状态掩盖到期。

下列 HTTP 均为拟议 `POST` 路径；CLI 使用 `sakura releasegov`。`verify` 是本地只读命令，不调用 export HTTP。导出预览列出全部选定材料及未带出的引用，不自动携带原账号、访问凭据或部署票据。

| 操作 | 拟议 HTTP | CLI | 返回结果 |
| --- | --- | --- | --- |
| 证据适用性 | `/api/releasegov-evidence/checkApplicability` | `releasegov evidence check` | 候选、目标、来源及期限匹配 |
| 评估预览/执行 | `/api/releasegov-evaluations/preview`、`/api/releasegov-evaluations/evaluate` | `releasegov evaluation preview/run` | 完整输入摘要和逐规则结果 |
| 签发准入 | `/api/releasegov-decisions/preview`、`/api/releasegov-decisions/issue` | `releasegov decision preview/issue` | 固定评估、人工审阅和截止 |
| 当前复核 | `/api/releasegov-decisions/recheck` | `releasegov decision recheck` | 当前有效性及失效原因 |
| 记录反馈 | `/api/releasegov-handoffs/recordOutcome` | `releasegov handoff record` | 人工声明或原回执核对状态 |
| 离线交接 | `/api/releasegov-exchange/export` | `releasegov export`、`releasegov verify` | 封套清单、完整性和重算范围 |

## 6. 容量、异常与清理

拟定上限：每空间 200 个候选，每候选 500 项证据、200 条规则和 50 个例外。单证据 32 MiB，单次评估 30 秒；全包存储 4 GiB，单封套 512 MiB。交接说明正文最多 256 KiB，上传、派生副本和隔离导入均计费，控制账本按总览独立预留。

| 异常 | 必须呈现的处理结果 |
| --- | --- |
| 版本名一致而候选摘要不同 | 判为身份不匹配，拒绝复用原证据和准入决定 |
| 证据过期、来源撤权或目标改变 | 当前决定失效，保留签发历史，补证后重新评估 |
| 时钟不可信或时间区间无法确定 | 拒绝时效准入，保留待处理原因 |
| 签发中断、重复提交或磁盘满 | 查询原意图和回执，确认前保留预留，不创建第二份决定 |
| 执行反馈未知 | 标记待核对，只查询原提供者；不得以重复发布确认成功 |

审查档案保护规则、证据、例外、评估和决定的固定修订。过期决定仍有审计用途，不能自动清理。清理预览列出全部引用；导出读租约、未知提交与未确认反馈都会阻止相关字节删除。

## 7. 实施与验收

依次完成候选和证据、规则与时段、例外和评估、审阅准入、交接与离线核验。前置为固定材料、可追溯来源、服务端时间有效性、跨插件发布恢复；不新增部署执行接口。实际发布服务对本包结论的消费属于后续单独设计。

1. 三个模板均能从候选形成逐规则结果和审查档案，完成导出与隔离接收。
2. 同名不同摘要、错误目标、证据缺失及过期都阻止复用原准入。
3. 有效业务例外得到明确的带例外结论；不可豁免规则和未知结果无法绕过。
4. 来源撤权、窗口截止或例外撤销立即影响当前有效性，历史决定仍保持原内容。
5. 要求两位独立审批人的策略明确不支持，单人录入多个姓名仍无法通过。
6. 签发中断与重复提交返回原决定或待核对状态，磁盘满不丢失控制记录。
7. 人工执行反馈和导入报告不升级为本机执行证明，任何流程都不自动部署或发送消息。
8. 单包、适配器缺席、窄屏、夜间主题及纯 Node 离线核验均完成流程；清理拒绝受保护证据。
