# 一致性在线快照

启用快照插件后，打开运行中实例的“快照”页，输入名称并选择“创建在线快照”。客户机需要安装并启动 `qemu-guest-agent`；Alpine 可执行：

```sh
apk add qemu-guest-agent
rc-service qemu-guest-agent start
rc-update add qemu-guest-agent default
```

Sakura 启动实例时提供专用 virtio 串口。创建在线快照时，先通过代理冻结客户机本地文件系统，再由 QEMU 在 QCOW2 磁盘上创建内部快照，最后解冻。快照页将此类条目标记为“文件系统一致性”。如果代理不可用或没有文件系统成功冻结，操作会失败；如果 QEMU 创建失败，仍会尝试解冻。如果解冻失败，Sakura 会强制停止实例，以免文件系统持续处于冻结状态。

在线快照仅保存磁盘，不保存内存、运行中进程或应用事务。数据库等应用如需事务级一致性，应在快照前自行完成应用层检查点。恢复、删除快照、克隆和导出仍要求先停止实例。临时写时复制实例不支持保存在线快照。

接口为 `POST /api/vms/{vmId}/snapshots`，请求体示例：`{"name":"before-upgrade","online":true}`。未提供 `online` 时沿用离线快照行为。真实 Alpine/QEMU 验证命令为 `npm run test:online-snapshot`：在运行中创建快照、继续写入、停止恢复、再次启动并核对旧文件内容。
