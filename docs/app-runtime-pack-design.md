# 应用运行与运维插件包设计

## 设计状态与目标

设计版本：`1.0.0`。核对基线：Sakura `2.5.0`，提交 `6fb9115`，日期 `2026-10-23`。本文保留设计时的方案；`2.6.0` 实施后的使用方式与实际边界见 [应用运行指南](app-runtime-pack.md)，验收状态见 [项目状态](../PROJECT_STATUS.md)。

`app-runtime` 将已登记制品安装到明确的受管 VM，持续维护应用版本、配置、数据、入口和恢复记录。用户能完成首次安装、升级、停止、回退、备份演练与卸载，并知道每次操作影响哪些资源。

首版面向单宿主 Linux VM。一个应用绑定一台专用 VM；可先使用本体已登记镜像新建 VM，也可审阅后接管符合条件的专用 VM。支持静态站点、Node/Python 服务和已有 Linux 可执行文件；运行时必须在目标环境中实际就绪。多主机调度、外部云部署、自动扩容和高可用不属于首版。

同一 VM 内的两个版本进程仅用于无状态版本切换。宿主或 VM 故障会同时影响它们，不宣称高可用。状态应用默认采用有维护窗口的停止、备份、迁移和重启流程。

## 与现有能力的关系

现有 [`operations`](../plugins/packs/operations.ts) 包继续负责 VM 备份、同步、监控、维护、文件整理和迁移。本包增加应用级身份、安装事务和恢复编排，不改写该包。现有 [`delivery`](delivery-workbench.md) 负责构建和交接，预览具有到期时间；本包拥有持续运行实例，不把预览续期当作安装。

| 现有入口与实际证据 | 本包复用方式 | 尚缺的能力与实施边界 |
| --- | --- | --- |
| [`WorkspacesV1`](../server/service-contracts/v1.ts)、[`projects/services.ts`](../plugins/projects/services.ts) | 项目配置、服务依赖、启动停止和运行观测 | `save/run` 主要使用 VM 当前项目；新增固定 `projectId` 和配置修订的受限适配入口，禁止切换当前项目后执行 |
| [`ServiceHealthV1`](../plugins/service-health/services.ts)、[`service-health.ts`](../server/service-health.ts) | 复用采样、连续失败和重启预算 | 增加安装代号、服务配置摘要及采样有效期绑定；已有项目健康不能直接证明新版本就绪 |
| [`HttpIngressV1`](../plugins/network/services.ts)、[`http-ingress.ts`](../server/http-ingress.ts) | 复用监听器、代理和证书实现 | 当前 `action` 缺少应用归属和公开比较交换契约；需增加带归属、版本前置条件的切换与撤销端口 |
| [`BackupsV1`](../plugins/backups/services.ts)、[`backups.ts`](../server/backups.ts) | 复用整机备份、完整性检查和恢复为新 VM | `Backups.run` 实际调用 `requireStopped(id)`，必须关闭 VM；补充停写、关机、冷备与受控重启的身份交接，停止应用进程不满足冷备条件 |
| [`PluginContext`](../server/plugin-api.ts)、[`plugin-capabilities.ts`](../server/plugin-capabilities.ts) | 复用受限 VM、执行、存储、元数据和受管任务 | 持久应用资源归属、跨重启 fencing token 及停用后的入口关闭需要明确宿主支持 |
| [`DeliveryArtifactsV1` / `DeliveryReleasesV1`](../server/service-contracts/delivery-storage.ts)、[交付来源契约](../server/service-contracts/delivery-quality.ts) | 可选读取封存制品、来源、当前判定和信任记录 | 安装前仍须本包审阅；不能把导入 ID、外部通过声明或临时读取租约当执行授权 |
| [`SecretsV1`](../plugins/secrets/services.ts) | 复用私密值保存与解析 | 当前公开读值不提供不可变版本；需补充不返回明文的引用版本核验，不把 `updatedAt` 当强身份 |
| [`plugin-capabilities.ts`](../server/plugin-capabilities.ts) 的网络能力与既有网络配置 | 复用受管连通性和网络身份 | NAT 开关不提供目标和时限约束；补充本体可核验的出站过滤、规则观察及到期撤销端口 |

跨插件调用均通过声明的 `serviceRef`。本体的网络、VM 和存储内部类仅能由宿主适配器复用；`app-*` 不直接导入其他插件的领域实现。新公共端口按现有契约流程发布、生成和冻结，保留 `2.5.0` 接口兼容性。

## 包成员与插件边界

新包直接包含下列 9 个插件及既有 `command-palette`。依赖解析器补齐 `projects`、`secrets`、`service-health`、`network`、`backups` 及它们声明的依赖；不隐式启用 `delivery`、`foundry`、`data-lab` 或整个 `operations` 包。

| 插件 | 用户动作与输入 | 输出与独立价值 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- | --- |
| `app-targets` 运行目标 | 选择镜像、新建或审阅接管 VM；配置 CPU、内存、磁盘和网络预算 | 固定目标、能力检查、占用与漂移记录；可单独检查部署环境 | `projects` | `foundry-catalog` |
| `app-packages` 安装制品 | 上传文件清单和启动描述，或选择交付版本；审阅来源 | 不可变安装包、本地许可和保留引用；可独立管理待安装版本 | 无 | `delivery-artifacts`、`delivery-releases`、`delivery-gates` |
| `app-config` 应用配置 | 定义配置模式、填写非敏感值、选择私密引用、比较修订 | 配置修订、有效性结果和受控解析；可独立核对配置变化 | `app-targets`、`secrets` | 无 |
| `app-data` 持久数据 | 声明专用数据目录、配额、兼容范围和迁移步骤 | 数据集身份、单写者租约、迁移日志和保留状态；可独立盘点应用数据 | `app-targets` | 无 |
| `app-observe` 应用观测 | 查看进程、健康、事件和有界日志；确认故障与重启策略 | 绑定安装代号的健康证据、事件和诊断包；可单独观测已登记应用 | `app-targets`、`service-health` | `metrics` |
| `app-routes` 应用入口 | 预览端口占用、申请入口、审阅切换或关闭 | 带归属和修订的路由、实际探测结果；可独立管理已登记应用入口 | `app-targets`、`app-observe`、`network` | 无 |
| `app-recovery` 备份与恢复 | 创建检查点、设保留策略、演练、提出恢复计划、执行批准的运行手册 | 一致性与完整性证据、新恢复目标和审计记录；可独立恢复已登记应用数据 | `app-targets`、`app-data`、`backups` | 无 |
| `app-deploy` 安装与变更 | 预览并执行安装、升级、回退、停止、重新配置和卸载 | 不可变变更计划、执行记录、当前安装及独立清理结论 | 前述 7 个 `app-*` 插件 | 无 |
| `app-workbench` 应用工作台 | 建立应用、比较版本、处理阻塞、查看时间线 | 完整流程界面和命令面板入口；业务校验仍由各服务负责 | 前述 8 个 `app-*` 插件 | 无 |

生命周期按职责归属：`app-targets` 保存目标和占用；`app-packages/config/data` 保留持久元数据，不在卸载时删数据。`app-observe` 拥有采样订阅、证据汇总和应用事件，复用 `service-health` 的探测与重启执行，不另启第二套重启控制器。`app-routes` 拥有应用入口租约；`app-recovery/deploy` 拥有任务、恢复票据和取消处理；`app-workbench` 只拥有界面订阅。

所有资源所有者须登记停用钩子。停止采样器只表示观测停止；停止应用进程、关闭路由、取消迁移和删除文件各有自己的结果。单独启用 `app-deploy` 会解析必要依赖，仍可完成基本流程；只启用观察或配置插件时，界面提供相应功能，不伪造未安装阶段。

依赖的拓扑顺序为：既有服务 → `app-targets` 与 `app-packages` → `app-config/app-data/app-observe` → `app-routes/app-recovery` → `app-deploy` → `app-workbench`。`app-recovery` 产生证据和恢复目标，由 `app-deploy` 执行版本切换，不反向依赖安装服务。可选交付来源也不依赖任何 `app-*`。

## 首次安装与日常使用

1. 新建应用，获得宿主内唯一 `appId`。选择本体登记镜像，建立专用 VM；检查实际架构、运行时、可用空间及服务管理器。镜像摘要不等于目标运行时已就绪。
2. 上传本地文件清单，声明静态目录或参数化启动命令。服务端校验路径、文件长度与摘要后封存。显示“本地未签名、所有者审阅”，不生成可信发布者标记。
3. 配置非敏感参数、私密引用、服务健康探针、数据目录和资源上限。未声明外网权限默认不联网；运行时缺失时阻断计划，不临时联网安装。
4. 生成安装计划，展示目标身份、制品差异、配置变化、数据影响、网络入口、停机需求和预算。用户审阅后确认该摘要，不提供脱离计划的全局“已同意”。
5. 执行时复核审批、目标和预算，保留制品引用，建立独立版本目录；校验真实落盘内容，再配置服务。持久数据留在独立数据目录中。
6. 启动新版本，采集进程、服务探针和入口探针。健康达标后按预期路由修订切换，观察稳定窗口，再登记为当前版本。无 HTTP 服务采用命令探针，不虚构 URL。
7. 失败时显示失败阶段与可采取的动作。旧版本可用时保留旧入口；已有数据写入时先判断兼容性。不能证明状态时进入待核销，不自动重放迁移。
8. 日常页面展示应用版本、数据代号、观测时效、预算、检查点和最后变更。升级、修改私密引用、回退与卸载都生成新的计划和操作记录。

可选 `delivery` 流程先经公共服务读取具体来源作用域、版本、候选和判定，再固定内容摘要。通道只是选择入口；安装计划保存解析后的具体版本，执行时不能跟随变化后的通道。隔离中、签名无效、已撤回或信任已撤销的版本不能进入新计划。

本包复制并校验所需制品到自身命名空间后，才能完成来源接收；读取期间持有交付读取租约，完成后关闭。关闭可选来源插件不会删除已复制内容，但新安装或切换需重新检查来源。来源不可查询时保持既有运行，并阻断新的来源授权；所有者可另行按“本地未验证来源”重新登记、审阅和生成计划。

本地模式不解析或冒充验证 `.sakura-delivery.zip`。用户可导出其中允许交接的运行文件后，使用本包明确的文件清单上传；直接导入交付格式须启用相应交付插件。三个新包之间没有必需依赖，未启用 `foundry` 时仍使用本体登记镜像。

可选 `foundry-catalog` 拟通过 `FoundryCatalogV1.previewUse/authorizeUse` 返回固定 `revisionDigest` 的镜像引用和验证凭据；本体拟增 `ImageAssetsV1` 负责租约、独立磁盘、创建受管 VM 与持久引用。两个接口目前均不存在。没有该插件时走本体镜像入口；已选镜像引用失效时必须报错，不能悄悄改用默认镜像。

## 数据契约与身份

新 Schema 使用独立 `schemaVersion: 1`，严格拒绝未知字段、未来版本和跨宿主引用。标识采用 UUID，摘要采用 SHA-256；相对路径拒绝越界、链接、设备文件和大小写碰撞。元数据追加修订，物理文件通过现有存储能力有界读写。

| 类型 | 必要字段与不变量 |
| --- | --- |
| `AppScope` | `hostId/appId`；查询历史不要求源项目或 VM 仍存活；执行另行绑定目标 |
| `AppTarget` | `targetId/revision/vmId/vmCreationId/writableDiskId/diskGeneration/projectId/imageDigest/arch/runtimeFingerprint/ownershipToken`；唯一专用应用归属，记录实际能力检查 |
| `AppPackage` | `packageId/contentDigest/files/startup/services/runtimeRequirements/origin/acceptance`；内容与启动声明共同参与摘要，时间戳不参与 |
| `AppConfigRevision` | `revision/schemaDigest/publicValues/secretRefs/secretRefVersions/digest`；明文私密值不进入记录、计划、日志或导出 |
| `AppDataset` | `datasetId/targetId/relativeRoot/quotaBytes/generation/schemaVersion/writerLease/retained`；路径改变须新计划，不能从客户端传宿主绝对路径 |
| `AppChangePlan` | `planId/digest/action/appRevision/targetIdentity/packageDigest/configDigest/dataGeneration/routeRevision/trustRevision/steps/allowedBootTransitions/networkPolicy/budget/expiresAt`；不可变，只在服务端生成 |
| `AppApproval` | `planDigest/actor/sessionAuthority/allowedEffects/approvedAt/expiresAt`；审批默认 10 分钟有效，执行入队与出队均复核 |
| `AppOperationLease` | `leaseId/appId/targetIdentity/operationId/fencingToken/ownerGeneration/expiresAt`；每应用仅一个变更写者，短租约不代表应用存活期限 |
| `AppInstallation` | `installationId/packageDigest/configDigest/targetIdentity/dataGeneration/operationId/desiredState/observedState`；当前指针以修订比较交换 |
| `AppCheckpoint` | `checkpointId/backupId/installationId/dataGeneration/quiesceEvidence/powerOffReceipt/bootTransitionId/integrity/restoreEvidence`；记录关机冷备或实际一致性适配器结果，恢复演练另计 |
| `AppBootTransition` | `transitionId/planDigest/vmCreationId/writableDiskId/diskGeneration/fromIdentity/powerOffReceipt/backupId/toIdentity/derivedLeaseId`；单次受控关机与重启回执，不改写原计划 |
| `AppNetworkLease` | `policyDigest/targetIdentity/protocols/destinations/ports/absoluteExpiresAt/filterReceipt/observedState/revokeReceipt`；NAT 连通性与过滤生效、撤销结果分别记录 |

`targetIdentity` 区分稳定归属与单次启动身份。稳定归属是 VM 创建代号、受管可写磁盘 ID、磁盘代号和项目身份；启动身份是 VM 进程身份、执行代号及客户机启动 ID。磁盘内容会随正常写入变化，磁盘归属不能只凭文件名或旧内容摘要判断。

关机冷备计划预先声明一次允许的启动身份转换。执行器先持久化关机意图，核验原 VM 与磁盘归属，再停止写者并关闭 VM。收到本体确认的进程停止回执后执行备份；校验完成才按同一意图重启。新启动必须仍属原 VM 创建身份及磁盘、项目，旧进程必须已退出；应用自启动与入口保持关闭。

本体核验这次预先批准的转换后，记录新的启动身份并签发绑定原计划、剩余步骤和剩余预算的派生租约，同时废止旧租约。该回执允许继续原计划，不修改不可变计划。未登记重启、超出次数、磁盘替换或归属不符均视为漂移，旧计划失效；名字相同或端口可达不能授权继续。

变更租约由宿主统一分配，部署、迁移、恢复和健康重启必须竞争同一个应用写权限。审批有效期限制任务开始时间；已启动操作在批准的效果与总时限内运行，不能通过续租扩大动作或延长原总时限。撤权后只保留原身份的收尾能力。

`app-packages` 复用有界分块、摘要和路径校验的基础实现。实现时将适用逻辑抽为宿主内部共享模块，两个领域分别通过公开服务暴露，不跨读交付目录、不复制整个交付存储系统。首版单文件及单包上限均为 1 GiB，单包最多 10,000 个文件，块大小至多 512 KiB；禁止隐式解压可执行归档。

制品的安装、计划执行、历史保留和检查点分别持有引用。垃圾清理仅处理无引用对象，先显示具体清单，再凭短时令牌复核；包归档、应用卸载和数据删除是不同动作。

## 拟增公共服务与操作

下表服务均由对应插件提供独立 `serviceRef`，方法参数必须携带 `AppScope`。执行类方法返回操作 ID 和状态，不用 HTTP 200 或任务退出码代替业务成功。

| 服务 | 拟定主要方法 |
| --- | --- |
| `AppTargetsV1` | `list/get/inspect/planCreate/planAdopt/applyTarget/beginBootTransition/completeBootTransition/previewNetwork/applyNetwork/observeNetwork/revokeNetwork/reconcile/releaseOwnership`；启动交接与网络操作由本体受限端口核验 |
| `AppPackagesV1` | `begin/chunk/complete/seal/inspect/acceptLocal/acceptDelivery/get/retain/release/cleanupPlan/cleanup` |
| `AppConfigV1` | `schema/preview/save/get/compare/assertReferences`；解析私密值仅供受权执行适配器 |
| `AppDataV1` | `list/previewProvision/prepare/acquireWriter/checkpointState/migrate/reconcile/planDelete/delete` |
| `AppObserveV1` | `view/events/logs/probe/assertHealthy/acknowledge/setRestartPolicy` |
| `AppRoutesV1` | `preview/reserve/get/switch/close/reconcile`；切换须 `expectedRevision/installationId/fencingToken` |
| `AppRecoveryV1` | `policy/checkpoint/verify/planRestore/restoreToNewTarget/drill/planRunbook/run/reconcile` |
| `AppDeployV1` | `list/get/preview/approve/apply/cancel/reconcile/installation`；`preview.action` 区分安装、升级、停止、回退、重配置和卸载 |
| `AppWorkbenchV1` | `overview/templates/timeline`；仅聚合，不另存业务真相 |

补充现有服务时优先新增版本化端口。固定项目执行、受控启动身份交接、带归属的入口切换、出站过滤及到期撤销、私密引用版本是新增契约，不在设计中假定现有 `V1` 已支持；实现必须经过历史契约兼容检查。

## 安装、升级与回退状态机

普通安装：`planned → approved → queued → preparing → staged → starting → checking → switching → observing → succeeded`。每个外部副作用先写持久意图，再保存实际回执。步骤成功前检查租约和身份；重放使用同一幂等键，不重复创建目录、入口或服务。

有状态升级：`preparing → draining → app-stopped → vm-shutting-down → vm-stopped → checkpointing → vm-booting → identity-rebinding → migrating → starting → checking → switching → observing`。`draining` 拒绝新流量，等待请求完成或达到审阅过的超时；停止写者后仍须关闭 VM，才可调用现有冷备服务。

`checkpointing` 必须取得关机证据与备份完整性证据；`identity-rebinding` 完成上述受控身份交接后才能迁移。重启、核验或派生租约失败均进入待核销，不重放迁移。迁移前复核检查点和还原空间；应用进程与外部入口到显式启动、切换阶段才可恢复。

失败分支使用 `failed/cancelled/reconciliation-required`，运行状态另存 `stopped/starting/healthy/unhealthy/unknown`。清理状态另存 `not-needed/pending/verified/unknown`。`healthy + cleanup unknown` 可以表达新版本可用但旧资源待核销，不允许直接显示“全部完成”。

成功条件同时包括：制品校验通过；目标与配置符合计划；必要迁移完成；当前安装指针和路由实际指向目标版本；稳定窗口通过；需要释放的旧进程、端口和临时目录已核销。无须删除的旧版本保留引用并标明保留期限。

取消在可中断阶段停止新动作并核销原资源。进入不可中断的数据迁移步骤后，取消请求记为待处理，步骤按申明期限收尾或标未知；不能杀进程后宣称事务已撤销。源脚本必须声明可中断性、幂等键和已提交标志，否则首版拒绝自动迁移。

无状态升级可在同 VM 分别启动两个隔离版本；计划提前预留两份资源。新版本连续健康后以路由修订比较交换，再排空旧连接并停止旧版。每个版本拥有不同服务账号或等效隔离身份、目录与端口，禁止同时抢占同一运行目录。

**流量回退不等于数据回滚。** 若旧版支持当前数据模式，可生成仅切流计划；不兼容时关闭自动回退，要求恢复计划。恢复将检查点还原到新目标并验证，再审阅丢失检查点之后写入的范围后切换。原目标隔离保留，禁止就地覆盖唯一数据副本。

启动检查默认连续成功 3 次、间隔 5 秒、每次超时 3 秒，稳定窗口 60 秒；均进入计划摘要。健康证据记录安装代号与时间，超过 30 秒须重新探测。参数可按应用修订，缺失探针明确显示未验证，不能把进程存在当服务健康。

## 持久数据、冲突与恢复

版本目录和数据目录分离。首版持久数据位于专用 VM 的受管目录，跨版本保留；配额须由实际文件系统约束并核验。当前环境不支持硬配额时，计划显示“容量预检”，不得标为强制限额。达到预算时停止新增变更，不能删除业务数据腾空间。

迁移步骤包含 `fromSchema/toSchema/scriptDigest/timeout/idempotencyKey/verification/compatibilityRange`。成功后追加新数据代号。缺少迁移完成回执时，以只读核对与验证步骤恢复判断；不能根据日志最后一行猜测成功。数据库逻辑备份只有在适配器实际支持并验证时才可标为一致性备份，首版最低保证是应用停写、VM 关机后的冷备。

检查点绑定完整安装描述和 VM 备份。用户单独从既有备份功能恢复 VM 后，本包将其识别为新目标，不继承原目标的写者租约、应用入口或自动启动授权。演练使用隔离网络、新应用服务身份和关闭的外部连接，防止重复消费队列或发送业务消息。

接管既有 VM 必须检查运行服务、目录、端口、项目和既有插件所有权。存在其他应用或未知写者时拒绝默认接管；用户先将业务迁出或选择新 VM。允许的接管需列出保留项、变更项及恢复方式，并生成专用审批。不能因为名称相同而覆盖其他插件的入口。

目标被手动改动时标记漂移。未经原计划允许的启动身份、目标架构、项目、运行脚本、配置、数据代号或路由修订变化都会使旧计划失效；只允许重新生成计划或登记可解释的新基线。计划内冷备重启须有完整身份转换回执。手动删除 VM 后，历史和制品仍可读，执行拒绝复用同名新 VM。

备份保留策略默认保留最近 3 个已校验检查点，并保护当前升级和未结恢复操作引用。执行前估算备份、还原、双版本和临时空间；不足时停在计划阶段。导出备份使用现有加密能力，密钥引用失效时保留记录并阻止恢复，不创建空密钥备份。

定时冷备会关闭专用 VM。策略审阅必须列明维护窗口、最大停机时长、允许的单次启动转换和服务恢复条件；窗口外不得自行关机。每次任务先固化计划与身份，再按“停写 → 关机确认 → 冷备校验 → 受控重启 → 派生租约 → 应用健康 → 开放入口”执行。

冷备失败时，仅在原计划允许、原 VM 与磁盘归属完整且未开始迁移时，才可经受控身份交接恢复原服务；否则保持停止并报告故障。任务结束不等于应用已恢复。冷备过程中宿主崩溃，重启后先核验持久意图及实际关机、备份和启动回执，不能直接沿用关机前的启动身份。

## 权限、审批与运行预算

首版所有新 API 均限宿主所有者。读历史采用宿主身份；运行操作还需明确 `AppScope`、固定目标及未撤销的插件代号。每次入队、出队、关键外部写入和元数据提交前重查权限。CLI、UI 与服务调用共用同一审批和预算实现。

新安装、端口暴露、数据迁移、接管、恢复切换和永久删除均要求具体计划审阅。一次审批只覆盖其中列出的效果；修改命令、网络、目标或数据影响必须重新审批。已有授权不会因页面刷新重复询问，但审批过期或计划身份变化必须重新确认。

默认入口仅本机回环地址与独立应用域名，禁止借用管理站点来源；代理移除宿主管理 Cookie、Authorization 和跨来源敏感头。开放局域网、证书与客户端认证单独进入计划。默认拒绝外网，恢复演练默认隔离。NAT 仅提供连通性，不能证明仅允许指定目标或按时断网。

有限联网计划必须由本体可验证的出站过滤端口落实协议、目标 IP 或受控解析域名、端口和绝对截止时间，返回规则安装、实际观察与撤销回执。过滤须覆盖声明的 IPv4/IPv6、DNS 与重定向边界；不支持的目标表达或协议直接拒绝。规则先于连通性生效，到期自动撤销由本体持久管理，插件退出不延长期限。

当前缺少上述完整公开契约，列为 M0 阻塞条件。平台无法验证过滤或到期撤销时，阻断受限网络计划；不得退化成普通 NAT 后仍标为有限联网。重启后先重新核验过滤和剩余期限，再恢复连通性；未经批准的外连即使业务健康也不能通过验收。

入口上游只能引用已登记目标和服务端口；拒绝任意宿主 URL、管理端口及未批准重定向。服务端实际探测结果与浏览器展示分开保存，管理凭据不转发给应用。路由关闭必须证明确切监听入口失效，不能仅删除界面列表项。

计划预算覆盖 VM 数量、vCPU、内存、磁盘预留、数据配额、日志、上传及操作时间。默认每应用最多 1 个变更任务、1 个恢复演练、2 个无状态安装代；宿主总预算集中预留，不能逐插件各自计算后超卖。执行超时与客户机进程终止结果分别记录。

日志默认每服务保留 20 MiB、应用事件保留 30 天；导出与检索受字节上限约束。命令与健康探针可能输出敏感内容，运行环境使用私密注入和输出脱敏；浏览器不提供任意私密值回显。重启默认关闭；启用后最多 10 分钟内 3 次，耗尽后停止重启并建立事件。

自动动作仅允许预先审阅的重启、停止入口和只读诊断。运行手册把步骤、参数范围、版本与可变更资源固定到摘要；首版不自动执行任意故障修复脚本、不自动覆盖数据，不依赖 AI 判断给予通过状态。

## 停用、崩溃与重启

正常停用先禁止新操作，持久化进行中记录，关闭本包入口并停止本包进程，再释放执行资源。版本、配置、数据和备份保留。若有不可中断迁移或身份不明资源，停用返回未完成项；不能将未成功的清理写成成功。

宿主需要持久的应用归属登记和入口保护，保证插件异常退出后仍能关闭其公开入口。该能力属于 M0 缺口；实现前不能承诺强制卸载后客户机进程必定停止。内核只能按原资源身份关闭入口或发送停止请求，不取得新的业务执行授权。

重启读取操作日志、租约和 VM 身份，过期租约不能直接被新任务覆盖。先核对实际进程、目录、路由和迁移提交点，再归类已完成、可安全续行或待人工处理。旧控制器的 fencing token 永久失效；无法隔离旧写者时禁止新写者接管。

持续运行应用没有短时绝对到期要求，独立于变更任务租约。宿主重启后的自动启动仅使用预先审阅的应用自启动策略；不自动重试安装、恢复或迁移。观测恢复前显示未知，入口重新开启前必须重新验证目标身份和当前健康。

关机保留应用定义、VM 磁盘、数据和版本引用。用户主动停止设置 `desiredState=stopped`，重启宿主或重新启用插件都不能覆盖这个意图。自动恢复策略默认关闭；启用时也受重启次数、预算和数据兼容性限制。未知迁移状态始终阻断自动启动。

卸载默认关闭入口、停止服务并移除版本目录，保留数据、制品档案和检查点。清除数据使用独立计划，列出确切对象、引用、预计空间及不可恢复影响；无法证明安全归属的目录只记录待处理，不递归删除。

## API、CLI 与界面

每个插件提供 `/api/app-<name>` 平面入口，沿用现有插件路由规则。GET 使用显式 `appId`；POST 采用严格判别式 `action` Schema，计划、审批、执行分开。列表分页返回游标，日志分块返回位置和截断标记；错误码区分冲突、权限失效、能力不足、健康失败与待核销。

请求和响应进入现有生成式契约；异步任务注册现有 jobs 与 retry 贡献。重试入口先展示原操作结果和新计划，不直接重放未知迁移。没有任务 ID 或实际步骤证据的按钮不得显示操作完成。

拟定 CLI：`sakura app target inspect/create/adopt`、`package upload/accept`、`config preview/save`、`plan install/upgrade/rollback/uninstall`、`approve <digest>`、`apply <planId>`、`status/logs/stop/reconcile`、`backup create/verify`、`restore plan/apply`、`data plan-delete/delete`。均支持 `--json` 和显式 `--app`；命令输出计划文件与摘要，非交互执行必须带服务端审批回执。

工作台主视图按“应用列表 → 目标与制品 → 配置与数据 → 变更计划 → 执行 → 运行观测 → 备份恢复”组织。应用页同时显示期望版本与观测版本，健康和清理各占一列。失败状态给出下一步，如“恢复原操作”“新建兼容性回退计划”，不放无条件重试按钮。

首次安装向导提供静态站点、Node 服务、Python 服务和自定义可执行文件模板。模板仅声明需要的运行时、探针和配置；实际能力检查通过后才启用安装。历史页可以打开旧计划、配置差异、入口变更、数据迁移与诊断包。

## 里程碑与验收

下列里程碑按依赖执行，负责人为模块职责，状态均为“待开始”。设计完成不代表这些验收已通过。

| 里程碑 | 优先级、依赖与负责模块 | 可验收交付 |
| --- | --- | --- |
| M0 宿主与服务契约 | P0，无前置；宿主与既有服务维护者 | 镜像资产、固定项目、资源归属、fencing、受控关机与启动身份交接、路由 CAS、出站过滤与到期撤销、私密引用版本、恢复目标身份均有实际契约和证据；旧契约仍通过；不支持有限联网则阻断对应计划 |
| M1 独立首次安装 | P0，M0；全部 8 个领域插件 | `app-deploy` 及其全部必需服务提供真实可调用的最小流程，包括实际探测、入口切换、冷备和新目标恢复；使用本地制品安装静态和命令服务，退出码与实际访问有证据；无 delivery/foundry 依赖，不接受占位服务 |
| M2 升级与观测 | P0，M1；observe/routes/deploy | 在 M1 服务基础上完成复杂变更：健康失败保留旧入口、并发计划仅一个生效、无状态切换后旧进程确认停止；状态应用明确维护窗口 |
| M3 数据与恢复 | P0，M2；data/recovery | 扩展 M1 冷备恢复为迁移和故障恢复场景：实际写入数据、升级迁移、兼容性回退阻断和新目标恢复均可复现；演练验证数据内容和服务功能，不只校验备份文件 |
| M4 来源与操作体验 | P1，M3；packages/workbench | delivery 可选来源复核、撤销与停用退化明确；CLI、UI、取消、日志与历史可用；390 px 布局和键盘操作验收 |
| M5 生命周期交付 | P0，M4；宿主及全部模块 | 权限撤销、强制停用、宿主崩溃与重启核销、保留清理和安装包发行均通过；提交、标签、支持范围和验证缺口有记录 |

| 失败场景 | 必须观察到的结果 |
| --- | --- |
| 审阅后替换文件、命令或私密引用版本 | 摘要或引用冲突，原计划拒绝执行，已运行版本不变 |
| 同名 VM 重建或目标当前项目改变 | 固定身份校验失败，不能在新对象上继续写入 |
| 只停止应用后申请现有冷备 | 检测 VM 仍运行并拒绝；必须取得实际 VM 关机回执 |
| 冷备计划内重启、关机后宿主崩溃或未登记重启 | 仅原 VM 创建与磁盘身份匹配、已有意图及新启动回执时换发派生租约；其余阻断并待核销 |
| 预留空间不足、运行时缺失、配额不支持 | 计划给出实际原因与有限能力；不擅自联网或宣称硬隔离 |
| 仅有 NAT、过滤不覆盖 IPv6 或联网租约到期 | 拒绝受限联网计划或确认实际阻断外连；不能凭 NAT 开关或到期字段显示限制生效 |
| 上传中断、制品损坏、跨应用引用、路径越界 | 拒绝封存或执行；保留可核销的部分状态，已引用制品不被清理 |
| 新版健康失败、探针过期或路由遭外部修改 | 保留旧服务或关闭不明入口；不能覆盖更高路由修订 |
| 迁移已写数据后进程崩溃 | 标记数据状态未知，禁用自动旧版启动，要求核对提交点或恢复 |
| 控制器在切流后、登记成功前崩溃 | 用持久意图和实际路由恢复；不重复切换，不把旧版误删为孤儿 |
| 写者租约过期但原进程仍活着 | 先隔离原写者；不能仅凭到期时间让两个控制器同时写入 |
| 备份文件完整但业务恢复失败 | 检查点完整性通过、恢复演练失败分别展示；不显示恢复可用 |
| 关闭可选来源或撤销发布者 | 已运行应用继续保留；新的来源安装阻断并解释处理方式 |
| 插件停用、权限撤销、页面取消 | 禁止后续业务写入；原身份清理单独记录，未验证清理保持待核销 |
| 卸载后重新安装或请求清除数据 | 保留数据可被显式重新绑定；永久删除须独立计划且精确归属验证 |

正式验收至少覆盖静态无状态、带持久数据的 HTTP 服务和无 HTTP 的命令服务。Node/Python 支持按实际镜像矩阵逐项声明；未验证的镜像、架构与文件系统能力不能以模板存在代替通过。测试材料留在忽略目录，Git 仅保留契约、实现、文档和简短验证结论。
