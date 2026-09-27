# 未完成功能清单

根据当前工作区源码生成。最初基线为 `c669881`，其目录中有 200 条未完成记录。

目前共 250 条目录记录，其中 178 条有实现入口，**72 条仍未完成**（65 条规划、7 条部分实现）。按标识去重后为 71 个未完成标识；不同条目仍有范围重叠。

本轮已接通 128 条原未完成目录记录，包括 Git 和目录同步冲突的图形解决。实现范围、使用方式与验证见 [本轮实现记录](capability-completion.md)。**这不表示全部功能已经完成**；available 也不代表当前实例已安装所需工具。

| 目录 | 总数 | 已有入口 | 部分实现 | 规划 | 未完成 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 第一批 | 50 | 34 | 3 | 13 | 16 |
| 第二批 | 100 | 87 | 2 | 11 | 13 |
| 第三批 | 100 | 57 | 2 | 41 | 43 |

## 第一批

### 实例与资源

- [ ] **多架构实例**（P2 · 规划） · [`multi-arch`](../server/feature-suite.ts#L32) — 为 ARM64 等架构提供 QEMU 兼容运行入口。 对应完整流程尚未实现。
- [ ] **一致性在线快照**（P2 · 规划） · [`online-snapshots`](../server/feature-suite.ts#L36) — 通过文件系统冻结创建一致性快照。 对应完整流程尚未实现。

### 文件与数据

- [ ] **Windows 文件系统直挂**（P1 · 规划） · [`windows-mount`](../server/feature-suite.ts#L40) — 通过受控共享挂载宿主机目录。 对应完整流程尚未实现。

### 开发工作台

- [ ] **LSP 语言服务**（P1 · 部分实现） · [`language-services`](../server/feature-suite.ts#L48) — 提供补全、跳转、重命名和诊断。 对应完整流程尚未实现。
- [ ] **DAP 调试器**（P2 · 规划） · [`debug-adapter`](../server/feature-suite.ts#L49) — 提供断点、单步、调用栈和变量查看。 对应完整流程尚未实现。
- [ ] **Dev Container 支持**（P1 · 规划） · [`dev-container`](../server/feature-suite.ts#L58) — 从 Dockerfile 或 devcontainer 配置创建环境。 对应完整流程尚未实现。

### 网络与服务

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

- [ ] **虚拟磁盘加密**（P1 · 规划） · [`disk-encryption`](../server/extended-features.ts#L48) — 保护宿主机上的实例磁盘文件。 对应完整流程尚未实现。
- [ ] **项目磁盘配额**（P1 · 规划） · [`project-quota`](../server/extended-features.ts#L51) — 限制单个项目可使用的空间。 对应完整流程尚未实现。
- [ ] **客户机目录配额**（P1 · 部分实现） · [`guest-quota`](../server/extended-features.ts#L52) — 目前为 quota 探测，尚无完整配额设置与管理流程。
- [ ] **安全擦除证明**（P2 · 规划） · [`secure-erase`](../server/extended-features.ts#L63) — 擦除文件并记录操作证明。 对应完整流程尚未实现。

### 网络

- [ ] **项目网络隔离**（P1 · 规划） · [`network-isolation`](../server/extended-features.ts#L114) — 按项目隔离网络命名空间。 对应完整流程尚未实现。
- [ ] **网络带宽配额**（P2 · 部分实现） · [`network-quota`](../server/extended-features.ts#L116) — 已支持在运行中的客户机设置与清除出站带宽上限；并发连接和请求速率限制仍未实现。
- [ ] **SSH Agent 转发**（P1 · 规划） · [`ssh-agent-forward`](../server/extended-features.ts#L117) — 在确认后转发宿主机 Agent。 对应完整流程尚未实现。
- [ ] **GPG Agent 转发**（P2 · 规划） · [`gpg-agent-forward`](../server/extended-features.ts#L118) — 在确认后转发签名 Agent。 对应完整流程尚未实现。

### 安全

- [ ] **TPM 与安全启动**（P2 · 规划） · [`tpm-secure-boot`](../server/extended-features.ts#L123) — 检测并配置 TPM 和安全启动链。 对应完整流程尚未实现。
- [ ] **Windows Hello 解锁**（P2 · 规划） · [`hello-unlock`](../server/extended-features.ts#L124) — 使用宿主机安全凭据解锁密钥。 对应完整流程尚未实现。
- [ ] **系统调用隔离**（P2 · 规划） · [`syscall-profile`](../server/extended-features.ts#L138) — 为客户机应用应用受限策略。 对应完整流程尚未实现。

### 体验集成

- [ ] **语言与区域包**（P2 · 规划） · [`locale-packs`](../server/extended-features.ts#L185) — 支持界面语言、时区和数字格式。 对应完整流程尚未实现。

### 平台

- [ ] **自更新与回滚**（P0 · 规划） · [`self-update`](../server/extended-features.ts#L186) — 灰度升级 Sakura 并支持回滚。 对应完整流程尚未实现。

## 第三批

### 远程主机与集群

- [ ] **虚拟机在线迁移**（P1 · 规划） · [`live-migration`](../server/next-features.ts#L55) — 检查在线迁移前置条件并生成迁移计划。 对应完整流程尚未实现。
- [ ] **故障自动接管**（P0 · 规划） · [`ha-failover`](../server/next-features.ts#L73) — 保存高可用接管策略和最后一次健康检查。 对应完整流程尚未实现。
- [ ] **集群策略发布**（P1 · 规划） · [`fleet-policy-rollout`](../server/next-features.ts#L89) — 以版本化批次保存集群策略发布计划。 对应完整流程尚未实现。

### 虚拟硬件与固件

- [ ] **vTPM 密钥登记**（P1 · 规划） · [`vtpm-key-enrollment`](../server/next-features.ts#L113) — 保存 vTPM 密钥登记元数据和轮换提醒。 对应完整流程尚未实现。
- [ ] **PCI 与 USB 直通**（P1 · 规划） · [`pci-usb-passthrough`](../server/next-features.ts#L121) — 校验直通设备声明并生成安全预览。 对应完整流程尚未实现。
- [ ] **GPU 与 vGPU 档案**（P1 · 规划） · [`gpu-vgpu-profiles`](../server/next-features.ts#L129) — 登记 GPU 配置档案及其兼容性要求。 对应完整流程尚未实现。
- [ ] **在线 vCPU 热插拔**（P1 · 部分实现） · [`vcpu-hotplug`](../server/next-features.ts#L145) — 已实现预留插槽、QMP 添加和客户机上线校验。当前 WHPX 拒绝在线添加；Alpine 6.18 在 TCG 下未识别预留 CPU，正常添加流程仍待兼容内核验证。
- [ ] **Virtio-FS 共享目录**（P0 · 规划） · [`virtio-fs`](../server/next-features.ts#L154) — 检查客户机是否识别 virtio-fs 或 9p 共享目录。 对应完整流程尚未实现。
- [ ] **虚拟音视频设备**（P2 · 规划） · [`virtual-media-devices`](../server/next-features.ts#L162) — 保存虚拟声卡、摄像头和媒体设备配置。 对应完整流程尚未实现。

### 存储与灾备

- [ ] **S3/MinIO 备份目标**（P1 · 规划） · [`object-backup`](../server/next-features.ts#L188) — 校验对象存储目标配置并保存脱敏连接信息。 对应完整流程尚未实现。
- [ ] **快照分支合并**（P1 · 规划） · [`snapshot-merge`](../server/next-features.ts#L195) — 生成快照分支合并预览并记录来源。 对应完整流程尚未实现。

### 网络与服务治理

- [ ] **WireGuard 覆盖网络**（P1 · 规划） · [`wireguard-overlay`](../server/next-features.ts#L239) — 检查客户机 WireGuard 工具和当前接口状态。 对应完整流程尚未实现。
- [ ] **ACME 证书续期**（P1 · 规划） · [`acme-renewal`](../server/next-features.ts#L263) — 检查客户机 ACME 客户端并保存续期窗口。 对应完整流程尚未实现。
- [ ] **NAT 回流**（P2 · 规划） · [`nat-hairpin`](../server/next-features.ts#L279) — 保存端口回流规则并检查当前转发配置。 对应完整流程尚未实现。
- [ ] **服务网格边车**（P2 · 规划） · [`service-mesh`](../server/next-features.ts#L289) — 登记服务边车策略和可选代理检测结果。 对应完整流程尚未实现。

### 安全与合规

- [ ] **Passkey/WebAuthn**（P0 · 规划） · [`passkey-webauthn`](../server/next-features.ts#L291) — 保存控制面 Passkey 策略和注册统计。 对应完整流程尚未实现。
- [ ] **OIDC 与 SAML 单点登录**（P0 · 规划） · [`oidc-saml`](../server/next-features.ts#L299) — 校验身份提供商元数据并保存非敏感配置。 对应完整流程尚未实现。
- [ ] **自定义 RBAC**（P0 · 规划） · [`custom-rbac`](../server/next-features.ts#L306) — 保存项目角色、权限和成员映射。 对应完整流程尚未实现。
- [ ] **JIT 临时授权**（P1 · 规划） · [`jit-privilege`](../server/next-features.ts#L307) — 登记有时限的临时权限请求。 对应完整流程尚未实现。
- [ ] **双人审批**（P0 · 规划） · [`dual-approval`](../server/next-features.ts#L308) — 保存需要第二位成员确认的高风险操作。 对应完整流程尚未实现。
- [ ] **签名策略包**（P1 · 规划） · [`signed-policy-bundles`](../server/next-features.ts#L309) — 计算策略包摘要并记录签名状态。 对应完整流程尚未实现。
- [ ] **远程不可变审计**（P0 · 规划） · [`remote-audit-lock`](../server/next-features.ts#L311) — 保存远程审计目标和本地链式记录摘要。 对应完整流程尚未实现。

### 可观测性与自动运维

- [ ] **自动修复 Runbook**（P0 · 规划） · [`auto-remediation`](../server/next-features.ts#L401) — 保存带审批和预览的自动修复步骤。 对应完整流程尚未实现。

### 开发与 AI

- [ ] **分布式构建农场**（P2 · 规划） · [`build-farm`](../server/next-features.ts#L409) — 保存构建节点和队列调度元数据。 对应完整流程尚未实现。
- [ ] **DevContainer 市场**（P1 · 规划） · [`devcontainer-marketplace`](../server/next-features.ts#L419) — 登记 DevContainer 模板和来源校验状态。 对应完整流程尚未实现。
- [ ] **依赖升级机器人**（P1 · 规划） · [`dependency-bot`](../server/next-features.ts#L435) — 保存依赖升级检查计划和安全限制。 对应完整流程尚未实现。

### 协作与团队

- [ ] **共享终端**（P0 · 规划） · [`shared-terminal`](../server/next-features.ts#L460) — 保存共享终端会话和成员访问状态。 对应完整流程尚未实现。
- [ ] **共享桌面视图**（P1 · 规划） · [`shared-desktop-view`](../server/next-features.ts#L461) — 保存只读桌面查看会话。 对应完整流程尚未实现。
- [ ] **会话交接**（P0 · 规划） · [`session-handoff`](../server/next-features.ts#L462) — 保存可恢复的会话交接令牌元数据。 对应完整流程尚未实现。
- [ ] **项目权限**（P0 · 规划） · [`project-permissions`](../server/next-features.ts#L465) — 保存项目成员和角色权限。 对应完整流程尚未实现。
- [ ] **团队模板**（P1 · 规划） · [`team-templates`](../server/next-features.ts#L466) — 保存可复制的项目和资源模板。 对应完整流程尚未实现。
- [ ] **变更审批**（P0 · 规划） · [`change-approval`](../server/next-features.ts#L468) — 保存变更摘要、审批人和审批状态。 对应完整流程尚未实现。

### 操作系统与桌面

- [ ] **Windows/Linux 进程互操作**（P1 · 规划） · [`process-interop`](../server/next-features.ts#L471) — 检查客户机进程工具和宿主平台。 对应完整流程尚未实现。
- [ ] **宿主盘挂载策略**（P0 · 规划） · [`host-drive-policy`](../server/next-features.ts#L479) — 保存宿主目录挂载的只读和路径策略。 对应完整流程尚未实现。
- [ ] **按应用剪贴板策略**（P0 · 部分实现） · [`clipboard-policy`](../server/next-features.ts#L495) — 已实现 Sakura 网页应用入口的复制/粘贴、实例覆盖、文件与图片限制、敏感文本检测，以及 noVNC 缓存撤回；仍缺按 Windows/Linux 独立应用进程的系统级策略。
- [ ] **音频摄像头麦克风直通**（P1 · 规划） · [`media-passthrough`](../server/next-features.ts#L503) — 检查客户机音视频设备和直通声明。 对应完整流程尚未实现。
- [ ] **USB 热插拔**（P1 · 规划） · [`usb-hotplug`](../server/next-features.ts#L510) — 保存 USB 设备热插拔事件和规则。 对应完整流程尚未实现。
- [ ] **CUDA/ROCm 直通**（P1 · 规划） · [`gpu-compute-passthrough`](../server/next-features.ts#L512) — 检查客户机 CUDA/ROCm 工具和设备可见性。 对应完整流程尚未实现。

### 平台与扩展

- [ ] **插件市场**（P0 · 规划） · [`plugin-marketplace`](../server/next-features.ts#L543) — 保存插件目录、来源和安装状态。 对应完整流程尚未实现。
- [ ] **签名沙箱插件**（P0 · 规划） · [`signed-plugin-sandbox`](../server/next-features.ts#L545) — 计算插件摘要并记录签名与沙箱策略。 对应完整流程尚未实现。
- [ ] **移动伴侣**（P2 · 规划） · [`mobile-companion`](../server/next-features.ts#L577) — 保存移动设备配对和只读通知策略。 对应完整流程尚未实现。
- [ ] **浏览器扩展**（P2 · 规划） · [`browser-extension`](../server/next-features.ts#L578) — 保存浏览器扩展连接状态和权限摘要。 对应完整流程尚未实现。
- [ ] **Windows 托盘伴侣**（P1 · 规划） · [`tray-companion`](../server/next-features.ts#L579) — 保存托盘进程连接和启动策略。 对应完整流程尚未实现。

## 目录以外的范围

- 插件独立下载与热卸载；当前仍只加载内置插件。
- 基于客户机内存压力的自动回收。
- 完整发行版包管理界面。
- 持久保存 RAM 和运行中进程的快照/恢复。

重新生成：`npm run features:audit`。上述目录状态由源码声明，真实硬件、多主机和外部身份服务仍需要对应环境验证。
