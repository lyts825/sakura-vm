# 多主机配置基线插件包设计

## 1. 版本与使用结果

设计版本 4.0.0，日期 2026-10-25。包 ID 为 `fleet-baseline`，含 12 个拟议插件，运行实现待开始。基线为应用 2.7.0 / `237d7bc`；工作区中的 2.8.0 实施不作为本包已验证能力。共同约定见[第四批总览](plugin-pack-next-design.md)。

用户为一组明确主机建立配置基线，将固定观察与基线比较，处理漂移和例外，再按批次审阅有限变更。交付物包括逐字段差异、覆盖情况、变更计划、原提供者回执和复测报告。

现有[主机配对](host-peers.md)负责远端身份及连接，[集群策略发布](fleet-policy-rollout.md)负责插件灰度策略写入。本包增加跨时点的基线、漂移及审阅记录。首版在线写入仅限原提供者支持的插件灰度策略，不增加通用远程命令。

## 2. 内部插件与依赖

下表服务和方法均为拟议接口。`platform` 是现有插件，但本文需要的新窄服务尚未实现；不能用其通用 `next` 接口代替。

| 插件 ID | 专属对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `baseline-scopes` | 空间、主机来源身份及范围版本；FleetBaselineScopesV1：registerHost、retireHost、freezeScope | — | — |
| `baseline-observations` | 固定配置观察、字段能力与来源证明；FleetBaselineObservationsV1：upload、previewCapture、capture | baseline-scopes | platform |
| `baseline-profiles` | 预期字段、适用平台与比较规则；FleetBaselineProfilesV1：validate、sealProfile、fork | baseline-scopes | — |
| `baseline-selections` | 标签选择器及展开后的目标集合；FleetBaselineSelectionsV1：resolve、freezeSelection | baseline-scopes, baseline-observations | — |
| `baseline-comparisons` | 逐字段漂移、未观察及不适用项；FleetBaselineComparisonsV1：preview、compare、explain | baseline-scopes, baseline-observations, baseline-profiles, baseline-selections | — |
| `baseline-exceptions` | 带理由、范围与期限的漂移例外；FleetBaselineExceptionsV1：propose、decide、expire | baseline-scopes, baseline-comparisons, baseline-profiles | — |
| `baseline-plans` | 精确变更建议、前置条件和受影响字段；FleetBaselinePlansV1：compose、preview、sealPlan | baseline-scopes, baseline-observations, baseline-profiles, baseline-selections, baseline-comparisons, baseline-exceptions | — |
| `baseline-waves` | 逐波目标、暂停阈值和人工检查点定义；FleetBaselineWavesV1：partition、validate、freezeWaves | baseline-scopes, baseline-plans, baseline-selections | — |
| `baseline-executions` | 下游原计划、逐目标意图、波次推进与结果核对；FleetBaselineExecutionsV1：prepare、submit、advance、cancelPending、reconcile | baseline-scopes, baseline-observations, baseline-plans, baseline-waves | platform |
| `baseline-reports` | 漂移趋势、实际覆盖和复测结论；FleetBaselineReportsV1：sealReport、comparePeriods | baseline-scopes, baseline-observations, baseline-comparisons, baseline-exceptions, baseline-plans, baseline-waves, baseline-executions | — |
| `baseline-exchange` | 基线、观察及报告封套；FleetBaselineExchangeV1：export、inspectImport、acceptImport | baseline-scopes, baseline-observations, baseline-profiles, baseline-selections, baseline-comparisons, baseline-exceptions, baseline-plans, baseline-waves, baseline-executions, baseline-reports | — |
| `baseline-workbench` | 主机矩阵、漂移审阅、波次与恢复入口；FleetBaselineWorkbenchV1：view、templates | baseline-scopes, baseline-observations, baseline-profiles, baseline-selections, baseline-comparisons, baseline-exceptions, baseline-plans, baseline-waves, baseline-executions, baseline-reports, baseline-exchange | — |

波次插件只管理固定目标和推进条件。执行插件拥有运行进度与原回执，服务端核对自己的逐目标结果后才能推进下一波；页面传入的成功计数不作为凭据。波次定义不反向读取执行服务，避免依赖循环。

空间根账本唯一归 `baseline-scopes`，负责空间状态、额度预留和发布恢复。其余插件经该直接依赖核对空间及额度。主机配置和真实写入回执仍归原提供者，本包仅保存固定引用及可导出的证据投影。

## 3. 完整用户流程

1. 新建空间，选择“开发主机一致性”“分组插件灰度”或“离线配置复核”模板。
2. 显式登记主机身份，导入固定配置快照。在线采集须先启用对应窄适配，再确认字段和目标。
3. 创建基线，指定平台条件、必需字段、精确值或有界比较规则，固定修订。
4. 展开主机选择器，确认完整名单，比较快照并逐项处理漂移、缺项和限时例外。
5. 生成精确变更计划，查看前置修订、潜在影响和支持状态，再安排小批次及停止阈值。
6. 在线动作逐波取得原提供者计划并批准；无适配器时导出待执行清单，保持“未应用”。
7. 核对原回执并重新采集配置，记录仍未观察和执行未知的目标；封存复测报告。
8. 导出选定基线及证据，预览清理无引用材料；取消只撤销尚未提交的动作。

离线流程能独立完成基线、漂移、审阅和交接。在线执行是单独验收能力，离线报告不能证明配置已落地。

## 4. 数据、状态与原权威

`HostReference` 固定来源命名空间、主机 ID、证书指纹及登记修订。证书轮换须重新核验映射；相同名称或地址不能自动继承旧主机的计划与结果。

`ConfigurationObservation` 记录采集时间、字段能力、平台版本和配置修订。未知字段、来源不支持、离线和超时分别保存。空字符串、空数组、未采集和明确不存在具有不同含义。

`BaselineProfile` 用声明式字段类型和比较操作，不接受远程脚本。差异状态为 `matched/drifted/unobserved/not-applicable`；例外只注释漂移，不把实际配置改写成匹配。

目标选择器在预览时展开为固定集合。主机标签随后改变，不扩大已批准名单。基线、观察、目标修订及例外到期变化，均使未提交计划失效。

在线计划保存原提供者的票据摘要和原回执查询入口。配置写入仍由原 `fleetPolicyRollouts` 领域执行。新窄接口必须保留原锁、主机身份、授权、当前策略修订和一次领取语义。

拟议的 `HostBaselineCaptureV1` 仅允许列出的只读字段；`FleetBaselineApplyV1` 仅签发插件灰度策略动作。拟由原系统领域实现，再经 `platform` 的独立服务句柄提供；不改变旧 V1 含义。

首版在线采集限主机平台、架构、宿主版本及已授权的插件灰度策略。在线写入只接受 `pluginId/enabled/percentage/cohortVersion` 和原策略修订，沿用原提供者的合法范围。项目配置、文件、账号、网络和系统包只支持导入审阅，不提供在线修改。

普通主机配对不授予上述采集或执行权。接入时须分别验证现有读取权限、明确的字段范围和目标策略发布权限；缺少字段授权协议时对应采集模式为 `not-supported`。

执行插件保存波次运行状态：`draft → ready → executing → awaiting-review → completed`，另有 `halted`；波次定义插件只保留固定定义。任一未知写入结果阻止后续波次。取消不能宣称撤销已经生效的策略；修复或回退须生成新计划和原提供者批准。

## 5. 页面与操作入口

工作台包含主机范围、观察矩阵、基线编辑、漂移列表、例外、变更波次和复测。每格显示观察时间及来源；过期数据保留但淡化，不能当作在线状态。CLI 别名为 `baseline`。

| 操作 | 拟议 HTTP | CLI（均以 `sakura` 开头） | 返回要点 |
| --- | --- | --- | --- |
| 固定目标 | `/api/baseline-selections/freezeSelection` | `baseline selection freeze` | 完整名单、身份摘要、排除项 |
| 比较基线 | `/api/baseline-comparisons/preview`、`/api/baseline-comparisons/compare` | `baseline comparison preview/compare` | 固定输入、逐字段状态、未覆盖范围 |
| 变更预览 | `/api/baseline-plans/preview` | `baseline plan preview` | 精确字段、前置条件及不支持的动作 |
| 准备及提交 | `/api/baseline-executions/prepare`、`/api/baseline-executions/submit` | `baseline execution prepare/submit` | 原计划、授权期限和逐目标回执 |
| 中断核对 | `/api/baseline-executions/reconcile` | `baseline execution reconcile` | 原回执、未知目标及允许的后续动作 |
| 复测交接 | `/api/baseline-reports/sealReport`、`/api/baseline-exchange/export` | `baseline report seal`、`baseline export` | 执行与配置复测分别计数 |

大批次预览返回完整条目总数及摘要，页面分段读取。离线 `baseline verify` 不访问主机，不能把导入回执变成本地真实执行证明。

## 6. 预算、失败与恢复

拟定单空间上限：200 台登记主机、100 份基线、每台每次 2000 个配置字段、500 个观察版本。在线单波最多 16 台、并发 2 台；原提供者更小的限制优先。

采集每台最长 30 秒；比较最长 120 秒、512 MiB 内存。控制 JSON 最大 1 MiB，单观察 4 MiB；本包存储 2 GiB，导出 256 MiB。没有后台默认轮询，重复采集由用户显式触发。

以上为待实测的设计上限。实际准入取本包与宿主剩余额度中的更小值，不提高现有共同默认 8 GiB 总额。

| 异常 | 必须呈现及保留的结果 |
| --- | --- |
| 主机离线、字段缺失或观察过期 | 显示未观察，保留旧证据和时间范围 |
| 主机指纹或配置修订改变 | 原计划失效，拒绝把动作重定向到同名主机 |
| 一波部分成功 | 保留逐目标结果，停止后续波次，不自动回滚成功目标 |
| 提交断线、重启或回执未知 | 只查询原请求；核对失败保持未知，不新建执行 |
| 撤销配对或发布授权 | 停止新采集与新提交；已发生动作按原提供者核对能力处理 |
| 导入及清理中断 | 未完整发布的空间保持隔离，未知下游回执保护相关材料 |

## 7. 实施前置与验收

先交付离线观察、基线、差异和审阅，再补原提供者窄服务，最后验收波次、复测及交接。在线模式还需将其受支持字段、操作和权限逐项登记到公开契约；不能依靠目录中的平台功能名称推断接口已就绪。

验收用例：

1. 三个模板完成离线输入、基线比较、例外、计划、报告与离线核验。
2. 缺失、空值、不适用和匹配分别计数；例外到期恢复待处理状态但不写主机。
3. 标签变化不扩大原目标集合；同名主机、证书轮换及旧配置修订使计划拒绝。
4. 在线适配缺席时，页面允许离线审阅，同时明确阻断实际采集或应用。
5. 在显式授权的两台测试主机上验证原策略发布、逐目标回执与重新采集；未实测不得标在线完成。
6. 部分成功、结果未知和控制器重启均停止后续波次，核对过程不重放写入。
7. 最大观察集分页、取消、撤权及受引用材料清理正确；导入执行记录保持外来声明。
