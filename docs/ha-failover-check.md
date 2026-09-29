# 故障接管策略与健康检查

第三批能力中心的“故障接管策略与健康检查”目前只保存策略并提供手动健康检查。可在界面选择已配对主机、故障检查次数阈值和副本最长时效，保存后点击“检查健康”。API 使用 `POST /api/vms/:vmId/next-features` 的 `configure`，设置 `featureId: "ha-failover"`、`enabled: true` 和 `options.targetHostId`（已配对主机的主机 ID），可选设置 `failureThreshold`（2–10，默认 3）与 `maxReplicaAgeMinutes`（1–10080，默认 1440）。`check` 结果包含主实例状态、目标资源和平台观测、最近已校验快照副本的实时回执与数据时效、阻断原因，并保存到该实例的能力执行历史。

当前没有后台故障计数器，`failureThreshold` 仅作为策略记录；不会因一次或多次检查自动切换。来源主机故障时本机控制服务也可能不可用，且缺少独立见证节点、源端栅栏、目标受控启动和流量切换。即使目标有新鲜副本，检查始终返回 `ready: false, executed: false`。使用已实现的[跨主机快照复制](snapshot-replications.md)可预先创建独立副本，但它本身不构成自动故障接管。
