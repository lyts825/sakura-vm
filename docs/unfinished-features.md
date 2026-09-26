# 未完成功能清单

根据当前工作区源码生成。最初基线为 `c669881`，其目录中有 200 条未完成记录。

目前共 250 条目录记录，其中 113 条有实现入口，**137 条仍未完成**（120 条规划、17 条部分实现）。按标识去重后为 136 个未完成标识；不同条目仍有范围重叠。

本轮已接通 63 条原未完成目录记录，另完善了文本三方合并。实现范围、使用方式与验证见 [本轮实现记录](capability-completion.md)。**这不表示全部功能已经完成**；available 也不代表当前实例已安装所需工具。

| 目录 | 总数 | 已有入口 | 部分实现 | 规划 | 未完成 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 第一批 | 50 | 23 | 10 | 17 | 27 |
| 第二批 | 100 | 67 | 2 | 31 | 33 |
| 第三批 | 100 | 23 | 5 | 72 | 77 |

## 第一批

### 实例与资源

- [ ] **通用镜像导入**（P1 · 规划） · [`image-import`](../server/feature-suite.ts#L25) — 支持 VHDX、VMDK、RAW、OVA 等格式的导入校验。 对应完整流程尚未实现。
- [ ] **黄金镜像制作**（P1 · 部分实现） · [`golden-images`](../server/feature-suite.ts#L26) — 将干净的实例固化为可复用模板。 对应完整流程尚未实现。
- [ ] **多架构实例**（P2 · 规划） · [`multi-arch`](../server/feature-suite.ts#L27) — 为 ARM64 等架构提供 QEMU 兼容运行入口。 对应完整流程尚未实现。
- [ ] **一致性在线快照**（P2 · 规划） · [`online-snapshots`](../server/feature-suite.ts#L31) — 通过文件系统冻结创建一致性快照。 对应完整流程尚未实现。
- [ ] **快照时间线与差异**（P1 · 规划） · [`snapshot-diff`](../server/feature-suite.ts#L32) — 比较快照的文件和磁盘变化。 对应完整流程尚未实现。

### 文件与数据

- [ ] **Windows 文件系统直挂**（P1 · 规划） · [`windows-mount`](../server/feature-suite.ts#L35) — 通过受控共享挂载宿主机目录。 对应完整流程尚未实现。

### 开发工作台

- [ ] **LSP 语言服务**（P1 · 部分实现） · [`language-services`](../server/feature-suite.ts#L43) — 提供补全、跳转、重命名和诊断。 对应完整流程尚未实现。
- [ ] **DAP 调试器**（P2 · 规划） · [`debug-adapter`](../server/feature-suite.ts#L44) — 提供断点、单步、调用栈和变量查看。 对应完整流程尚未实现。
- [ ] **三方合并编辑器**（P0 · 部分实现） · [`merge-editor`](../server/feature-suite.ts#L48) — 已有文件草稿及 Git 普通文本三方编辑、版本校验和暂存；仍缺同步冲突的图形编辑及删除、链接、子模块、二进制冲突工作流。
- [ ] **Dev Container 支持**（P1 · 规划） · [`dev-container`](../server/feature-suite.ts#L53) — 从 Dockerfile 或 devcontainer 配置创建环境。 对应完整流程尚未实现。
- [ ] **隐私优先 AI 编程助手**（P2 · 规划） · [`ai-assistant`](../server/feature-suite.ts#L56) — 在脱敏后提供解释、测试和修复建议。 对应完整流程尚未实现。

### 网络与服务

- [ ] **HTTPS 反向代理**（P1 · 规划） · [`reverse-proxy`](../server/feature-suite.ts#L58) — 生成本地域名、证书和服务路由。 对应完整流程尚未实现。
- [ ] **网络配置档案**（P1 · 部分实现） · [`network-profiles`](../server/feature-suite.ts#L59) — 保存 NAT、DNS、代理和镜像源设置。 对应完整流程尚未实现。
- [ ] **VPN 集成**（P1 · 规划） · [`vpn-integration`](../server/feature-suite.ts#L60) — 管理 WireGuard 或 Tailscale 连接。 对应完整流程尚未实现。
- [ ] **网络诊断工具箱**（P0 · 部分实现） · [`network-diagnostics`](../server/feature-suite.ts#L61) — 执行 DNS、HTTPS、路由和端口测试。 对应完整流程尚未实现。
- [ ] **离线软件包缓存**（P1 · 规划） · [`package-cache`](../server/feature-suite.ts#L62) — 缓存常用软件源和项目依赖。 对应完整流程尚未实现。

### 桌面与跨系统

- [ ] **GPU 与 3D 加速**（P2 · 规划） · [`gpu-acceleration`](../server/feature-suite.ts#L64) — 支持 virtio-gpu 和 VirGL 等方案。 对应完整流程尚未实现。
- [ ] **音频与摄像头转发**（P2 · 规划） · [`audio-video`](../server/feature-suite.ts#L65) — 让 Linux 图形应用使用宿主机设备。 对应完整流程尚未实现。
- [ ] **单应用 Linux 窗口**（P2 · 规划） · [`single-app-windows`](../server/feature-suite.ts#L66) — 将 Linux GUI 应用集成到 Windows 桌面。 对应完整流程尚未实现。
- [ ] **Windows 进程互操作**（P2 · 规划） · [`process-interop`](../server/feature-suite.ts#L67) — 允许 Linux 命令调用受控的 Windows 程序。 对应完整流程尚未实现。
- [ ] **宿主机原生集成**（P0 · 部分实现） · [`native-integration`](../server/feature-suite.ts#L68) — 在资源管理器或宿主编辑器中打开文件。 对应完整流程尚未实现。
- [ ] **多显示器与无障碍**（P1 · 部分实现） · [`multi-monitor`](../server/feature-suite.ts#L69) — 保存分辨率、缩放和多屏布局。 对应完整流程尚未实现。

### 运维与安全

- [ ] **历史资源指标**（P0 · 部分实现） · [`metrics-history`](../server/feature-suite.ts#L70) — 保存 CPU、内存、磁盘和网络趋势。 对应完整流程尚未实现。
- [ ] **阈值告警与通知中心**（P0 · 部分实现） · [`alerts`](../server/feature-suite.ts#L71) — 对资源、服务、备份失败发送提醒。 对应完整流程尚未实现。
- [ ] **镜像与软件包安全扫描**（P1 · 部分实现） · [`security-scan`](../server/feature-suite.ts#L72) — 检查 CVE、弱配置和过期组件。 对应完整流程尚未实现。
- [ ] **多用户与只读分享**（P2 · 规划） · [`rbac-sharing`](../server/feature-suite.ts#L73) — 提供角色、短期令牌和审计日志。 对应完整流程尚未实现。
- [ ] **插件 API 与自动化触发器**（P1 · 规划） · [`plugin-api`](../server/feature-suite.ts#L74) — 内置插件框架已存在；Webhook、第三方隔离插件及完整事件触发器仍未实现。

## 第二批

### 虚拟机

- [ ] **救援模式启动**（P1 · 规划） · [`rescue-boot`](../server/extended-features.ts#L26) — 用临时系统检查故障实例磁盘。 对应完整流程尚未实现。
- [ ] **电源感知调度**（P1 · 规划） · [`power-aware-schedule`](../server/extended-features.ts#L30) — 根据宿主机电池和交流电状态调度。 对应完整流程尚未实现。

### 存储

- [ ] **虚拟磁盘加密**（P1 · 规划） · [`disk-encryption`](../server/extended-features.ts#L40) — 保护宿主机上的实例磁盘文件。 对应完整流程尚未实现。
- [ ] **项目磁盘配额**（P1 · 规划） · [`project-quota`](../server/extended-features.ts#L43) — 限制单个项目可使用的空间。 对应完整流程尚未实现。
- [ ] **客户机目录配额**（P1 · 部分实现） · [`guest-quota`](../server/extended-features.ts#L44) — 目前为 quota 探测，尚无完整配额设置与管理流程。
- [ ] **临时 COW 工作区**（P1 · 规划） · [`cow-workspace`](../server/extended-features.ts#L45) — 创建退出即丢弃的隔离工作区。 对应完整流程尚未实现。
- [ ] **安全擦除证明**（P2 · 规划） · [`secure-erase`](../server/extended-features.ts#L48) — 擦除文件并记录操作证明。 对应完整流程尚未实现。

### 文件同步

- [ ] **自定义合并驱动**（P2 · 规划） · [`merge-drivers`](../server/extended-features.ts#L58) — 为文本和二进制类型选择合并方式。 对应完整流程尚未实现。
- [ ] **多主机统一视图**（P2 · 规划） · [`multi-host-view`](../server/extended-features.ts#L59) — 登记多个 Sakura 主机并集中查看状态。 对应完整流程尚未实现。

### 网络

- [ ] **项目网络隔离**（P1 · 规划） · [`network-isolation`](../server/extended-features.ts#L99) — 按项目隔离网络命名空间。 对应完整流程尚未实现。
- [ ] **出站白名单**（P1 · 规划） · [`egress-policy`](../server/extended-features.ts#L100) — 限制客户机可访问的目标。 对应完整流程尚未实现。
- [ ] **网络带宽配额**（P2 · 规划） · [`network-quota`](../server/extended-features.ts#L101) — 限制带宽、连接数和请求速率。 对应完整流程尚未实现。
- [ ] **SSH Agent 转发**（P1 · 规划） · [`ssh-agent-forward`](../server/extended-features.ts#L102) — 在确认后转发宿主机 Agent。 对应完整流程尚未实现。
- [ ] **GPG Agent 转发**（P2 · 规划） · [`gpg-agent-forward`](../server/extended-features.ts#L103) — 在确认后转发签名 Agent。 对应完整流程尚未实现。
- [ ] **本地域名别名**（P0 · 规划） · [`local-dns-alias`](../server/extended-features.ts#L104) — 为服务生成本地域名和通配别名。 对应完整流程尚未实现。
- [ ] **数据包捕获**（P1 · 规划） · [`packet-capture`](../server/extended-features.ts#L105) — 采集脱敏网络诊断包。 对应完整流程尚未实现。
- [ ] **临时反向隧道**（P2 · 规划） · [`reverse-tunnel`](../server/extended-features.ts#L106) — 为受控调试创建一次性入口。 对应完整流程尚未实现。

### 安全

- [ ] **TPM 与安全启动**（P2 · 规划） · [`tpm-secure-boot`](../server/extended-features.ts#L107) — 检测并配置 TPM 和安全启动链。 对应完整流程尚未实现。
- [ ] **Windows Hello 解锁**（P2 · 规划） · [`hello-unlock`](../server/extended-features.ts#L108) — 使用宿主机安全凭据解锁密钥。 对应完整流程尚未实现。
- [ ] **会话自动锁定**（P0 · 规划） · [`session-lock`](../server/extended-features.ts#L109) — 长时间无操作后锁定控制面板。 对应完整流程尚未实现。
- [ ] **剪贴板敏感检测**（P1 · 规划） · [`clipboard-redaction`](../server/extended-features.ts#L111) — 识别并阻止疑似密钥复制。 对应完整流程尚未实现。
- [ ] **密钥轮换提醒**（P1 · 规划） · [`secret-rotation`](../server/extended-features.ts#L112) — 追踪密钥年龄并提示轮换。 对应完整流程尚未实现。
- [ ] **签名实例包策略**（P1 · 规划） · [`signed-bundles`](../server/extended-features.ts#L113) — 只允许受信任签名的导入包。 对应完整流程尚未实现。
- [ ] **系统调用隔离**（P2 · 规划） · [`syscall-profile`](../server/extended-features.ts#L122) — 为客户机应用应用受限策略。 对应完整流程尚未实现。

### 运维

- [ ] **多主机健康管理**（P2 · 规划） · [`multi-host-health`](../server/extended-features.ts#L132) — 集中查看多个宿主节点健康状态。 对应完整流程尚未实现。
- [ ] **可用性报告**（P1 · 部分实现） · [`availability-report`](../server/extended-features.ts#L133) — 目前为 uptime 探测，尚无持续可用性记录与完整报告。

### 体验集成

- [ ] **资源管理器集成**（P0 · 规划） · [`explorer-integration`](../server/extended-features.ts#L134) — 从 Windows 资源管理器打开项目。 对应完整流程尚未实现。
- [ ] **快捷键编辑器**（P1 · 规划） · [`shortcut-editor`](../server/extended-features.ts#L144) — 自定义全局和项目快捷键。 对应完整流程尚未实现。
- [ ] **离线监控 PWA**（P1 · 规划） · [`offline-pwa`](../server/extended-features.ts#L146) — 离线查看最近状态和事件。 对应完整流程尚未实现。
- [ ] **无障碍检查模式**（P1 · 规划） · [`accessibility-audit`](../server/extended-features.ts#L148) — 检查对比度、焦点和屏幕阅读器语义。 对应完整流程尚未实现。
- [ ] **语言与区域包**（P2 · 规划） · [`locale-packs`](../server/extended-features.ts#L155) — 支持界面语言、时区和数字格式。 对应完整流程尚未实现。

### 平台

- [ ] **自更新与回滚**（P0 · 规划） · [`self-update`](../server/extended-features.ts#L156) — 灰度升级 Sakura 并支持回滚。 对应完整流程尚未实现。
- [ ] **OpenAPI 与 SDK**（P1 · 规划） · [`api-explorer`](../server/extended-features.ts#L157) — 提供 API 浏览器和生成客户端。 对应完整流程尚未实现。

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
- [ ] **主机磁盘健康**（P0 · 部分实现） · [`host-disk-health`](../server/next-features.ts#L216) — 目前返回本机信息，尚未实现实际磁盘健康检查。
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
- [ ] **日志保留策略**（P0 · 规划） · [`log-retention`](../server/next-features.ts#L353) — 保存日志保留天数和容量上限。 对应完整流程尚未实现。
- [ ] **告警路由**（P0 · 规划） · [`alert-routing`](../server/next-features.ts#L354) — 保存按标签匹配的告警通知路由。 对应完整流程尚未实现。
- [ ] **自动修复 Runbook**（P0 · 规划） · [`auto-remediation`](../server/next-features.ts#L373) — 保存带审批和预览的自动修复步骤。 对应完整流程尚未实现。

### 开发与 AI

- [ ] **分布式构建农场**（P2 · 规划） · [`build-farm`](../server/next-features.ts#L381) — 保存构建节点和队列调度元数据。 对应完整流程尚未实现。
- [ ] **DevContainer 市场**（P1 · 规划） · [`devcontainer-marketplace`](../server/next-features.ts#L391) — 登记 DevContainer 模板和来源校验状态。 对应完整流程尚未实现。
- [ ] **依赖升级机器人**（P1 · 规划） · [`dependency-bot`](../server/next-features.ts#L407) — 保存依赖升级检查计划和安全限制。 对应完整流程尚未实现。
- [ ] **本地 AI 助手**（P2 · 规划） · [`local-ai-assistant`](../server/next-features.ts#L417) — 保存本地模型端点和上下文策略，不执行隐式命令。 对应完整流程尚未实现。
- [ ] **自然语言命令规划**（P0 · 规划） · [`natural-command-planner`](../server/next-features.ts#L425) — 把自然语言请求保存为可审阅的命令预览。 对应完整流程尚未实现。

### 协作与团队

- [ ] **共享终端**（P0 · 规划） · [`shared-terminal`](../server/next-features.ts#L432) — 保存共享终端会话和成员访问状态。 对应完整流程尚未实现。
- [ ] **共享桌面视图**（P1 · 规划） · [`shared-desktop-view`](../server/next-features.ts#L433) — 保存只读桌面查看会话。 对应完整流程尚未实现。
- [ ] **会话交接**（P0 · 规划） · [`session-handoff`](../server/next-features.ts#L434) — 保存可恢复的会话交接令牌元数据。 对应完整流程尚未实现。
- [ ] **文件锁**（P0 · 规划） · [`file-locks`](../server/next-features.ts#L435) — 登记项目文件锁和过期时间。 对应完整流程尚未实现。
- [ ] **项目权限**（P0 · 规划） · [`project-permissions`](../server/next-features.ts#L437) — 保存项目成员和角色权限。 对应完整流程尚未实现。
- [ ] **团队模板**（P1 · 规划） · [`team-templates`](../server/next-features.ts#L438) — 保存可复制的项目和资源模板。 对应完整流程尚未实现。
- [ ] **变更审批**（P0 · 规划） · [`change-approval`](../server/next-features.ts#L440) — 保存变更摘要、审批人和审批状态。 对应完整流程尚未实现。

### 操作系统与桌面

- [ ] **Windows/Linux 进程互操作**（P1 · 规划） · [`process-interop`](../server/next-features.ts#L443) — 检查客户机进程工具和宿主平台。 对应完整流程尚未实现。
- [ ] **宿主盘挂载策略**（P0 · 规划） · [`host-drive-policy`](../server/next-features.ts#L451) — 保存宿主目录挂载的只读和路径策略。 对应完整流程尚未实现。
- [ ] **文件关联**（P2 · 规划） · [`file-associations`](../server/next-features.ts#L458) — 保存扩展名到 Sakura 工作区的关联。 对应完整流程尚未实现。
- [ ] **按应用剪贴板策略**（P0 · 规划） · [`clipboard-policy`](../server/next-features.ts#L460) — 保存剪贴板按应用的读写和敏感内容策略。 对应完整流程尚未实现。
- [ ] **音频摄像头麦克风直通**（P1 · 规划） · [`media-passthrough`](../server/next-features.ts#L468) — 检查客户机音视频设备和直通声明。 对应完整流程尚未实现。
- [ ] **USB 热插拔**（P1 · 规划） · [`usb-hotplug`](../server/next-features.ts#L475) — 保存 USB 设备热插拔事件和规则。 对应完整流程尚未实现。
- [ ] **CUDA/ROCm 直通**（P1 · 规划） · [`gpu-compute-passthrough`](../server/next-features.ts#L477) — 检查客户机 CUDA/ROCm 工具和设备可见性。 对应完整流程尚未实现。
- [ ] **Jupyter/Marimo 环境**（P1 · 规划） · [`notebook-environment`](../server/next-features.ts#L485) — 检查客户机 Notebook 工具并保存启动参数。 对应完整流程尚未实现。
- [ ] **认证浏览器 IDE**（P0 · 规划） · [`authenticated-ide-preview`](../server/next-features.ts#L493) — 保存浏览器 IDE 会话和认证过期时间。 对应完整流程尚未实现。
- [ ] **桌面录制与回放**（P2 · 规划） · [`desktop-recording`](../server/next-features.ts#L501) — 检查客户机录制工具并保存回放索引。 对应完整流程尚未实现。

### 平台与扩展

- [ ] **插件市场**（P0 · 规划） · [`plugin-marketplace`](../server/next-features.ts#L508) — 保存插件目录、来源和安装状态。 对应完整流程尚未实现。
- [ ] **签名沙箱插件**（P0 · 规划） · [`signed-plugin-sandbox`](../server/next-features.ts#L510) — 计算插件摘要并记录签名与沙箱策略。 对应完整流程尚未实现。
- [ ] **GraphQL API**（P1 · 规划） · [`graphql-api`](../server/next-features.ts#L518) — 登记 GraphQL API 版本和查询限制。 对应完整流程尚未实现。
- [ ] **Webhook 事件**（P0 · 规划） · [`webhook-events`](../server/next-features.ts#L519) — 保存 Webhook 订阅和最近投递状态。 对应完整流程尚未实现。
- [ ] **事件自动化 DSL**（P0 · 规划） · [`automation-dsl`](../server/next-features.ts#L521) — 校验并保存事件自动化规则，默认只预览。 对应完整流程尚未实现。
- [ ] **移动伴侣**（P2 · 规划） · [`mobile-companion`](../server/next-features.ts#L528) — 保存移动设备配对和只读通知策略。 对应完整流程尚未实现。
- [ ] **浏览器扩展**（P2 · 规划） · [`browser-extension`](../server/next-features.ts#L529) — 保存浏览器扩展连接状态和权限摘要。 对应完整流程尚未实现。
- [ ] **Windows 托盘伴侣**（P1 · 规划） · [`tray-companion`](../server/next-features.ts#L530) — 保存托盘进程连接和启动策略。 对应完整流程尚未实现。
- [ ] **功能开关与灰度**（P0 · 规划） · [`feature-rollout`](../server/next-features.ts#L531) — 保存功能开关、目标比例和灰度版本。 对应完整流程尚未实现。

## 目录以外的范围

- 插件独立下载与热卸载；当前仍只加载内置插件。
- 基于客户机内存压力的自动回收。
- 完整发行版包管理界面。
- 持久保存 RAM 和运行中进程的快照/恢复。

重新生成：`npm run features:audit`。上述目录状态由源码声明，真实硬件、多主机和外部身份服务仍需要对应环境验证。
