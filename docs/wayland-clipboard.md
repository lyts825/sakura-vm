# 原生 Wayland 应用剪贴板策略

在「桌面 → 外观与布局」选择「原生 Wayland」，保存内容后应用并重启 KDE。随后打开「原生应用剪贴板」，把应用类型切换为「原生 Wayland 应用」，安装代理，填写客户机应用的完整路径、读取 SHA-256 身份并保存规则，再从面板启动。X11 与 Wayland 的程序规则、归属及会话记录分别保存。

生产入口从完整原项目 Desktop/native 票据中发现真实项目 UID 的 Plasma/Wayland 端点，核对账号、boot、原 cgroup、保护帧及来源构建、PID 创建身份、项目网络、运行目录与 socket 身份。desktopOwner 显示来源桌面项目 UID/run，applicationOwner 显示该应用独立 sandbox UID。KWin wrapper 创建监听端点时，还固定其唯一直属 KWin 子进程、继承 FD 与内核监听 inode；子进程重启后旧代理停止接入，须重新启动应用会话。公开 API 不接受任意合成器路径或用户身份。X11 桌面上启动此模式会明确拒绝。

每个会话分配新的独立 Linux 用户、家目录、私有 D-Bus 和 0700 运行目录。应用使用固定的原生 Wayland 后端和专属协议代理；不传入 `DISPLAY`、`XAUTHORITY` 或继承的 Wayland socket。接受与客户机架构匹配的普通 64 位 ELF，拒绝 setuid/setgid 与文件能力提权程序。参数逐项按字面传递。

应用的专属 mount namespace 在原项目路径挂入 idmapped 目录视图，把真实项目 UID/GID 映为本次应用独立 UID/GID。普通 0700 项目目录和其中的 0600 项目文件可正常读写；应用新建文件在原文件系统仍归项目 UID/GID。控制器不改写原目录和文件的 owner、mode、ACL。固定 Root helper 在新 namespace 重开并核对原目录 dev/inode，设置 `nosuid`、`nodev`，随后由控制器核对映射身份、模式、挂载标志和准确应用 UID 的实际访问权限。需要 x86_64 或 aarch64、原 Root user namespace，以及客户机内核和文件系统实际支持 idmapped mount；Linux 5.12 起提供该机制，但版本号不能代替实际检查。任何创建、映射或访问检查失败均拒绝本次启动，不放宽共享权限或改用项目 UID。

若私人父目录阻止新 UID 遍历，helper 只在本次应用 namespace 用 Root 所有的 tmpfs 建立到准确项目叶目录的必要路径，并隐藏该阻塞祖先下的其他内容。此路由只提供项目子树，不授予私人父目录中的其他文件；原系统 namespace 仍使用原路径和权限。覆盖根目录，或与应用家目录、代理运行目录重叠的路由会明确拒绝，不能隐式替换 HOME 或运行目录。

项目内 0700 私有 ELF 的执行也使用映射视图。固定 Python 引导程序已进入本次 mount namespace 并永久降权后，重新打开准确路径，复核原 dev/inode、模式、大小、修改时间、完整摘要及无文件 capabilities，再以新 FD 执行。原挂载中的 Root 句柄在应用代码执行前关闭，拒绝身份变化、内容变化或不支持 FD 执行的环境。

## 内容与规则

复制和粘贴分别受方向、其他格式、敏感文本及 1 KiB–1 MiB UTF-8 文本上限约束。代理在 `wl_data_source.send` 与 `wl_data_offer.receive` 处接管正文管道，收齐到 EOF，检查完整文本后才开始交付；`zwp_primary_selection` 使用同样检查。它同时处理异步消息和独立的 FD 队列，不假定 SCM_RIGHTS 必须与消息头同时到达。

敏感检查包括常见私钥、令牌、JWT、凭据赋值和带凭据 URL，不能识别所有秘密。纯文本严格核对编码和 UTF-8 字节数，不支持的字符集拒绝。关闭其他格式或启用敏感检查时拒绝二进制与自定义格式。门户文件传输令牌始终拒绝，私有会话没有共享桌面门户总线。

禁止复制方向时，不转送新的 selection 或 drag 请求，保留已有选择。允许方向但正文不合规则时，接收者得到关闭的数据管道；不能承诺恢复此前已被应用自行替换的 selection。停用规则放宽后续内容检查，但不开放隐藏的特权接口。更新使用策略锁和完整文件摘要确认；收紧取消尚未交付的正文，放宽不放松采集中的限制。第一字节交付后无法撤回已交付内容，合成器或工具包随后直接返回其旧缓存也可能不产生新代理请求；更新成功不表示这些缓存已被清空。

采集时限 0.75 秒、交付时限 1 秒、不完整或发送阻塞的协议时限 5 秒。慢源或不持续处理事件的应用可能被拒绝，工具包自身也有等待时限。每会话最多 32 个连接、32 个正文传输、每条 8 MiB 二进制数据和合计 32 MiB 正文缓存；文本仍受保存的较小上限约束。正文只接受可写管道 FD，常规文件和设备 FD 不作为正文目标；正常图形共享内存 FD 继续按其声明协议处理。

## 生命周期与范围

停止来源桌面先以完整原证明退休匹配的应用和代理域；失败保留原归属及准备租约供停止重试。2026-10-03 当前目录视图在自有 WSL/ext4 namespace 通过 8 个真实场景：0700/0600 读写、私人父目录路由、直接合成器拒绝、procfs 不支持映射的拒绝，以及取消/EOF/超时清理。两个正例另验证项目私有 0700 ELF：旧挂载 FD 执行实际返回 EACCES，当前固定引导程序重新打开映射 FD 后执行成功，实际应用读取 0600 文件并确认管理描述符关闭、NoNewPrivileges=1、有效 capabilities 为空；原 owner/mode/ACL 与 ELF 摘要不变。当前 20 资产构建为 `d3f26de18d95089f26883e2258d189743e1eaf0def5c4a9a853e7857613b87e5`，32 项相关回归零失败，原 58 项目录视图回归保留。这不替代新 UID 桌面的真实 Wayland 联测。此前真实 Qt/GTK 结果继续作为历史协议验证保留。

应用、私有 D-Bus 及普通子进程进入应用专属 cgroup；根用户代理进入另一个专属 cgroup。目录视图票据绑定原 Desktop run/boot、项目与应用 UID/GID、原目录 dev/inode/mode、挂载标志和 mount namespace dev/inode。接入、状态和停止同时核对实际 UID、创建时间、网络、cgroup 及原 namespace；替换或迁出的活进程会拒绝。准确原 cgroup 已空时仍可完成停止和记录清理，不因 namespace 已释放而失去清理入口。

短期 Root helper 通过私有 SCM_RIGHTS 回传单个 namespace FD，核对内核类型、Root 归属及实际 helper namespace 后才确认接收，并实际等待精确子进程退出。取消、EOF、超时或回执错误会关闭接收 FD 和 socket，只结束本次仍未回收的 helper。应用在降权前进入已核对 namespace，原 Root 目录和 namespace FD 在执行应用前关闭。停止先关闭代理，再结束所属应用进程并等待释放两组域，请先保存内容。只有已停止会话可清理记录。服务重载保留归属，克隆与导出/导入保留身份和规则，不重放 PID 或自动启动应用。

协议定义固定来自 Wayland 1.24.0 与 wayland-protocols 1.45。17 个官方 XML 保留原字节和许可证，连同两个 Python 源文件及来源清单组成 20 个打包资产，构建、上传和启动均核对摘要。未知接口、`ext/wlr data-control` 及 KDE 特权剪贴板管理接口隐藏，直接绑定同样拒绝；新工具包依赖的图形扩展可能需要显式适配。

这仍不是系统级 DLP，不接管已运行的普通程序、其他用户或客户机管理员，也不限制其他文件、网络或人工输入方式。项目目录共享不等于文件内容隔离。总目录状态继续保持部分实现。真实 Qt/GTK、规则更新及原生桌面入口的最终验证范围见本轮实现记录，不能用协议单元测试替代真实桌面验证。

依据：[Wayland 消息、对象与 FD 队列](https://wayland.freedesktop.org/docs/book/Protocol.html)，[固定来源清单](../native/wayland-clipboard/sources.json)，[Linux idmapped mount](https://docs.kernel.org/filesystems/idmappings.html)，[Linux cgroup v2](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)。
