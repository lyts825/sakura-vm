# 事件与队列实验插件包设计

## 1. 版本与使用结果

设计 3.0.0，2026-10-24；基线 2.7.0 / `912287a`。`event-lab` 含 11 个拟议插件，实现待开始，遵守[第三批共同协议](plugin-pack-suite-design.md)。

用户定义消息、生产计划和消费策略，在专用队列中观察延迟、重复、重投、积压及应用结果去重。首版使用本包固定测试事件协议与持久队列实现，明确标为测试代理；不宣称兼容任何现有消息产品，也不测量生产集群性能。

与[接口验证](integration-lab.md)的请求/响应不同，本包固定消息生命周期及确认语义。与[故障演练](resilience-lab.md)不同，延迟和重投属于预先声明的队列规则，不引入任意网络故障或生产服务操作。

## 2. 内部插件与依赖

短依赖前缀为 `event-`。

| 插件 ID | 专属对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `event-contracts` | 空间、消息模式、键与兼容规则；EventContractsV1：validate、compare | — | — |
| `event-fixtures` | 固定消息正文和生成种子；EventFixturesV1：generate、importRows | contracts | — |
| `event-brokers` | 专用 VM、队列、运行隔离与代理账本；EventBrokersV1：prepare、observe、cleanup | contracts, @projects | — |
| `event-producers` | 发送顺序、速率和消息键；EventProducersV1：compile、previewMessages | contracts, fixtures | — |
| `event-consumers` | 固定消费状态机、确认和幂等策略；EventConsumersV1：compile、validatePolicy | contracts | — |
| `event-scenarios` | 发送、暂停、重投、恢复与截止阶段；EventScenariosV1：compile、preview | contracts, producers, consumers | — |
| `event-runs` | 执行许可、消息意图和原始轨迹；EventRunsV1：preview、start、cancel、reconcile | brokers, scenarios, producers, consumers, fixtures | — |
| `event-assertions` | 顺序、重复、遗漏、确认与业务结果检查；EventAssertionsV1：evaluate、explain | contracts, runs | — |
| `event-reports` | 逐事件轨迹、积压与证据覆盖；EventReportsV1：seal、compare | runs, assertions | — |
| `event-exchange` | 模式、策略、样例和证据包；EventExchangeV1：export、inspectImport、acceptImport | contracts, fixtures, brokers, producers, consumers, scenarios, runs, assertions, reports | — |
| `event-workbench` | 模板、时序检查、异常定位和交接；EventWorkbenchV1：view、templates | * | — |

本包无需其他新包。代理、消费者进程和队列属于 brokers；runs 仅获本次资源的受限许可。producers、consumers 和 scenarios 保存声明，不直接创建进程。代理和消费者只在本次 VM 内连接，不映射宿主端口。

## 3. 完整用户流程

1. 选择“重复消息去重”“确认丢失后的重投”或“慢消费者积压”，创建固定合成消息。
2. 定义消息键和模式，再选择发送计划、消费延迟、确认位置和去重策略。
3. 封存场景，选择已准备镜像，预览消息数量、阶段、代理及截止。
4. 确认后创建专用 VM 和本次队列，执行固定状态机。
5. 查看每条消息的发送、入队、投递、应用结果和确认，核对断言及未知项。
6. 封存报告、导出指定正文或仅摘要，核销原代理与副本。

## 4. 事件与判定语义

`messageId` 标识原消息，`deliveryId` 标识每次投递。日志保留消息键、正文摘要、序列、单调时钟及来源进程身份。生产者写入与代理接收分开记账；确认响应丢失时，不能把发送失败解释为没有入队。

消费模板只允许固定动作：校验、等待、写入本次结果表、确认、拒绝及规定次数重试。没有任意脚本、外部回调或外部数据库。应用结果去重按固定幂等键核验，不宣称传输只发生一次。

顺序只在明确分区和键范围内判断。迟到、重投、未发送、投递未知及已确认分别计数。延迟以同一代理的单调时钟计算；导入轨迹或不同进程时钟不能直接相减。最终计数不完整时，整体为 inconclusive。

测试代理持久保存队列与确认账本。代理进程退出后保留原数据，不自动恢复投递；新演练使用新队列。显式的场景内重投必须包含在原计划中，宿主重启后的恢复只核销原任务。

## 5. 页面、接口与预算

工作台包含模式、样例、生产/消费策略、场景、运行、时序和交接。CLI 别名 `event`。

| 操作 | 拟议 HTTP | CLI | 关键结果 |
| --- | --- | --- | --- |
| 编译策略 | `/api/event-producers/compile`、`/api/event-consumers/compile` | `event producer compile`、`event consumer compile` | 有限状态、数量与拒绝原因 |
| 运行 | `/api/event-runs/preview`、`start` | `event run preview/start` | 固定计划与真实执行回执 |
| 轨迹检查 | `/api/event-assertions/evaluate` | `event assertion evaluate` | 每消息状态、未知及业务重复 |
| 核销/交换 | `/api/event-runs/reconcile`、`/api/event-exchange/export` | `event run reconcile`、`event export` | 原资源状态、数据覆盖 |

拟定每次 10,000 条消息、单条 8 KiB、最多 40,000 次投递，速率 100 条/秒、消费者 4 个，实际并发仍受工具预算约束。运行最多 10 分钟，每包 1 台 2 vCPU / 2 GiB VM，虚拟磁盘 8 GiB。总存储 16 GiB，单次证据 512 MiB、导出 1 GiB。正文按原消息保存一次，投递日志引用摘要。

## 6. 实施与验收

先实现模式、固定状态机和持久队列协议，再通过 EventSessionsV1 的实际进程归属、截止和停止验证，最后接通断言、工作台与交换。队列崩溃恢复不得依赖客户机内存计数。

必须验证三个模板及其失败变体；相同键不同正文、重复确认、先写结果后丢失确认、毒消息重试耗尽、顺序范围误判、调度缺口、控制器冻结、代理崩溃、取消及容量耗尽都须有明确结果。离线核验能重算有完整轨迹的计数，但不能认证外来轨迹确实发生。

未来连接外部消息产品须新增独立适配器、授权及验收。本版的测试协议不会被登记成外部产品兼容证明。
