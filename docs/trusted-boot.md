# TPM 与安全启动

在 Linux x86_64 宿主上，Debian 或 Ubuntu UEFI 实例可启用 TPM 与安全启动。在“资源”中停止实例后启用策略，下一次启动将使用预登记密钥的 OVMF 代码与独立 NVRAM 文件，并启动持久 TPM 2.0 状态目录中的 `swtpm` 侧车。Sakura 为 QEMU 打开 SMM、受保护的 pflash 和 TPM TIS 设备；停止实例时清理套接字和侧车，保留 TPM 状态与 UEFI NVRAM 供下一次启动使用。守护程序意外退出会停止实例。Ubuntu 的发行版包通常把 `swtpm` 放入 PATH；OVMF 可从 QEMU 的 `share` 目录或 Linux `/usr/share/OVMF` 读取，也可用 `SAKURA_SECURE_BOOT_CODE`、`SAKURA_SECURE_BOOT_VARS` 和 `SAKURA_SWTPM_PATH` 指定安装路径。

“检查客户机状态”和第二批能力中心会读取 UEFI `SecureBoot`、`SetupMode` 变量以及 `/dev/tpmrm0` 或 `/dev/tpm0`；只有实际启用安全启动、退出设置模式并发现 TPM 设备才报告就绪。该检查不验证 TPM 报价或 PCR，也不接受用户自定义 PK/KEK/db/dbx。预登记模板含发行版启动链需要的受信任密钥；不同固件包与镜像组合可能无法启动，应先在测试实例上验证。

当前 `.sakura` 备份与导出仅保存虚拟磁盘，不包含独立的 `tpm2` 状态目录和 `uefi-secure-vars.fd`。从这类备份导入的新实例不会继承 TPM 身份或安全启动策略；若客户机使用 TPM 密封密钥，磁盘备份不能独立恢复该密钥。

已在 WSL Linux 宿主使用 QEMU 10.2、swtpm 0.10.1 和 Debian 客户机验证 Secure Boot 与 TPM 2.0，`node --experimental-transform-types scripts/smoke-trusted-boot-guest.ts` 可复核。Sakura 主要验证平台 Windows 的随附便携 QEMU 目前缺少 TPM emulator 后端，因而该能力仍标为**部分实现**。现有 [vTPM 密钥登记](hardware-readiness.md#vtpm-密钥登记)只保存用户公钥指纹元数据，不代表 TPM 内部的密钥创建或报价验证。

启动参数依据 [QEMU TPM 文档](https://www.qemu.org/docs/master/specs/tpm)和 [EDK II OVMF 安全启动说明](https://github.com/tianocore/edk2/blob/master/OvmfPkg/README)。
