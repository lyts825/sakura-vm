# Virtio-FS 共享目录检查

第三批能力中心的“Virtio-FS 共享目录”现在执行只读前置检查：当前 QEMU 是否列出 `vhost-user-fs` 设备和共享内存对象，宿主是否能启动 `virtiofsd`，运行中的客户机是否声明 `virtiofs`/`9p` 文件系统，以及 `/proc/mounts` 中实际存在的相关挂载。结果分别返回宿主与客户机证据，并列出阻断原因。可以用 `SAKURA_VIRTIOFSD_PATH` 指向已安装守护程序；QEMU 路径遵循 `SAKURA_QEMU_DIR`。

按照 [QEMU 的 vhost-user 后端说明](https://www.qemu.org/docs/master/system/devices/virtio/vhost-user.html)，Virtio-FS 需要外部 `virtiofsd`、QEMU 文件系统设备和与客户机内存大小匹配的共享内存对象。Sakura 尚未管理这些启动参数、目录授权和客户机挂载，因此即使检查发现这些组件，结果仍为 `ready: false, executed: false`。现有[宿主目录挂载](host-mount.md)使用 SSHFS，不能据此报告 Virtio-FS 已启用。当前随附的 Windows QEMU 构建缺少相关文件系统后端，无法在本机完成真实 Virtio-FS 挂载验证。
