# 在线 vCPU 热插拔

在“能力中心 → 在线 vCPU 热插拔”选择实例。先停止实例，将加速器设为 TCG，并以 `configure` 模式设置大于当前 vCPU 数的 `maximum`（上限 8）。启动后先运行 `view`：只有 `canAdd: true` 且 `guestPossible` 覆盖目标值时，才能以 `add` 模式输入 `target` 在线增加。服务通过 QMP 添加 QEMU 列出的确切 CPU 插槽，再等待 Linux 客户机把新 CPU 上线；成功后的数量持久保存，后续冷启动继续使用。仅支持增加，不支持在线移除。

真实 Debian 12/QEMU 11.1 在 Windows 宿主 TCG 下验证了从 1 个 vCPU 增至 2 个、客户机 `/proc/cpuinfo` 确认上线以及重启后的持久化。当前 WHPX 热插拔不稳定，会在修改前拒绝；现用 Alpine 6.18 客户机没有识别预留 CPU，也会拒绝。其他发行版需先看 `view` 的实际结果，不能从 QEMU 已预留插槽直接推断客户机内核支持。操作遵循 [QEMU 虚拟 CPU 热插拔接口](https://www.qemu.org/docs/master/system/cpu-hotplug.html)。

运行 `npm run test:cpu-hotplug` 可在已有 Debian 12 镜像的 Windows 开发环境中重跑完整流程。测试使用独立临时数据目录，不修改源镜像。
