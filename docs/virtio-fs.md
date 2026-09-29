# Virtio-FS 共享目录

在支持 `vhost-user-fs-pci` 和 `memory-backend-memfd` 的 Linux x86_64 QEMU 宿主上，Sakura 可将指定宿主目录共享给客户机。需要安装可执行的 `virtiofsd`，或者用 `SAKURA_VIRTIOFSD_PATH` 指向它；QEMU 路径遵循 `SAKURA_QEMU_DIR`。在“资源”中的“Virtio-FS 共享目录”填写宿主绝对路径，保持默认只读或显式允许写入，停止实例后保存策略，再启动实例。目录挂载到客户机 `/mnt/sakura-virtiofs`，设备标签为 `sakura-host`。

启动时 Sakura 检查宿主二进制能力，拒绝共享 Sakura 数据目录及其上级目录，并在独立临时目录拉起 `virtiofsd`。QEMU 使用与初始内存相同大小的共享内存后端和 vhost-user-fs 设备。客户机运行后自动尝试挂载，挂载失败会在资源卡片记录原因并重试。守护程序意外退出时，Sakura 停止对应 QEMU 进程；实例退出或服务关闭时清理守护程序与套接字。更改路径或读写策略需要先停止实例；在线“卸载并停用”会卸载客户机文件系统并让下次启动不再附加设备。

当前实现只支持 Linux x86_64 宿主及客户机，且不与 NUMA、内存热插拔配置同时使用。已在 WSL Linux 宿主用真实 QEMU 10.2、virtiofsd 1.13.2 和 Alpine、Debian、Ubuntu 客户机验证自动挂载、宿主文件读取与只读拒写，以及停机切换为可写模式后客户机文件写入宿主目录。可运行 `node --experimental-transform-types scripts/smoke-virtio-fs-guest.ts alpine`，或将末尾参数改为 `debian`、`ubuntu` 复核。随附的 Windows QEMU 构建不含所需文件系统设备和共享内存后端，主要验证平台 Windows 尚不能使用该路径，功能目录仍标为部分实现。独立的 [SSHFS 宿主目录挂载](host-mount.md)继续使用 `/mnt/sakura-host`，不作为 Virtio-FS 证据。

实现参数参照 [QEMU vhost-user 后端文档](https://www.qemu.org/docs/master/system/devices/virtio/vhost-user.html) 和 [virtiofsd README](https://gitlab.com/virtio-fs/virtiofsd/-/raw/main/README.md)。
