# 硬件声明、密钥登记与计算设备检查

这些能力在第三批能力中心的操作参数中使用。它们分别提供只读预览、元数据登记和客户机可见性检查；不创建 vTPM，不解绑宿主 PCI 驱动，也不安装 GPU 驱动。

## PCI 与 USB 直通声明预览

```json
{"mode":"preview","device":{"kind":"usb","vendorId":4660,"productId":22136}}
```

USB 预览校验 VID:PID，并报告当前机型是否有 USB 控制器。宿主设备是否存在、是否可独占以及客户机驱动是否就绪均标为未知。实际连接使用现有“USB 热插拔”能力。

```json
{"mode":"preview","device":{"kind":"pci","address":"0000:01:00.0"}}
```

PCI 预览校验 BDF。Linux 宿主上还会只读检查 `/sys/bus/pci/devices` 中的设备、IOMMU 组及全部成员的 `vfio-pci` 驱动绑定。Windows 宿主直接报告缺少 Linux VFIO 前置条件。即使检查通过，Sakura 目前也不会把 PCI 设备写入 QEMU 启动配置；不能把预览结果当成已经直通。QEMU 的 [VFIO 说明](https://www.qemu.org/docs/master/devel/vfio-iommufd.html)描述了宿主后端与 IOMMU 的要求。

## GPU 计算设备可见性

```json
{"provider":"auto"}
```

运行中的 Linux 实例会检查 `nvidia-smi` 的 GPU 列表及 `/dev/nvidiactl`、`/dev/nvidiaN`，或 `rocminfo` 的 GPU 代理及 `/dev/kfd`、`/dev/dri/renderD*`。可选 `provider` 为 `cuda` 或 `rocm`。结果只说明驱动工具和设备节点可见，不证明 CUDA/ROCm 程序能执行，也不配置宿主 PCI 直通。判据参考 [NVIDIA SMI 文档](https://docs.nvidia.com/deploy/nvidia-smi/)与 [AMD ROCm 设备文档](https://rocm.docs.amd.com/projects/install-on-linux/en/docs-6.0.0/how-to/docker.html)。

## vTPM 密钥登记

```json
{"mode":"save","fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","label":"Signing key","rotateAfterDays":365}
```

只接受公钥的 64 位小写十六进制 SHA-256 指纹、标签和轮换间隔；可选 `enrolledAt` 为 ISO 时间。`status` 返回到期日、已逾期及未来 30 天内到期的数量。`remove` 加 `fingerprint` 可删除一条记录。每个实例最多 32 条。登记不接收或保存私钥、密封数据、TPM 报价，也不会自动轮换密钥；目前没有可创建的虚拟 TPM 设备。
