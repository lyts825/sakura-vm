# 私有项目账号的共享网络限制

项目选择“独立命名空间”后，托管程序继续只使用本项目的回环网络。Sakura 还在客户机共享网络中按持久项目 UID 安装独立的 nftables 出站规则：同一账号从系统 SSH、cron、用户服务或自行启动的程序建立 IPv4/IPv6 连接时，也会被阻断，包括共享网络中的回环连接。其他账号和固定管理下载器不受这条规则影响；项目自己的独立回环仍可访问。

限制在创建账号前登记并安装。目录迁移尚未完成的 intent 账号也保持该 UID 的限制；迁移完成并核对完整绑定后才允许托管程序启动。共享项目不自动增加规则。已有私有账号的规则在普通项目停止后继续保留，明确切换为共享网络并成功提交原绑定后，才删除原 UID 的准确规则。

## 开机与恢复

固定开机入口是 `/etc/sakura-project-egress/restore`，只执行已核对构建中的隔离 Python 控制器。它读取 root 持久绑定，恢复私有 UID 的规则，包括尚未完成目录迁移的保留账号。规则在已配置防火墙服务之后恢复。

systemd 为系统 SSH、cron、at、用户会话及 `user@.service` 添加 Requires/After 依赖。OpenRC 为已安装的 sshd、crond/cronie、atd 和 local 服务追加 `rc_need`，保留原配置内容；固定服务加入 boot 级别。恢复失败时这些依赖不会成功启动。首次配置之后另行安装或自定义的其他启动器须重新核对其依赖。

## 普通 SSH 与定时任务的提权限制

首次准备私有项目时，固定 systemd/OpenRC 配置还会给标准 SSH、cron/at 和用户会话启动器设置 `NoNewPrivileges`。这些启动器及其后代不能通过 setuid、setgid 或文件 capability 获得新的权限，项目账号的普通登录 Shell 保持 `/bin/sh`。systemd 检查实际合并后的配置、用户服务实例及执行标志，拒绝被后续配置覆盖或使用特权执行标志的入口；OpenRC 核对系统启动库、工具支持和标准启动流程，不把任意自定义脚本视为已保护。

这项服务设置会影响同一客户机中经这些服务登录或运行任务的**所有普通账号**，包括共享项目和非项目账号；其 `sudo`、`su` 及其他依赖执行时提权的程序可能无法提权。已具有权限的固定 root 管理入口继续按原权限执行。删除最后一个私有项目也不会自动撤回这些系统启动配置。

安装配置不会自动重启系统服务或中断既有连接。若实际 root 守护进程或既有 SSH 会话尚未继承限制，新的项目账号和托管执行会返回 `PROJECT_IDENTITY_EGRESS_NNP_RESTART_REQUIRED`，保留原意图及详细进程身份。管理员应核对后重启对应服务、结束旧会话，再重试原准备操作；只读身份查询和停止清理仍可使用。仅凭新监听进程的配置不够，仍存在的旧认证或会话进程也会被核对。

OpenRC 标准 SSH 若在统一 cgroup 挂载前启动，可通过受控 PIDfile 中已核对的真实 Root 监听器确认归属。接受连接和拆分的 SSH helper 必须沿真实内核父子链追溯该监听器，每个节点仍须 NNP=1，并再次核对原创建时间、父进程、映像、账号、能力及 cgroup。孤立或被重新挂接的进程、未知父节点、身份变化和错角色的 PIDfile 均拒绝，进程标题本身不会授予归属。托管 SSH 状态保留实际出站准入失败原因，状态读取不会修复配置或开放失败入口。

systemd 的 PAM 登录会把 SSH 会话移入对应的 `session-*.scope`。该路径只接受仍能沿最多 128 个真实 SSH 映像节点追溯到标准 `ssh.service`/`sshd.service` 监听器的会话，包括普通账号和拆分的 session/auth helper。监听器必须符合受控 systemctl 文件描述符返回的 loaded、active/running、有效 NNP、MainPID 和准确 ControlGroup；链中每个节点仍须 NNP=1，且只能位于原会话 scope 或该服务域。准入结束前重新读取服务权威并核对所有已使用节点的原身份；未知或孤立的父链、重新挂接、UID/能力/映像变化及任何权威漂移均拒绝。scope 名称和进程标题不会单独授予归属。标准服务域的原快速路径不增加 systemctl 查询；PAM 路径缓存两种服务的查询，每个已使用服务在检查前后各一次，总计至多四次，沿用固定查询超时。

systemd 的首次提交顺序为：保存 pending 归属、持久写入全部策略文件和启动链接、执行 `daemon-reload`、保存 applied 归属。以后只读核对仍发现管理器需要重新加载时，返回 `PROJECT_IDENTITY_EGRESS_NNP_PENDING`；管理员核对原配置并执行 `systemctl daemon-reload` 后重试原意图。恢复不初始化另一套账号或放宽原限制。

准入开始时会完整采集 `/proc` 进程身份，随后最多进行三次增量 PID 列举。每次列举发现的新 PID，包括最后一次发现的 PID，都须实际读取完整身份并进入原准入检查；已记录 PID 核对内核 startTicks，拒绝 PID 复用。新增进程不会仅因程序名称、UID 或 cgroup 被视为无害。最后一次列举是本次观察边界，无法原子排除之后的进程出生。尚未用于服务或账号授权的首轮读取若遇到身份变化，最多尝试三轮完整读取；首轮保持原时限，后续读取和增量列举共用十五秒窗口，无等待，并逐个核对读取前后及列举前后的时限，宿主原四十秒总预算不变。新增 SSH 或项目 UID 仍须通过同样的 NNP、能力及归属检查。身份变化、复用或超出窗口时保留拒绝，并返回固定原因、阶段及尝试次数；已使用的服务权威或 SSH 父链变化不重试，也不会重启或终止既有进程。

完整进程读取缺失时，另外通过固定目录描述符读取内核 stat：只有已离开 `/proc`、状态为 Z/X 的退出进程，或 flags 含固定 PF_KTHREAD 位的内核线程可以略过。仍存活的普通进程读取不完整、stat/flags 未知或读取失败均拒绝，不能凭进程标题略过。字段和状态来自 [Linux proc 实现](https://github.com/torvalds/linux/blob/v6.1/fs/proc/array.c)，固定 PF_KTHREAD 位来自 [Linux 调度定义](https://github.com/torvalds/linux/blob/v6.1/include/linux/sched.h)。

原生项目入口在运行客户机程序前检查传入描述符。标准输入、输出、错误及保护帧描述符上的 IPv4、IPv6、packet、netlink 等网络套接字被拒绝；普通管道、文件、PTY 和本地 Unix 套接字继续保留二进制输入及 EOF 语义。这不会阻止另一个特权代理在项目程序运行后通过 Unix socket 另行转交网络描述符。

宿主和客户机保留原 registry、账号、boot、网络设备/inode、规则表 handle 及 pending/applied 状态。规则创建使用经严格校验的 UID 与 UUID marker 生成固定 nft 标准文本：`create table` 保存表归属，`add chain` 安装 output 链，`add rule` 安装准确 UID 的 drop 规则。三个显式命令由同一次 `nft -f -` 提交为原子事务；已有同名表仍使 `create` 拒绝，不能追加或接管。删除仍使用固定 JSON 事务，不加载项目环境。创建、删除、写入或服务配置升级的应答丢失保留待确认状态；再次明确启动同一项目会核对并完成原意图。身份查询可读取已提交绑定供恢复，执行和 SSH/终端准入仍须规则确认。

nftables 1.0.6 的 JSON 表创建会遗漏真实内核表 comment，JSON 列表也不显示它；新自有 Debian 12 夹具已记录该差异。固定文本创建保留真实表归属。读取时，正常 JSON 继续严格核对；仅表 comment 缺失时，才从同一 PID 1 网络空间的受保护 nft 文本输出核对准确表名、原 handle 和唯一顶层 marker，再确认前后全部三个 JSON 对象及 handle 不变。规则 comment 不能代替表 marker，未知字段、额外规则、数值类型变化、文本超限或读取间漂移均拒绝。旧版已产生的无真实表 marker 的 pending 表继续阻止准入，不自动收编、删除或补写 marker。

另一份全新 Debian 12 实机失败记录确认，1.0.6 的嵌套 `create table { chain ... }` 只建立带正确 marker 的空表；该版本只对 `add` 展开嵌套对象。创建因此使用上述三个显式命令。已留下的空表同样返回 `EGRESS_TABLE_CHANGED`，保留原 pending 和未确认 handle，不自动补建链或规则。新的三语句实现仍须由新构建的真实客户机完成完整验证，失败夹具不能充当通过证明。

普通准入只核对，不修复被删除、替换或修改的已应用规则。未知表、变更 handle、原 boot 中的网络空间替换和被修改的管理脚本均拒绝；不清空整机规则。切回共享模式时，先保存意图、提交账号绑定，再确认删除原表。未知状态继续阻止托管执行，可从实例控制台核对 `systemctl status sakura-project-egress` 或 `rc-service sakura-project-egress status` 及原记录。

## 范围和验证

`tests/project-egress-compat-model.py` 从当前生产控制器 AST 提取实际定义，覆盖正常 JSON 快速路径、旧版缺失字段、完整文本归属、64 KiB 边界、数值类型与读取间漂移，也以实机原始字节核对无 marker 和只剩表的两种失败继续拒绝；原事务模型独立校验完整三个显式命令的固定语法，拒绝原嵌套样式、额外 token 和错表名，并保留 JSON 删除、handle 与应答失联条件。已有表重复创建、第三语句错误无部分应用也有便携反例；这些模型不替代更新后构建的新 Alpine/Debian 实机事务和功能验证，旧构建的历史成功不作为新来源的当前证明。

这是对**该项目 UID 发出的 IP 数据包**的限制。其他 UID、客户机管理员、由特权代理或其他账号转交的已打开套接字，以及其他 IPC 不属于这条规则的身份边界。管理员修改或重新加载整机防火墙可能改变规则；后续托管准入会拒绝失去归属的规则。它不替代实例级断网或抵御客户机 root 的系统策略。

`tests/project-egress.test.ts` 执行生产 Python 定义的事务模型，覆盖应答丢失、模式切换、原身份和表替换、重启恢复、systemd/OpenRC 配置、升级中断及配置保留。`scripts/smoke-project-egress-linux.py` 要求调用方创建独立 PID、mount、network 空间，并提供已校验的 nft 工具；它验证真实 UID、IPv4/IPv6、私有回环、其他 UID、原网络中的规则核对、handle 拒绝和模式切换。该脚本不创建系统账号，不代表 QEMU 开机或真实 SSH/cron 启动验证。

`npm run test:project-egress:vm -- --run-new alpine` 使用原始 Alpine 镜像的独立副本、新的数据目录和真实 QEMU。它先验证测试用 setuid 和文件 capability 程序确实能够提权，再验证受限普通系统 SSH、cron、托管 SSH、双栈回环和冷启动恢复；保留虚拟机、来源摘要、进程退出及输出关闭证据。`--inspect-owned alpine <测试目录>` 仅可对该脚本已确认关闭的自有夹具执行只读工具诊断，诊断通过不代表整组功能验证通过。

需要另选有足够空间的验证盘时，可设置 `SAKURA_EGRESS_FIXTURE_ROOT` 为绝对目录。入口核对实际目录路径，并在其中创建独立的新夹具，不搬移已有实例、镜像或证明；目录须允许当前用户创建文件及管理自己的 SSH 文件权限。证明保存实际父目录，仍逐项核对原始镜像、来源和自有进程关闭。连接诊断只记录正式状态检查、桥接验证、实际控制器错误及 relay 的错误流和退出，不读取 relay 正文或放宽准入。

公网软件源在模拟客户机中下载过慢时，可将 `SAKURA_EGRESS_APK_FIXTURE` 指向绝对路径的官方包夹具清单。清单固定 Alpine v3.23 x86_64、main/community 的签名索引与每个官方包的来源、长度和 SHA-256；适配器只在宿主回环提供已冻结文件，拒绝其他路径和写请求。只在全新自有 VM 中临时选择该软件源，仍执行同一生产安装命令、五分钟时限和客户机默认签名校验；安装后原软件源逐字节恢复，签名密钥摘要前后不变。本地源请求、缓存复核、实际服务关闭及零残留连接纳入完整证明。该模式验证功能与签名包安装，不代表默认公网源的安装性能；不会重启或修改历史失败 VM。

规则的 `inet`、output hook 和 socket UID 语义参照 [nftables 官方手册](https://netfilter.org/projects/nftables/manpage.html)，单次 `-f` 提交参照 [nftables 原子规则替换文档](https://wiki.nftables.org/wiki-nftables/index.php/Atomic_rule_replacement)，1.0.6 的命令展开参照 [官方 1.0.6 源码包](https://netfilter.org/projects/nftables/files/nftables-1.0.6.tar.xz) 中 `src/libnftables.c` 的 `nft_evaluate`；服务依赖参照 [OpenRC 服务脚本指南](https://github.com/OpenRC/openrc/blob/master/service-script-guide.md)。PAM 会话的 scope 归属参照 [pam_systemd 官方文档](https://github.com/systemd/systemd/blob/main/man/pam_systemd.xml)，服务状态及 MainPID/ControlGroup 属性参照 [systemd D-Bus 官方文档](https://github.com/systemd/systemd/blob/main/man/org.freedesktop.systemd1.xml)。
