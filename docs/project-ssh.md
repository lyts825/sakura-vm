# 项目 SSH 与 VS Code Remote-SSH

Debian、Ubuntu 中，在“项目”页选择工作项目，再点“配置 VS Code 连接”。私有项目会启动本项目的 OpenSSH 服务，生成专属客户端密钥、固定主机公钥的 SSH 档案，以及 VS Code 和普通 SSH 的连接入口。命令和 SFTP 从项目目录开始，编辑器及其后台子进程使用本项目的网络空间、环境和密钥快照。

同一实例只要包含私有项目，原来按实例名称生成的共享网络别名便被撤销。共享网络项目也使用自己的 SSH 服务与密钥，但保持共享网络模式。项目别名使用实例 UUID 和项目 ID，形如 `sakura-<实例 UUID>-<项目 ID>`；更改实例名称不改变这个别名，也不会与其他实例的名称档案重叠。没有私有项目的实例保留既有接入方式。Alpine 不提供此 Remote-SSH 接入。

## VS Code 设置

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

- “停止项目 SSH”会关闭本机入口，并通过所属 systemd 服务的整个 cgroup 清理 SSH、编辑器和后台进程，包括另建进程会话的子进程。目录与网络模式在这些进程存在时不能修改；停用 IDE 插件后，核心服务仍执行这个检查。启动文件丢失时也检查仍在运行的服务。
- 项目环境和密钥在启动时固定。发生变更或密钥服务不可用时，旧入口不再可用；停止后重新配置以加载新值。停止操作不依赖解析密钥，因此密钥插件缺失时仍能清理。
- 控制服务重载会关闭本机桥接并保留客户机服务。重新查看该项目或重新配置连接，会核对原有服务并恢复入口。实例暂停、停止或应急锁定会关闭桥接；恢复后重新打开项目入口。
- 项目 SSH 不在客户机开机时自动启动。实例重启后再次点击配置，会重建网络并核对绑定。项目文件和各自编辑器缓存保留。

连接前核对项目配置、启动记录、固定配置与密钥文件的摘要、systemd 启动标识、实际 sshd 程序与参数、所属进程及其网络空间，以及由主进程持有的回环监听。私有模式还核对仅有回环接口且没有 IPv4/IPv6 路由。主机记录只保存环境摘要；解析后的环境保存在客户机仅 root 可读的启动脚本中。主机密钥固定在专属 known_hosts，Windows 配置和私钥应用符合 OpenSSH 要求的文件权限，见 [微软 Windows OpenSSH 权限说明](https://github.com/PowerShell/Win32-OpenSSH/wiki/Security-protection-of-various-files-in-win32-openssh)。

本机入口监听 `127.0.0.1`，通过受管 SSH 连接转送至客户机项目回环，不添加网桥、接口或路由。每次新连接会再核对运行状态。项目服务使用 root，提供网络分段而非文件系统或管理员隔离；自行使用客户机系统 SSH、显式实例管理命令或在托管入口之外启动进程，仍属于实例范围。整体项目网络隔离继续保留部分实现状态。

## 验证

```powershell
npm run test:project-ssh -- debian
npm run test:project-ssh -- ubuntu
```

测试使用独立临时数据目录和真实 QEMU 客户机、Windows OpenSSH 客户端或宿主 `ssh`，验证身份、目录、环境、实际网络、SFTP、同端口应用、TCP 转发与外网拒绝、跨项目密钥拒绝、共享项目、控制重载、暂停、后台进程清理、配置与启动文件丢失、额外路由、密钥轮换和重启恢复。正常退出前同步磁盘并停止实例。设置 `SAKURA_KEEP_SSH_SMOKE=1` 可保留所属测试目录，脚本第三个参数可指定同一所属目录供复测。

可额外设置 `SAKURA_SSH_VSCODE_ARCHIVE` 为微软官方 Linux x64 服务端发布包的绝对路径，并将官方更新元数据中的 SHA-256 设置为 `SAKURA_SSH_VSCODE_SHA256`。测试核对摘要，通过真实 SFTP 上传到两个项目，分别启动官方后端、核对进程网络、经 SSH 转发版本端点并验证停止清理。当前已验证 VS Code Server 1.140.0 后端；本机未安装 VS Code 图形客户端，尚未完成 Remote-SSH 扩展界面的端到端验证。
