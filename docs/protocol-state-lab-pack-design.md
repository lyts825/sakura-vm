# 协议状态实验插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；应用保持 2.8.1，核对基线为 `4afb3b9a`。包 ID 为 `protocol-state-lab`，含 15 个拟议插件，运行实现待开始。共同约定见[第七批总览](plugin-pack-seventh-design.md)。

用户定义有限二进制消息、握手状态和允许的转换，在专属环境对自己提供的服务制品执行有界场景。交付消息规格、状态轨迹、性质判断及最小化尝试记录，可用于自研协议开发与回归。

[网络拓扑实验](network-topology-lab-pack-design.md)负责节点及路由，[事件队列](event-lab-pack-design.md)负责代理的消息语义。本包关注字节帧与有状态对话；首版仅访问专属客户机内固定端点，不提供公网目标扫描。

## 2. 内部插件与直接依赖

下列服务均为拟议 V1，直接依赖使用完整 ID；`@projects` 是基线插件。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `protostate-spaces` 协议空间 | 空间、授权修订和额度根账本；ProtostateSpacesV1：create、list、archive | — | — |
| `protostate-grammars` 消息语法 | 固定字段、长度、枚举和有限重复规则；ProtostateGrammarsV1：save、validate、seal | `protostate-spaces` | — |
| `protostate-messages` 消息材料 | 原始字节、字段解析和固定消息样本；ProtostateMessagesV1：upload、encode、decode | `protostate-spaces`, `protostate-grammars` | — |
| `protostate-machines` 状态模型 | 起始/结束状态、转换及允许消息集合；ProtostateMachinesV1：save、validate、seal | `protostate-spaces`, `protostate-grammars` | — |
| `protostate-guards` 条件约束 | 字段比较、变量绑定和有界定时条件；ProtostateGuardsV1：save、validate、seal | `protostate-spaces`, `protostate-grammars`, `protostate-machines` | — |
| `protostate-scenarios` 对话场景 | 请求序列、分片边界、关闭和期望分支；ProtostateScenariosV1：compose、preview、seal | `protostate-spaces`, `protostate-messages`, `protostate-machines`, `protostate-guards` | — |
| `protostate-generators` 有界变体 | 固定种子、边界变值、重排及覆盖计划；ProtostateGeneratorsV1：define、expand、seal | `protostate-spaces`, `protostate-grammars`, `protostate-messages`, `protostate-scenarios` | — |
| `protostate-targets` 目标制品 | 用户提供的固定服务字节、启动档案与端口声明；ProtostateTargetsV1：upload、inspect、pin | `protostate-spaces` | — |
| `protostate-runs` 协议运行 | 专属工具会话、原目标进程和逐连接回执；ProtostateRunsV1：preview、start、cancel、reconcile | `protostate-spaces`, `protostate-grammars`, `protostate-messages`, `protostate-machines`, `protostate-guards`, `protostate-scenarios`, `protostate-generators`, `protostate-targets`, `@projects` | — |
| `protostate-traces` 对话轨迹 | 双向字节、顺序、解析投影与丢失声明；ProtostateTracesV1：decode、readFrames、coverage | `protostate-spaces`, `protostate-grammars`, `protostate-runs` | — |
| `protostate-properties` 性质判断 | 状态合法性、响应约定和终止性质；ProtostatePropertiesV1：evaluate、compare、explain | `protostate-spaces`, `protostate-machines`, `protostate-guards`, `protostate-scenarios`, `protostate-runs`, `protostate-traces` | — |
| `protostate-reductions` 失败缩减 | 固定失败判据、候选序列及重复观察；ProtostateReductionsV1：preview、reduce、cancel、reconcile | `protostate-spaces`, `protostate-scenarios`, `protostate-generators`, `protostate-targets`, `protostate-runs`, `protostate-traces`, `protostate-properties` | — |
| `protostate-reports` 协议报告 | 规格、覆盖、反例、人工说明及核销证据；ProtostateReportsV1：assemble、review、seal | `protostate-spaces`, `protostate-grammars`, `protostate-machines`, `protostate-scenarios`, `protostate-runs`, `protostate-traces`, `protostate-properties`, `protostate-reductions` | — |
| `protostate-exchange` 协议交接 | 规格、场景、轨迹与反例的隔离交换；ProtostateExchangeV1：export、inspectImport、acceptImport | `protostate-spaces`, `protostate-grammars`, `protostate-messages`, `protostate-machines`, `protostate-guards`, `protostate-scenarios`, `protostate-generators`, `protostate-targets`, `protostate-runs`, `protostate-traces`, `protostate-properties`, `protostate-reductions`, `protostate-reports` | — |
| `protostate-workbench` 协议工作台 | 字节与字段联动、状态图、轨迹和失败导航；ProtostateWorkbenchV1：view、templates | `protostate-spaces`, `protostate-grammars`, `protostate-messages`, `protostate-machines`, `protostate-guards`, `protostate-scenarios`, `protostate-generators`, `protostate-targets`, `protostate-runs`, `protostate-traces`, `protostate-properties`, `protostate-reductions`, `protostate-reports`, `protostate-exchange` | — |

targets 只保存待执行制品，runs 是原运行资源所有者。reductions 每次候选执行都调用 runs 的固定计划，保留全部原 runId，不自行创建或释放客户机。

## 3. 模板与完整流程

| 模板 | 有限协议示例 | 检查重点 |
| --- | --- | --- |
| 长度前缀回声 | 固定长度字段和正文回显 | 分片、合并、错误长度及连接关闭 |
| 挑战与确认 | hello、challenge、confirm 三步对话 | 顺序、重复确认、超时及状态复位 |
| 分块传输 | 序号、有限分块和完成消息 | 缺块、重复块、重排及总量一致 |

1. 创建空间，编辑有限语法和状态机，导入用户提供的服务制品及消息样本。
2. 按字节与字段联动查看解析结果，明确不支持的字段和有歧义的分支。
3. 编排正常、边界及错误对话，固定种子、变体数量和失败判据。
4. 预览全部目标、输入、预算和截止，在新建专属客户机启动固定工具。
5. 执行场景，显示逐连接原始流及模型投影；异常保留原字节与断开原因。
6. 对稳定失败选择有界缩减，逐候选保留重现次数及不稳定标记。
7. 比较版本，复核性质及覆盖；核销连接、进程和 VM 后封存报告。
8. 导出规格与选定证据，离线核验再隔离接收；接收不会运行目标制品。

## 4. 语法与执行边界

语法使用 JSON 声明定长整数、枚举、固定字节、带上限的长度前缀和有限重复。整数字段明确位宽、符号及字节序；长度字段声明计数单位与覆盖范围。首版不支持递归语法、动态代码、无限回溯或自定义校验脚本。

条件语言只允许有类型的字段比较、有限集合和已声明变量。分支优先级必须明确；多个可达分支不能由实现随机选择。每份模型固定版本与消息语法摘要。

拟议本体接口 `ProtocolScenarioSessionsV1` 在专属 Linux 客户机创建固定目标与驱动进程，绑定内部端点、连接和捕获范围。固定启动档案使用制品摘要、参数数组和环境白名单，不拼接宿主 shell 字符串。

首版传输只支持内部 TCP 字节流。每个连接保存发送、接收及观察时间，TCP 分片不作为应用消息边界。TLS、UDP、原始套接字和外部目标另行实现；未支持模式明确拒绝。

失败判据引用固定性质及原证据，不能将目标无响应自动判成协议漏洞。超时、工具崩溃、捕获丢失和业务失败分开报告。缩减只宣称预算内找到更小反例，不宣称全局最小。

实际工具须证明外部网络隔离、独立截止、目标后代进程归属及原连接关闭。现有网络和项目服务不自动提供这些保证；能力探测未通过的平台不能开始运行。

## 5. 页面、HTTP 与 CLI

页面提供语法编辑、十六进制视图、状态图、场景表、原始轨迹、反例缩减和报告。状态图的高亮是模型解释，始终保留无法解析的原始片段及覆盖缺项。

| 拟议 HTTP | 对应服务方法 | 用途 |
| --- | --- | --- |
| `POST /api/protostate-grammars/validate` | ProtostateGrammarsV1.validate | 检查有限语法和长度引用 |
| `POST /api/protostate-scenarios/preview` | ProtostateScenariosV1.preview | 固定对话和预期分支 |
| `POST /api/protostate-runs/start` | ProtostateRunsV1.start | 消费批准后的原运行计划 |
| `POST /api/protostate-traces/readFrames` | ProtostateTracesV1.readFrames | 分页读取固定轨迹 |
| `POST /api/protostate-properties/evaluate` | ProtostatePropertiesV1.evaluate | 逐性质判断并保留缺项 |
| `POST /api/protostate-reductions/reduce` | ProtostateReductionsV1.reduce | 执行有界反例缩减 |
| `POST /api/protostate-runs/reconcile` | ProtostateRunsV1.reconcile | 核对原资源与迟到回执 |

CLI 拟为 `sakura protocol-state`，提供 grammar、message、machine、scenario、run、trace、check、reduce、exchange 和 verify。离线 verify 只检查语法、轨迹摘要及可重算性质，不回放网络请求。

## 6. 容量、权限与恢复

设计上限为 200 个状态、1000 条转换、每消息 64 KiB、每场景 1000 条消息、每次计划 100 个变体。单次运行最长 120 秒、最多 4 个内部连接、32 MiB 原始流；单次缩减最多 100 次候选及 15 分钟总截止。

包持久额度拟为 1 GiB，含 32 MiB 恢复账本。制品、镜像、专属磁盘、捕获和导出暂存均占原所有者额度；VM 按虚拟容量预留。新包须接入既有 8 GiB 宿主总额，不能把包额度视为额外赠送容量。

沿现有 owner 权限，服务端绑定 actor、空间、generation 与授权修订。批准固定完整生成集合和缩减上限；工作台显示全量计数，分页不缩小范围。规则或制品变化使计划失效。

取消先停止新连接及候选调度，再等原执行域退出。控制器退出后按原票据核对，不能新建 VM 接续未知请求。恢复只查询或核销原资源；清理未知时保留计费和恢复入口。

交接为 `sakura-protocol-state-lab/1`，制品默认不导出，若显式选入则标记可执行材料且不在核验时运行。升级保留旧解析语义与原流；导入轨迹仍为外来证据，不继承真实执行身份。

## 7. 实施与验收

实施先完成有限语法和场景，再补齐固定会话、资源核销与报告交接。真实工具未验证前只完成编辑阶段，不能标记整包完成。

| 场景 | 必须观察的结果 |
| --- | --- |
| 字节与字段往返 | 合法消息编码后按同版本语法解码一致，非法长度指向具体字段 |
| TCP 分片与合并 | 同一应用消息在不同网络分片下得到相同解析结果 |
| 非法状态转换 | 精确记录前状态、消息、触发条件与违反的转换，不丢原字节 |
| 有界生成 | 同种子与同输入生成相同变体，达到上限停止且标记覆盖范围 |
| 不稳定失败缩减 | 候选失败不稳定时保留频次，不能以一次失败声称可靠复现 |
| 超时与捕获缺失 | 工具错误、业务失败和证据不足分别显示，缺失不判通过 |
| 取消与控制器退出 | 原连接、后代进程及 VM 确认退出后才释放容量 |
| 隔离与导入 | 外部端点或宿主挂载拒绝；导入制品及轨迹不产生执行 |
