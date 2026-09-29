# 故障接管策略与健康检查

第三批能力中心的“故障接管策略与健康检查”可保存目标、故障阈值和副本最长时效，并持续观察本机主实例的运行状态。API 使用 `POST /api/vms/:vmId/next-features` 的 `configure`，设置 `featureId: "ha-failover"`、`enabled: true` 和 `options.targetHostId`（已配对主机的主机 ID），可选设置 `failureThreshold`（2–10，默认 3）、`maxReplicaAgeMinutes`（1–10080，默认 1440）和 `autoProcessFailover`（默认 `false`）。`check` 结果包含主实例状态、目标资源和平台观测、最近已校验快照副本的实时回执与数据时效；开启本机进程故障接管后还会验证目标启动权限与停机状态。`localProcessReady` 仅在本次服务已观察过来源进程运行、故障达到阈值且其余预检均通过时才为真；检查本身不会启动副本。

启用并选定目标后，主实例首次进入 `running` 时监测器开始计数；每 15 秒采样一次，连续 `failureThreshold` 次处于 `error` 或 `stopped` 则标记为疑似故障。恢复运行会清零；通过 Sakura 主动停止或暂停时会撤销监测。进程异常退出与故障计数写入 `ha-failure-monitor.json`，服务异常终止后重启可继续观察；正常关闭服务会撤销监测，避免计划关机触发误报。`GET /api/vms/:vmId/next-features` 的 `haFailoverMonitor` 和手动 `check` 结果的 `monitor` 显示采样状态。

要启用本机进程故障接管，先用[跨主机快照复制](snapshot-replications.md)创建停机副本，在目标主机的入站配对中分别授予“实例包导入”和“故障副本接管”，再勾选“本机 QEMU 进程退出后自动接管”。来源本次服务运行期间必须实际见过该 QEMU 运行；旧监测记录或服务重启后未托管的进程不构成退出证据。达到故障阈值后，Sakura 重新检查目标容量、平台、回执、快照时效和目标停机状态，在本机持久保存来源启动栅栏，然后请求目标启动。来源启动会返回 `HA_SOURCE_FENCED`；目标启动失败时保留栅栏并重试。目标仅返回“正在启动”时来源继续封锁、接管状态不记为已接受；目标客户机真正进入 `running` 后才记为已接受。

已导入的快照副本不能通过普通实例启动入口启动。目标仅接受已配对来源主机的故障副本接管请求，并再次核对来源主机、复制任务、来源实例、快照及磁盘校验值；这样手动启动备用实例不会绕过接管栅栏。

退出接管须先在目标主机停止副本，并回迁目标运行期间的新写入，或明确接受丢失这些写入。来源实例面板需勾选数据确认后才能点“目标停机后退出接管”；API 使用同一路径的 `run`，传入 `{ "mode": "rejoin", "dataReconciled": true }`。来源经认证请求目标把该副本持久标记为不可重启，收到确认后才解除自身栅栏。目标仍运行、不可访问或权限撤销时，来源保持封锁；若目标已封锁但响应丢失，重复操作仍可完成。退出后旧副本不可再用于接管，需要重新复制快照。

## 独立见证节点接管宿主失联

仓库现在提供独立 HTTPS 见证程序（`npm run ha:witness`）。它每 15 秒接收来源 Sakura 的已校验副本心跳；连续 `failureThreshold` 次心跳缺失后，先持久记录隔离阶段，再通过 Redfish `ForceOff` 关闭**来源宿主**，直到该系统资源明确返回 `PowerState: "Off"`。隔离失败或结果不明确时，绝不启动目标。隔离确认后，见证程序使用来源与目标的已配对令牌复核并启动精确的快照副本；目标进入 `running`、应用健康接口确认、流量接口确认目标实例后，才记录接管完成。故障中断后会从持久状态重试，不重新允许来源启动。后台接管不依赖目标网页会话保持解锁；实例应急锁与数据目录维护状态仍会阻止操作。

来源实例一旦启用宿主失联接管，就把见证登记持久写入 `machines.json`。每次启动都必须先获得见证节点授权；见证不可达、状态文件损坏、HA 插件未加载时均拒绝启动。目标快照副本也不能从普通“启动实例”入口手动启动。启用或修改见证目标与阈值前须停止来源实例；关闭策略会先取得见证节点的撤防确认，再清除本机登记。删除来源实例前须先撤防。

见证程序要部署在独立于来源与目标的第三节点，并使用持久存储。`npm run build` 会生成 `.sakura-witness/ha-witness.js`，运行包也包含它。在首次部署、**确认目标副本未运行且没有历史接管记录之后**，执行 `npm run ha:witness -- --initialize <witness-config.json>` 创建状态文件；随后执行 `npm run ha:witness -- <witness-config.json>` 启动。状态文件丢失或损坏时，程序拒绝自动初始化；应先核实源、目标和流量的实际状态，再人工恢复或初始化，不能把空状态当作安全的来源授权。

见证配置 JSON 包含 `version: 1`、`listen`（`host`、`port`、TLS `certFile`、`keyFile`）、`stateFile`、64 位十六进制 `sourceToken`，以及每个实例的 `vms` 项。每项填写 `sourceHostId`、`sourceVmId`、`targetHostId`、`failureThreshold`，并配置：

| 字段 | 内容 |
| --- | --- |
| `redfish` | 来源宿主 BMC 的 HTTPS `baseUrl`、`systemPath`（如 `/redfish/v1/Systems/1`）、`username`、`password`，以及 `caFile` 或 SHA-256 证书 `fingerprint` 二选一。见证程序按 [DMTF ComputerSystem Reset](https://github.com/DMTF/Redfish-Publications/blob/main/openapi/ComputerSystem.v1_0_6.yaml) 发 `ForceOff` 并轮询 `PowerState`。|
| `target` | 目标 Sakura 主机的配对 HTTPS `baseUrl`、证书 `fingerprint`、来源主机在 `host-peers.json` 中保存的该目标配对 `token`。目标入站配对必须授予导入和故障接管权限。|
| `application` | 应用健康 HTTPS `url`、64 位十六进制 `token`，可选证书 `fingerprint`。`GET <url>?vmId=<目标实例 UUID>` 须返回 `{ "ready": true, "vmId": "<目标实例 UUID>" }`。|
| `traffic` | 流量控制 HTTPS `baseUrl`、64 位十六进制 `token`，可选证书 `fingerprint`。`POST /activate` 接收 `{ "sourceVmId": "...", "targetVmId": "..." }`，须幂等返回 `{ "accepted": true, "activeVmId": "<目标实例 UUID>" }`；`GET /status?sourceVmId=...` 须返回同一 `activeVmId`。|

来源 Sakura 的 `SAKURA_HA_WITNESS_CONFIG_FILE` 环境变量指向另一个仅包含 `version: 1`、见证节点根 `url`、其证书 `fingerprint` 和相同 `token` 的 JSON 文件。配置后重启来源服务，在实例的故障接管面板选定目标，启用“独立见证节点确认宿主隔离后自动接管”，并保持见证配置中的阈值一致。更换目标或阈值时，先关闭策略并获得撤防确认，再更新见证节点配置、停止来源实例并重新启用。来源只在目标容量、平台、快照时效、复制回执和目标停机状态均通过时发送布防计划；不满足时发送撤防心跳。检查结果包含见证状态，只有来源计划与见证布防均就绪才报告 `ready: true`。

宿主失联后的回切需要先停止目标、回迁目标期间的新写入或明确接受丢失，并在来源面板确认后执行“目标停机后退出接管”。见证节点会让目标副本持久退役，才重新允许来源启动；流量回切由运维侧在来源应用恢复健康后进行。不要在目标运行期间重新初始化见证状态或直接修改本机登记。

目前已通过独立 HTTPS 服务模拟 Redfish、配对目标、应用健康和流量接口，以及见证重启/失败路径单元测试。**尚未在用户的真实第三节点、BMC、应用健康端点与流量控制系统上完成故障演练**，目录仍标为部分实现。已移除源实例的[冷迁移](cold-migration.md)可单独授权目标启动；那是另一种流程。
