# RAM 与进程状态快照

运行中的实例在“快照”页勾选“包含 RAM 与运行中进程”，输入名称并保存。恢复时先启动该实例，再点击对应快照的“恢复整机状态”。恢复会覆盖当前磁盘、内存和进程状态；勾选“恢复前自动保存当前状态”会额外占用一个内部快照名额。保存和恢复期间客户机可能短暂暂停，正在连接的终端会断开，应重新连接。

此功能使用 QEMU 的 `snapshot-save` / `snapshot-load` 作业，把虚拟机状态与可写 QCOW2 磁盘放在同一个内部快照。保存会等待作业完成，作业失败不会登记为可恢复快照。恢复前核对 QEMU 版本、加速器、虚拟硬件、CPU/内存拓扑、磁盘容量和实例控制身份；不匹配时拒绝加载。实例必须在本机以 **TCG** 模式运行。当前 Windows QEMU 的 WHPX 无法提供所需内存状态保存能力；默认自动模式若选用 WHPX，需停机后将加速器改为 TCG 再启动。

临时写时复制磁盘、加密磁盘和 UEFI 实例不支持此操作。UEFI NVRAM 和实例初始化镜像是 QCOW2 外部文件，不能仅凭磁盘内部快照恢复到相同设备状态。USB 外设及宿主侧连接也不随此快照持久化；应在恢复后重新连接。虚拟硬件或 QEMU 升级之后，旧 RAM 快照可能无法加载，应另做磁盘备份。跨主机快照复制、实例包导出和克隆只复制磁盘状态，不复制 RAM/进程；在目标主机启动会正常冷启动。

接口为 `POST /api/vms/{vmId}/snapshots`，请求体 `{"name":"working","online":true,"memory":true}`；恢复接口为 `POST /api/vms/{vmId}/snapshots/{snapshotId}/restore`，请求体 `{"memory":true,"backup":true}`。真实 Alpine/QEMU 回归命令 `npm run test:memory-snapshot` 验证运行中的 `sleep` 进程和文件在即时恢复及重启后恢复时均回到快照状态。

实现依据：[QEMU VM snapshots](https://www.qemu.org/docs/master/system/images) 与 [QEMU QMP snapshot jobs](https://www.qemu.org/docs/master/interop/qemu-qmp-ref.html)。
