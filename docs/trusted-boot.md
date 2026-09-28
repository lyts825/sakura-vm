# TPM 与安全启动检查

第二批能力中心的“TPM 与安全启动”现在读取主机和客户机证据。主机侧检查安全版 x86_64 OVMF 固件与 NVRAM 模板是否为普通文件、QEMU 是否提供 SMM 和 TPM emulator 后端，以及能否执行 `swtpm`。运行中的客户机侧读取 UEFI `SecureBoot` 和 `SetupMode` 变量，并检查 `/dev/tpmrm0` 或 `/dev/tpm0`。只有主机前提齐备，且客户机实际报告安全启动开启、退出设置模式并出现 TPM 设备时，检查才显示就绪；文件存在不代表链路已启用。此检查不是 TPM 报价或 PCR 验证。

当前能力仍为**部分实现**：不能创建或接入 vTPM，不能登记 PK、KEK、db、dbx 信任密钥，也不能启用完整的验证启动链。Sakura 默认便携 QEMU 11.1.0 在本机测试中拒绝 `-tpmdev`，且未发现 `swtpm`；因此当前安装不能启动 vTPM。安全版 OVMF 文件存在，但 [EDK II 说明](https://github.com/tianocore/edk2/blob/master/OvmfPkg/README)指出默认不含 Secure Boot 密钥；[QEMU TPM 文档](https://www.qemu.org/docs/master/specs/tpm)说明 emulator 后端还需要外部 `swtpm`。此检查不会修改实例或密钥。
