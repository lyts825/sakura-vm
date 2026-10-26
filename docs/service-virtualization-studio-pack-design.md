# 多服务模拟工作室插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；应用保持 2.8.1，核对基线为 `4afb3b9a`。包 ID 为 `service-virtualization-studio`，含 15 个拟议插件，运行实现待开始。共同约定见[第七批总览](plugin-pack-seventh-design.md)。

用户把多个服务合同、数据及跨服务反应组织为可复用模拟环境，运行消费者场景，固定联合状态并从检查点派生对比。交付多服务环境版本、场景包、联合快照、逐请求证据及覆盖报告。

既有 [integration-mocks](integration-lab.md) 已支持单服务有限状态、延迟、断连及会话隔离。本包新增多服务拓扑、跨服务确定性转发、联合快照和分支复位；沿用已有单服务语义，不重建接口验证或生产流量代理。

## 2. 内部插件与直接依赖

下列服务均为拟议 V1，直接依赖使用完整 ID；`@projects` 是基线插件。新包无需启用 `integration-lab` 整包。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `virtservice-spaces` 模拟空间 | 空间、授权修订和额度根账本；VirtserviceSpacesV1：create、list、archive | — | — |
| `virtservice-contracts` 服务目录 | 服务身份、操作、请求与响应合同；VirtserviceContractsV1：upload、validate、seal | `virtservice-spaces` | — |
| `virtservice-payloads` 响应材料 | 固定正文、字段映射及虚构数据集；VirtservicePayloadsV1：upload、compose、pin | `virtservice-spaces`, `virtservice-contracts` | — |
| `virtservice-matchers` 匹配规则 | 方法、路径、字段条件及显式优先级；VirtserviceMatchersV1：save、validate、seal | `virtservice-spaces`, `virtservice-contracts` | — |
| `virtservice-states` 服务状态 | 各服务初始键值、状态模式及重置基线；VirtserviceStatesV1：save、validate、seal | `virtservice-spaces`, `virtservice-contracts`, `virtservice-payloads` | — |
| `virtservice-transitions` 联动规则 | 局部状态变化、固定内部调用及联合提交次序；VirtserviceTransitionsV1：save、validate、seal | `virtservice-spaces`, `virtservice-contracts`, `virtservice-matchers`, `virtservice-states` | — |
| `virtservice-faults` 故障档案 | 指定服务/操作的延迟、错误与断连脚本；VirtserviceFaultsV1：save、validate、seal | `virtservice-spaces`, `virtservice-contracts`, `virtservice-matchers` | — |
| `virtservice-scenarios` 消费者场景 | 固定请求、跨服务期望、分支点与检查点要求；VirtserviceScenariosV1：compose、preview、seal | `virtservice-spaces`, `virtservice-contracts`, `virtservice-payloads`, `virtservice-states`, `virtservice-transitions`, `virtservice-faults` | — |
| `virtservice-packages` 环境版本 | 服务拓扑、端点槽位、完整定义和工具要求；VirtservicePackagesV1：assemble、validate、seal | `virtservice-spaces`, `virtservice-contracts`, `virtservice-payloads`, `virtservice-matchers`, `virtservice-states`, `virtservice-transitions`, `virtservice-faults`, `virtservice-scenarios` | — |
| `virtservice-sessions` 环境会话 | 原客户机、内部监听、联合检查点及分支回执；VirtserviceSessionsV1：preview、start、checkpoint、fork、cancel、reconcile | `virtservice-spaces`, `virtservice-packages`, `virtservice-scenarios`, `@projects` | — |
| `virtservice-traffic` 请求证据 | 原请求序号、服务间因果关联和选定正文；VirtserviceTrafficV1：capture、readRequests、coverage | `virtservice-spaces`, `virtservice-contracts`, `virtservice-sessions` | — |
| `virtservice-assertions` 场景判断 | 合同匹配、联合状态、分支差异及覆盖；VirtserviceAssertionsV1：evaluate、compare、explain | `virtservice-spaces`, `virtservice-contracts`, `virtservice-scenarios`, `virtservice-packages`, `virtservice-sessions`, `virtservice-traffic` | — |
| `virtservice-reports` 模拟报告 | 环境版本、固定分支、判断和原资源核销索引；VirtserviceReportsV1：assemble、review、seal | `virtservice-spaces`, `virtservice-packages`, `virtservice-sessions`, `virtservice-traffic`, `virtservice-assertions` | — |
| `virtservice-exchange` 模拟交接 | 环境定义、联合快照和报告的隔离交换；VirtserviceExchangeV1：export、inspectImport、acceptImport | `virtservice-spaces`, `virtservice-contracts`, `virtservice-payloads`, `virtservice-matchers`, `virtservice-states`, `virtservice-transitions`, `virtservice-faults`, `virtservice-scenarios`, `virtservice-packages`, `virtservice-sessions`, `virtservice-traffic`, `virtservice-assertions`, `virtservice-reports` | — |
| `virtservice-workbench` 模拟工作台 | 服务图、联动编辑、检查点树和逐请求导航；VirtserviceWorkbenchV1：view、templates | `virtservice-spaces`, `virtservice-contracts`, `virtservice-payloads`, `virtservice-matchers`, `virtservice-states`, `virtservice-transitions`, `virtservice-faults`, `virtservice-scenarios`, `virtservice-packages`, `virtservice-sessions`, `virtservice-traffic`, `virtservice-assertions`, `virtservice-reports`, `virtservice-exchange` | — |

单服务匹配格式与验证逻辑应抽成无权限公共库复用，不从其他插件目录读取定义。新会话能力属于本体执行领域扩展，不调用 `integration-*` 插件服务，因此无需隐含启用它们。

## 3. 模板与完整流程

| 模板 | 多服务关系 | 需要判断的结果 |
| --- | --- | --- |
| 下单与库存 | 订单调用库存预留，再确认订单 | 成功与库存拒绝两分支的联合状态 |
| 登录与用户资料 | 身份服务签发虚构令牌，资料服务匹配声明 | 过期、缺字段和服务恢复的消费者行为 |
| 支付结果对账 | 支付状态改变，订单按固定轮询读取 | 响应丢失与重复查询的状态一致性 |

1. 创建空间，导入合同和虚构载荷，编辑服务目录及逻辑端点。
2. 设置各服务初始状态、匹配优先级、固定内部调用及故障规则。
3. 编排消费者场景，声明检查点和待比较分支，展开全部服务与请求范围。
4. 封存环境版本，预览资源和截止，在专属客户机启动内部服务及固定消费者驱动。
5. 执行场景，在全部服务停准入且无在途请求时建立联合检查点。
6. 固定检查点后先关闭并核销原会话，再派生两个新会话，分别应用明确故障变体并比较结果。额度不足时顺序执行两个分支。
7. 核销全部监听、连接、后代进程和 VM，再审阅并封存报告。
8. 导出环境与选定证据，离线核验并隔离接收；后续运行必须新建计划。

## 4. 合同、状态与本体边界

首版接受受限 HTTP 合同 JSON，以及按明确子集转换的 OpenAPI 材料。支持方法、路径、允许头、JSON 请求与响应、有限状态和固定内部调用；不支持任意服务端脚本、真实凭据、外部 URL 或动态代理。

匹配采用显式优先级和唯一决胜规则，重叠条件在封存前检查。未匹配请求返回固定诊断响应并记入覆盖缺口，不能透传给真实服务。全部内部调用引用逻辑服务及操作 ID，不接受请求数据拼成的目标地址。

每个场景固定消费者序列及内部调用排序。跨服务循环必须声明最大跳数与累计请求预算；达到上限停止该场景。可重放的模拟次序不能被解释成真实分布式事务或网络调度保证。

联合检查点仅包含模型状态、固定时钟、随机种子和请求游标，不包含客户机内存或活动 socket。建立检查点须暂停准入并等待所有在途调用终止；无法达到静止状态时拒绝检查点，保留运行原状态。

fork 读取不可变检查点并启动新会话，旧会话不被重置。新分支仍受活动会话上限约束，原会话关闭并确认核销后才腾出名额。导入检查点只产生材料，运行批准、端口和身份全部失效。

重试请求不能凭模拟状态假定外部系统也可安全重试。停止原会话不删除检查点或原轨迹；分支结果仍保护共同检查点，清理须核对这些引用。

拟议本体接口 `MultiServiceVirtualizationSessionsV1` 由原集成执行领域提供，管理固定多服务工具、内部客户端、联合静止检查及原资源核销。它是本体新增适配，不能把现有单服务 PreparedWorkerSessionsV1 当成已有多服务实现。

首版仅在新建专属 Linux 客户机内监听，外部网络、宿主挂载和公开端口默认关闭。服务与消费者都由固定工具创建；用户可运行任意宿主浏览器或真实应用来访问模拟端点的能力不在首版范围。

## 5. 页面、HTTP 与 CLI

页面包括服务拓扑、规则表、初始状态、联动顺序、场景编辑、检查点树、请求详情和报告。服务图始终显示逻辑端点，不泄漏原内部会话令牌；分支对比保留共同检查点和变化项。

| 拟议 HTTP | 对应服务方法 | 用途 |
| --- | --- | --- |
| `POST /api/virtservice-transitions/validate` | VirtserviceTransitionsV1.validate | 检查内部引用、循环和跳数 |
| `POST /api/virtservice-packages/seal` | VirtservicePackagesV1.seal | 固定完整多服务环境 |
| `POST /api/virtservice-sessions/start` | VirtserviceSessionsV1.start | 消费原计划并创建专属会话 |
| `POST /api/virtservice-sessions/checkpoint` | VirtserviceSessionsV1.checkpoint | 静止后固定联合状态 |
| `POST /api/virtservice-sessions/fork` | VirtserviceSessionsV1.fork | 按新计划创建检查点分支 |
| `POST /api/virtservice-assertions/compare` | VirtserviceAssertionsV1.compare | 对比固定分支与证据范围 |
| `POST /api/virtservice-sessions/reconcile` | VirtserviceSessionsV1.reconcile | 核对原监听、进程及 VM |

CLI 拟为 `sakura service-virtualization`，提供 services、rules、environment、session、checkpoint、fork、traffic、check、exchange 和 verify。离线 verify 检查定义及轨迹规则，不启动模拟服务。

## 6. 容量、权限与恢复

设计上限为每环境 20 个服务、每服务 200 条规则和 64 个状态。单载荷最多 256 KiB，场景最多 1000 个消费者请求、10,000 次内部调用，单请求最多 16 跳；每会话最长 15 分钟。

每空间最多 2 个活动会话、每环境 20 份联合检查点，单份检查点最多 16 MiB。包持久上限拟为 1 GiB，含 32 MiB 恢复账本；工具镜像、原磁盘、流和暂存另按所有者计费，并接入既有 8 GiB 宿主总量。

权限沿现有 owner 模型。计划固定合同、环境、消费者、故障、检查点及绝对截止；每个 fork 都是独立新资源计划，不能复用原启动批准。锁定或撤权清除私有页面并停止后续派发。

取消先关闭服务和客户端准入，再收尾原请求、监听、进程和 VM。创建检查点或分支中断时查询原意图及对象图，不能通过重复 fork 猜测是否成功。未知占用保留计费与恢复入口。

交接使用 `sakura-service-virtualization-studio/1`。普通封套上限沿总览，完整引用子图可分批；缺失引用只读保留，不能接收为可运行环境。升级保留旧匹配语义、检查点格式与原字节，不把新工具计算结果覆盖旧证据。

## 7. 实施与验收

实施依次完成定义、公共匹配库复用、本体多服务适配、联合检查点和交接。验收必须运行真实专属工具；单服务既有通过记录不能替代本批验收。

| 场景 | 必须观察的结果 |
| --- | --- |
| 两服务联动 | 原始请求关联到具体内部调用，状态按固定顺序变化 |
| 重叠与未匹配 | 不明确优先级拒绝封存，未匹配请求只返回本地诊断 |
| 联合检查点 | 在途请求未终止时不能封存；完成后所有服务处于同一逻辑边界 |
| 分支隔离与额度 | 原会话核销后再建立两个分支；第三个活动会话拒绝，分支状态互不污染 |
| 循环与预算 | 超过跳数或累计请求上限停止新调用，报告完整停止原因 |
| 响应丢失 | 模拟已提交与消费者未知分别记录，不宣称真实系统已成功 |
| 撤权与中断 | 不再派发请求，全部原监听与 VM 确认退出后释放额度 |
| 交换与重启 | 导入不恢复活动端口，未知 fork 不重复创建，旧检查点可复核 |
