# ARM64 实例

在镜像库下载并校验 **Debian 12 ARM64** 后，新建实例时选择该镜像。Sakura 会使用 ARM64 QEMU、`virt` 机型、UEFI 固件和 TCG 软件模拟，并将独立的固件变量保存在实例目录。实例创建、重启、配置预览、实例包和黄金镜像都会保留架构信息。也可以在镜像导入页面明确选择 ARM64，将受支持的独立云镜像转换为托管实例。

目前 ARM64 路径只支持 Debian 12；Windows 的 WHPX 不用于 ARM64 客户机。ARM64 在 x86 宿主上使用 TCG，首次 cloud-init 可能需要数分钟。镜像必须与所选架构匹配，不能通过修改已有实例的架构来转换磁盘。固件、CPU 和设备选型依据 [QEMU ARM `virt` 机型文档](https://www.qemu.org/docs/master/system/arm/virt)。

开发环境已准备官方镜像时，运行 `npm run test:arm64` 可在独立临时数据目录中验证 Debian ARM64 启动、客户机架构和冷启动持久化；测试不会修改源镜像。
