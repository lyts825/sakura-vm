# TPM 与安全启动

在 Linux x86_64 宿主上，Debian 或 Ubuntu UEFI 实例可启用 TPM 与安全启动。在“资源”中停止实例后启用策略，下一次启动将使用预登记密钥的 OVMF 代码与独立 NVRAM 文件，并启动持久 TPM 2.0 状态目录中的 `swtpm` 侧车。Sakura 为 QEMU 打开 SMM、受保护的 pflash 和 TPM TIS 设备；停止实例时清理套接字和侧车，保留 TPM 状态与 UEFI NVRAM 供下一次启动使用。守护程序意外退出会停止实例。Ubuntu 的发行版包通常把 `swtpm` 放入 PATH；OVMF 可从 QEMU 的 `share` 目录或 Linux `/usr/share/OVMF` 读取，也可用 `SAKURA_SECURE_BOOT_CODE`、`SAKURA_SECURE_BOOT_VARS` 和 `SAKURA_SWTPM_PATH` 指定安装路径。

“检查客户机状态”和第二批能力中心会读取 UEFI `SecureBoot`、`SetupMode` 变量以及 `/dev/tpmrm0` 或 `/dev/tpm0`；只有实际启用安全启动、退出设置模式并发现 TPM 设备才报告就绪。该检查不验证 TPM 报价或 PCR，也不接受用户自定义 PK/KEK/db/dbx。预登记模板含发行版启动链需要的受信任密钥；不同固件包与镜像组合可能无法启动，应先在测试实例上验证。

新生成的 `.sakura` 备份与导出在磁盘之外保存安全启动策略、`uefi-secure-vars.fd` 和 `tpm2` 状态文件；导入和克隆当前实例时恢复这些数据，备份验证会检查每个状态文件的长度与 SHA-256。旧版只含磁盘的包仍可导入，但不会补回当时未保存的 TPM 身份。TPM 状态和控制身份私钥都属于敏感数据，请对便携包妥善保管，按需使用加密备份。历史磁盘快照没有对应的 TPM/NVRAM 快照，因此带有这些状态的实例不能从历史快照导出或克隆；跨主机迁移的源实例校验也包含 TPM/NVRAM 状态。

已在 WSL Linux 宿主使用 QEMU 10.2、swtpm 0.10.1 和 Debian 客户机验证两次原实例启动及备份导入后的第三次启动，均确认 Secure Boot 与 TPM 2.0，`node --experimental-transform-types scripts/smoke-trusted-boot-guest.ts` 可复核。Sakura 主要验证平台 Windows 的随附便携 QEMU 目前缺少 TPM emulator 后端，因而该能力仍标为**部分实现**。现有 [vTPM 密钥登记](hardware-readiness.md#vtpm-密钥登记)只保存用户公钥指纹元数据，不代表 TPM 内部的密钥创建或报价验证。

启动参数依据 [QEMU TPM 文档](https://www.qemu.org/docs/master/specs/tpm)和 [EDK II OVMF 安全启动说明](https://github.com/tianocore/edk2/blob/master/OvmfPkg/README)。
