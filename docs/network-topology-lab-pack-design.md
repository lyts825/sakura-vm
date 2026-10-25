# 网络拓扑实验插件包设计

## 1. 版本与用户结果

设计版本 5.0.0，日期 2026-10-25；应用基线 2.7.0 / `5726601`。包 ID 为 `network-topology-lab`，包含 14 个拟议插件，运行实现待开始。共同契约见[第五批总览](plugin-pack-specialist-design.md)。

用户在专属环境搭建多节点网络，检查寻址、路由、域名解析和访问策略，交付固定拓扑、逐探针结果及资源核销记录。首版支持虚拟 IPv4 节点、静态路由、私有名称区和 TCP/UDP 固定探针；其他协议明确标为未覆盖。

[网络模拟](network-emulation.md)和[数据包捕获](packet-capture.md)继续拥有原客户机能力。本包增加拓扑对象、路径期望和独立实验，既有用户 VM、宿主网卡及真实局域网不作为实验目标。

## 2. 内部插件与直接依赖

依赖短名统一补上 `netlab-`，`@projects` 为既有插件；`*` 按总览展开。每项服务均为拟议接口。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `netlab-spaces` 实验空间 | 根账本、模板和输入材料；NetlabSpacesV1：create、upload、pin | — | — |
| `netlab-nodes` 节点目录 | 主机/路由节点、网卡和能力档案；NetlabNodesV1：define、validate | spaces | — |
| `netlab-links` 链路编辑 | 端点、链路参数及碰撞检查；NetlabLinksV1：connect、checkEndpoints | spaces, nodes | — |
| `netlab-addresses` 地址规划 | 子网、网关、地址分配与重复检查；NetlabAddressesV1：allocate、checkOverlap | spaces, nodes, links | — |
| `netlab-routes` 路由规划 | 静态路由、下一跳与预期路径；NetlabRoutesV1：define、traceModel | spaces, nodes, links, addresses | — |
| `netlab-names` 名称解析 | 私有名称区、记录及预期解析；NetlabNamesV1：define、checkRecords | spaces, addresses | — |
| `netlab-policies` 访问策略 | 节点间协议和端口规则；NetlabPoliciesV1：define、checkConflicts | spaces, nodes, addresses | — |
| `netlab-probes` 探针计划 | 固定请求、拒绝期望及采样窗口；NetlabProbesV1：compose、validate | spaces, nodes, addresses, routes, names, policies | — |
| `netlab-runs` 拓扑运行 | 专属 VM、虚拟网络和运行意图；NetlabRunsV1：preview、start、cancel、reconcile | spaces, nodes, links, addresses, routes, names, policies, probes, @projects | — |
| `netlab-captures` 证据捕获 | 已批准接口的包头、计数和丢失声明；NetlabCapturesV1：extract、coverage | spaces, runs | — |
| `netlab-checks` 连通性判断 | 实测与期望对照、未覆盖和异常路径；NetlabChecksV1：evaluate、explain | spaces, probes, runs, captures | — |
| `netlab-reports` 实验报告 | 拓扑版本、模型与实测差异、核销索引；NetlabReportsV1：assemble、seal | spaces, nodes, links, addresses, routes, names, policies, probes, runs, captures, checks | — |
| `netlab-exchange` 拓扑交接 | 拓扑、探针和报告的隔离交换；NetlabExchangeV1：export、inspectImport、acceptImport | * | — |
| `netlab-workbench` 拓扑工作台 | 拖放拓扑、路径高亮和逐探针导航；NetlabWorkbenchV1：view、templates | * | — |

runs 在启动前固定捕获点及过滤器，并拥有原始运行输出；captures 只提取已批准输出，不能临时开启抓包。模型路径是 routes 的计算结果，真实观测由 runs 签发，二者分栏显示。

## 3. 完整使用流程

1. 从“双子网路由”“服务分区”或“私有名称解析”模板创建空间。
2. 添加节点、链路和地址；编辑器定位重复地址、悬空接口和不可达下一跳。
3. 配置私有记录及允许/拒绝规则，编写正向和负向探针。
4. 查看完整拓扑、预期路径、捕获点、预备镜像和资源预算，保存固定计划。
5. 批准后在新建 VM 内创建受限网络命名空间，运行固定探针；页面显示节点进度与实际结果。
6. 比较模型和观测，区分连接成功、明确拒绝、超时和采集缺失；需要修改时建立新拓扑修订。
7. 停止探针，核销命名空间、虚拟接口、捕获进程及 VM，封存报告。
8. 导出拓扑及选定证据，接收端核验后建立新草稿；显式清理无人引用的运行材料。

## 4. 领域规则与资源边界

`TopologyRevision` 固定节点、接口、链路、地址、路由、名称和策略修订。节点间环形拓扑合法；路由模型发现转发环时提示具体路径。不能把拓扑有环与插件依赖有环混为一谈。

首版在一个专属 VM 内建立虚拟节点，共用客户机内核；报告必须标明这一模型，不能宣称验证了独立物理主机、跨宿主时钟或真实硬件转发性能。边界出口由宿主网络领域在客户机之外执行。

拟议 `TopologySandboxV1` 仅接受声明式拓扑和固定探针。工具档案必须列出命名空间能力、接口标识和最大包数。拒绝宿主桥接、设备直通、任意目标地址及任意命令。解析器只使用本次私有名称区，不回退系统公共解析。

`ProbeObservation` 保存源/目的节点、协议、参数、单调时间、返回值和丢失数量。负向探针超时只证明未收到响应；没有足够证据时不得认定策略明确拒绝。采样捕获不能证明全部流量都符合规则。

启动意图保存 VM 创建回执、运行寿命、boot 和虚拟网络身份。控制器退出后独立监管停止原域；无法确认清理时维持 unknown，保留额度且不对同名新 VM 操作。

## 5. 页面、HTTP 与 CLI

页面包括拓扑画布、地址表、路由表、名称区、策略矩阵、探针、运行、证据和交接。所有拖动及表格修改带预期修订；画布同时提供可键盘操作的节点/边列表。CLI 别名为 `netlab`。

| 操作 | 拟议 POST 路径 | CLI（前缀 sakura） |
| --- | --- | --- |
| 检查地址 | `/api/netlab-addresses/checkOverlap` | `netlab addresses check` |
| 模型寻路 | `/api/netlab-routes/traceModel` | `netlab routes trace` |
| 计划/执行 | `/api/netlab-runs/preview`、`/api/netlab-runs/start` | `netlab run preview/start` |
| 取消/核销 | `/api/netlab-runs/cancel`、`/api/netlab-runs/reconcile` | `netlab run cancel/reconcile` |
| 对照结果 | `/api/netlab-checks/evaluate` | `netlab checks evaluate` |
| 交接 | `/api/netlab-exchange/export` | `netlab export`、`netlab verify` |

## 6. 容量、异常与恢复

拟定上限：单拓扑 16 个节点、32 条链路、256 条规则和 500 个探针；每次运行 10 分钟，捕获 100,000 个包头或 32 MiB，先到即止。单包持久材料 2 GiB，封套 256 MiB；同包最多一个活动 VM，磁盘另按 8 GiB 声明容量预留，超出宿主总额须拒绝。

地址冲突和悬空接口阻止执行；工具缺项为不支持；部分节点启动失败时停止调度并核销已创建资源。捕获超限保留截断声明，不把剩余探针判为通过。满盘和停止超时保留原意图及恢复账本。

## 7. 实施与验收

先完成拓扑编辑与规则检查，再实现隔离工具、运行和证据，最后完成报告、交接和工作台。网络隔离与独立截止是运行启用前置。

1. 三种模板均完成编辑、实际运行、报告、交接及原资源清理。
2. 重复地址、非法下一跳与未知节点指向准确对象；路由环保留可解释路径。
3. 正向连通、策略拒绝、名称解析失败和无响应分别产生正确结论。
4. 向外部地址发起未批准探针时，在工具准入和客户机外部边界均拒绝。
5. 捕获截断、节点启动失败、取消和控制器退出不产生假通过或未知资源释放。
6. 原 VM 删除后重建同名 VM，旧核销票据不能触碰新实例。
7. 导入只生成新草稿；仅启用本包及 projects 可以完成全部流程。
