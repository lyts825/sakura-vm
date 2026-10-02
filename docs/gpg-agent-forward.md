# 单次 GPG Agent 转发

能力中心的 `gpg-agent-forward` 将宿主 GnuPG 的受限制 **extra socket** 临时提供给一条项目命令。命令以保存的项目 UID/GID、独立 home、原目录和网络模式运行；每次提交命令、确认和时限，不能从旧配置沿用确认。客户机只导入公钥，宿主私钥文件不会复制到客户机。extra socket 允许请求签名和解密，应在提交时核对命令及其依赖。

## 准备

当前宿主连接实现支持 Windows x64 与原生 Windows GnuPG 的 loopback TCP/nonce socket 文件。Sakura 校验原监听进程的 PID、创建时间、用户和映像，固定 socket 文件及祖先目录的文件身份、属主和 ACL；在连接、发送 nonce 和转发协议帧时重新核对。Unix socket、MSYS socket 和命名管道目前明确报告不支持，不回退到未经身份校验的连接。

1. 安装并运行原生 Windows GnuPG Agent。`gpgconf --list-dirs agent-extra-socket` 可查询 extra socket；需要指定路径时，在启动 Sakura 前设置 `SAKURA_GPG_EXTRA_SOCKET`。来源目录应保持本用户的私有权限。Sakura 不启动或关闭宿主 Agent，不修改其配置、权限或密钥。来源不符或 Agent 已更换时报告未就绪。
2. 客户机需要 GnuPG、系统 `/usr/bin/python3`、真实 cgroup v2、Linux pidfd，以及已登记的项目账号和目录绑定。既有 root 目录按 [目录迁移](project-directory-migration.md) 的保存计划处理；此入口不自动安装工具、创建项目目录或应用迁移。
3. 客户机 `sshd -T` 应报告 `disableforwarding no`、`allowtcpforwarding remote` 和 `allowstreamlocalforwarding remote`，后两项也可为 `yes`。管理员须自行核对并配置 SSH 服务；Sakura 不修改 sshd 配置。

## 运行

将以下内容保存为 `gpg-forward.json`：

```json
{
  "command": "gpg --no-autostart --batch --import ./team-public.asc && gpg --no-autostart --batch --yes --local-user KEYID --detach-sign ./release.tar",
  "confirmed": true,
  "timeoutSeconds": 60
}
```

执行 `npm run sakura -- extended <实例名> run gpg-agent-forward gpg-forward.json`，再通过 `npm run sakura -- task <任务 ID> result` 查看结果。Shell 命令最长 8192 字符，时限为 1–300 秒。

每次运行有独立、可写的临时 `GNUPGHOME`，须在其中导入对应公钥。项目环境中的 `GNUPGHOME`、旧 `GPG_AGENT_INFO` 不能替换本次转发入口。示例显式使用 `--no-autostart`；任意用户命令仍可选择自行启动客户机程序，此入口不对 Shell 中所有 GnuPG 调用强制添加参数。

准备过程固定提交时的项目及配置，再解析该份配置的环境和密钥。正文和环境通过受保护 stdin 帧交给固定降权启动器，root 命令参数不含项目正文。输出遮盖项目私密配置。私有项目保持仅回环网络，通过文件系统 Unix 套接字访问转发，不添加网络接口或路由。

## 归属与关闭

root SSH source 位于本次独立的私有目录。项目可访问的入口为 root 属主、项目组专用的 socket；每次连接及 Assuan 请求核对进程创建身份、完整 UID/GID、补充组、能力、`no_new_privs`、客户机 boot 和完整任务 cgroup。临时 home 中的 `S.gpg-agent` 为固定路径的 Assuan 重定向文件，其文件身份和正文均受核对。

宿主 helper 的准确进程回执在发送 nonce 前持久化。项目运行记录写入前先保存宿主未启动回执，入场中断也能按原身份恢复。每条任务最多接受 8 条连接，拥有自己的 SSH 连接、helper 和期限；关闭一条任务不会关闭另一条任务或宿主 Agent。

正常退出、非零退出、超时或取消后，先确认任务 cgroup 与后代停止，再关闭本次宿主连接、broker、准确 socket 和临时 home，最后核销项目账号票据。清理核对文件身份，不跟随链接或删除未知替换对象。失败时保留原回执、具体错误码和待关闭资源；重载不能把丢失的内存登记当作已清理。整个准备、执行和清理阶段持有项目租约。

OpenSSH 撤销 Unix 转发并关闭 SSH 连接后可能保留 socket 文件。清理此类残留前，额外确认原 sshd 进程创建身份已经结束、内核 Unix socket 表中没有该准确路径，并再次核对原私有目录和 socket 文件身份；仍活动的监听、未知读取错误和替换对象会保留。Windows 来源目录的保护句柄只读取属性与 ACL，继续禁止写入和删除共享，避免妨碍 GnuPG 在目录内原子替换公钥环。来源文件仍持有数据读取句柄并逐帧核对原文件和进程。

## 验证

`npm run test:gpg-agent:identity -- --describe` 列出新的项目账号实测合同。默认预检只读取明确指定的原 Farm fixture、固定源码与资产摘要、测试所有权记录和公钥输入；真实运行需显式使用 `--reuse-existing` 及新的冻结记录。测试不安装客户机包或修改原 fixture 的项目配置。

旧版 Windows 命名管道模拟 Assuan 的 Alpine、Debian、Ubuntu 证明保留原源码归属，不能证明当前原生宿主连接或项目账号实现。当前批次的真实签名、验签、解密和客体生命周期结果以新证明为准，完成记录见 [功能实现记录](capability-completion.md)。
