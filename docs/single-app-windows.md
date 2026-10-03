# 单应用 Linux 窗口

运行中的 Alpine、Debian 或 Ubuntu 实例可在“桌面 → 单应用窗口”输入客户机里的程序名及参数，启动独立的浏览器弹窗。每个应用使用专属 Xvnc 显示器和 Openbox，会话与普通 KDE 桌面分开；首次使用会通过 `apk` 或 `apt` 安装所需图形组件。默认程序 `xterm` 可用于检查。参数每行一个，保留每行空格，程序需已安装在客户机中。此入口先捕获原项目配置、客户机 live 和项目账号；目录尚未迁移或不存在时，需要先完成项目目录的显式预览与迁移，不会用 Root 自动创建项目目录。

窗口沿用启动时所在项目的网络设置。Xvnc、窗口管理器、图形程序及其子进程进入原项目的网络命名空间和新建的独立 native run cgroup；私有项目网络仅有回环。浏览器连接通过已有 SSH 通道进入同一命名空间，不增加 QEMU 转发、网卡或路由。每次连接都会核对原 boot、账号、来源构建、cgroup、network namespace、mount namespace 和真实 RFB 监听，当前项目切换不改变已有窗口归属。窗口运行、准备或清理尚未确认时，必须先停止原窗口并完成清理，再修改该项目目录或网络模式；暂停时需先恢复实例。此入口需要 `projects` 插件。

每个窗口使用独立、密码锁定、shell 为 `/bin/false` 且不回收复用的 Linux 用户；面板分别显示项目 UID 与应用 UID。固定控制器先建立资源回执，再将准确启动器置入原 native run；在应用正文或环境生效之前永久清除附加组和 capabilities、设置 NoNewPrivs 并设置全部 UID/GID。没有 `su` 或 PAM 应用启动路径。应用数据保存在专属主目录中；其他窗口不能读取其中的 VNC 密码或受保护的 X11 凭据。Xvnc 要求随机密码认证，密码仅通过已有认证接口和同源窗口消息传递，不写入网址、浏览器存储或长期运行进程的命令行。客户机 IPv4/IPv6 防火墙还按用户限制回环地址的 `5900–5999` TCP 端口，仅允许连接自己的窗口，避免访问共享 KDE 桌面或其他受管窗口；其他出站流量遵守原项目网络设置。防火墙组件不可用、已有同名规则或资源身份无法核对时启动失败；清理只移除准确属于本运行的规则，未知规则保留并明确提示清理待重试。

应用以自己的 sandbox UID 进入专属 mount namespace，通过 idmapped mount 在相同 pathname 读写原 project UID 的项目目录；原磁盘 owner、mode、ACL 和 inode 不变，新文件的实际 owner 仍是 project UID。私有祖先目录阻断访问时，只在应用的挂载视图内建立通往准确项目叶的路径，并隐藏该阻断祖先的兄弟内容；这不授予访问项目子树之外的私有文件。路线会覆盖本次应用 HOME 或 runtime 时明确拒绝。内核或文件系统不支持 idmapped mount 时启动失败，保留原目录与失败回执，不降级到项目 UID、不扩大目录权限。机制见 [Linux 内核 idmapped mount 文档](https://docs.kernel.org/filesystems/idmappings.html)。

停止窗口会按原 run UUID、boot 和 cgroup 的设备号/inode 终止该完整运行域，包括脱离父进程的子进程；随后核对并移除本窗口防火墙与准确 runtime。应用正常退出或达到四小时运行上限后，创建该窗口且仍持内存租约的服务实例每两秒只读核对退出状态，再串行执行同一原域停止。状态控制调用有四十秒上限；清理失败保留完整票据和配置门闩，显示 `cleanup-pending` 并允许重试原窗口。主目录和用户账户保留，避免删除应用数据或把旧文件权限交给另一窗口。不会按 UID 枚举并终止原运行域之外的进程。

每台实例最多四个未核销会话，可从桌面页重新打开或停止。关闭弹窗只断开观看，可从会话列表重新打开。弹窗加载独立页面，取得连接令牌后不再依赖主控制页保持打开；令牌不写入弹窗网址。图形数据经已有实例 SSH 通道和有权限校验的 WebSocket 转发；客户机 RFB 仅监听环回。只有准确 WM 与应用的 exec 成功、进程归属和实际 RFB 监听均核对通过才报告 `running`，不会把仅启动 Xvnc 当作应用已启动。

启动时可分别关闭“复制到宿主”和“粘贴到应用”。Sakura 将限制写入此应用专属 Xvnc 会话的剪贴板收发与 PRIMARY 选区参数，并禁止会话内用 `vncconfig` 放宽这些参数；重开窗口仍沿用会话设置，更改需要停止并重新启动应用。网页中的敏感文本检测和大小限制仍额外生效。这只约束该图形会话与 VNC 客户端之间的剪贴板传递，不阻止客户机管理员在其他进程或显示器中访问数据。

这是独立的**浏览器窗口**，应用界面仍显示在自己的虚拟屏幕上，可能带有 Openbox 背景和窗口边框，不提供跨窗口剪贴板同步、音频或文件拖放。浏览器必须允许弹窗。服务重载会只读恢复完整会话索引、复核原监听后允许重连或按原票据停止，不自动重新启动应用或接管自然退出监视。旧版仅有 UID 标记的窗口显示 `review-required`，网络与项目归属未核实，需管理员人工核对；它们不能据此打开或自动清理。客户机 Root、显式特权代理以及原运行域外的普通入口不属于本窗口的启动和清理边界。

主机实例目录的 `single-app-runs.json` 在第一次 native prepare 前记录稳定 UUID、配置版本、原项目身份、boot 和不可变 nativeBuild；固定 `prepare-run` 在原 native EX 锁下核对该来源三件套、已安装启动器、原 boot 与账号，再创建运行域，不重新选择当前构建。客户机 `/var/lib/sakura/single-app-uid/:UUID/session.json` 保存独立 UID、完整 run、目录视图与监听回执。启动应答失联、取消、清理失败和重载都重用原 UUID，只读恢复后清理，不重新发行票据。主机 `run` 保留发布时的完整 tuple，成功停止另存 `closure`；原 owner 发现另一服务实例已准确核销该 UUID 时，只释放自己的内存租约，不重复 native stop，不重写其他实例的记录。无原 ticket 时，只有热/归档 ticket、原 cgroup、guest receipt 与 runtime 都只读确认不存在，才允许记录完整 `absence` 并退休。

接口：`GET /api/vms/:vmId/single-app` 查看会话；`POST` 使用 `{ "action": "start", "program": "xterm", "args": [], "resolution": "1024x768", "clipboard": { "copy": false, "paste": true } }` 启动，或 `{ "action": "stop", "id": "..." }` 停止。省略 `clipboard` 时双向均允许。图形 WebSocket 为 `/ws/:vmId/desktop?app=:sessionId&token=:ownerToken`，仅实例拥有者可连接。

当前专项覆盖原生票据与权限模型、主机启动/取消/应答失联/重载/关闭生命周期，以及新自有 Linux namespace 中真实的 0700 目录、0600 文件和映射 ELF、永久 UID/capability 清除、管理 FD 关闭与管道 EOF/超长/超时行为。`scripts/smoke-single-app-native-linux.py` 只验证这些启动原语，不验证 Xvnc、RFB、普通 SSH 或发行版安装。`npm run test:single-app-windows` 使用新的严格桌面 smoke，默认仅描述方案；显式添加 `-- --run-cow x11` 或 `-- --run-cow wayland` 才在新自有 Debian KDE COW 上验证当前生产路径的公共 API、RFB 认证与字节流、自然退出和精确 detached stop。仅 describe 成功不算 GUI 通过。旧 `scripts/smoke-single-app-windows.ts` 作为历史保留，不能作为新路径的当前证明，也不能替代其他发行版的新验证。
