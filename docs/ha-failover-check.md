# 故障接管策略与健康检查

第三批能力中心的“故障接管策略与健康检查”可保存目标、故障阈值和副本最长时效，并持续观察本机主实例的运行状态。API 使用 `POST /api/vms/:vmId/next-features` 的 `configure`，设置 `featureId: "ha-failover"`、`enabled: true` 和 `options.targetHostId`（已配对主机的主机 ID），可选设置 `failureThreshold`（2–10，默认 3）与 `maxReplicaAgeMinutes`（1–10080，默认 1440）。`check` 结果包含主实例状态、目标资源和平台观测、最近已校验快照副本的实时回执与数据时效、阻断原因，并保存到该实例的能力执行历史。

启用并选定目标后，主实例首次进入 `running` 时监测器开始计数；每 15 秒采样一次，连续 `failureThreshold` 次处于 `error` 或 `stopped` 则标记为疑似故障。恢复运行会清零；通过 Sakura 主动停止或暂停时会撤销监测。进程异常退出与故障计数写入 `ha-failure-monitor.json`，服务异常终止后重启可继续观察；正常关闭服务会撤销监测，避免计划关机触发误报。`GET /api/vms/:vmId/next-features` 的 `haFailoverMonitor` 和手动 `check` 结果的 `monitor` 显示采样状态。

这只是来源主机上的 QEMU 运行状态监测，不能在来源宿主失联时独立判定故障，也不能证明客户机应用健康。来源主机故障时本机控制服务可能同时不可用；独立见证节点、源端栅栏、目标受控启动和流量切换仍缺失。即使达到阈值且目标有新鲜副本，检查仍返回 `ready: false, executed: false`，不会自动启动副本。使用已实现的[跨主机快照复制](snapshot-replications.md)可预先创建独立副本，但它本身不构成自动故障接管。
