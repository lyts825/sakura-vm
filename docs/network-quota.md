# 客户机网络配额

在“能力中心 → 扩展能力 → 客户机网络配额”中选择 `network-quota`，把 `mode` 设为 `status`、`apply` 或 `clear`。`egressKbps` 是指定客户机网卡的出站上限（64–1,000,000 Kbit/s），`burstKiB` 是突发缓存，`latencyMs` 是队列等待上限。`maxTcpConnections` 限制同时存在的出站 TCP 连接数，`newTcpConnectionsPerSecond` 限制每秒新建 TCP 连接数，`connectionBurst` 允许短暂突发。连接限制设为 `0` 表示不限。检查按钮读取当前网卡和防火墙规则。

带宽规则使用 Linux `tc` TBF，连接规则同时应用于 IPv4 和 IPv6 的 OUTPUT 链。运行中的客户机需要 `iproute2`；启用连接限制时还需要 `iptables`、`ip6tables`、连接跟踪和管理员网络权限。应用前读取现有根队列；发现 netem、HTB 或其他非默认规则时拒绝覆盖。连接规则先构建新链，再接入 OUTPUT；失败时清理新链。清除只删除 Sakura 使用的 `42:` TBF 根规则与带标记的连接链，不修改其他防火墙规则。客户机重启后内核规则消失，需要再次应用。

速率限制统计 TCP 建连请求，不统计复用同一连接的 HTTP 请求；并发上限不主动断开已建立的连接。IPv4 与 IPv6 分别计数，跨两个地址族的合计值可能超过单个配置值。带宽限制作用于所选网卡的出站方向，不对入站字节限速。`npm run test:network` 在真实 Alpine/QEMU 客户机中检查带宽发送计数、实际的超额建连拒绝、在线替换和清除。
