# 未完成功能清单

根据当前工作区源码生成。最初基线为 `c669881`，其目录中有 200 条未完成记录。

目前共 250 条目录记录，其中 141 条有实现入口，**109 条仍未完成**（99 条规划、10 条部分实现）。按标识去重后为 108 个未完成标识；不同条目仍有范围重叠。

本轮已接通 91 条原未完成目录记录，另完善了文本三方合并。实现范围、使用方式与验证见 [本轮实现记录](capability-completion.md)。**这不表示全部功能已经完成**；available 也不代表当前实例已安装所需工具。

| 目录 | 总数 | 已有入口 | 部分实现 | 规划 | 未完成 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 第一批 | 50 | 30 | 4 | 16 | 20 |
| 第二批 | 100 | 79 | 1 | 20 | 21 |
| 第三批 | 100 | 32 | 5 | 63 | 68 |

## 第一批

### 实例与资源

- [ ] **通用镜像导入**（P1 · 规划） · [`image-import`](../server/feature-suite.ts#L30) — 支持 VHDX、VMDK、RAW、OVA 等格式的导入校验。 对应完整流程尚未实现。
- [ ] **多架构实例**（P2 · 规划） · [`multi-arch`](../server/feature-suite.ts#L32) — 为 ARM64 等架构提供 QEMU 兼容运行入口。 对应完整流程尚未实现。
- [ ] **一致性在线快照**（P2 · 规划） · [`online-snapshots`](../server/feature-suite.ts#L36) — 通过文件系统冻结创建一致性快照。 对应完整流程尚未实现。
- [ ] **快照时间线与差异**（P1 · 规划） · [`snapshot-diff`](../server/feature-suite.ts#L37) — 比较快照的文件和磁盘变化。 对应完整流程尚未实现。

### 文件与数据

- [ ] **Windows 文件系统直挂**（P1 · 规划） · [`windows-mount`](../server/feature-suite.ts#L40) — 通过受控共享挂载宿主机目录。 对应完整流程尚未实现。

### 开发工作台

- [ ] **LSP 语言服务**（P1 · 部分实现） · [`language-services`](../server/feature-suite.ts#L48) — 提供补全、跳转、重命名和诊断。 对应完整流程尚未实现。
- [ ] **DAP 调试器**（P2 · 规划） · [`debug-adapter`](../server/feature-suite.ts#L49) — 提供断点、单步、调用栈和变量查看。 对应完整流程尚未实现。
- [ ] **三方合并编辑器**（P0 · 部分实现） · [`merge-editor`](../server/feature-suite.ts#L53) — 已有文件草稿及 Git 普通文本三方编辑、版本校验和暂存；仍缺同步冲突的图形编辑及删除、链接、子模块、二进制冲突工作流。
- [ ] **Dev Container 支持**（P1 · 规划） · [`dev-container`](../server/feature-suite.ts#L58) — 从 Dockerfile 或 devcontainer 配置创建环境。 对应完整流程尚未实现。

### 网络与服务

- [ ] **HTTPS 反向代理**（P1 · 规划） · [`reverse-proxy`](../server/feature-suite.ts#L63) — 生成本地域名、证书和服务路由。 对应完整流程尚未实现。
- [ ] **VPN 集成**（P1 · 规划） · [`vpn-integration`](../server/feature-suite.ts#L65) — 管理 WireGuard 或 Tailscale 连接。 对应完整流程尚未实现。
- [ ] **离线软件包缓存**（P1 · 规划） · [`package-cache`](../server/feature-suite.ts#L67) — 缓存常用软件源和项目依赖。 对应完整流程尚未实现。

### 桌面与跨系统

- [ ] **GPU 与 3D 加速**（P2 · 规划） · [`gpu-acceleration`](../server/feature-suite.ts#L69) — 支持 virtio-gpu 和 VirGL 等方案。 对应完整流程尚未实现。
- [ ] **音频与摄像头转发**（P2 · 规划） · [`audio-video`](../server/feature-suite.ts#L70) — 让 Linux 图形应用使用宿主机设备。 对应完整流程尚未实现。
- [ ] **单应用 Linux 窗口**（P2 · 规划） · [`single-app-windows`](../server/feature-suite.ts#L71) — 将 Linux GUI 应用集成到 Windows 桌面。 对应完整流程尚未实现。
- [ ] **Windows 进程互操作**（P2 · 规划） · [`process-interop`](../server/feature-suite.ts#L72) — 允许 Linux 命令调用受控的 Windows 程序。 对应完整流程尚未实现。
- [ ] **多显示器与无障碍**（P1 · 部分实现） · [`multi-monitor`](../server/feature-suite.ts#L74) — 保存分辨率、缩放和多屏布局。 对应完整流程尚未实现。

### 运维与安全

- [ ] **镜像与软件包安全扫描**（P1 · 部分实现） · [`security-scan`](../server/feature-suite.ts#L77) — 检查 CVE、弱配置和过期组件。 对应完整流程尚未实现。
- [ ] **多用户与只读分享**（P2 · 规划） · [`rbac-sharing`](../server/feature-suite.ts#L78) — 提供角色、短期令牌和审计日志。 对应完整流程尚未实现。
- [ ] **插件 API 与自动化触发器**（P1 · 规划） · [`plugin-api`](../server/feature-suite.ts#L79) — 内置插件框架与签名 Webhook 投递已实现；第三方隔离插件及完整事件触发工作流仍未实现。

## 第二批

### 存储

- [ ] **虚拟磁盘加密**（P1 · 规划） · [`disk-encryption`](../server/extended-features.ts#L47) — 保护宿主机上的实例磁盘文件。 对应完整流程尚未实现。
- [ ] **项目磁盘配额**（P1 · 规划） · [`project-quota`](../server/extended-features.ts#L50) — 限制单个项目可使用的空间。 对应完整流程尚未实现。
- [ ] **客户机目录配额**（P1 · 部分实现） · [`guest-quota`](../server/extended-features.ts#L51) — 目前为 quota 探测，尚无完整配额设置与管理流程。
- [ ] **安全擦除证明**（P2 · 规划） · [`secure-erase`](../server/extended-features.ts#L62) — 擦除文件并记录操作证明。 对应完整流程尚未实现。

### 文件同步

- [ ] **自定义合并驱动**（P2 · 规划） · [`merge-drivers`](../server/extended-features.ts#L72) — 为文本和二进制类型选择合并方式。 对应完整流程尚未实现。
- [ ] **多主机统一视图**（P2 · 规划） · [`multi-host-view`](../server/extended-features.ts#L73) — 登记多个 Sakura 主机并集中查看状态。 对应完整流程尚未实现。

### 网络

- [ ] **项目网络隔离**（P1 · 规划） · [`network-isolation`](../server/extended-features.ts#L113) — 按项目隔离网络命名空间。 对应完整流程尚未实现。
- [ ] **出站白名单**（P1 · 规划） · [`egress-policy`](../server/extended-features.ts#L114) — 限制客户机可访问的目标。 对应完整流程尚未实现。
- [ ] **网络带宽配额**（P2 · 规划） · [`network-quota`](../server/extended-features.ts#L115) — 限制带宽、连接数和请求速率。 对应完整流程尚未实现。
- [ ] **SSH Agent 转发**（P1 · 规划） · [`ssh-agent-forward`](../server/extended-features.ts#L116) — 在确认后转发宿主机 Agent。 对应完整流程尚未实现。
- [ ] **GPG Agent 转发**（P2 · 规划） · [`gpg-agent-forward`](../server/extended-features.ts#L117) — 在确认后转发签名 Agent。 对应完整流程尚未实现。
- [ ] **本地域名别名**（P0 · 规划） · [`local-dns-alias`](../server/extended-features.ts#L118) — 为服务生成本地域名和通配别名。 对应完整流程尚未实现。
- [ ] **数据包捕获**（P1 · 规划） · [`packet-capture`](../server/extended-features.ts#L119) — 采集脱敏网络诊断包。 对应完整流程尚未实现。
- [ ] **临时反向隧道**（P2 · 规划） · [`reverse-tunnel`](../server/extended-features.ts#L120) — 为受控调试创建一次性入口。 对应完整流程尚未实现。

### 安全

- [ ] **TPM 与安全启动**（P2 · 规划） · [`tpm-secure-boot`](../server/extended-features.ts#L121) — 检测并配置 TPM 和安全启动链。 对应完整流程尚未实现。
- [ ] **Windows Hello 解锁**（P2 · 规划） · [`hello-unlock`](../server/extended-features.ts#L122) — 使用宿主机安全凭据解锁密钥。 对应完整流程尚未实现。
- [ ] **签名实例包策略**（P1 · 规划） · [`signed-bundles`](../server/extended-features.ts#L127) — 只允许受信任签名的导入包。 对应完整流程尚未实现。
- [ ] **系统调用隔离**（P2 · 规划） · [`syscall-profile`](../server/extended-features.ts#L136) — 为客户机应用应用受限策略。 对应完整流程尚未实现。

### 运维

- [ ] **多主机健康管理**（P2 · 规划） · [`multi-host-health`](../server/extended-features.ts#L146) — 集中查看多个宿主节点健康状态。 对应完整流程尚未实现。

### 体验集成

- [ ] **语言与区域包**（P2 · 规划） · [`locale-packs`](../server/extended-features.ts#L183) — 支持界面语言、时区和数字格式。 对应完整流程尚未实现。

### 平台

- [ ] **自更新与回滚**（P0 · 规划） · [`self-update`](../server/extended-features.ts#L184) — 灰度升级 Sakura 并支持回滚。 对应完整流程尚未实现。

## 第三批

### 远程主机与集群

- [ ] **短代码主机配对**（P0 · 规划） · [`host-pairing`](../server/next-features.ts#L20) — 生成可撤销的短代码，把另一台 Sakura 主机加入当前控制面。 对应完整流程尚未实现。
- [ ] **主机证书轮换**（P0 · 规划） · [`host-cert-rotation`](../server/next-features.ts#L28) — 登记主机证书的轮换策略和下一次轮换时间。 对应完整流程尚未实现。
- [ ] **多主机资源总览**（P0 · 部分实现） · [`multi-host-inventory`](../server/next-features.ts#L36) — 目前返回本机信息，尚未实现多主机汇总。
- [ ] **虚拟机在线迁移**（P1 · 规划） · [`live-migration`](../server/next-features.ts#L44) — 检查在线迁移前置条件并生成迁移计划。 对应完整流程尚未实现。
- [ ] **冷迁移队列**（P1 · 规划） · [`cold-migration`](../server/next-features.ts#L51) — 为停止状态的实例保存可重试迁移队列。 对应完整流程尚未实现。
- [ ] **资源评分调度**（P1 · 规划） · [`resource-scheduler`](../server/next-features.ts#L53) — 根据 CPU、内存和负载为实例计算主机选择分数。 对应完整流程尚未实现。
- [ ] **故障自动接管**（P0 · 规划） · [`ha-failover`](../server/next-features.ts#L61) — 保存高可用接管策略和最后一次健康检查。 对应完整流程尚未实现。
- [ ] **跨主机快照复制**（P1 · 规划） · [`cross-host-snapshots`](../server/next-features.ts#L69) — 记录快照复制目标、校验和与重试状态。 对应完整流程尚未实现。
- [ ] **集群策略发布**（P1 · 规划） · [`fleet-policy-rollout`](../server/next-features.ts#L77) — 以版本化批次保存集群策略发布计划。 对应完整流程尚未实现。
- [ ] **主机维护排空**（P0 · 规划） · [`maintenance-drain`](../server/next-features.ts#L85) — 在维护前登记排空计划并追踪实例迁移状态。 对应完整流程尚未实现。

### 虚拟硬件与固件

- [ ] **UEFI 与 OVMF 固件**（P1 · 规划） · [`uefi-ovmf`](../server/next-features.ts#L93) — 检测宿主机是否有 UEFI/OVMF 固件并保存选择。 对应完整流程尚未实现。
- [ ] **vTPM 密钥登记**（P1 · 规划） · [`vtpm-key-enrollment`](../server/next-features.ts#L101) — 保存 vTPM 密钥登记元数据和轮换提醒。 对应完整流程尚未实现。
- [ ] **PCI 与 USB 直通**（P1 · 规划） · [`pci-usb-passthrough`](../server/next-features.ts#L109) — 校验直通设备声明并生成安全预览。 对应完整流程尚未实现。
- [ ] **GPU 与 vGPU 档案**（P1 · 规划） · [`gpu-vgpu-profiles`](../server/next-features.ts#L117) — 登记 GPU 配置档案及其兼容性要求。 对应完整流程尚未实现。
- [ ] **嵌套虚拟化**（P2 · 规划） · [`nested-virtualization`](../server/next-features.ts#L125) — 检测嵌套虚拟化能力并记录结果。 对应完整流程尚未实现。
- [ ] **在线 vCPU 热插拔**（P1 · 部分实现） · [`vcpu-hotplug`](../server/next-features.ts#L133) — 已实现预留插槽、QMP 添加和客户机上线校验。当前 WHPX 拒绝在线添加；Alpine 6.18 在 TCG 下未识别预留 CPU，正常添加流程仍待兼容内核验证。
- [ ] **Virtio-FS 共享目录**（P0 · 规划） · [`virtio-fs`](../server/next-features.ts#L142) — 检查客户机是否识别 virtio-fs 或 9p 共享目录。 对应完整流程尚未实现。
- [ ] **虚拟音视频设备**（P2 · 规划） · [`virtual-media-devices`](../server/next-features.ts#L150) — 保存虚拟声卡、摄像头和媒体设备配置。 对应完整流程尚未实现。
- [ ] **硬件兼容矩阵**（P0 · 部分实现） · [`hardware-compatibility`](../server/next-features.ts#L158) — 目前返回本机信息，尚未建立经验证的硬件兼容矩阵。

### 存储与灾备

- [ ] **存储池管理**（P0 · 部分实现） · [`storage-pools`](../server/next-features.ts#L166) — 目前返回本机信息，尚未实现存储池管理。
- [ ] **SSD/HDD 分层**（P1 · 规划） · [`storage-tiering`](../server/next-features.ts#L173) — 保存热数据与冷数据的分层策略。 对应完整流程尚未实现。
- [ ] **S3/MinIO 备份目标**（P1 · 规划） · [`object-backup`](../server/next-features.ts#L175) — 校验对象存储目标配置并保存脱敏连接信息。 对应完整流程尚未实现。
- [ ] **快照分支合并**（P1 · 规划） · [`snapshot-merge`](../server/next-features.ts#L182) — 生成快照分支合并预览并记录来源。 对应完整流程尚未实现。
- [ ] **文件级恢复**（P0 · 规划） · [`file-level-restore`](../server/next-features.ts#L184) — 保存文件级恢复请求和目标路径校验结果。 对应完整流程尚未实现。
- [ ] **灾备演练**（P1 · 规划） · [`disaster-recovery-drill`](../server/next-features.ts#L223) — 保存可审计的灾备演练计划和结果。 对应完整流程尚未实现。

### 网络与服务治理

- [ ] **WireGuard 覆盖网络**（P1 · 规划） · [`wireguard-overlay`](../server/next-features.ts#L225) — 检查客户机 WireGuard 工具和当前接口状态。 对应完整流程尚未实现。
- [ ] **私有 DNS 与 DNSSEC**（P1 · 规划） · [`private-dns-dnssec`](../server/next-features.ts#L233) — 检查客户机解析器和 DNSSEC 工具。 对应完整流程尚未实现。
- [ ] **HTTP 反向代理**（P0 · 规划） · [`http-ingress`](../server/next-features.ts#L241) — 保存服务入口、路径和上游健康检查配置。 对应完整流程尚未实现。
- [ ] **ACME 证书续期**（P1 · 规划） · [`acme-renewal`](../server/next-features.ts#L249) — 检查客户机 ACME 客户端并保存续期窗口。 对应完整流程尚未实现。
- [ ] **mTLS 服务策略**（P0 · 规划） · [`mtls-policy`](../server/next-features.ts#L257) — 保存服务间双向 TLS 策略和证书轮换时间。 对应完整流程尚未实现。
- [ ] **NAT 回流**（P2 · 规划） · [`nat-hairpin`](../server/next-features.ts#L265) — 保存端口回流规则并检查当前转发配置。 对应完整流程尚未实现。
- [ ] **延迟丢包模拟**（P1 · 规划） · [`network-emulation`](../server/next-features.ts#L268) — 检查 tc/netem 工具并预览网络仿真参数。 对应完整流程尚未实现。
- [ ] **服务网格边车**（P2 · 规划） · [`service-mesh`](../server/next-features.ts#L275) — 登记服务边车策略和可选代理检测结果。 对应完整流程尚未实现。

### 安全与合规

- [ ] **Passkey/WebAuthn**（P0 · 规划） · [`passkey-webauthn`](../server/next-features.ts#L277) — 保存控制面 Passkey 策略和注册统计。 对应完整流程尚未实现。
- [ ] **OIDC 与 SAML 单点登录**（P0 · 规划） · [`oidc-saml`](../server/next-features.ts#L285) — 校验身份提供商元数据并保存非敏感配置。 对应完整流程尚未实现。
- [ ] **自定义 RBAC**（P0 · 规划） · [`custom-rbac`](../server/next-features.ts#L292) — 保存项目角色、权限和成员映射。 对应完整流程尚未实现。
- [ ] **JIT 临时授权**（P1 · 规划） · [`jit-privilege`](../server/next-features.ts#L293) — 登记有时限的临时权限请求。 对应完整流程尚未实现。
- [ ] **双人审批**（P0 · 规划） · [`dual-approval`](../server/next-features.ts#L294) — 保存需要第二位成员确认的高风险操作。 对应完整流程尚未实现。
- [ ] **签名策略包**（P1 · 规划） · [`signed-policy-bundles`](../server/next-features.ts#L295) — 计算策略包摘要并记录签名状态。 对应完整流程尚未实现。
- [ ] **远程不可变审计**（P0 · 规划） · [`remote-audit-lock`](../server/next-features.ts#L297) — 保存远程审计目标和本地链式记录摘要。 对应完整流程尚未实现。

### 可观测性与自动运维

- [ ] **eBPF 性能分析**（P2 · 规划） · [`ebpf-profiler`](../server/next-features.ts#L337) — 检查客户机 eBPF 工具和内核能力。 对应完整流程尚未实现。
- [ ] **火焰图生成**（P2 · 规划） · [`flamegraph`](../server/next-features.ts#L344) — 检查 perf/stack 工具并保存采样配置。 对应完整流程尚未实现。
- [ ] **自动修复 Runbook**（P0 · 规划） · [`auto-remediation`](../server/next-features.ts#L387) — 保存带审批和预览的自动修复步骤。 对应完整流程尚未实现。

### 开发与 AI

- [ ] **分布式构建农场**（P2 · 规划） · [`build-farm`](../server/next-features.ts#L395) — 保存构建节点和队列调度元数据。 对应完整流程尚未实现。
- [ ] **DevContainer 市场**（P1 · 规划） · [`devcontainer-marketplace`](../server/next-features.ts#L405) — 登记 DevContainer 模板和来源校验状态。 对应完整流程尚未实现。
- [ ] **依赖升级机器人**（P1 · 规划） · [`dependency-bot`](../server/next-features.ts#L421) — 保存依赖升级检查计划和安全限制。 对应完整流程尚未实现。

### 协作与团队

- [ ] **共享终端**（P0 · 规划） · [`shared-terminal`](../server/next-features.ts#L446) — 保存共享终端会话和成员访问状态。 对应完整流程尚未实现。
- [ ] **共享桌面视图**（P1 · 规划） · [`shared-desktop-view`](../server/next-features.ts#L447) — 保存只读桌面查看会话。 对应完整流程尚未实现。
- [ ] **会话交接**（P0 · 规划） · [`session-handoff`](../server/next-features.ts#L448) — 保存可恢复的会话交接令牌元数据。 对应完整流程尚未实现。
- [ ] **文件锁**（P0 · 规划） · [`file-locks`](../server/next-features.ts#L449) — 登记项目文件锁和过期时间。 对应完整流程尚未实现。
- [ ] **项目权限**（P0 · 规划） · [`project-permissions`](../server/next-features.ts#L451) — 保存项目成员和角色权限。 对应完整流程尚未实现。
- [ ] **团队模板**（P1 · 规划） · [`team-templates`](../server/next-features.ts#L452) — 保存可复制的项目和资源模板。 对应完整流程尚未实现。
- [ ] **变更审批**（P0 · 规划） · [`change-approval`](../server/next-features.ts#L454) — 保存变更摘要、审批人和审批状态。 对应完整流程尚未实现。

### 操作系统与桌面

- [ ] **Windows/Linux 进程互操作**（P1 · 规划） · [`process-interop`](../server/next-features.ts#L457) — 检查客户机进程工具和宿主平台。 对应完整流程尚未实现。
- [ ] **宿主盘挂载策略**（P0 · 规划） · [`host-drive-policy`](../server/next-features.ts#L465) — 保存宿主目录挂载的只读和路径策略。 对应完整流程尚未实现。
- [ ] **按应用剪贴板策略**（P0 · 部分实现） · [`clipboard-policy`](../server/next-features.ts#L481) — 已实现 Sakura 网页应用入口的复制/粘贴、实例覆盖、文件与图片限制、敏感文本检测，以及 noVNC 缓存撤回；仍缺按 Windows/Linux 独立应用进程的系统级策略。
- [ ] **音频摄像头麦克风直通**（P1 · 规划） · [`media-passthrough`](../server/next-features.ts#L489) — 检查客户机音视频设备和直通声明。 对应完整流程尚未实现。
- [ ] **USB 热插拔**（P1 · 规划） · [`usb-hotplug`](../server/next-features.ts#L496) — 保存 USB 设备热插拔事件和规则。 对应完整流程尚未实现。
- [ ] **CUDA/ROCm 直通**（P1 · 规划） · [`gpu-compute-passthrough`](../server/next-features.ts#L498) — 检查客户机 CUDA/ROCm 工具和设备可见性。 对应完整流程尚未实现。
- [ ] **Jupyter/Marimo 环境**（P1 · 规划） · [`notebook-environment`](../server/next-features.ts#L506) — 检查客户机 Notebook 工具并保存启动参数。 对应完整流程尚未实现。
- [ ] **认证浏览器 IDE**（P0 · 规划） · [`authenticated-ide-preview`](../server/next-features.ts#L514) — 保存浏览器 IDE 会话和认证过期时间。 对应完整流程尚未实现。

### 平台与扩展

- [ ] **插件市场**（P0 · 规划） · [`plugin-marketplace`](../server/next-features.ts#L529) — 保存插件目录、来源和安装状态。 对应完整流程尚未实现。
- [ ] **签名沙箱插件**（P0 · 规划） · [`signed-plugin-sandbox`](../server/next-features.ts#L531) — 计算插件摘要并记录签名与沙箱策略。 对应完整流程尚未实现。
- [ ] **事件自动化 DSL**（P0 · 规划） · [`automation-dsl`](../server/next-features.ts#L556) — 校验并保存事件自动化规则，默认只预览。 对应完整流程尚未实现。
- [ ] **移动伴侣**（P2 · 规划） · [`mobile-companion`](../server/next-features.ts#L563) — 保存移动设备配对和只读通知策略。 对应完整流程尚未实现。
- [ ] **浏览器扩展**（P2 · 规划） · [`browser-extension`](../server/next-features.ts#L564) — 保存浏览器扩展连接状态和权限摘要。 对应完整流程尚未实现。
- [ ] **Windows 托盘伴侣**（P1 · 规划） · [`tray-companion`](../server/next-features.ts#L565) — 保存托盘进程连接和启动策略。 对应完整流程尚未实现。
- [ ] **功能开关与灰度**（P0 · 规划） · [`feature-rollout`](../server/next-features.ts#L566) — 保存功能开关、目标比例和灰度版本。 对应完整流程尚未实现。

## 目录以外的范围

- 插件独立下载与热卸载；当前仍只加载内置插件。
- 基于客户机内存压力的自动回收。
- 完整发行版包管理界面。
- 持久保存 RAM 和运行中进程的快照/恢复。

重新生成：`npm run features:audit`。上述目录状态由源码声明，真实硬件、多主机和外部身份服务仍需要对应环境验证。
