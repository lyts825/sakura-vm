# 文档索引

核对日期：2026-10-24；应用与内置包版本：**2.7.0**；宿主插件 API：**5**；既有公共服务契约保持兼容，Notebook 和 Files 提供显式的 **V2**。

| 使用场景 | 从这里开始 |
| --- | --- |
| 安装与日常使用 | [项目 README](../README.md) 的快速启动、插件选择与使用范围 |
| 阅读或修改源码 | [源码阅读与维护指南](development-guide.md) → [架构说明](architecture.md) |
| 开发插件或调整公开接口 | [插件设计契约](plugin-design-contract.md) → [插件协议](plugin-protocol.md) → [HTTP](http-request-contracts.md) / [WebSocket](websocket-contracts.md) 契约 |
| 核对版本、验收或阻塞 | [项目状态](../PROJECT_STATUS.md)、Git 标签与 `server/service-contracts/releases/` |
| 查找尚未完成的能力 | [未完成功能清单](unfinished-features.md) 与对应功能文档 |

主题文档按下方导航查阅，保留现有文件路径，避免旧链接失效。历史记录保留当时的版本与验证边界；当前接口以源码、生成契约和设计契约为准。

## 架构、契约与开发维护

- [架构与依赖边界](architecture.md)
- [第三方 WebAssembly 插件](community-plugins.md)
- [有界计算运行时](compute-runtime.md)
- [固定动作委派（2.8.0 实施中）](delegated-actions.md)
- [源码阅读与维护指南](development-guide.md)
- [HTTP 请求体契约清单](http-request-contracts.md)
- [统一网络运行时](network-runtime.md)
- [最小核心、插件与整合包](plugin-architecture.md)
- [插件设计契约与统管层接口](plugin-design-contract.md)
- [项目交付工作台插件包设计](delivery-pack-design.md)
- [三个插件包的产品与实施设计](plugin-pack-roadmap.md)：[环境镜像工坊](foundry-pack-design.md)、[应用运行与运维](app-runtime-pack-design.md)、[数据与实验工作台](data-lab-pack-design.md)；实现使用指南见下方三个插件包
- [第二批三个完整插件包设计](plugin-pack-expansion-design.md)：[接口集成验证](integration-lab-pack-design.md)、[可靠性演练](resilience-lab-pack-design.md)、[项目知识与文档](knowledge-studio-pack-design.md)；设计版本 2.0.0，2.7.0 实施与验收状态见项目状态
- [第三批十个完整插件包设计](plugin-pack-suite-design.md)：浏览器、软件供应、数据库变更、事件队列、模型评测、媒体、本地化、跨包流程、事件复盘和交互式实验；101 个拟议插件，设计版本 3.0.0，运行实现待开始
- [插件与整合包协议](plugin-protocol.md)
- [独立运行包自更新](self-update.md)
- [受管存储与恢复](storage-runtime.md)
- [WebSocket 契约与收发路径](websocket-contracts.md)

## 工作空间、项目与开发工具

- [认证浏览器 IDE](browser-ide.md)
- [构建农场](build-farm.md)
- [临时 COW 工作区](cow-workspaces.md)
- [npm 依赖升级机器人](dependency-bot.md)
- [工作区恢复与自动化功能](development-next.md)
- [开发工作台与安全维护](development-workbench.md)
- [项目交付工作台](delivery-workbench.md) 与 [交付 CLI](delivery-cli.md)
- [环境镜像工坊](foundry-workbench.md)
- [应用运行与运维](app-runtime-pack.md)
- [数据与实验工作台](data-lab.md)
- [接口集成验证](integration-lab.md)
- [可靠性演练](resilience-lab.md)
- [项目知识与文档](knowledge-studio.md)
- [开发工作区与数据互通](development-workspaces.md)
- [工程操作的项目账号](engineering-project-identity.md)
- [文件锁](file-locks.md)
- [Git 工作台的项目账号](git-project-identity.md)
- [本地 AI 编程助手与命令规划](local-assistant.md)
- [AI 修复会话](repair-sessions.md)
- [环境变更预览与受控应用](environment-plan.md)
- [流水线依赖与局部重跑](pipeline-graph.md)
- [JupyterLab 与 Marimo 环境](notebook-environments.md)
- [离线软件包缓存](package-cache.md)
- [发行版包管理器](package-workbench.md)
- [私有项目容器](private-containers.md)
- [收藏命令与流水线的项目账号执行](project-command-tasks.md)
- [项目目录与账号迁移](project-directory-migration.md)
- [项目命令执行](project-execution.md)
- [持久项目账号与固定启动器](project-identities.md)
- [项目主命令的运行归属](project-main-lifecycle.md)
- [项目语言服务与调试器](project-protocol-streams.md)
- [项目磁盘配额](project-quota.md)
- [项目首次 Git 检出](project-repository.md)
- [项目常驻服务的运行归属](project-service-lifecycle.md)
- [项目 SSH、SFTP 与编辑器接入](project-ssh.md)
- [项目终端与只读分享](project-terminals.md)
- [项目工具探测与受限命令](project-tool-tasks.md)
- [项目运行时版本](runtime-versions.md)
- [沙箱工作台](sandbox.md)
- [团队模板](team-templates.md)
- [工作空间管理](workspace-management.md)

## 网络与跨主机协作

- [跨主机冷迁移](cold-migration.md)
- [客户机出站目标白名单](egress-policy.md)
- [私有 DNS 与 DNSSEC](guest-dns.md)
- [主机配对与多主机状态](host-peers.md)
- [本机 HTTP/HTTPS 服务入口](http-ingress.md)
- [在线迁移检查与执行](live-migration-plan.md)
- [Windows 系统域名解析](local-aliases.md)
- [NAT 回流验证](nat-hairpin.md)
- [客户机网络延迟与丢包模拟](network-emulation.md)
- [客户机网络配额](network-quota.md)
- [脱敏数据包捕获](packet-capture.md)
- [私有项目账号的共享网络限制](project-egress.md)
- [项目网络隔离](project-network-isolation.md)
- [临时反向隧道](reverse-tunnel.md)
- [项目 Envoy 边车](service-mesh.md)
- [跨主机快照复制](snapshot-replications.md)
- [WireGuard 覆盖网络](wireguard-overlay.md)

## 磁盘、备份、恢复与高可用

- [安全清理中心](cleanup-center.md)
- [任务证据与处理](task-evidence.md)
- [备份文件级恢复](backup-file-recovery.md)
- [灾备演练](disaster-recovery-drill.md)
- [黄金镜像库](golden-images.md)
- [独立第三节点部署与真实故障演练](ha-external-drill.md)
- [故障接管策略与健康检查](ha-failover-check.md)
- [见证配置迁移与状态恢复](ha-witness-maintenance.md)
- [宿主目录挂载](host-mount.md)
- [主机维护排空](maintenance-drain.md)
- [RAM 与进程状态快照](memory-snapshots.md)
- [S3/MinIO 备份目标](object-backup.md)
- [一致性在线快照](online-snapshots.md)
- [只读救援](rescue-boot.md)
- [项目文件逻辑擦除记录](secure-erase.md)
- [快照时间线与差异](snapshot-diff.md)
- [快照分支合并](snapshot-merge.md)
- [本机存储池](storage-pools.md)
- [SSD/HDD 分层](storage-tiering.md)
- [目录同步合并驱动](sync-merge-drivers.md)
- [Virtio-FS 共享目录](virtio-fs.md)

## 桌面、设备与平台集成

- [ARM64 实例](arm64-instances.md)
- [启动性能验证](boot-performance.md)
- [浏览器扩展](browser-extension.md)
- [网页应用剪贴板策略](clipboard-policy.md)
- [在线 vCPU 热插拔](cpu-hotplug.md)
- [桌面录制与回放](desktop-recording.md)
- [eBPF 内核性能分析](ebpf-profiler.md)
- [客户机性能火焰图](flamegraph.md)
- [客户机用户与目录配额](guest-quota.md)
- [客户机任务取消与清理](guest-task-cleanup.md)
- [硬件声明、密钥登记与计算设备检查](hardware-readiness.md)
- [Linux 图形桌面](linux-desktop.md)
- [客户机内存压力自动回收](memory-reclaim.md)
- [移动伴侣](mobile-companion.md)
- [Windows 普通应用剪贴板策略](native-clipboard.md)
- [Windows 工作区集成](native-integration.md)
- [嵌套虚拟化检测](nested-virtualization.md)
- [樱花插图](sakura-art.md)
- [单应用 Linux 窗口](single-app-windows.md)
- [Windows 托盘伴侣](tray-companion.md)
- [TPM 与安全启动](trusted-boot.md)
- [USB 热插拔](usb-hotplug.md)
- [原生 Wayland 应用剪贴板策略](wayland-clipboard.md)
- [Windows 受控启动的早期剪贴板策略](windows-clipboard-early-init.md)
- [WSL Linux 后端](wsl-backend.md)
- [Linux X11 应用剪贴板策略](x11-clipboard.md)

## 权限、安全、自动化与可观测性

- [多用户、只读分享与项目成员](access-control.md)
- [自动修复 Runbook](auto-remediation.md)
- [事件自动化规则](automation-rules.md)
- [插件功能灰度](feature-rollouts.md)
- [能力中心](feature-suite.md)
- [集群策略发布](fleet-policy-rollout.md)
- [单次 GPG Agent 转发](gpg-agent-forward.md)
- [Windows Hello 解锁](hello-unlock.md)
- [远程不可变审计锚点](remote-audit.md)
- [镜像与软件包安全扫描](security-scan.md)
- [单次 SSH Agent 转发](ssh-agent-forward.md)
- [OIDC 与 SAML 单点登录](sso.md)
- [事件投递与告警路由](webhooks.md)

## 历史实施、审核与剩余范围

- [功能实现记录](capability-completion.md)
- [代码审核与修复记录 · 2026-09-21](code-review-2026-09-21.md)
- [最后三项功能的历史清单](feature-completion-history.md)
- [前端界面优化 - 视觉指南](frontend-optimization-visual-guide.md)
- [功能实现完整性审计](implementation-audit.md)
- [功能审计修复记录](implementation-fixes.md)
- [统一插件管理实施记录](plugin-system.md)
- [系统资源架构实施记录](system-runtime-plan.md)
- [未完成功能清单](unfinished-features.md)

## 其他项目资料

- [前端优化记录](frontend-optimization.md)
- [字体来源与重建](../src/assets/fonts/README.md)
- [宣传视频源码与交付物](../sakura-promo-video/README.md)
- [视频中的 Manim 动画](../sakura-promo-video/manim/README.md)
