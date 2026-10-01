# 项目 SSH、SFTP 与编辑器接入

Alpine、Debian、Ubuntu 中，在“项目”页选择工作项目，再配置项目连接。私有项目会启动本项目的 OpenSSH 服务，生成专属客户端密钥和固定主机公钥的 SSH 档案。命令和 SFTP 从项目目录开始，客户端及其后台子进程使用本项目的网络空间、环境和密钥快照。Debian、Ubuntu 同时提供 VS Code Remote-SSH 入口；Alpine 提供普通 SSH、SFTP 和 Neovim 入口。

同一实例只要包含私有项目，原来按实例名称生成的共享网络别名便被撤销。共享网络项目也使用自己的 SSH 服务与密钥，但保持共享网络模式。项目别名使用实例 UUID 和项目 ID，形如 `sakura-<实例 UUID>-<项目 ID>`；更改实例名称不改变这个别名，也不会与其他实例的名称档案重叠。Alpine 始终使用项目入口；Debian、Ubuntu 没有私有项目时保留既有接入方式。

能力中心的 VS Code、JetBrains 和 Neovim 档案同样使用经过核对的项目 SSH 入口，只导出本项目地址、专属身份与固定主机公钥配置。使用项目入口时，尚未配置项目 SSH、IDE 插件未启用、绑定或运行状态核对失败都会拒绝导出。Alpine 拒绝生成 VS Code Remote-SSH 和 JetBrains Gateway 档案：两者的官方远程后端要求目前不支持 Alpine，见 [微软 Linux 客户机要求](https://code.visualstudio.com/docs/remote/linux) 和 [JetBrains 远程开发要求](https://www.jetbrains.com/help/pycharm/prerequisites.html)。此限制不影响普通项目 SSH/SFTP 和 Neovim。

## VS Code 设置

此节适用于 Debian、Ubuntu。

私有项目不能从客户机联网下载服务端。在本机 VS Code 的用户设置中使用：

```json
{
  "remote.SSH.localServerDownload": "always",
  "remote.SSH.remoteServerListenOnSocket": false
}
```

服务端由本机下载并经 SSH 传入；扩展和它们额外下载的依赖仍需预先准备，可按 VS Code 的离线方式安装 VSIX。使用默认的 TCP 服务监听；项目服务允许到本项目回环地址的 SSH 本地转发，不提供 Unix 套接字转发、Agent、X11、隧道或远程监听转发。下载与转发要求见 [微软 Remote-SSH 文档](https://code.visualstudio.com/docs/remote/ssh) 和 [连接排查](https://code.visualstudio.com/docs/remote/troubleshooting)。

每个项目固定使用自己的 `HOME=/var/lib/sakura/ssh/<项目 ID>`，编辑器服务和扩展缓存位于其中的 `.vscode-server`。这避免 Remote-SSH 在不同项目间复用共享 root 目录中的服务端进程。`HOME` 和编辑器缓存位置不由项目环境变量覆盖。此设置不改变 root 在 passwd 中的主目录；SCP/SFTP 使用明确的绝对目标路径，不能用 `~` 假定上述目录。

## 生命周期与保护

- “停止项目 SSH”会关闭本机入口，并通过所属服务的整个 cgroup 清理 SSH、编辑器和后台进程，包括另建进程会话的子进程。Debian、Ubuntu 使用 systemd 的 `KillMode=control-group`；Alpine 使用 OpenRC 建立的真实统一 cgroup 和内核 `cgroup.kill`，等待进程终止并由 init 回收后完成停止。目录与网络模式在这些进程存在时不能修改；停用 IDE 插件后，核心服务仍执行这个检查。配置或服务文件丢失时也检查仍在运行的进程，停止不依赖这些文件。
- 项目环境和密钥在启动时固定。发生变更或密钥服务不可用时，旧入口不再可用；停止后重新配置以加载新值。停止操作不依赖解析密钥，因此密钥插件缺失时仍能清理。
- 控制服务重载会关闭本机桥接并保留客户机服务。重新查看该项目或重新配置连接，会核对原有服务并恢复入口。实例暂停、停止或应急锁定会关闭桥接；恢复后重新打开项目入口。
- 项目 SSH 不在客户机开机时自动启动。实例重启后再次点击配置，会重建网络并核对绑定。项目文件和各自编辑器缓存保留。

连接前核对项目配置、启动记录、固定配置与密钥文件的摘要、实际 sshd 程序与参数、所属进程及其网络空间，以及由主进程持有的回环监听。Debian、Ubuntu 保留 systemd 启动标识核对；Alpine 核对 OpenRC 运行状态、真实 cgroup 挂载、内核进程归属、仅 root 可写的运行记录及 PID 文件、启动 UUID、客户机 boot ID 和进程 start ticks，不生成 systemd 记录替代这些证据。私有模式还核对仅有回环接口且没有 IPv4/IPv6 路由。主机记录只保存环境摘要；解析后的环境保存在客户机仅 root 可读的启动脚本中。主机密钥固定在专属 known_hosts，Windows 配置和私钥应用符合 OpenSSH 要求的文件权限，见 [微软 Windows OpenSSH 权限说明](https://github.com/PowerShell/Win32-OpenSSH/wiki/Security-protection-of-various-files-in-win32-openssh)。

Alpine 入口需要 OpenRC、真正挂载的 cgroup v2 统一层级和内核 `cgroup.kill`，配置过程会安装 OpenSSH/SFTP、Python、iproute2、util-linux 并启动 OpenRC `cgroups` 服务。缺少这些内核能力或进程归属不符时拒绝开放入口。OpenRC 原生 `rc-service sakura-ssh-<项目 ID> stop` 使用相同的 cgroup 清理；项目 SSH 不加入开机 runlevel。服务和启动器文件按项目分别绑定摘要，运行记录保存在 `/run/sakura-project-ssh/<项目 ID>`，客户机重启后重建。

Alpine 运行记录的 JSON 或字段损坏时，停止仍会关闭桥接，核对并清空真实固定 cgroup，等待进程回收，然后清理本项目的 OpenRC 状态标记。不会根据损坏记录单独杀 PID。有效 PID 线索仍精确核对 boot ID、start ticks 和存活状态；另外独立核对真正的 sshd 程序与精确的项目配置参数。如果对应主进程仍在 cgroup 外存活，停止不会报告完成，连接、重建和目录修改也会拒绝。确认这些进程均已停止后，坏记录可以保持原样，重新配置入口会产生新记录。

本机入口监听 `127.0.0.1`，通过受管 SSH 连接转送至客户机项目回环，不添加网桥、接口或路由。每次新连接会再核对运行状态。项目服务使用 root，提供网络分段而非文件系统或管理员隔离；自行使用客户机系统 SSH、显式实例管理命令或在托管入口之外启动进程，仍属于实例范围。整体项目网络隔离继续保留部分实现状态。

## 验证

```powershell
npm run test:project-ssh -- alpine
npm run test:project-ssh -- debian
npm run test:project-ssh -- ubuntu
```

测试使用独立临时数据目录和真实 QEMU 客户机、Windows OpenSSH 客户端或宿主 `ssh`，验证身份、目录、环境、实际网络、系统 OpenSSH SFTP 客户端及 ssh2 SFTP、编辑器档案的真实 SSH 连接、同端口应用、TCP 转发与外网拒绝、跨项目密钥拒绝、共享项目、控制重载、暂停、后台进程清理、配置与启动文件丢失、额外路由、密钥轮换和重启恢复。Alpine 还验证实际 OpenRC 服务与 cgroup 归属、被更改的启动记录、逃离所属 cgroup 的主进程会使入口和目录变更被拒绝、原生服务停止与同机另一个项目不受影响，以及不支持的 IDE 档案被拒绝。正常退出前同步磁盘并停止实例。设置 `SAKURA_KEEP_SSH_SMOKE=1` 可保留所属测试目录，脚本第三个参数可指定同一所属目录供复测。

设置 `SAKURA_SSH_STOP_RECOVERY_ONLY=1` 并选择 Alpine，可定向验证保持坏 JSON、缺 PID、PID 类型错误、旧 boot ID、旧 start ticks 的状态直接停止，核对实际进程与 cgroup、已认证桥接、OpenRC 标记、重复停止和随后重建，同机另一个项目保持可用；同时验证坏记录与 cgroup 外对应 sshd 并存时拒绝放行。这些回归也包含在默认 Alpine 全轮测试中。

在 Debian、Ubuntu 测试中，可额外设置 `SAKURA_SSH_VSCODE_ARCHIVE` 为微软官方 Linux x64 服务端发布包的绝对路径，并将官方更新元数据中的 SHA-256 设置为 `SAKURA_SSH_VSCODE_SHA256`。测试核对摘要，通过真实 SFTP 上传到两个项目，分别启动官方后端、核对进程网络、经 SSH 转发版本端点并验证停止清理。已验证 VS Code Server 1.140.0 后端。

设置 `SAKURA_SSH_VSCODE_CLIENT` 为本机官方 `Code.exe` 的绝对路径，可启用真实桌面 Remote-SSH 联测；`SAKURA_SSH_REMOTE_VSIX` 可指定事先下载的官方 Remote-SSH VSIX，否则从扩展市场安装。测试单独创建用户配置与扩展目录，在两个项目分别打开桌面窗口，以实际远程 workspace 扩展验证打开、修改和保存文本，创建集成终端、执行 ShellExecution 任务，核对扩展、子进程、终端和任务的实际网络空间并验证外网拒绝。客户端关闭仅针对测试窗口，随后仍执行完整 SSH 生命周期验证。结果保存为所属目录中的 `vscode-client-evidence.json`，客户端日志在其 `vscode-client-portable-data/user-data/logs`。Windows 上的官方 VS Code 1.140.0 与 Remote-SSH 0.129.2026091815 已在真实 Debian 12、Ubuntu 24.04 各自的两个私有项目通过上述流程；Alpine 明确拒绝这两项 VS Code 测试。JetBrains Gateway 当前验证了 Debian、Ubuntu 导出的档案和真实 SSH 连接，尚未执行其客户端联测。

设置 `SAKURA_SSH_NEOVIM_CLIENT` 为本机 `nvim.exe`（或宿主 `nvim`）的绝对路径，可启用真实 Neovim netrw 客户端打开、修改、保存和重新打开 UTF-8 文本的验证。测试使用已固定主机公钥的项目 SSH 档案，结果写入所属目录的 `neovim-client-evidence.json`，逐项目日志位于 `neovim-client`。Neovim 0.12 需要先执行 `:packadd netrw`。Windows netrw 会把绝对远程目录中的空格转义为字面反斜杠，导致 SFTP 找不到原路径；使用导出档案的 `relativeRemotePath=scp://<项目别名>/./` 作为项目 cwd 的相对入口，在其后追加文件名编辑，例如 `:edit scp://<项目别名>/./example.txt`。专属 SSH/SFTP 入口已固定初始目录；绝对 `remotePath` 继续供支持它的客户端使用。本批客户端证据覆盖文件读、改、保存、重新打开，未覆盖 netrw 目录浏览器的全部操作。

Windows 官方 Neovim 0.12.5 已在真实 Alpine 3.23、Debian 12、Ubuntu 24.04 各自的两个私有项目完成上述客户端流程，其中一个实际项目目录包含空格和单引号；各发行版的完整 SSH 生命周期验证也通过。Alpine 客户机使用 OpenRC 0.63-r1 和 Linux 6.18.22-0-virt。
