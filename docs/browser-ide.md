# 认证浏览器 IDE

在 Debian 或 Ubuntu 实例中启动并选择项目，核对并应用必要的[目录权限迁移](project-directory-migration.md)，然后到“能力中心”选择“认证浏览器 IDE”。参数 `mode` 支持 `status`、`install`、`start`、`stop`。首次 `start` 自动安装固定版本的 code-server；安装包下载后先核对 SHA-256，再在客户机中启用。首次下载约 239 MB，客户机需要可访问 GitHub 的网络与足够磁盘空间。Alpine 暂不支持此入口，可继续使用 Sakura 文件编辑器与终端。启动不自动创建项目目录或修改属主。

已通过摘要校验的发布包缓存于客户机 `/var/cache/sakura/browser-ide/code-server-4.132.0-linux-amd64.tar.gz`，再次安装可复用。管理员也可预置该文件以离线安装；每次使用缓存都会重新检查固定 SHA-256，错误缓存会拒绝安装，需要替换缓存。系统工具缺失时仍需客户机软件源。下载发生连接重置等错误时每个入口最多重试三次，发布下载入口失败后使用同一发布包的 [GitHub 官方资产接口](https://docs.github.com/en/rest/releases/assets#get-a-release-asset)，最终仍核对同一摘要且受任务时限约束。

`guestPort` 是客户机监听端口，`hostPort` 是 Windows 本机回环端口，默认均为 8080；冲突时更换本机端口。服务为当前项目启动独立的 code-server 会话，打开该项目目录。启动结果不含密码；点击“打开浏览器 IDE”后，Sakura 才通过已授权、未锁定的本机接口提供入口与随机密码。新标签页显示 code-server 登录页，在原标签页输入或复制访问密码。密码不会写入任务结果或普通状态；本机服务记录使用受限权限保存以便重启恢复。不要分享密码。

`ttlMinutes` 默认 60，范围 1–240 分钟。到期时客户机守护逻辑停止原整个 cgroup，包括脱离终端的后台子进程；控制服务关闭后仍有效。控制服务运行或重新加载时，在完整清理确认后核销原票据并关闭本机桥接。手动 `stop` 同样清理整个运行域，保留安装包、项目文件和账号 home；失败保留原完整记录供重试。实例暂停时先恢复再停止。每个实例的每个项目同时管理一个浏览器 IDE 会话；修改端口或项目目录前先停止原会话。

浏览器 IDE、集成终端、扩展宿主及其子进程以持久项目 UID/GID 运行，使用账号独立的 `HOME=/var/lib/sakura-project-homes/<身份 UUID>`。code-server 配置、用户数据和扩展位于该 home 的 `.config/sakura-browser-ide` 与 `.local/share/sakura-browser-ide`，旧 root 编辑器缓存保留。命令、项目环境与密码通过受保护 stdin 帧进入固定降权启动器，不拼接到 root 参数或脚本正文。共享发行包安装和系统工具安装仍是实例管理员操作。安装及认证机制参考 [code-server 官方安装文档](https://github.com/coder/code-server/blob/main/docs/install.md)与 [安全访问说明](https://coder.com/docs/code-server/guide)。

共享与私有项目均只监听客户机回环地址，经宿主 `127.0.0.1` 上的 SSH TCP 桥接访问，不创建 QEMU 端口映射或客户机路由；所选宿主端口已有实例映射时拒绝占用。私有项目的 IDE 及后代进入原项目网络命名空间，扩展下载与联网命令受其限制；固定发行包仍由共享网络的管理员安装器准备。实例停止、暂停、应急锁定或控制服务关闭时关闭桥接，重载只在原完整账号、boot、构建、cgroup inode、进程创建身份、正文摘要及实际 UID 持有的监听全部核对后恢复入口。SSH 控制连接完成后再核对一次归属，跨 boot 等待不会开放旧入口。更改网络模式前先停止会话；客户机 root 仍能自行变更网络，不能将此视为抵御管理员的安全边界。

旧 root 会话缺少上述完整账号票据时显示需要检查，并保留原记录。管理员须确认关闭原会话和全部后代、处理准确旧记录，再明确迁移目录并重建；系统不会把未知 root 会话自动视为新账号运行。新会话启动前保存原 intent，停止失败先进入检查状态并禁止重新开放入口，原进程及票据随后按准确身份重试清理。客户机冷重启后只在原资源确认不存在时退休旧票据，不向新 boot 进程发送旧停止请求。

迁移前的 root 入口曾用 `npm run test:browser-ide` 在真实 Debian/QEMU 客户机中核验发布包摘要、启动、拒绝错误密码、接受正确密码和到期清理；该历史证据不证明新版 UID 入口已完成相同实测。
设置 `SAKURA_BROWSER_IDE_PRIVATE=1` 运行同一脚本，额外核对进程所在命名空间、无网络路由、无 QEMU 映射及桥接恢复。
同时设置 `SAKURA_BROWSER_IDE_TERMINAL=1` 会用真实 Chromium 操作 IDE 集成终端并核对其网络命名空间。可将 `SAKURA_BROWSER_IDE_ARCHIVE` 设为宿主已下载发布包的路径；脚本先校验该文件，再在客户机测试错误缓存拒绝和有效缓存安装。

新版独立实机入口为 `npm run test:browser-ide:identity -- --describe`，默认只显示计划，不启动虚拟机。`--make-freeze ubuntu` 固定正式源码、官方发布包、已经停止的准确自有 Ubuntu 测试实例和历史证明；`--validate-only ubuntu <冻结文件>` 只读复核，`--run-owned ubuntu <冻结文件>` 才启动该实例。测试为新 UUID 建立项目，保留既有账号、磁盘、迁移计划和证明；十项计划覆盖真实认证与 WebSocket 终端、UID/home、邻居独立、只读重载、票据和帧拒绝、整域停止、应用关闭后的 TTL 与冷重启。脚本和宿主回归不代替尚未完成的实机证据。
