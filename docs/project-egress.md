# 私有项目账号的共享网络限制

项目选择“独立命名空间”后，托管程序继续只使用本项目的回环网络。Sakura 还在客户机共享网络中按持久项目 UID 安装独立的 nftables 出站规则：同一账号从系统 SSH、cron、用户服务或自行启动的程序建立 IPv4/IPv6 连接时，也会被阻断，包括共享网络中的回环连接。其他账号和固定管理下载器不受这条规则影响；项目自己的独立回环仍可访问。

限制在创建账号前登记并安装。目录迁移尚未完成的 intent 账号也保持该 UID 的限制；迁移完成并核对完整绑定后才允许托管程序启动。共享项目不自动增加规则。已有私有账号的规则在普通项目停止后继续保留，明确切换为共享网络并成功提交原绑定后，才删除原 UID 的准确规则。

## 开机与恢复

固定开机入口是 `/etc/sakura-project-egress/restore`，只执行已核对构建中的隔离 Python 控制器。它读取 root 持久绑定，恢复私有 UID 的规则，包括尚未完成目录迁移的保留账号。规则在已配置防火墙服务之后恢复。

systemd 为系统 SSH、cron、at、用户会话及 `user@.service` 添加 Requires/After 依赖。OpenRC 为已安装的 sshd、crond/cronie、atd 和 local 服务追加 `rc_need`，保留原配置内容；固定服务加入 boot 级别。恢复失败时这些依赖不会成功启动。首次配置之后另行安装或自定义的其他启动器须重新核对其依赖。

宿主和客户机保留原 registry、账号、boot、网络设备/inode、规则表 handle 及 pending/applied 状态。规则创建和删除使用固定 JSON 事务，不加载项目环境。创建、删除、写入或服务配置升级的应答丢失保留待确认状态；再次明确启动同一项目会核对并完成原意图。身份查询可读取已提交绑定供恢复，执行和 SSH/终端准入仍须规则确认。

普通准入只核对，不修复被删除、替换或修改的已应用规则。未知表、变更 handle、原 boot 中的网络空间替换和被修改的管理脚本均拒绝；不清空整机规则。切回共享模式时，先保存意图、提交账号绑定，再确认删除原表。未知状态继续阻止托管执行，可从实例控制台核对 `systemctl status sakura-project-egress` 或 `rc-service sakura-project-egress status` 及原记录。

## 范围和验证

这是对**该项目 UID 发出的 IP 数据包**的限制。其他 UID、客户机管理员、由特权代理或其他账号转交的已打开套接字，以及其他 IPC 不属于这条规则的身份边界。管理员修改或重新加载整机防火墙可能改变规则；后续托管准入会拒绝失去归属的规则。它不替代实例级断网或抵御客户机 root 的系统策略。

`tests/project-egress.test.ts` 执行生产 Python 定义的事务模型，覆盖应答丢失、模式切换、原身份和表替换、重启恢复、systemd/OpenRC 配置、升级中断及配置保留。`scripts/smoke-project-egress-linux.py` 要求调用方创建独立 PID、mount、network 空间，并提供已校验的 nft 工具；它验证真实 UID、IPv4/IPv6、私有回环、其他 UID、原网络中的规则核对、handle 拒绝和模式切换。该脚本不创建系统账号，不代表 QEMU 开机或真实 SSH/cron 启动验证。

规则的 `inet`、output hook 和 socket UID 语义参照 [nftables 官方手册](https://netfilter.org/projects/nftables/manpage.html)；服务依赖参照 [OpenRC 服务脚本指南](https://github.com/OpenRC/openrc/blob/master/service-script-guide.md)。
