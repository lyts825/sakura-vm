# 项目 SSH、SFTP 与编辑器接入

Alpine、Debian、Ubuntu 中，在“项目”页选择工作项目，核对并应用所需的[目录权限迁移](project-directory-migration.md)，再配置项目连接。每个项目启动自己的 OpenSSH 服务，生成专属客户端密钥和固定主机公钥的 SSH 档案。Shell、命令和 SFTP 从项目目录开始，以持久项目 UID/GID 执行，使用独立 home、所选网络和启动时捕获的环境。Debian、Ubuntu 同时提供 VS Code Remote-SSH 入口；Alpine 提供普通 SSH、SFTP 和 Neovim 入口。SSH 准备不会自动创建项目目录或改变其属主。

共享网络项目也使用自己的 SSH 服务、账号与密钥，保持共享网络模式。三种发行版的 IDE 入口和导出档案均使用项目 SSH，不再生成旧的实例 root 别名。项目别名使用实例 UUID 和项目 ID，形如 `sakura-<实例 UUID>-<项目 ID>`；更改实例名称不改变这个别名。

SSH 认证仍使用专属密钥和 `User root`，固定 ForceCommand 将真实客户端命令、终端类型和捕获环境作为数据交给原生启动器。启动器核对完整账号及服务票据、切换网络、清除附加组与能力、降低 UID/GID 后执行密封脚本。交互终端和二进制 stdin 通过单独的描述符保留；SFTP 使用同一入口。root argv 不携带项目正文或解析后的环境，环境快照保存为 root 独占的 `session.json`。

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

每个项目固定使用账号记录中的 `HOME=/var/lib/sakura-project-homes/<账号 UUID>`，编辑器服务和扩展缓存位于其中的 `.vscode-server`。`HOME`、`USER`、`LOGNAME` 和 VS Code 缓存位置由账号入口固定。旧 `/var/lib/sakura/ssh/<项目 ID>` 目录保留，不自动迁移、删除或重新授权旧 root 编辑器缓存。SCP/SFTP 使用明确的绝对路径或项目相对路径。

## JetBrains Gateway 设置

此节适用于 Debian、Ubuntu 的项目 SSH 入口。JetBrains 档案保留 `StrictHostKeyChecking yes`，使用另外生成的 `known_hosts.jetbrains`，将项目别名和当前 `[127.0.0.1]:<端口>` 同时固定到已经核对的同一个项目公钥。实际 Gateway 的 SSHJ 校验器不使用 OpenSSH `HostKeyAlias`；只保留别名的普通 SSH 档案不足以通过其严格校验。重建本机端口后重新导出档案，替换旧的端口绑定，不选择接受未知公钥。

完整下载档案应放入 Gateway 实际解析的 OpenSSH config，再创建项目 alias 的 SSH 条目，选择 “OpenSSH config and authentication agent”。档案明确禁用认证代理、密码、交互认证和全局 known_hosts，实际使用固定的项目私钥。Windows OpenSSH 的默认目录来自 Windows 账户，单独设置 `HOME` 或 Java `user.home` 并不能改变 `ssh -G` 读取的配置；独立客户端应通过 Gateway 的 Advanced Settings 选择 OpenSSH backend 和自己的 SSH tool。下面的测试入口生成只读取所属配置文件的 `ssh.exe -F <所属 config>` 包装器，同时生成 Gateway 的 SSH 条目、配置、缓存、日志和临时目录，避免读取或改写用户全局 SSH/IDE 设置。

私有网络的后端不能自行下载依赖。先在宿主下载官方 Linux x64 WebStorm 后端与对应 SHA-256，经固定公钥的项目 SSH/SFTP 上传、核对摘要后解压。每个项目使用自己的启动器，第三方只读库可以共享。官方 native remote launcher 需要 `WEBIDE_VM_OPTIONS` 文件中的 `-Duser.home`、`-Didea.config.path`、`-Didea.system.path`、`-Didea.log.path`、`-Didea.plugins.path` 分别指向当前项目账号 home 及其独立目录，仅设置 `WEBIDE_PROPERTIES` 不够。启动器也固定项目的 XDG 配置、缓存与数据目录。其他 JetBrains 产品和任意默认 Gateway 下载/启动路径尚未验证。

可复现部署和连接入口是 [project-jetbrains-client-smoke.ts](../scripts/project-jetbrains-client-smoke.ts)，由项目 SSH 测试调用。设置以下环境变量后运行 `npm run test:project-ssh -- debian` 或 `ubuntu`：

```powershell
$env:SAKURA_SSH_JETBRAINS_GATEWAY = 'D:\owned-tools\gateway\bin\gateway64.exe'
$env:SAKURA_SSH_JETBRAINS_BACKEND_ARCHIVE = 'D:\owned-tools\WebStorm-263.5701.38.tar.gz'
$env:SAKURA_SSH_JETBRAINS_BACKEND_SHA256 = '<官方 SHA-256，64 位小写十六进制>'
```

这些地址是本机工具占位路径，需替换为事先下载和核对的官方文件；测试不安装到用户 IDE，不使用用户账户或许可证。新的所属实例分配 8 GiB 内存、4 CPU 和 16 GiB 磁盘，现有实例需要在停止时具备相应容量。辅助脚本当前限定 Windows Gateway 与 WebStorm 后端：先核对本地官方摘要，上传后再次核对；使用真正导出的 JetBrains 档案生成独立客户端配置，部署两个项目启动器，再通过原生 `jetbrains-gateway://connect` 链接自动连接。日志核对 Gateway 的实际 SSH、SFTP worker、后端状态和 TCP 转发测试；实际 `/proc` 核对后端的项目 `HOME`、cwd、环境、网络空间、cgroup 和独立 Java 配置目录，并测试外网连接被拒绝。

`jetbrains-client-evidence.json` 记录传输与后端证据。`clientEditorVerified`、`clientLicensingVerified` 分别记录图形编辑和许可验证，不能由 SSH 成功推断为真。实际匹配版本的 JetBrains Client 仍可能要求登录或有效许可证；[EAP 同样需要 JetBrains Account](https://www.jetbrains.com/resources/eap/)。本批官方 WebStorm EAP Client 已实际启动，但停在强制登录界面，没有使用账号或绕过此门槛，图形文本编辑、保存与重开仍未验证。部署方式参考 [官方远程后端启动](https://www.jetbrains.com/help/idea/remote-development-a.html)、[完全离线部署](https://www.jetbrains.com/help/idea/fully-offline-mode.html) 与 [许可要求](https://www.jetbrains.com/help/idea/licensing-and-useful-links.html)。

迁移前的 root 入口曾使用 Windows 官方 Gateway 2026.2.2（build 262.10315.114）与官方 WebStorm EAP 2026.3（build 263.5701.38），在真实 Debian 12、Ubuntu 24.04 各自的两个私有项目通过上述自动连接、严格主机公钥、实际 SFTP 上传、TCP 转发、后端独立配置与进程归属验证。定向停止验证分别核对 Alpha 所属的全部真实 cgroup 成员与后端消失、Beta 原有后端及 SSH 保持可用，随后 Beta 停止清空其进程。这些历史记录不证明当前项目 UID 入口的桌面兼容性；辅助脚本已改为核对账号 home 及真实 UID/GID，仍需运行新版本联测。匹配版本 Windows JetBrains Client build 263.5701.38 的历史实测停在强制账户登录阶段，图形编辑与许可仍未验证。

## 生命周期与保护

启动或就绪检查失败时，回滚最多通过独立控制连接重试三次。关闭本机桥接前核对同一实例、客户机 boot ID 与本次 runId，客户机停止脚本内再次核对；实例重启、启动记录或桥接被替换时不操作新一代对象。无法确认停止时返回 `PROJECT_SSH_CLEANUP_FAILED`，同时报告原启动错误并保留启动记录，不能把失败的回滚当成已清理。正常手动停止仍按原有授权入口执行。

启动前持久保存准确账号、boot、原 cgroup 名称和随机 run UUID，客户机先保存受保护的 SSH 完整回执，再发行原生运行票据。发行应答丢失时，停止先查询并持久保存原完整 daemon、boot、cgroup device/inode 票据，随后才关闭桥接和清理原进程域。查询失败、构建不匹配或归属变化时保留原记录与入口，不猜测新身份。若中断状态只有 SSH 完整回执而没有原生运行文件，普通会话与只读授权仍拒绝；清理查询可恢复这份原回执，在原域确认消失后以不可覆盖的原子写入补齐原生记录，再退休 SSH 回执与核销票据。容量或同步失败保持可重试状态，不能借此授权用户代码。

- “停止项目 SSH”会关闭本机入口，并通过所属服务的整个 cgroup 清理 SSH、编辑器和后台进程，包括另建进程会话的子进程。Debian、Ubuntu 使用 systemd 的 `KillMode=control-group`；Alpine 使用 OpenRC 建立的真实统一 cgroup 和内核 `cgroup.kill`，等待进程终止并由 init 回收后完成停止。目录与网络模式在这些进程存在时不能修改；停用 IDE 插件后，核心服务仍执行这个检查。配置或服务文件丢失时也检查仍在运行的进程，停止不依赖这些文件。
- 项目环境和密钥在启动时固定。发生变更或密钥服务不可用时，旧入口不再可用；停止后重新配置以加载新值。停止操作不依赖解析密钥，因此密钥插件缺失时仍能清理。
- 控制服务重载会关闭本机桥接并保留客户机服务。重新查看该项目或重新配置连接，会核对原有服务并恢复入口。实例暂停、停止或应急锁定会关闭桥接；恢复后重新打开项目入口。
- 项目 SSH 不在客户机开机时自动启动。实例重启后再次点击配置，会重建网络并核对绑定。项目文件和各自编辑器缓存保留。

连接前核对项目配置、启动记录、固定配置与密钥文件的摘要、实际 sshd 程序与参数、所属进程及其网络空间，以及由主进程持有的回环监听。Debian、Ubuntu 保留 systemd 启动标识核对；Alpine 核对 OpenRC 运行状态、真实 cgroup 挂载、内核进程归属、仅 root 可写的运行记录及 PID 文件、启动 UUID、客户机 boot ID 和进程 start ticks，不生成 systemd 记录替代这些证据。私有模式还核对仅有回环接口且没有 IPv4/IPv6 路由。主机记录只保存环境摘要；解析后的环境通过标准输入写入客户机 root 独占的 JSON 快照，不拼接到 root 启动脚本或参数中。主机密钥固定在专属 known_hosts，Windows 配置和私钥应用符合 OpenSSH 要求的文件权限，见 [微软 Windows OpenSSH 权限说明](https://github.com/PowerShell/Win32-OpenSSH/wiki/Security-protection-of-various-files-in-win32-openssh)。

Alpine 入口需要 OpenRC、真正挂载的 cgroup v2 统一层级和内核 `cgroup.kill`，配置过程会安装 OpenSSH/SFTP、Python、iproute2、util-linux 并启动 OpenRC `cgroups` 服务。缺少这些内核能力或进程归属不符时拒绝开放入口。OpenRC 原生 `rc-service sakura-ssh-<项目 ID> stop` 使用相同的 cgroup 清理；项目 SSH 不加入开机 runlevel。服务和启动器文件按项目分别绑定摘要，运行记录保存在 `/run/sakura-project-ssh/<项目 ID>`，客户机重启后重建。

Alpine 运行记录的 JSON 或字段损坏时，停止仍会关闭桥接，核对并清空真实固定 cgroup，等待进程回收，然后清理本项目的 OpenRC 状态标记。不会根据损坏记录单独杀 PID。有效 PID 线索仍精确核对 boot ID、start ticks 和存活状态；另外独立核对真正的 sshd 程序与精确的项目配置参数。如果对应主进程仍在 cgroup 外存活，停止不会报告完成，连接、重建和目录修改也会拒绝。确认这些进程均已停止后，坏记录可以保持原样，重新配置入口会产生新记录。

本机入口监听 `127.0.0.1`，通过受管 SSH 连接转送至客户机项目回环，不添加网桥、接口或路由。每次新连接会再核对运行状态。认证守护进程由 root 管理，项目命令、SFTP 与编辑器进程以本项目 UID/GID 执行，受客户机文件权限约束。自行使用客户机系统 SSH、显式实例管理命令或在托管入口之外启动进程，仍属于实例范围。浏览器 IDE、cron、用户管理器和其余尚未迁移的扩展入口继续列为未完成范围，整体项目网络隔离保留部分实现状态。

## 验证

2026-10-02 新版项目 UID 入口在真实 Alpine 3.23 客户机中通过九项检查：项目 UID/GID、独立 home、目录、私有网络与捕获环境；512 KiB 二进制 stdin/EOF；256 KiB SFTP 及跨项目文件拒绝；真实 PTY 输入、调整窗口、Ctrl-C 后继续执行与退出；只读重载复用完整票据及弱化权限拒绝；整个服务域和脱离终端后代停止、邻居保留与重建；无效 SESSION 描述符/标志拒绝；实际发行票据后丢失应答的恢复；仅剩受保护 SSH 回执的明确故障夹具。最后一项人为移除已核对的原生运行文件，以模拟发行中断后的持久状态，不代表捕获了写入间的进程崩溃。证明为 `.data/project-ssh-identity-test-temp/sakura-ssh-identity-fMLJIu/project-ssh-identity-e022a2a6-8812-4532-8bc2-b22bc50a6d24.json`，摘要 `c0c623395f56cb75bb1d0d51925cb5d9c4eda6ab26fb7e3aeafd6bf74109584a`。268 个源码摘要保持一致，原缓存镜像未变，实际退出 0，实例、自有子进程与准确 QEMU/CIM 均已关闭。

新版入口的定向后端回归 138 项全部通过，包括九组原生 SSH 事务模型和十四组归档模型；证明为 `.data/project-ssh-identity-backend-00c7b71a-2089-40d9-a484-a60669e02465-verification.json`。首轮实机测试的 PTY 检查错误读取 ssh2 继承的 Node `closed` 状态，修正为实际 SSH close 事件与退出码后完成上述复测；原 false 证明继续保留。当前新版实机成功范围为 Alpine SSH/SFTP/PTY，不包含 Debian/Ubuntu、实际 VS Code、JetBrains 或 Neovim 桌面客户端。

```powershell
npm run test:project-ssh:identity -- --run-new alpine
```

迁移前的回滚故障注入曾在 Alpine、Debian、Ubuntu 各通过五项真实场景，包括首次身份核对/停止连接失败、全部核对失败，以及核对之后运行身份被替换，实际 SSH 连接和脱离进程组的后台子进程也纳入清理核对。这些历史证据只覆盖当时的 root 入口，不能代替当前账号及完整票据实现的复测。原入口为 `npx tsx scripts/smoke-project-ssh-rollback.ts alpine|debian|ubuntu OWNED_STOPPED_GUEST_TASK_ROOT`，使用 [客户机任务清理](guest-task-cleanup.md) 脚本已验证并停止的同发行版自有实例目录。

当前回滚脚本已改用明确的目录迁移与真实项目 UID，并在原生票据实际发行后注入丢失应答，再验证原完整票据在任何终止操作前恢复。默认三项为首次归属核对失败、首次停止连接失败和全部核对失败；可使用 `--case` 选择单项。旧的绑定替换及 cgroup inode 替换场景尚未适配，会在启动虚拟机前明确拒绝。脚本改造本身不作为新版三项场景已通过实机的证明。

```powershell
npm run test:project-ssh -- alpine
npm run test:project-ssh -- debian
npm run test:project-ssh -- ubuntu
```

测试使用独立临时数据目录和真实 QEMU 客户机、Windows OpenSSH 客户端或宿主 `ssh`，验证身份、目录、环境、实际网络、系统 OpenSSH SFTP 客户端及 ssh2 SFTP、编辑器档案的真实 SSH 连接、同端口应用、TCP 转发与外网拒绝、跨项目密钥拒绝、共享项目、控制重载、暂停、后台进程清理、配置与启动文件丢失、额外路由、密钥轮换和重启恢复。Alpine 还验证实际 OpenRC 服务与 cgroup 归属、被更改的启动记录、逃离所属 cgroup 的主进程会使入口和目录变更被拒绝、原生服务停止与同机另一个项目不受影响，以及不支持的 IDE 档案被拒绝。正常退出前同步磁盘并停止实例。设置 `SAKURA_KEEP_SSH_SMOKE=1` 可保留所属测试目录，脚本第三个参数可指定同一所属目录供复测。

设置 `SAKURA_SSH_STOP_RECOVERY_ONLY=1` 并选择 Alpine，可定向验证保持坏 JSON、缺 PID、PID 类型错误、旧 boot ID、旧 start ticks 的状态直接停止，核对实际进程与 cgroup、已认证桥接、OpenRC 标记、重复停止和随后重建，同机另一个项目保持可用；同时验证坏记录与 cgroup 外对应 sshd 并存时拒绝放行。这些回归也包含在默认 Alpine 全轮测试中。

在 Debian、Ubuntu 测试中，可额外设置 `SAKURA_SSH_VSCODE_ARCHIVE` 为微软官方 Linux x64 服务端发布包的绝对路径，并将官方更新元数据中的 SHA-256 设置为 `SAKURA_SSH_VSCODE_SHA256`。测试核对摘要，通过真实 SFTP 上传到两个项目，分别启动官方后端、核对进程网络、经 SSH 转发版本端点并验证停止清理。已验证 VS Code Server 1.140.0 后端。

设置 `SAKURA_SSH_VSCODE_CLIENT` 为本机官方 `Code.exe` 的绝对路径，可启用真实桌面 Remote-SSH 联测；`SAKURA_SSH_REMOTE_VSIX` 可指定事先下载的官方 Remote-SSH VSIX，否则从扩展市场安装。测试单独创建用户配置与扩展目录，在两个项目分别打开桌面窗口，以实际远程 workspace 扩展验证打开、修改和保存文本，创建集成终端、执行 ShellExecution 任务，核对扩展、子进程、终端和任务的真实 UID/GID 与网络空间并验证外网拒绝。客户端关闭仅针对测试窗口，随后仍执行完整 SSH 生命周期验证。结果保存为所属目录中的 `vscode-client-evidence.json`，客户端日志在其 `vscode-client-portable-data/user-data/logs`。迁移前的 root 入口曾使用官方 VS Code 1.140.0 与 Remote-SSH 0.129.2026091815，在真实 Debian 12、Ubuntu 24.04 各自的两个私有项目通过当时的流程；该历史证据不证明当前项目 UID 入口的桌面兼容性。Alpine 明确拒绝这两项 VS Code 测试。JetBrains 的传输、后端与客户端编辑验证分别记录，详见上节。

设置 `SAKURA_SSH_NEOVIM_CLIENT` 为本机 `nvim.exe`（或宿主 `nvim`）的绝对路径，可启用真实 Neovim netrw 客户端打开、修改、保存和重新打开 UTF-8 文本的验证。测试使用已固定主机公钥的项目 SSH 档案，结果写入所属目录的 `neovim-client-evidence.json`，逐项目日志位于 `neovim-client`。Neovim 0.12 需要先执行 `:packadd netrw`。Windows netrw 会把绝对远程目录中的空格转义为字面反斜杠，导致 SFTP 找不到原路径；使用导出档案的 `relativeRemotePath=scp://<项目别名>/./` 作为项目 cwd 的相对入口，在其后追加文件名编辑，例如 `:edit scp://<项目别名>/./example.txt`。专属 SSH/SFTP 入口已固定初始目录；绝对 `remotePath` 继续供支持它的客户端使用。本批客户端证据覆盖文件读、改、保存、重新打开，未覆盖 netrw 目录浏览器的全部操作。

迁移前的 root 入口曾使用 Windows 官方 Neovim 0.12.5，在真实 Alpine 3.23、Debian 12、Ubuntu 24.04 各自的两个私有项目完成上述客户端流程，其中一个实际项目目录包含空格和单引号；当时各发行版的完整 SSH 生命周期验证也通过。这些历史记录不代替当前项目 UID 入口的客户端复测。Alpine 客户机使用 OpenRC 0.63-r1 和 Linux 6.18.22-0-virt。
