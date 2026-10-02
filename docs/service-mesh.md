# 项目 Envoy 边车

能力中心的“服务网格边车”按实例和项目保存一条回环 TCP 代理策略。选择项目后提交 {"mode":"save","policy":{"name":"frontend","listenPort":15001,"upstreamPort":8080}}，再明确检查或提交 {"mode":"start"}。

在运行中的 Linux 实例明确安装兼容的 Envoy、tmux 与 Python 3，应用已核对的 [目录迁移](project-directory-migration.md) 后启动。版本检查、配置验证和长期代理都使用原项目持久 UID/GID、独立 home、原目录描述符与网络，正文及环境通过有界保护帧传送。环境从捕获配置只解析一次；root 不运行 Envoy，不执行项目目录或环境。缺失目录不自动建立。

固定配置仅监听此项目 127.0.0.1:15001，转发到同一项目 127.0.0.1:8080。私有项目只使用独立空间的回环接口，不添加网卡、IPv4/IPv6 路由或对外代理。两个私有项目可以使用相同端口；两个共享网络项目不能保存相同监听端口，切换到共享网络也重新检查。边车关闭热重启，固定一个工作线程。临时访问使用同一项目的 [TCP 隧道](reverse-tunnel.md)。

普通 status 只读取工具可用性、完整原票据及最近一次同配置、boot、系统二进制的 UID 兼容性结果，不安装启动器、解析环境或执行版本任务。没有样本时 envoyUsable 为 null，就绪为 false。明确“检查”或“启动”才执行 UID 版本探测。首次私有项目检查或启动可以准备固定网络空间，随后重读状态；boot 或二进制变化在执行前拒绝。

长期服务拥有独立 sakura-mesh-uid-<projectId> tmux 名称、/run/sakura-project-mesh/<projectId> 和宿主 project-mesh/<projectId>/runtime.json。就绪与重载同时核对原账号、boot、完整 service/native 票据、cgroup device/inode、保护帧摘要、固定配置及唯一实际 UID 回环监听，再核对 Envoy 映像、argv、cwd、网络、PID 创建身份和能力。额外接口、路由或被替换对象均拒绝，不依据标签或 PID 收编进程。

stop 先确认原版本/校验短任务的完整域和 native 票据核销，再停止原长期服务的整个 UUID cgroup，包含脱离会话的后代。固定配置清理、准备租约释放和宿主记录删除按此顺序完成。失联应答、取消或清理失败返回 503，保存原完整记录、配置与租约供明确停止重试。更换策略、目录、网络模式或禁用能力须先停止；暂停实例须先恢复。remove 删除已停止项目的策略，不删除未知旧配置。

宿主重载保留已完成边车并只读核对；关闭控制服务会清理未完成启动及有限任务，健康长期代理保持。客户机冷重启须先按准确旧票据确认原域与资源已不存在，再明确启动，旧 kill 不发送到新 boot。第 1 版策略仍可读取。旧 root 会话与未知域需要管理员按原证明处理，新入口不猜测停止或转换为 UID 运行。

配置位于 /etc/sakura/mesh-uid/<projectId>/<runUUID>.json，root 属主、原项目 GID、0440。root 独占 owner 回执保存账号、run、boot、端口、摘要及 inode。发布只接受一条固定回环 listener/cluster 的惰性 JSON，清空管理环境并使用系统 cwd。UID 执行前和 root 核对/清理时复核同一配置；发布中断留下不能核对的文件时保留原对象供管理员处理。

配置使用 Envoy 官方 [静态 listener/cluster](https://www.envoyproxy.io/docs/envoy/latest/start/quick-start/configuration-static.html) 和 [TCP proxy](https://www.envoyproxy.io/docs/envoy/latest/configuration/listeners/network_filters/tcp_proxy_filter) 结构。不提供管理端口、动态 xDS、TLS 凭据、透明流量劫持或跨主机服务发现。客户机 root 仍可改动进程、文件和空间，范围见 [项目网络隔离](project-network-isolation.md)。

正式九个相关测试文件 249/249 通过、零跳过，实际退出 0 且源码前后未变，证明为 .data/mesh-identity-backend-c65614f4-cafd-415b-aa79-0700dc89050a-verification.json；完整类型检查通过。本批完成捕获配置、完整有限任务与服务票据、失联应答、取消/清理重试、只读重载和首次私有网络准备模型；生成的 root/UID Python 静态编译通过。没有启动新的 VM，实际 UID/GID/home、Envoy listener、Linux cgroup 与发行版兼容性仍需联测，正式 smoke 已适配：npm run test:service-mesh -- debian（或 ubuntu/alpine）。--describe 不创建运行时，--validate-only 只核对已有缓存、镜像与源码；正常执行使用新建且保留的测试实例，必须实际确认原 UID/native 整域关闭。脚本类型、嵌入 Python 静态编译和准确应用校验已通过，尚未执行新的 VM 或 Linux C 观察器。

## 旧入口的历史联测

以下真实 VM 结果属于旧 root 入口，不能作为新 UID 入口已经实测的证明。

`npm run test:service-mesh -- debian` 和 `-- ubuntu` 使用真实虚拟机与 [官方 Envoy 1.39.1](https://github.com/envoyproxy/envoy/releases/tag/v1.39.1) 的固定 SHA-256 二进制。已验证三个并行代理使用相同端口而流量与网络分开、目录和环境、Windows DPAPI 密钥加载且结果不暴露密钥、宿主 SSH 桥接、控制服务重启、暂停保护、配置变动拒绝、旧会话与脱离会话代理清理、启动取消、额外路由拒绝，以及真实客户机重启后手动恢复。测试实例独立，结束时关闭并移除。

同一官方 glibc 二进制在当前 Alpine 3.23 加 gcompat 的客户机中缺少 `pthread_cond_clockwait` 和 `__res_init`，未完成真实代理验证。`-- alpine` 当前只验证这个兼容性失败被生产启动入口拒绝、未留下代理，且状态报告未就绪；其成功退出不代表 Alpine 代理流量通过。Alpine 使用前仍需另外安装与该发行版兼容的 Envoy。
