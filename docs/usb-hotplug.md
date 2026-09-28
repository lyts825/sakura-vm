# USB 热插拔

启动 x86_64 实例后，在“能力中心”搜索“USB 热插拔”，点击“运行”打开管理面板。面板显示 QEMU `info usbhost` 可见的宿主设备。填写四位十六进制厂商 ID 与产品 ID，可保存持久转发规则，也可临时连接到当前实例。规则和最近操作结果写入宿主数据目录；实例下次启动后会重新向 QEMU 应用规则。临时连接在实例停止时清除。规则删除会对当前转发请求热移除；手动移除某条规则的当前转发并不删除规则，下次启动仍会重新应用。

Sakura 为 x86_64 实例提供独立的 QEMU xHCI 控制器，并通过 QMP `device_add usb-host` 和 `device_del` 动态管理指定 VID:PID 的转发。单实例最多保存 16 条规则及配置 16 条当前转发。相同 VID:PID 不会重复配置。请求成功仅表示 QEMU 接受转发或移除请求，不证明物理设备已经连接、Windows 驱动允许 QEMU 访问，或客户机已经识别该设备。QEMU 的 `info usbhost` 输出和操作错误用于排查；请在客户机中进一步检查 `lsusb` 等工具。当前 ARM64 实例没有此控制器。

本机控制 API 为 `GET/POST /api/vms/{vmId}/usb-hotplug`，由控制面凭证保护；账户模式下只允许管理员。请求结构在 OpenAPI/SDK 中。[QEMU USB 文档](https://www.qemu.org/docs/master/system/devices/usb)说明了 `usb-host` 的 VID:PID 匹配和热插拔命令。`npm run test:usb-hotplug` 已用随项目提供的 Windows QEMU 验证 xHCI、`usb-host` 的 QMP 添加/移除命令；目前没有物理 USB 设备的客户机端验证。
