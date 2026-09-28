# 未完成功能清单

根据当前工作区源码生成。最初基线为 `c669881`，其目录中有 200 条未完成记录。

目前共 250 条目录记录，其中 236 条有实现入口，**14 条仍未完成**（13 条规划、1 条部分实现）。按标识去重后为 14 个未完成标识；不同条目仍有范围重叠。

本轮已接通 186 条原未完成目录记录，包括 Git 和目录同步冲突的图形解决。实现范围、使用方式与验证见 [本轮实现记录](capability-completion.md)。**这不表示全部功能已经完成**；available 也不代表当前实例已安装所需工具。

| 目录 | 总数 | 已有入口 | 部分实现 | 规划 | 未完成 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 第一批 | 50 | 48 | 0 | 2 | 2 |
| 第二批 | 100 | 98 | 0 | 2 | 2 |
| 第三批 | 100 | 90 | 1 | 9 | 10 |

## 第一批

### 桌面与跨系统

- [ ] **单应用 Linux 窗口**（P2 · 规划） · [`single-app-windows`](../server/feature-suite.ts#L81) — 将 Linux GUI 应用集成到 Windows 桌面。 对应完整流程尚未实现。

### 运维与安全

- [ ] **插件 API 与自动化触发器**（P1 · 规划） · [`plugin-api`](../server/feature-suite.ts#L90) — 内置插件框架、签名 Webhook 和签名 WebAssembly 计算插件已实现；第三方事件订阅、自动触发、HTTP 与界面扩展仍未实现。

## 第二批

### 网络

- [ ] **项目网络隔离**（P1 · 规划） · [`network-isolation`](../server/extended-features.ts#L120) — 按项目隔离网络命名空间。 对应完整流程尚未实现。

### 安全

- [ ] **TPM 与安全启动**（P2 · 规划） · [`tpm-secure-boot`](../server/extended-features.ts#L130) — 检测并配置 TPM 和安全启动链。 对应完整流程尚未实现。

## 第三批

### 远程主机与集群

- [ ] **虚拟机在线迁移**（P1 · 规划） · [`live-migration`](../server/next-features.ts#L64) — 检查在线迁移前置条件并生成迁移计划。 对应完整流程尚未实现。
- [ ] **故障自动接管**（P0 · 规划） · [`ha-failover`](../server/next-features.ts#L82) — 保存高可用接管策略和最后一次健康检查。 对应完整流程尚未实现。

### 虚拟硬件与固件

- [ ] **vTPM 密钥登记**（P1 · 规划） · [`vtpm-key-enrollment`](../server/next-features.ts#L122) — 保存 vTPM 密钥登记元数据和轮换提醒。 对应完整流程尚未实现。
- [ ] **PCI 与 USB 直通**（P1 · 规划） · [`pci-usb-passthrough`](../server/next-features.ts#L130) — 校验直通设备声明并生成安全预览。 对应完整流程尚未实现。
- [ ] **Virtio-FS 共享目录**（P0 · 规划） · [`virtio-fs`](../server/next-features.ts#L163) — 检查客户机是否识别 virtio-fs 或 9p 共享目录。 对应完整流程尚未实现。

### 网络与服务治理

- [ ] **服务网格边车**（P2 · 规划） · [`service-mesh`](../server/next-features.ts#L299) — 登记服务边车策略和可选代理检测结果。 对应完整流程尚未实现。

### 安全与合规

- [ ] **OIDC 与 SAML 单点登录**（P0 · 规划） · [`oidc-saml`](../server/next-features.ts#L309) — 校验身份提供商元数据并保存非敏感配置。 对应完整流程尚未实现。

### 操作系统与桌面

- [ ] **按应用剪贴板策略**（P0 · 部分实现） · [`clipboard-policy`](../server/next-features.ts#L517) — 已实现 Sakura 网页应用入口的复制/粘贴、实例覆盖、文件与图片限制、敏感文本检测，以及 noVNC 缓存撤回；仍缺按 Windows/Linux 独立应用进程的系统级策略。
- [ ] **CUDA/ROCm 直通**（P1 · 规划） · [`gpu-compute-passthrough`](../server/next-features.ts#L535) — 检查客户机 CUDA/ROCm 工具和设备可见性。 对应完整流程尚未实现。

### 平台与扩展

- [ ] **移动伴侣**（P2 · 规划） · [`mobile-companion`](../server/next-features.ts#L600) — 保存移动设备配对和只读通知策略。 对应完整流程尚未实现。

## 目录以外的范围

- 持久保存 RAM 和运行中进程的快照/恢复。

重新生成：`npm run features:audit`。上述目录状态由源码声明，真实硬件、多主机和外部身份服务仍需要对应环境验证。
