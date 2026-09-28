# 单次 GPG Agent 转发

第二批能力中心的 `gpg-agent-forward` 把宿主机 GnuPG 的 **extra socket** 通过 SSH 远端 Unix 套接字，临时提供给一条客户机命令。连接在命令结束、超时或取消后关闭；客户机不会获得宿主私钥文件。extra socket 是 GnuPG 为远端使用设计的受限制接口，但拿到它的客户机仍可请求签名，因此只对可信命令开启。[GnuPG Agent 手册](https://gnupg.org/documentation/manuals/gnupg26/gpg-agent.1.html)说明 extra socket 的用途。

## 准备

1. 宿主机安装并运行 GnuPG Agent，确认 `gpgconf --list-dirs agent-extra-socket` 返回其 extra socket，且 Sakura 服务进程能连接并收到 Assuan `OK`。如需指定原生可连接的套接字或 Windows 命名管道，在启动 Sakura 前设置 `SAKURA_GPG_EXTRA_SOCKET`。找不到或无法连接时，能力检查会报告未就绪。
2. 客户机安装 `gpg` 和 `mktemp`。默认 Alpine 镜像可执行 `apk add gnupg`。
3. 客户机 SSH 服务必须允许远端 Unix 套接字转发。先运行 `sshd -T | grep -E '^(disableforwarding|allowtcpforwarding|allowstreamlocalforwarding) '`。其中 `disableforwarding` 应为 `no`，其余两项应为 `remote` 或 `yes`。默认 Alpine 镜像的 `AllowTcpForwarding no` 会拒绝此次转发；管理员可在客户机 `/etc/ssh/sshd_config` 中改为 `AllowTcpForwarding remote` 并设置 `AllowStreamLocalForwarding remote`，验证 `sshd -t` 后重启 `sshd`。这是实例 SSH 配置的显式选择，Sakura 不会悄悄修改它。[OpenSSH sshd_config](https://man.openbsd.org/OpenBSD-current/man5/sshd_config.5)列出了两项策略。

## 运行

将以下内容保存为 `gpg-forward.json`：

```json
{
  "command": "gpg --batch --import /workspace/team-public.asc && gpg --no-autostart --batch --yes --local-user KEYID --detach-sign /workspace/release.tar",
  "confirmed": true,
  "timeoutSeconds": 60
}
```

执行 `npm run sakura -- extended <实例名> run gpg-agent-forward gpg-forward.json`，再用 `npm run sakura -- task <任务 ID> result` 查看退出码、输出及清理警告。`command` 是客户机 Shell 命令，最长 8192 字符，时限为 1–300 秒。Sakura 为每次运行创建权限受限的临时 `GNUPGHOME`，所以命令须在该目录导入对应**公钥**；上例从客户机项目导入。签名命令使用 `--no-autostart`，避免连接失败时客户机自行启动另一个 Agent。

客户机临时目录、SSH 监听套接字和活动连接会在执行后清理。宿主机额外套接字位置不会写入客户机。当前真实 Alpine 回归使用 Windows 命名管道上的模拟 Assuan 服务，验证了 SSH 转发、单次命令响应、默认 SSH 策略拒绝、命令失败和取消时清理；未用真实宿主私钥完成签名。可运行 `npm run test:gpg-agent-forward` 复核。
