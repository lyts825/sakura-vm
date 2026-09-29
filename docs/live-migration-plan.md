# 在线迁移前置检查

能力中心的“虚拟机在线迁移”检查读取运行中实例的 QEMU 状态、版本和迁移任务状态，并刷新已配对主机的资源评分。没有指定目标主机时选择一个合格同伴；也可在 `POST /api/vms/:vmId/next-features` 的 `check` 请求中传入 `options.targetHostId`。结果包含候选主机、逐项阻断原因及迁移步骤，不会修改实例或发送数据。

底层 QEMU 传输模块已将 `blockdev-mirror` 的 NBD 磁盘在线镜像与 RAM 预复制组合：先等待磁盘追平，QEMU 在 `pre-switchover` 暂停来源后再次等待最后的脏块追平，取消镜像并关闭 NBD，持久来源栅栏成功后才允许目标继续运行。栅栏前的预复制错误会取消迁移，且仅在确认迁移取消、目标未运行时恢复来源；栅栏结果不确定时维持两端停机以避免双写。独立的 [真实 QEMU 冒烟脚本](../scripts/smoke-qemu-live-migration.ts)使用临时合成磁盘，在 Windows QEMU 11.1 和 WSL Linux QEMU 10.2 上验证正常切换、磁盘内容一致、预复制中断、栅栏失败与磁盘容量不匹配。Windows 可运行 `npm run test:live-migration-transport`；WSL 内可运行 `node --experimental-transform-types scripts/smoke-qemu-live-migration.ts`，并追加 `--interrupt-precopy`、`--fail-fence`、`--different-size` 或 `--remote-endpoint` 验证失败路径。传输模块拒绝非回环端口。加 `--peer-tunnel` 后，Windows 与 WSL 上的真实 QEMU NBD 和内存迁移流也通过配对主机的证书指纹锁定 TLS、短期会话和权限校验；测试仍在单机上模拟两个主机，栅栏为测试回调，且没有启动完整客户机系统。目标通道可在撤销同伴权限时断开；来源实例另有持久迁移栅栏，服务重启后仍拒绝原主机启动。

服务 API 目前仍只生成计划：尚未为配对目标创建配置一致的暂停实例，也未把已验证的 TLS 通道、NBD 与 RAM 传输、持久来源栅栏和目标客户机就绪验证串成完整的跨主机执行流程。即使源和目标的当前资源都满足要求，结果仍为 `ready: false, executed: false`；不能把底层冒烟、冷迁移或快照复制当作可用的在线迁移。目录状态继续保留“部分实现”。跨主机移动可使用已有的[冷迁移队列](cold-migration.md)，但需要先停止源实例。底层顺序依据 [QEMU 在线块操作](https://www.qemu.org/docs/master/interop/live-block-operations)和 [QMP 迁移命令](https://www.qemu.org/docs/master/interop/qemu-qmp-ref.html)。
