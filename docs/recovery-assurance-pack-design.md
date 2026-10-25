# 恢复验证插件包设计

## 1. 版本与使用结果

设计版本 4.0.0，日期 2026-10-25。核对基线为应用 2.7.0 / `237d7bc`，工作区另有 2.8.0 实施改动。包 ID 为 `recovery-assurance`，包含 11 个拟议插件，实现状态为待开始。共同约定见[第四批总览](plugin-pack-next-design.md)。

用户为一组业务组件选择固定备份、恢复顺序和成功条件，在隔离副本中验证文件、数据与服务，再取得恢复耗时、数据缺口和清理证据。交付物是可复核的恢复验证档案及下一次演练计划。

现有[灾备演练](disaster-recovery-drill.md)验证单个备份启动及指定路径，[文件级恢复](backup-file-recovery.md)提取指定文件。本包增加多组件恢复关系、业务探针、恢复目标和历史比较。原备份的制作、保留、远端删除及正式故障切换仍由原领域负责。

首版支持显式上传的固定本地备份和经过验收的备份只读适配器。真实恢复只作用于新建副本；导入的历史报告可以审阅，但不能证明本机已完成恢复。

## 2. 内部插件与依赖

表内接口均为拟议。依赖使用完整 ID；每个插件拥有自己的记录，工作台不另存一套运行结果。

| 插件 ID | 专属对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `recovery-sources` | 上传字节、来源许可和备份格式探测；AssuranceSourcesV1：upload、inspect、pin | — | — |
| `recovery-catalog` | 组件与固定恢复点、完整/增量组成及缺项；AssuranceCatalogV1：register、resolveChain、capture | recovery-sources | backups |
| `recovery-objectives` | 业务范围、目标时长和数据容忍窗口；AssuranceObjectivesV1：define、validate、seal | recovery-sources, recovery-catalog | — |
| `recovery-probes` | 文件摘要、只读数据检查、固定健康探针及期望值；AssuranceProbesV1：compile、validate | recovery-sources | — |
| `recovery-plans` | 恢复依赖图、组件映射、工具和预算；AssurancePlansV1：compose、preview、seal | recovery-sources, recovery-catalog, recovery-objectives, recovery-probes | — |
| `recovery-sessions` | 原副本租约、恢复步骤、实际探针证据和清理回执；AssuranceSessionsV1：preview、start、cancel、reconcile | recovery-sources, recovery-plans, recovery-catalog, recovery-probes, projects, snapshots | secrets |
| `recovery-evaluations` | 目标达成、计时范围、数据缺口和证据覆盖；AssuranceEvaluationsV1：evaluate、compare | recovery-sources, recovery-sessions, recovery-objectives, recovery-probes | — |
| `recovery-reviews` | 人工复核、例外理由和整改记录；AssuranceReviewsV1：review、assignFollowup、resolve | recovery-sources, recovery-evaluations | — |
| `recovery-reports` | 固定报告、覆盖矩阵和历史变化；AssuranceReportsV1：assemble、seal、diff | recovery-sources, recovery-plans, recovery-sessions, recovery-evaluations, recovery-reviews | — |
| `recovery-exchange` | 精确材料清单、验证档案封套和接收映射；AssuranceExchangeV1：export、inspectImport、acceptImport、verify | recovery-sources, recovery-catalog, recovery-objectives, recovery-probes, recovery-plans, recovery-sessions, recovery-evaluations, recovery-reviews, recovery-reports | — |
| `recovery-workbench` | 准备、恢复进度、目标判断、整改和原资源清理；AssuranceWorkbenchV1：view、templates | recovery-sources, recovery-catalog, recovery-objectives, recovery-probes, recovery-plans, recovery-sessions, recovery-evaluations, recovery-reviews, recovery-reports, recovery-exchange | — |

`recovery-catalog` 的备份采集适配须由 `backups` 新增固定来源接口，保留备份锁和原读回执。当前下载接口不能直接充当长期引用。本包无法延长原备份保留期；持有独立字节后，目录明确区分本地材料与原备份状态。

`recovery-sources` 拥有空间元数据及根容量账本，并提供空间创建、授权查询和关闭预览。其他服务登记自有对象的容量及保护引用；根账本只记归属和占用，不接管原运行回执或读取其他插件正文。

## 3. 完整用户流程

1. 创建空间，选择“文件恢复证明”“应用与数据库恢复”或“恢复点缺口”模板。示例只生成定义，不启动 VM。
2. 上传备份或显式采集已授权的固定备份。检查格式、摘要、分卷、增量父项和加密状态；缺项列出准确恢复点。
3. 登记组件关系，指定一致性检查点、允许的数据损失和恢复时长。未知时间及不同时间基准保留为未知。
4. 设置只读探针与期望值，封存恢复顺序、内部通信、工具镜像、目标和资源上限。
5. 预览需要解密的材料、全部副本和预算。确认后先校验，再创建副本，按依赖顺序恢复和探测。
6. 查看组件级结果、未覆盖检查和耗时区间。探针失败保留诊断；人工说明不能覆盖实际失败。
7. 审阅目标差距，登记整改负责人标签和下一次候选日期。保存日期不会自动安排执行。
8. 确认原副本、解密暂存及内部网络清理，再封存最终报告并按清单导出。交接账本另行核销传输租约；本地备份材料按保留选择和引用清理。

## 4. 数据、计时与执行边界

`RecoveryPoint` 固定来源字节摘要、组件 ID、格式、父项和数据一致性时间证据。备份完成时间不能替代最后可恢复事务时间。应用与数据库来自不同时间点时，先显示一致性缺口，不能只凭两者均能启动判为通过。

`RecoveryPlan` 固定组件有向无环图、每项恢复点、探针版本、解密引用、镜像摘要及内部通信矩阵。依赖环、丢失父项、缺少工具、无法证明隔离或超额均在执行前拒绝。首版只支持实施时验证过的格式与版本；未知格式保持不支持。

恢复时间目标（Recovery Time Objective，RTO）明确计时起点与终点。报告分别列出排队、材料准备、恢复、启动和业务探针耗时；总时长从批准后的执行准入开始，到必需探针达到预设条件结束。重复比较必须使用同一计时口径。

恢复点目标（Recovery Point Objective，RPO）的判断绑定模拟事故时刻和已证明的一致性检查点。时钟偏差、缺少事务时间或不一致的组件检查点使相关结论为不确定。文件摘要一致只证明指定文件内容，不证明全部业务数据一致。

任务状态沿用总览。组件状态为 `pending → restoring → booting → probing → finished`，终止原因另记 `failed/cancelled/interrupted`；业务判断和清理状态独立。一个组件失败后，依赖它的组件记为阻断，不能按未运行检查计算通过率。

拟由 `snapshots` 以新增公共服务提供 `RecoveryRehearsalSessionsV1`，`recovery-sessions` 通过已声明的直接依赖取得绑定句柄。新接口负责固定备份导入、独立副本、内部网络、固定探针和原身份核销，保留快照领域的创建及销毁权威。现有 bundles 等服务不视为已经实现该协议。来源字节只能经 catalog 的固定材料租约取得，不能传入任意宿主路径或绕过旧导入器准入。

首版探针限定为普通文件存在与摘要、固定数据模板的记录数/检查点查询，以及计划内副本服务的固定健康请求。文件路径受允许根目录约束，数据模板参数按模式验证；不接受任意 SQL、Shell 或外部 URL。没有匹配适配器的探针在预览时拒绝。

上传备份中的启动代码只在隔离副本运行；默认没有外部网络、宿主目录、公开端口或生产身份注入。内部联通限计划内副本和端口。清理待确认时可以封存中间报告，但必须标注未完成收尾；新回执产生新的报告修订，不能补写已经导出的字节。

解密仅使用执行时仍获准的秘密引用；密钥、令牌和解密正文不进入报告。备份自身可能包含业务凭据，报告必须提示其材料属性；隔离恢复不向生产服务验证这些凭据。解密暂存按明文字节计费，并纳入清理回执。

## 5. 页面、HTTP 与 CLI

页面包含恢复点、组件关系、目标、探针、计划、运行、整改、报告与交接。首次运行显示格式与镜像缺项；执行页分别显示业务检查和资源收尾。CLI 别名为 `assure`，所有命令以 `sakura assure` 开头。

| 操作 | 拟议 HTTP | CLI 子命令 | 返回要点 |
| --- | --- | --- | --- |
| 核对恢复点组成 | `/api/recovery-catalog/resolveChain` | `point resolve` | 全部组成、缺项、固定摘要 |
| 固定计划 | `/api/recovery-plans/compose` | `plan compose` | 组件关系、探针和目标版本 |
| 执行预览与提交 | `/api/recovery-sessions/preview`、`/api/recovery-sessions/start` | `run preview`、`run start` | 全量计划摘要、批准绑定、原运行 ID |
| 目标判断 | `/api/recovery-evaluations/evaluate` | `evaluation create` | 计时口径、数据缺口、覆盖及不确定项 |
| 原资源核销 | `/api/recovery-sessions/reconcile` | `run reconcile` | 原副本及暂存的清理证明 |
| 档案交接 | `/api/recovery-exchange/export` | `export`、`verify` | 精确材料和离线核验结果 |

HTTP 默认使用总览规定的命名 POST 入口。`verify` 是本地只读命令，不调用 export HTTP。恢复点、计划、运行和报告均提供分页读取；业务探针不能通过浏览器提交伪造成功证据。

## 6. 预算、失败与验收

拟定硬上限：每空间 100 个组件、500 个恢复点、100 个计划；每次最多 4 个组件、100 项探针，单项 60 秒，整次 60 分钟。全包同时运行 1 次，每台副本最多 2 vCPU、4 GiB 内存、16 GiB 虚拟磁盘，合计最多 4 台。源材料 16 GiB/件，包总量 128 GiB，导出上限 1 GiB；大型备份默认只列摘要及缺项，不夹带进入报告。所有上限仍受宿主共同额度约束。

准入须计入源材料、分卷重组、明文暂存、全部声明虚拟磁盘、镜像和报告。128 GiB 只是设计上限，不表示当前宿主支持该额度。共同额度、流式上传和独立截止未验收前，只能使用更小的已验证限制。

| 异常 | 必须保留的状态与恢复方式 |
| --- | --- |
| 备份损坏、父项缺失或密码不可用 | 拒绝创建副本，显示具体组成及错误；不回退到较新备份 |
| 启动成功但业务探针失败 | 记录恢复可启动、业务未通过，不提升总体结论 |
| 控制器退出或恢复响应丢失 | 查询原意图及创建回执，不新建第二套副本；未知占用继续计费 |
| 撤权、取消或时限到期 | 停止调度，终止原执行域；清理能力只处理原资源 |
| 暂存或副本清理失败 | 标记清理待确认，保留租约、占用和重试入口，不能覆盖下一次运行 |
| 导入历史报告缺少源备份 | 允许审阅有界报告，明确不可本地重算，也不签发本地运行证明 |

实施前置为流式材料与恢复账本、备份固定来源服务、`RecoveryRehearsalSessionsV1` 及经过实机验证的恢复工具。沿用 `snapshots`、`backups` 的原资源权威；现有灾备演练的单任务方法不自动满足本包多副本协议。

| 验收场景 | 可判定结果 |
| --- | --- |
| 三个模板的完整流程 | 实际恢复固定备份，取得探针原始证据、目标判断、报告和清理回执 |
| 两组件依赖与不同检查点 | 按依赖顺序启动；不一致数据点使对应目标无法通过 |
| 文件正确、业务记录缺失 | 文件检查通过，业务检查失败，总体不通过 |
| 损坏分卷、缺父项、错误密钥 | 在对应阶段明确拒绝，未授权明文不进入输出 |
| 同一请求重复及进程退出 | 复用原回执，不重复创建；跨代查询须重新鉴权 |
| 取消与外连尝试 | 拒绝生产网络访问，所有原副本及子进程结束，失败清理有可查询责任记录 |
| 导出、篡改及异机接收 | 篡改拒绝；完整档案映射为新 ID，原批准和执行权限不生效 |

只有实际恢复、业务探针、异步恢复核对和原资源清理全部通过，才能将该包标记为已实现。历史报告展示与离线校验可以先交付，但不能替代完整包验收。
