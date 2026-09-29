# TPM 与安全启动

在 Linux x86_64 宿主上，Debian 或 Ubuntu UEFI 实例可启用 TPM 与安全启动。在“资源”中停止实例后启用策略，下一次启动将使用预登记密钥的 OVMF 代码与独立 NVRAM 文件，并启动持久 TPM 2.0 状态目录中的 `swtpm` 侧车。Sakura 为 QEMU 打开 SMM、受保护的 pflash 和 TPM TIS 设备；停止实例时清理套接字和侧车，保留 TPM 状态与 UEFI NVRAM 供下一次启动使用。守护程序意外退出会停止实例。安全启动首次进入 EFI 时允许签名引导程序登记启动项并复位；客户机初始化完成后，Sakura 通过 QMP 恢复“客户机重启即停止 QEMU”的行为。Ubuntu 的发行版包通常把 `swtpm` 放入 PATH；OVMF 可从 QEMU 的 `share` 目录或 Linux `/usr/share/OVMF` 读取，也可用 `SAKURA_SECURE_BOOT_CODE`、`SAKURA_SECURE_BOOT_VARS` 和 `SAKURA_SWTPM_PATH` 指定安装路径。

QMP 的 `set-action` 需要 QEMU 6.0 或更新版本；宿主能力检查会拒绝较旧版本。

“检查客户机状态”和第二批能力中心会读取 UEFI `SecureBoot`、`SetupMode` 变量以及 `/dev/tpmrm0` 或 `/dev/tpm0`；只有实际启用安全启动、退出设置模式并发现 TPM 设备才报告就绪。该检查不验证 TPM 报价或 PCR，也不接受用户自定义 PK/KEK/db/dbx。预登记模板含发行版启动链需要的受信任密钥；不同固件包与镜像组合可能无法启动，应先在测试实例上验证。

新生成的 `.sakura` 备份与导出在磁盘之外保存安全启动策略、`uefi-secure-vars.fd` 和 `tpm2` 状态文件；导入和克隆当前实例时恢复这些数据，备份验证会检查每个状态文件的长度与 SHA-256。旧版只含磁盘的包仍可导入，但不会补回当时未保存的 TPM 身份。TPM 状态和控制身份私钥都属于敏感数据，请对便携包妥善保管，按需使用加密备份。

停机后新建的磁盘快照还会保存对应 TPM/NVRAM 状态，恢复该快照时一并回滚；从该历史快照导出或克隆也使用同一状态。损坏的状态文件会在改写磁盘前被拒绝。较旧、没有状态侧车的快照在实例已有 TPM 状态时仍拒绝恢复或导出，不会用当前 TPM 身份冒充历史身份。启用 TPM/NVRAM 的实例暂不支持在线磁盘快照，因为客户机文件系统冻结并不能同时冻结宿主上的 swtpm 和 OVMF 状态；整机 RAM 快照原有的 UEFI 限制也保持不变。跨主机迁移的源实例校验包含 TPM/NVRAM 状态。

已在 WSL Linux 宿主使用 QEMU 10.2、swtpm 0.10.1 和 Debian、Ubuntu 客户机验证多次原实例启动、停机快照回滚及历史快照导入后的再次启动，均确认 Secure Boot 与 TPM 2.0；回滚还撤销了快照之后写入的客户机文件。Ubuntu 的签名引导链首次登记 EFI 启动项时需要一次复位。`node --experimental-transform-types scripts/smoke-trusted-boot-guest.ts debian` 或将末尾参数改为 `ubuntu` 可复核。Windows 可按 [WSL 后端](wsl-backend.md)启动已具备上述依赖的 Linux 服务。随附便携 Windows QEMU 目前缺少 TPM emulator 后端，因而该能力仍标为**部分实现**。现有 [vTPM 密钥登记](hardware-readiness.md#vtpm-密钥登记)只保存用户公钥指纹元数据，不代表 TPM 内部的密钥创建或报价验证。

启动参数依据 [QEMU TPM 文档](https://www.qemu.org/docs/master/specs/tpm)、[QMP `set-action` 参考](https://www.qemu.org/docs/master/interop/qemu-qmp-ref.html)和 [EDK II OVMF 安全启动说明](https://github.com/tianocore/edk2/blob/master/OvmfPkg/README)。
