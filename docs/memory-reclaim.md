# 客户机内存压力自动回收

在“能力中心 → 资源”启用自动内存回收并保存最低目标后，Sakura 每 15 秒读取运行中 Linux 客户机的 `/proc/meminfo`。`MemAvailable / MemTotal` 连续三次达到 55% 时，请求 Virtio 内存气球把目标降低至多 64 MiB；低于 20% 时请求恢复 128 MiB，最多到实例配置内存。每次调整后冷却 60 秒，避免来回跳变。最低目标取策略值、发行版最低内存要求和 256 MiB 中的最大值。关闭 Virtio 气球设备的实例不能启用该策略。

策略按实例持久保存；停止实例时不采样，重新启动后从当前配置内存重新判断。页面展示最近采样、可用内存与请求的气球目标。关闭策略不会自动恢复当前目标，可使用原有“动态内存目标”滑块恢复，或者重新启动实例。气球目标是 QEMU 接受的请求，不是宿主立即实际回收的字节数；客户机驱动和内存占用决定达到目标的速度。

```text
GET  /api/vms/:vmId/memory-reclaim
POST /api/vms/:vmId/memory-reclaim
     {"operation":"configure","policy":{"enabled":true,"minMiB":512}}
     {"operation":"sample"}
```

`npm run test:memory-reclaim` 使用真实 QEMU/Alpine 验证客户机内存采样触发 Virtio 气球目标从 1024 MiB 降至 960 MiB；单元测试覆盖持续高空闲、低内存恢复与策略重启持久化。
