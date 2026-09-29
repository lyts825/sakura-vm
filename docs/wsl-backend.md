# WSL Linux 后端

Sakura 默认在 Windows 原生运行。随附的 Windows QEMU 缺少 TPM emulator 与 Virtio-FS 所需的设备和共享内存后端；已安装 WSL 的机器可选择在其中运行整套 Sakura 服务和 Linux QEMU，从而使用已接通的可信启动与 Virtio-FS 路径。浏览器仍在 Windows 上打开 `http://127.0.0.1:7337`。

先在 Windows 项目目录执行 `npm ci`、`npm run setup` 和 `npm run build`。所选 WSL 发行版还需安装 Linux Node.js 22.12+，以及 `qemu-system-x86_64`、`qemu-img`、`qemu-io`、`swtpm`、`virtiofsd` 和带预登记密钥的 OVMF 固件。Ubuntu 的相关系统包是 `qemu-system-x86`、`qemu-utils`、`swtpm`、`virtiofsd`、`ovmf`；Node.js 版本请单独核对。随后在 Windows 项目目录运行：

```powershell
npm run check:wsl
npm run start:wsl
```

`check:wsl` 只读检查 WSL 内的工具、QEMU 功能、固件和已构建的 Sakura，不会启动服务。`start:wsl` 在默认 WSL 发行版里运行服务，按 Ctrl+C 会正常停止托管虚拟机。默认数据目录为该发行版的 `$HOME/.local/share/sakura-vm`，不能放在 `/mnt` 的 Windows 文件系统：QEMU 和侧车进程需要 Unix 套接字。可以在 Windows PowerShell 中设定 `SAKURA_WSL_DATA_DIR` 为该发行版内的绝对路径，`SAKURA_PORT` 可更改服务端口。

```powershell
$env:SAKURA_WSL_DATA_DIR = '/home/me/sakura-data'
$env:SAKURA_PORT = '7447'
npm run start:wsl
```

WSL 模式与默认 Windows 模式的数据目录、实例和插件选择分开；它不会自动迁移现有实例。实例需要迁移时可使用 Sakura 的便携导出与导入。WSL 服务将 WSL 发行版视为宿主，宿主目录填写 Linux 路径；只在 Windows 上运行的原生集成不可用。要启用可信启动，请使用 Debian/Ubuntu UEFI 实例并在停机时设置策略；Virtio-FS 在实例资源中配置宿主 Linux 目录。相关范围见 [TPM 与安全启动](trusted-boot.md)和 [Virtio-FS](virtio-fs.md)。

这条可选路径不改变原生 Windows QEMU 的能力。跨主机在线迁移、宿主故障接管等其他未完成项也不因切换到 WSL 而自动具备。
