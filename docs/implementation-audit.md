# 功能实现完整性审计

> 这是修复前的审计快照。2026-09-26 已修复其中的公共入口、工程执行器与状态误报等缺陷，当前结果见 [修复与验证记录](implementation-fixes.md)。下面的缺陷状态和代码行号保留为历史证据，不代表修复后的现状。

日期：2026-09-26。对象：当前工作区，包含上一轮五项优化的未提交改动。此次只检查和记录，未修改产品实现。

本报告逐项核对能力中心 **50 + 100 + 100 = 250 条目录记录**，结合插件入口、专用服务、界面、CLI、文档及测试检查替代实现。两个批次都含 process-interop；目录条目数不等于互不重复的功能数量。**“接口存在、任务完成、state=available、工具检测通过”均不等于同名完整功能已实现。**

## 结论

- **37/37 个工程操作**当前在进入执行器之前被严格 Schema 拒绝。
- 第二、三批合计 **200/200 个 configure 分支**也被 action 字段校验错误阻断。这与功能缺失数量重叠，不能相加当作未完成总数。
- 第一批 50 条中，源代码自己声明 26 个 available、2 个 experimental、22 个 planned；26 个 available 内仍存在缺陷及范围缩减。
- 第二批 100 条中，36 条关联专门工程操作（全部受上述阻断），57 条既无专用探针也无工程操作映射，另有 7 条只有探针/特殊处理。57 条中的暂停恢复等存在其他入口，已在明细中单独纠正。
- 第三批 100 条的实际分支为：**53 条通用本地记录、22 条明确未实现回退、15 条工具/环境探测、10 条本地特殊逻辑**。特殊逻辑也包含未接入执行限制的锁定、简单标签生成及注释文本。

下表状态是代码实现层次，不是产品完成率；已有专用操作仍受对应运行环境和依赖约束。

| 批次 | 审计分类 |
| --- | --- |
| 第一批 | 未实现 18；部分实现 23；已有专用操作 8；实现有缺陷 1 |
| 第二批 | 已有其他入口 1；目录占位 52；已有专用操作 2；工程入口阻塞 36；仅探测 2；部分实现 4；仅提示文本 3 |
| 第三批 | 仅本地记录 56；仅本机信息 1；目录占位 22；仅探测 15；部分实现 4；仅规划 1；仅提示文本 1 |

## 优先修复的缺陷

### [P1] 37 个工程操作全部被公共请求校验阻断

ExtendedFeatures.action 把带 action 字段的完整对象交给 validateOperation，后者只允许 operation/parameters 且 strict。37 个操作的有效示例均复现 unrecognized_keys: action，HTTP 层将其映射为 400，尚未进入实际执行器。

证据：[server/extended-features.ts:551](D:/27247/Desktop/Sakura/server/extended-features.ts:551)、[server/engineering-operations.ts:54](D:/27247/Desktop/Sakura/server/engineering-operations.ts:54)。

### [P1] 两批共 200 个能力的 configure API 全部被同类错误阻断

action(configure) 直接把 value 传入 configure；内部严格 Schema 不接受 action。对两批 100+100 条目均已隔离复现。

证据：[server/extended-features.ts:549](D:/27247/Desktop/Sakura/server/extended-features.ts:549)、[server/next-features.ts:429](D:/27247/Desktop/Sakura/server/next-features.ts:429)。

### [P1] 空闲自动关机未形成有效空闲计时

tick 每轮先 sample，再按最新样本 sampledAt 判断 idleMinutes；采样正常时差接近零。隔离数据已有 10 分钟前的低 CPU 记录，阈值 1 分钟，tick 后仍未调用 stop。需要独立记录连续空闲起点。

证据：[server/feature-suite.ts:681](D:/27247/Desktop/Sakura/server/feature-suite.ts:681)、[server/feature-suite.ts:696](D:/27247/Desktop/Sakura/server/feature-suite.ts:696)。

### [P1] 应急锁定没有接入任何执行限制

incident-lockdown 仅保存 records[id].locked 并报告 ready=true；没有其他请求/任务路径读取并执行此策略。check 也直接写入 locked=true。它不能作为真实应急锁定使用。

证据：[server/next-features.ts:373](D:/27247/Desktop/Sakura/server/next-features.ts:373)、[server/features.ts:311](D:/27247/Desktop/Sakura/server/features.ts:311)。

### [P1] 部分无实现或缺依赖的条目被标记为可用

工具命令的 || echo / || true 把“不存在”转换成退出码 0，guestProbe 仅据 code===0 判 ready。桌面录制缺 ffmpeg 的路径仍可通过；审计日志/命令表单仅 printf 提示，自然语言规划只返回注释，却也可显示可用。

证据：[server/next-features.ts:318](D:/27247/Desktop/Sakura/server/next-features.ts:318)、[server/extended-features.ts:277](D:/27247/Desktop/Sakura/server/extended-features.ts:277)。

### [P1] 修复入口后仍会遇到操作实现和描述不一致

工程操作存在大量仅打印结果/忽略参数的实现；Git stash、cherry-pick、bisect、rebase 还有具体命令拼接错误。不能只修 Schema 就把 37 项标为完成；逐项差距见后表。

证据：[server/extended-features.ts:393](D:/27247/Desktop/Sakura/server/extended-features.ts:393)、[server/engineering-operations.ts:27](D:/27247/Desktop/Sakura/server/engineering-operations.ts:27)。

### [P1] 工程任务失败状态与实际退出码未打通

操作任务包装只打印 runOperation 的返回对象，没有对 code 非零或 results 失败抛错；Jobs 只根据 promise 是否拒绝标记失败。同结构隔离复现 code=7 时任务仍为 done。发布门禁、基准、宏与 Runbook 均受影响。

证据：[server/extended-features.ts:557](D:/27247/Desktop/Sakura/server/extended-features.ts:557)、[server/jobs.ts:162](D:/27247/Desktop/Sakura/server/jobs.ts:162)。

### [P1] 归档解压缺少声明的成员安全检查

参数 Schema 只限制归档文件和目标的相对路径；执行器仅 tar -tzf 检查能否列出，然后直接解压，没有逐成员检查链接/绝对路径/越界路径。该缺陷目前被公共入口错误遮挡，修入口时应一并处理。

证据：[server/extended-features.ts:522](D:/27247/Desktop/Sakura/server/extended-features.ts:522)、[server/engineering-operations.ts:13](D:/27247/Desktop/Sakura/server/engineering-operations.ts:13)。

### [P2] 目录状态与真实实现、文档和测试不一致

第二/三批全部 200 条静态 state=available；测试仅断言数量、唯一性及标签，不能验证实际能力。第一批的 binary-preview/merge-editor 等虽标已有入口，完整功能不存在；相反磁盘整理、插件 API 已在其他模块有实现。

证据：[tests/extended-features.test.ts:11](D:/27247/Desktop/Sakura/tests/extended-features.test.ts:11)、[tests/next-features.test.ts:92](D:/27247/Desktop/Sakura/tests/next-features.test.ts:92)。

## 完整目录明细

“目录占位”表示当前入口明确落到未实现回退；“仅本地记录/仅探测”表示有代码但没有对应的完整执行流程；“工程入口阻塞”同时列出解除阻断之后仍需补齐的实现。

### 第一批（50 条）

| 功能 / 标识 | 状态 | 已有内容与缺口 | 实现证据 |
| --- | --- | --- | --- |
| 通用镜像导入 / `image-import` | 未实现 | 只支持官方云镜像及 Sakura 自有包；缺 VHDX/VMDK/RAW/OVA 通用导入。 | [docs/development-workspaces.md:64](D:/27247/Desktop/Sakura/docs/development-workspaces.md:64) |
| 黄金镜像制作 / `golden-images` | 部分实现 | 已有实例克隆和导出；缺黄金镜像固化、清理及模板目录生命周期。 | [server/bundles.ts:221](D:/27247/Desktop/Sakura/server/bundles.ts:221) |
| 多架构实例 / `multi-arch` | 未实现 | 当前 QEMU/镜像路径面向 x86_64；目录检查只返回宿主 process.arch。 | [server/feature-suite.ts:310](D:/27247/Desktop/Sakura/server/feature-suite.ts:310) |
| 开机与关机计划 / `power-schedules` | 已有专用操作 | 有启停时刻配置及定时工作器；需要启用 automation-scheduler。 | [server/feature-suite.ts:691](D:/27247/Desktop/Sakura/server/feature-suite.ts:691) |
| 空闲自动暂停或关机 / `idle-shutdown` | 实现有缺陷 | 先刷新最新采样再计算其时间差，正常采样时无法累计空闲时长；隔离复现未触发停止。 | [server/feature-suite.ts:696](D:/27247/Desktop/Sakura/server/feature-suite.ts:696) |
| 动态内存目标 / `dynamic-memory` | 已有专用操作 | 通过 QMP 设置 balloon 内存目标；不是内存设备热插拔。 | [server/machines.ts:1154](D:/27247/Desktop/Sakura/server/machines.ts:1154) |
| 一致性在线快照 / `online-snapshots` | 未实现 | 实际快照入口强制实例停止；没有文件系统冻结与在线一致性流程。 | [server/machines.ts:1035](D:/27247/Desktop/Sakura/server/machines.ts:1035) |
| 快照时间线与差异 / `snapshot-diff` | 未实现 | 已有离线快照列表、备注与恢复；目录检查只读取快照数量，无文件/磁盘差异计算。 | [server/feature-suite.ts:313](D:/27247/Desktop/Sakura/server/feature-suite.ts:313) |
| TRIM、压缩与稀疏回收 / `disk-maintenance` | 部分实现 | 停机 QCOW2 整理已实现，不能全算未实现；缺计划 TRIM、完整稀疏回收编排。 | [server/maintenance.ts:103](D:/27247/Desktop/Sakura/server/maintenance.ts:103) |
| 资源预设与推荐 / `resource-presets` | 部分实现 | 四个固定 CPU/内存预设可应用；缺按工作负载推荐及磁盘推荐。 | [server/feature-suite.ts:369](D:/27247/Desktop/Sakura/server/feature-suite.ts:369) |
| Windows 文件系统直挂 / `windows-mount` | 未实现 | 现有同步是文件复制；无宿主目录直挂/virtio-fs 设备配置。 | [server/feature-suite.ts:316](D:/27247/Desktop/Sakura/server/feature-suite.ts:316) |
| 文件拖放与富剪贴板 / `file-drop` | 部分实现 | 文件拖放上传、桌面文本剪贴板已实现；缺文件/图片富剪贴板双向桥接。 | [plugins/files/client.tsx:342](D:/27247/Desktop/Sakura/plugins/files/client.tsx:342) |
| 全工作区全文搜索 / `workspace-search` | 部分实现 | 有选定实例/项目搜索；缺跨实例、跨项目统一检索与聚合。 | [server/feature-suite.ts:558](D:/27247/Desktop/Sakura/server/feature-suite.ts:558) |
| 可视化磁盘分析 / `disk-analyzer` | 部分实现 | 返回 du 目录大小并显示列表；缺按文件类型统计及完整可视化分析。 | [server/feature-suite.ts:388](D:/27247/Desktop/Sakura/server/feature-suite.ts:388) |
| 可续传分块传输 / `resumable-transfer` | 未实现 | 有流式上传下载，但中断需重新传输；未实现分块续传协议。 | [docs/development-workspaces.md:39](D:/27247/Desktop/Sakura/docs/development-workspaces.md:39) |
| 三方同步合并 / `three-way-sync` | 部分实现 | 有共同哈希基线、冲突检测及保留某侧/双份决策；没有基于共同内容的三方合并。 | [server/sync.ts:458](D:/27247/Desktop/Sakura/server/sync.ts:458) |
| 目录级版本时间线 / `directory-history` | 部分实现 | 有单文件历史和目录回收站；缺整目录版本快照、差异及整体回滚。 | [server/file-history.ts:29](D:/27247/Desktop/Sakura/server/file-history.ts:29) |
| 二进制文件预览 / `binary-preview` | 未实现 | 目录标为 available，但文件面板只提供 UTF-8 编辑及下载；无图片/PDF/归档预览组件。 | [plugins/files/client.tsx:233](D:/27247/Desktop/Sakura/plugins/files/client.tsx:233) |
| LSP 语言服务 / `language-services` | 部分实现 | 有语法高亮及单文件命令式诊断；缺 LSP 会话、补全、定义跳转和重命名。 | [server/code-intelligence.ts:19](D:/27247/Desktop/Sakura/server/code-intelligence.ts:19) |
| DAP 调试器 / `debug-adapter` | 未实现 | 只有目录信息；未发现 DAP 会话、断点、单步、调用栈接口及 UI。 | [server/feature-suite.ts:318](D:/27247/Desktop/Sakura/server/feature-suite.ts:318) |
| 测试资源管理器 / `test-explorer` | 已有专用操作 | 有测试文件发现、运行命令及任务日志；按目录中当前简化范围实现。 | [server/feature-suite.ts:446](D:/27247/Desktop/Sakura/server/feature-suite.ts:446) |
| 格式化与代码检查 / `format-lint` | 部分实现 | 能调用项目 lint/format 工具；没有统一自动修复流程，缺工具时部分分支只打印提示并返回成功。 | [server/feature-suite.ts:449](D:/27247/Desktop/Sakura/server/feature-suite.ts:449) |
| Git Worktree 管理 / `git-worktrees` | 部分实现 | 有 worktree 列表、新建、删除；缺工作树切换与项目目录联动。 | [server/feature-suite.ts:467](D:/27247/Desktop/Sakura/server/feature-suite.ts:467) |
| 三方合并编辑器 / `merge-editor` | 部分实现 | 有冲突文本及覆盖/重新载入提示；缺 Git/同步三方可视化合并编辑器。 | [plugins/files/client.tsx:680](D:/27247/Desktop/Sakura/plugins/files/client.tsx:680) |
| 依赖图与更新报告 / `dependency-report` | 部分实现 | 返回包管理器报告；缺依赖关系图及统一升级建议模型。 | [server/feature-suite.ts:455](D:/27247/Desktop/Sakura/server/feature-suite.ts:455) |
| 更多运行时版本 / `runtime-matrix` | 部分实现 | 精确版本管理已支持 Node/Python；缺此目录承诺的 Go、Java、.NET、PHP。 | [server/runtime-versions.ts:12](D:/27247/Desktop/Sakura/server/runtime-versions.ts:12) |
| Linux 包管理器界面 / `package-manager` | 已有专用操作 | 有 apk/apt 查询、安装、卸载和更新任务。 | [server/feature-suite.ts:574](D:/27247/Desktop/Sakura/server/feature-suite.ts:574) |
| 可复现环境锁文件 / `reproducible-env` | 部分实现 | 有 Node/Python/Rust 版本文本快照比对和依赖锁文件安装；缺操作系统包、全部工具链的统一锁定及重建验证。 | [server/feature-suite.ts:458](D:/27247/Desktop/Sakura/server/feature-suite.ts:458) |
| Dev Container 支持 / `dev-container` | 未实现 | Docker/Compose 是独立插件；未解析 devcontainer 配置并创建开发环境。 | [server/feature-suite.ts:318](D:/27247/Desktop/Sakura/server/feature-suite.ts:318) |
| 浏览器预览与热重载 / `browser-preview` | 已有专用操作 | 支持端口转发及打开服务网页；热重载由客户机开发服务器提供。 | [plugins/network/client.tsx:74](D:/27247/Desktop/Sakura/plugins/network/client.tsx:74) |
| 数据库服务预设 / `database-presets` | 已有专用操作 | 有 PostgreSQL/Redis/MySQL Docker 预设、数据卷和端口。 | [server/feature-suite.ts:476](D:/27247/Desktop/Sakura/server/feature-suite.ts:476) |
| 隐私优先 AI 编程助手 / `ai-assistant` | 未实现 | 只有路线图；没有模型连接、上下文构建或建议生成流程。 | [server/feature-suite.ts:51](D:/27247/Desktop/Sakura/server/feature-suite.ts:51) |
| 端口自动发现 / `port-discovery` | 已有专用操作 | 读取监听端口并返回发现结果，配合网络插件管理转发。 | [server/feature-suite.ts:621](D:/27247/Desktop/Sakura/server/feature-suite.ts:621) |
| HTTPS 反向代理 / `reverse-proxy` | 未实现 | TCP 转发已实现；HTTPS 证书、本地域名及 HTTP 路由未实现。 | [server/feature-suite.ts:320](D:/27247/Desktop/Sakura/server/feature-suite.ts:320) |
| 网络配置档案 / `network-profiles` | 部分实现 | 实际 Schema 只有代理和软件源；缺目录承诺的 DNS/NAT 档案管理。 | [server/network-profiles.ts:32](D:/27247/Desktop/Sakura/server/network-profiles.ts:32) |
| VPN 集成 / `vpn-integration` | 未实现 | 没有 WireGuard/Tailscale 连接管理；相关平台项仅检查客户机工具。 | [server/feature-suite.ts:320](D:/27247/Desktop/Sakura/server/feature-suite.ts:320) |
| 网络诊断工具箱 / `network-diagnostics` | 部分实现 | 有 DNS、HTTPS、监听端口检查；缺完整路由诊断及结构化故障定位。 | [server/feature-suite.ts:611](D:/27247/Desktop/Sakura/server/feature-suite.ts:611) |
| 离线软件包缓存 / `package-cache` | 未实现 | 未实现离线包缓存索引、存储、代理或缓存命中流程。 | [server/feature-suite.ts:57](D:/27247/Desktop/Sakura/server/feature-suite.ts:57) |
| 服务运行面板 / `service-dashboard` | 已有专用操作 | 项目服务依赖、日志、启停与健康检查有实际服务实现。 | [server/workspaces.ts:107](D:/27247/Desktop/Sakura/server/workspaces.ts:107) |
| GPU 与 3D 加速 / `gpu-acceleration` | 未实现 | 没有 GPU/3D 转发；WHPX 是 CPU 虚拟化加速，不能代替 GPU 功能。 | [docs/linux-desktop.md:57](D:/27247/Desktop/Sakura/docs/linux-desktop.md:57) |
| 音频与摄像头转发 / `audio-video` | 未实现 | 现有 noVNC 桌面未实现声音、摄像头或麦克风转发。 | [docs/linux-desktop.md:57](D:/27247/Desktop/Sakura/docs/linux-desktop.md:57) |
| 单应用 Linux 窗口 / `single-app-windows` | 未实现 | 提供整个远程桌面；无 WSLg 类独立应用窗口集成。 | [docs/linux-desktop.md:57](D:/27247/Desktop/Sakura/docs/linux-desktop.md:57) |
| Windows 进程互操作 / `process-interop` | 未实现 | 执行命令只发往客户机；无 Linux 调用受控 Windows 进程的协议。 | [server/feature-suite.ts:62](D:/27247/Desktop/Sakura/server/feature-suite.ts:62) |
| 宿主机原生集成 / `native-integration` | 部分实现 | 有 VS Code Remote-SSH 链接及配置；缺资源管理器打开、文件关联等系统集成。 | [server/ide.ts:72](D:/27247/Desktop/Sakura/server/ide.ts:72) |
| 多显示器与无障碍 / `multi-monitor` | 部分实现 | 有单桌面分辨率、自适应缩放与全屏；缺多屏拓扑和布局持久化。 | [server/feature-suite.ts:64](D:/27247/Desktop/Sakura/server/feature-suite.ts:64) |
| 历史资源指标 / `metrics-history` | 部分实现 | CPU/内存/磁盘采样历史已保存；未保存目录承诺的网络趋势。 | [server/feature-suite.ts:354](D:/27247/Desktop/Sakura/server/feature-suite.ts:354) |
| 阈值告警与通知中心 / `alerts` | 部分实现 | 有资源阈值事件与确认；缺服务/备份统一告警及外部通知投递。 | [server/feature-suite.ts:511](D:/27247/Desktop/Sakura/server/feature-suite.ts:511) |
| 镜像与软件包安全扫描 / `security-scan` | 部分实现 | 只有 SSH 设置、升级列表和可写系统文件检查；没有 CVE 数据源和漏洞匹配。 | [server/feature-suite.ts:635](D:/27247/Desktop/Sakura/server/feature-suite.ts:635) |
| 多用户与只读分享 / `rbac-sharing` | 未实现 | 只有本机共享管理令牌与同源检查；没有多用户、角色及只读短期分享。 | [server/index.ts:46](D:/27247/Desktop/Sakura/server/index.ts:46) |
| 插件 API 与自动化触发器 / `plugin-api` | 部分实现 | 内置插件声明、生命周期、事件及独立调度器已实现；缺外部 Webhook、任意第三方隔离插件和完整触发器系统。 | [server/plugin-api.ts:46](D:/27247/Desktop/Sakura/server/plugin-api.ts:46) |

### 第二批（100 条）

| 功能 / 标识 | 状态 | 已有内容与缺口 | 实现证据 |
| --- | --- | --- | --- |
| 挂起与恢复 / `vm-suspend` | 已有其他入口 | 暂停/恢复已在 Machines 和 automation 路由实现；扩展目录的通用按钮仍落到未实现回退。 | [plugins/automation/server.ts:59](D:/27247/Desktop/Sakura/plugins/automation/server.ts:59) |
| 多实例依赖启动 / `vm-dependency-start` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“按依赖关系启动多个实例。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 崩溃循环熔断 / `crash-loop-guard` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“连续启动失败后阻止无限重试。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 救援模式启动 / `rescue-boot` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“用临时系统检查故障实例磁盘。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| QEMU 参数预览 / `qemu-commandline` | 已有专用操作 | 实际生成 QEMU 参数预览。 | [server/extended-features.ts:228](D:/27247/Desktop/Sakura/server/extended-features.ts:228) |
| CPU 拓扑与 NUMA / `cpu-topology` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“配置 vCPU 拓扑和 NUMA 布局。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 客户机时钟策略 / `guest-clock-policy` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：sync 用客户机自己的 date 设置自身时间，没有读取宿主时间；错误被 \|\| true 隐藏。 | [server/extended-features.ts:452](D:/27247/Desktop/Sakura/server/extended-features.ts:452) |
| 电源感知调度 / `power-aware-schedule` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“根据宿主机电池和交流电状态调度。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 资源预留与公平调度 / `resource-reservation` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“为实例设置资源预留和启动优先级。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 设备能力档案 / `device-profiles` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“保存可复用的虚拟设备组合。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 虚拟磁盘加密 / `disk-encryption` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“保护宿主机上的实例磁盘文件。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| QCOW2 完整性巡检 / `qcow2-scrub` | 已有专用操作 | 实际执行离线 qemu-img check；需要停止实例。 | [server/extended-features.ts:229](D:/27247/Desktop/Sakura/server/extended-features.ts:229) |
| 备份块级去重 / `backup-dedup` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“减少重复备份的磁盘占用。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 项目磁盘配额 / `project-quota` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“限制单个项目可使用的空间。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 客户机目录配额 / `guest-quota` | 仅探测 | 只能尝试 quota -s；没有设置或执行目录配额。 | [server/extended-features.ts:265](D:/27247/Desktop/Sakura/server/extended-features.ts:265) |
| 临时 COW 工作区 / `cow-workspace` | 部分实现 | 已有隔离 VM 沙箱和增量盘；无此项声明的项目级退出即丢弃工作区。 | [server/sandboxes.ts:98](D:/27247/Desktop/Sakura/server/sandboxes.ts:98) |
| 归档与解压向导 / `archive-wizard` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：解压只先 tar -t 再 tar -x；没有所声明的全成员路径、符号链接及越界校验。 | [server/extended-features.ts:522](D:/27247/Desktop/Sakura/server/extended-features.ts:522) |
| POSIX ACL 管理 / `posix-acl` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：有 getfacl/setfacl 调用；缺失工具可只返回成功提示，结果失败未传播。 | [server/extended-features.ts:441](D:/27247/Desktop/Sakura/server/extended-features.ts:441) |
| 安全擦除证明 / `secure-erase` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“擦除文件并记录操作证明。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 文件哈希清单 / `hash-manifest` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：只输出 sha256sum；output 参数、大小/mtime 字段及 20,000 文件/512 MiB 上限未实现。 | [server/extended-features.ts:339](D:/27247/Desktop/Sakura/server/extended-features.ts:339) |
| 跨实例复制 / `cross-vm-copy` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“在两个运行中的实例之间复制文件。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 事件驱动增量同步 / `watch-sync` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“监听变化并只同步受影响的文件。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 同步时间窗 / `sync-window` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“按时段和带宽执行同步。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 同步重命名识别 / `rename-detection` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“识别移动或重命名而不是重新上传。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 名称冲突预检 / `case-conflict-report` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：只比较小写名称；缺 Windows 保留名、非法字符及路径语义预检。 | [server/extended-features.ts:343](D:/27247/Desktop/Sakura/server/extended-features.ts:343) |
| 离线同步队列 / `sync-queue` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“网络中断后排队并重试同步作业。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 路径同步策略 / `path-sync-policy` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“对路径设置只读、单向和权限策略。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 同步回滚点 / `sync-rollback` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“撤销一轮已应用的同步变更。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 自定义合并驱动 / `merge-drivers` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“为文本和二进制类型选择合并方式。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 多主机统一视图 / `multi-host-view` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“登记多个 Sakura 主机并集中查看状态。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 项目 onboarding / `project-onboarding` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：只列文件、输出 README 和清单名；没有生成初始化步骤。 | [server/extended-features.ts:350](D:/27247/Desktop/Sakura/server/extended-features.ts:350) |
| 任务自动导入 / `task-import` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：只打印静态任务名；save 参数未用于保存收藏命令。 | [server/extended-features.ts:356](D:/27247/Desktop/Sakura/server/extended-features.ts:356) |
| 环境变量 Schema / `env-schema` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：未注入项目最终环境；boolean 未处理，choices 使用字面变量文本，错误未聚合为失败。 | [server/extended-features.ts:362](D:/27247/Desktop/Sakura/server/extended-features.ts:362) |
| 项目 Shell profile / `shell-profiles` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：有读/写 profile 及显式加载命令的实现；仍需修复公共入口和失败传播。 | [server/extended-features.ts:371](D:/27247/Desktop/Sakura/server/extended-features.ts:371) |
| 命令参数表单 / `command-forms` | 仅提示文本 | 探针只 printf“参数表单适配器已启用”；收藏命令有参数输入，但本目录未实现声明驱动表单。 | [server/extended-features.ts:264](D:/27247/Desktop/Sakura/server/extended-features.ts:264) |
| 环境一致性报告 / `environment-parity` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“比较多个实例的工具链和配置。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 工具链兼容检查 / `toolchain-check` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：只打印工具版本；没有读取项目版本约束或检查兼容性。 | [server/extended-features.ts:347](D:/27247/Desktop/Sakura/server/extended-features.ts:347) |
| 环境清理重建 / `environment-recreate` | 部分实现 | 能力中心可按锁文件安装依赖；此项没有清理旧环境、重建和验证流程。 | [server/feature-suite.ts:464](D:/27247/Desktop/Sakura/server/feature-suite.ts:464) |
| 初始化预演 / `bootstrap-dry-run` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：仅 sh -n 语法检查；声明的工具和路径前置检查未实现。 | [server/extended-features.ts:384](D:/27247/Desktop/Sakura/server/extended-features.ts:384) |
| 项目模板打包 / `project-template-pack` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：基础 tar 打包；未实现声明中的通用私钥排除、成员边界检查。 | [server/extended-features.ts:388](D:/27247/Desktop/Sakura/server/extended-features.ts:388) |
| Git Stash 管理 / `git-stash` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：list/save 有命令；apply/drop 分支缺 stash 子命令，会生成 git apply/git drop。 | [server/extended-features.ts:393](D:/27247/Desktop/Sakura/server/extended-features.ts:393) |
| Git reflog 恢复 / `git-reflog` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：有列表和从提交新建分支的命令；公共入口及失败传播仍阻塞使用。 | [server/extended-features.ts:393](D:/27247/Desktop/Sakura/server/extended-features.ts:393) |
| 交互式 Rebase / `git-rebase` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：plan 直接运行交互式 rebase；apply/abort 都变成 --continue，todo 未使用。 | [server/extended-features.ts:393](D:/27247/Desktop/Sakura/server/extended-features.ts:393) |
| Git Bisect 向导 / `git-bisect` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：start 拼接 good 再 bad，与 Git 所需顺序相反；未检查干净工作区。 | [server/extended-features.ts:393](D:/27247/Desktop/Sakura/server/extended-features.ts:393) |
| Cherry-pick 助手 / `git-cherry-pick` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：continue/abort 缺 --；revert 分支没有使用提交参数构造 git revert。 | [server/extended-features.ts:393](D:/27247/Desktop/Sakura/server/extended-features.ts:393) |
| 补丁签名包 / `patch-bundle` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“导出带校验和签名的补丁包。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 本地代码评审 / `review-comments` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“为差异添加行级评论和线程。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 提交与分支策略 / `git-policy` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：只打印分支名和提交标题；branchPrefixes、commitTypes、message 未用于校验。 | [server/extended-features.ts:406](D:/27247/Desktop/Sakura/server/extended-features.ts:406) |
| 提交前密钥扫描 / `precommit-secrets` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：仅打印 clean/suspected-secret，缺路径行号及失败拦截，未连接提交入口。 | [server/extended-features.ts:409](D:/27247/Desktop/Sakura/server/extended-features.ts:409) |
| 代码所有权映射 / `code-ownership` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：只打印 CODEOWNERS 文件；paths 参数和规则匹配未实现。 | [server/extended-features.ts:412](D:/27247/Desktop/Sakura/server/extended-features.ts:412) |
| 跨发行版测试矩阵 / `test-matrix` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“在多个客户机环境运行同一组测试。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 不稳定测试识别 / `flaky-tests` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：重复执行并打印 code/ms；没有不稳定分类，失败退出码不能使任务失败。 | [server/extended-features.ts:415](D:/27247/Desktop/Sakura/server/extended-features.ts:415) |
| 覆盖率趋势 / `coverage-history` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：只 cat 覆盖率文件；未实现多格式解析、覆盖率趋势比较。 | [server/extended-features.ts:422](D:/27247/Desktop/Sakura/server/extended-features.ts:422) |
| 性能回归基准 / `benchmark-regression` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：只打印多轮耗时；baselineMs、thresholdPercent 及中位数比较未实现。 | [server/extended-features.ts:425](D:/27247/Desktop/Sakura/server/extended-features.ts:425) |
| SBOM 清单 / `sbom` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：不是声明的 CycloneDX；只返回锁文件包路径或原文，没有标准版本/完整性模型。 | [server/extended-features.ts:467](D:/27247/Desktop/Sakura/server/extended-features.ts:467) |
| 许可证合规报告 / `license-report` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：只列 LICENSE/COPYING/package.json 路径；未解析依赖许可或 allowed 参数。 | [server/extended-features.ts:470](D:/27247/Desktop/Sakura/server/extended-features.ts:470) |
| 发布门禁 / `release-gates` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：多条命令未启用遇错退出，前一项失败可能被后一项成功掩盖；任务包装也忽略 code。 | [server/extended-features.ts:473](D:/27247/Desktop/Sakura/server/extended-features.ts:473) |
| 产物来源证明 / `artifact-provenance` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：仅提交、脏状态和最多 500 个哈希；缺工具版本与完整来源模型。 | [server/extended-features.ts:480](D:/27247/Desktop/Sakura/server/extended-features.ts:480) |
| 变更日志生成 / `changelog` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：已有 git log 生成文本的命令；公共入口仍阻断。 | [server/extended-features.ts:484](D:/27247/Desktop/Sakura/server/extended-features.ts:484) |
| 可复现构建验证 / `reproducible-build` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：复制当前工作区两次而非导出同一提交；只打印两组哈希，没有比较和失败判定。 | [server/extended-features.ts:487](D:/27247/Desktop/Sakura/server/extended-features.ts:487) |
| IPv6 客户机网络 / `ipv6` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“为客户机提供 IPv6 网络能力。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 静态租约与路由 / `static-routes` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：有 ip route 命令；Schema 仅约束字符串长度，缺声明中的 IP/CIDR 与默认路由保护。 | [server/extended-features.ts:458](D:/27247/Desktop/Sakura/server/extended-features.ts:458) |
| 项目网络隔离 / `network-isolation` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“按项目隔离网络命名空间。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 出站白名单 / `egress-policy` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“限制客户机可访问的目标。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 网络带宽配额 / `network-quota` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“限制带宽、连接数和请求速率。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| SSH Agent 转发 / `ssh-agent-forward` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“在确认后转发宿主机 Agent。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| GPG Agent 转发 / `gpg-agent-forward` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“在确认后转发签名 Agent。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 本地域名别名 / `local-dns-alias` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“为服务生成本地域名和通配别名。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 数据包捕获 / `packet-capture` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“采集脱敏网络诊断包。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 临时反向隧道 / `reverse-tunnel` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“为受控调试创建一次性入口。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| TPM 与安全启动 / `tpm-secure-boot` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“检测并配置 TPM 和安全启动链。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| Windows Hello 解锁 / `hello-unlock` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“使用宿主机安全凭据解锁密钥。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 会话自动锁定 / `session-lock` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“长时间无操作后锁定控制面板。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 防篡改审计日志 / `audit-log` | 仅提示文本 | 只打印“审计适配器已启用”；无防篡改链、签名或不可变存储。 | [server/extended-features.ts:277](D:/27247/Desktop/Sakura/server/extended-features.ts:277) |
| 剪贴板敏感检测 / `clipboard-redaction` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“识别并阻止疑似密钥复制。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 密钥轮换提醒 / `secret-rotation` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“追踪密钥年龄并提示轮换。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 签名实例包策略 / `signed-bundles` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“只允许受信任签名的导入包。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 不可修改备份锁 / `immutable-backups` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“防止保留期内的备份被删除。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 系统调用隔离 / `syscall-profile` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“为客户机应用应用受限策略。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 高风险命令评估 / `command-risk` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：已有启发式正则风险分类；公共入口仍阻断。 | [server/extended-features.ts:493](D:/27247/Desktop/Sakura/server/extended-features.ts:493) |
| 指标导出 / `metrics-export` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“导出 Prometheus 或 OpenTelemetry 指标。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 进程历史指标 / `process-history` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：仅一次 workspaces.metrics 进程摘要；没有 PID 启动标识及结构化进程历史。 | [server/extended-features.ts:431](D:/27247/Desktop/Sakura/server/extended-features.ts:431) |
| 磁盘 I/O 指标 / `disk-io-metrics` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：只读一次 /proc/diskstats；没有间隔采样、吞吐和平均延迟计算。 | [server/extended-features.ts:435](D:/27247/Desktop/Sakura/server/extended-features.ts:435) |
| 网络流量指标 / `network-metrics` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：只读一次累计计数；没有一秒增量/速率计算。 | [server/extended-features.ts:438](D:/27247/Desktop/Sakura/server/extended-features.ts:438) |
| 事件关联时间线 / `event-timeline` | 仅提示文本 | 只打印当前客户机时间；任务中心已有任务事件，但无服务/启动/告警的关联时间线。 | [server/extended-features.ts:274](D:/27247/Desktop/Sakura/server/extended-features.ts:274) |
| 异常基线检测 / `anomaly-detection` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“根据历史指标发现异常变化。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 运维 Runbook / `runbooks` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：有顺序步骤；失败后跳过后续步骤，但整条任务仍可被标记完成。 | [server/extended-features.ts:503](D:/27247/Desktop/Sakura/server/extended-features.ts:503) |
| 维护窗口 / `maintenance-windows` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“在指定时段暂停自动任务。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 多主机健康管理 / `multi-host-health` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“集中查看多个宿主节点健康状态。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 可用性报告 / `availability-report` | 仅探测 | 只读取 /proc/uptime；未计算历史可用率或生成报告。 | [server/extended-features.ts:275](D:/27247/Desktop/Sakura/server/extended-features.ts:275) |
| 资源管理器集成 / `explorer-integration` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“从 Windows 资源管理器打开项目。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 编辑器连接档案 / `editor-profiles` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“生成 JetBrains 和 Neovim 连接配置。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 终端布局预设 / `terminal-layouts` | 部分实现 | 现有终端标签可恢复，分屏是组件内 useState；没有可命名布局预设及恢复。 | [src/TerminalWorkspace.tsx:18](D:/27247/Desktop/Sakura/src/TerminalWorkspace.tsx:18) |
| 快捷键编辑器 / `shortcut-editor` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“自定义全局和项目快捷键。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 条件命令宏 / `command-macros` | 工程入口阻塞 | 公共 action 校验阻断此操作。执行器现状：有 when 条件、argv 引用、超时和步骤结果；最终失败没有向任务状态传播。 | [server/extended-features.ts:503](D:/27247/Desktop/Sakura/server/extended-features.ts:503) |
| 离线监控 PWA / `offline-pwa` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“离线查看最近状态和事件。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 无障碍检查模式 / `accessibility-audit` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“检查对比度、焦点和屏幕阅读器语义。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 语言与区域包 / `locale-packs` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“支持界面语言、时区和数字格式。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| 自更新与回滚 / `self-update` | 目录占位 | 通用 check/run 落到明确未实现回退；配置也受公共校验错误影响。缺少“灰度升级 Sakura 并支持回滚。”的执行闭环。 | [server/extended-features.ts:298](D:/27247/Desktop/Sakura/server/extended-features.ts:298) |
| OpenAPI 与 SDK / `api-explorer` | 部分实现 | 已有插件/操作 JSON Schema；无完整 HTTP OpenAPI 文档、交互浏览器或 SDK 生成器。 | [scripts/plugin-schema.ts:36](D:/27247/Desktop/Sakura/scripts/plugin-schema.ts:36) |

### 第三批（100 条）

| 功能 / 标识 | 状态 | 已有内容与缺口 | 实现证据 |
| --- | --- | --- | --- |
| 短代码主机配对 / `host-pairing` | 仅本地记录 | 只生成随机配对码及有效期；没有兑换、撤销、认证和远端连接。 | [server/next-features.ts:339](D:/27247/Desktop/Sakura/server/next-features.ts:339) |
| 主机证书轮换 / `host-cert-rotation` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：登记主机证书的轮换策略和下一次轮换时间。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 多主机资源总览 / `multi-host-inventory` | 仅本机信息 | 只读取当前 Node 宿主的 os 信息；没有远程主机清单或汇总。 | [server/next-features.ts:346](D:/27247/Desktop/Sakura/server/next-features.ts:346) |
| 虚拟机在线迁移 / `live-migration` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“检查在线迁移前置条件并生成迁移计划。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| 冷迁移队列 / `cold-migration` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：为停止状态的实例保存可重试迁移队列。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 资源评分调度 / `resource-scheduler` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：根据 CPU、内存和负载为实例计算主机选择分数。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 故障自动接管 / `ha-failover` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存高可用接管策略和最后一次健康检查。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 跨主机快照复制 / `cross-host-snapshots` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“记录快照复制目标、校验和与重试状态。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| 集群策略发布 / `fleet-policy-rollout` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：以版本化批次保存集群策略发布计划。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 主机维护排空 / `maintenance-drain` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：在维护前登记排空计划并追踪实例迁移状态。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| UEFI 与 OVMF 固件 / `uefi-ovmf` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“检测宿主机是否有 UEFI/OVMF 固件并保存选择。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| vTPM 密钥登记 / `vtpm-key-enrollment` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“保存 vTPM 密钥登记元数据和轮换提醒。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| PCI 与 USB 直通 / `pci-usb-passthrough` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“校验直通设备声明并生成安全预览。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| GPU 与 vGPU 档案 / `gpu-vgpu-profiles` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“登记 GPU 配置档案及其兼容性要求。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| 嵌套虚拟化 / `nested-virtualization` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“检测嵌套虚拟化能力并记录结果。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| 在线 vCPU 热插拔 / `vcpu-hotplug` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“保存在线 vCPU 调整计划和目标值。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| 在线内存热插拔 / `memory-hotplug` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“保存在线内存调整计划和目标值。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| Virtio-FS 共享目录 / `virtio-fs` | 仅探测 | 只 grep 已挂载目录；没有宿主共享进程、QEMU 设备和挂载编排。 缺少工具的部分分支仍可返回 ready=true。 | [server/next-features.ts:160](D:/27247/Desktop/Sakura/server/next-features.ts:160) |
| 虚拟音视频设备 / `virtual-media-devices` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“保存虚拟声卡、摄像头和媒体设备配置。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| 硬件兼容矩阵 / `hardware-compatibility` | 部分实现 | QEMU/QMP 能力直接硬编码 true；没有硬件项目逐项探测矩阵。 | [server/next-features.ts:348](D:/27247/Desktop/Sakura/server/next-features.ts:348) |
| 存储池管理 / `storage-pools` | 部分实现 | 仅 stat 当前数据目录；没有存储池清单、容量统计及选择/分配。 | [server/next-features.ts:350](D:/27247/Desktop/Sakura/server/next-features.ts:350) |
| SSD/HDD 分层 / `storage-tiering` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存热数据与冷数据的分层策略。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| S3/MinIO 备份目标 / `object-backup` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：校验对象存储目标配置并保存脱敏连接信息。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 快照分支合并 / `snapshot-merge` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“生成快照分支合并预览并记录来源。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| 文件级恢复 / `file-level-restore` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“保存文件级恢复请求和目标路径校验结果。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| 全局备份去重 / `global-dedup` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“计算本地备份索引的去重统计。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| 备份带宽限速 / `backup-throttle` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存备份带宽和并发限制。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| RPO/RTO 计算器 / `rpo-rto-planner` | 部分实现 | 有简单容量/带宽估算；RPO 使用保留天数计算，缺备份频率输入及适当校验。 | [server/next-features.ts:358](D:/27247/Desktop/Sakura/server/next-features.ts:358) |
| 主机磁盘健康 / `host-disk-health` | 部分实现 | 只 stat 数据目录；目录 size 不是磁盘容量，也不代表磁盘健康。 | [server/next-features.ts:350](D:/27247/Desktop/Sakura/server/next-features.ts:350) |
| 灾备演练 / `disaster-recovery-drill` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“保存可审计的灾备演练计划和结果。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| WireGuard 覆盖网络 / `wireguard-overlay` | 仅探测 | 只检查 wg 和现有接口；没有配置或建立隧道。 缺少工具的部分分支仍可返回 ready=true。 | [server/next-features.ts:161](D:/27247/Desktop/Sakura/server/next-features.ts:161) |
| 私有 DNS 与 DNSSEC / `private-dns-dnssec` | 仅探测 | 只查 localhost/resolvectl；没有私有 DNS 区域、DNSSEC 配置或验证。 缺少工具的部分分支仍可返回 ready=true。 | [server/next-features.ts:162](D:/27247/Desktop/Sakura/server/next-features.ts:162) |
| HTTP 反向代理 / `http-ingress` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存服务入口、路径和上游健康检查配置。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| ACME 证书续期 / `acme-renewal` | 仅探测 | 只读 certbot/lego 版本；没有申请、续期任务与证书部署。 缺少工具的部分分支仍可返回 ready=true。 | [server/next-features.ts:163](D:/27247/Desktop/Sakura/server/next-features.ts:163) |
| mTLS 服务策略 / `mtls-policy` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存服务间双向 TLS 策略和证书轮换时间。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 网络拓扑图 / `network-topology` | 仅探测 | 只返回 ip/ifconfig 文本；没有拓扑模型或图。 缺少工具的部分分支仍可返回 ready=true。 | [server/next-features.ts:164](D:/27247/Desktop/Sakura/server/next-features.ts:164) |
| NAT 回流 / `nat-hairpin` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“保存端口回流规则并检查当前转发配置。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| PAC 代理策略 / `proxy-pac` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存按域名分流的 PAC 规则。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 延迟丢包模拟 / `network-emulation` | 仅探测 | 只查看 tc qdisc；没有应用或预览给定延迟/丢包参数。 缺少工具的部分分支仍可返回 ready=true。 | [server/next-features.ts:165](D:/27247/Desktop/Sakura/server/next-features.ts:165) |
| 服务网格边车 / `service-mesh` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“登记服务边车策略和可选代理检测结果。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| Passkey/WebAuthn / `passkey-webauthn` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存控制面 Passkey 策略和注册统计。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| OIDC 与 SAML 单点登录 / `oidc-saml` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：校验身份提供商元数据并保存非敏感配置。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 自定义 RBAC / `custom-rbac` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存项目角色、权限和成员映射。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| JIT 临时授权 / `jit-privilege` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：登记有时限的临时权限请求。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 双人审批 / `dual-approval` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存需要第二位成员确认的高风险操作。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 签名策略包 / `signed-policy-bundles` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：计算策略包摘要并记录签名状态。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 远程不可变审计 / `remote-audit-lock` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存远程审计目标和本地链式记录摘要。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 合规证据导出 / `compliance-evidence` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“导出当前能力和操作记录的证据摘要。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| PII 数据分类 / `pii-classification` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：对输入路径和字段声明生成隐私分类结果。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 事件应急锁定 / `incident-lockdown` | 仅本地记录 | 只写 locked 布尔值且返回 ready=true；没有接入权限/任务拦截，check 也会写锁定状态。 | [server/next-features.ts:373](D:/27247/Desktop/Sakura/server/next-features.ts:373) |
| OpenTelemetry 链路 / `otel-tracing` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：生成当前 Sakura 请求和任务的链路适配状态。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| eBPF 性能分析 / `ebpf-profiler` | 仅探测 | 只探测 bpftool feature；没有性能采样与结果分析。 缺少工具的部分分支仍可返回 ready=true。 | [server/next-features.ts:166](D:/27247/Desktop/Sakura/server/next-features.ts:166) |
| 火焰图生成 / `flamegraph` | 仅探测 | 只读 perf 版本；没有采样、栈聚合或火焰图输出。 缺少工具的部分分支仍可返回 ready=true。 | [server/next-features.ts:167](D:/27247/Desktop/Sakura/server/next-features.ts:167) |
| 集中日志索引 / `log-index` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存日志索引字段和最近一次索引状态。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 日志保留策略 / `log-retention` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存日志保留天数和容量上限。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 告警路由 / `alert-routing` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存按标签匹配的告警通知路由。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| SLO 仪表盘 / `slo-dashboard` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“根据任务历史生成可用性指标摘要。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| 错误预算 / `error-budget` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“根据目标 SLO 计算剩余错误预算。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| 容量预测 / `capacity-forecast` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“根据宿主机当前资源生成容量预测快照。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| 自动修复 Runbook / `auto-remediation` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存带审批和预览的自动修复步骤。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 构建缓存 / `build-cache` | 仅探测 | 只找缓存目录；没有缓存键、恢复、失效和容量管理。 缺少工具的部分分支仍可返回 ready=true。 | [server/next-features.ts:168](D:/27247/Desktop/Sakura/server/next-features.ts:168) |
| 分布式构建农场 / `build-farm` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存构建节点和队列调度元数据。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 语言服务器目录 / `language-server-catalog` | 仅探测 | 只尝试语言服务器版本；没有安装、会话连接或编辑器集成。 缺少工具的部分分支仍可返回 ready=true。 | [server/next-features.ts:169](D:/27247/Desktop/Sakura/server/next-features.ts:169) |
| DevContainer 市场 / `devcontainer-marketplace` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：登记 DevContainer 模板和来源校验状态。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 分支预览环境 / `branch-preview` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存分支预览环境的生命周期状态。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 测试分片 / `test-sharding` | 仅规划 | 只生成 SHARD_INDEX/SHARD_TOTAL 标签；没有分配测试用例、执行或合并结果。 | [server/next-features.ts:365](D:/27247/Desktop/Sakura/server/next-features.ts:365) |
| 依赖升级机器人 / `dependency-bot` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存依赖升级检查计划和安全限制。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 代码搜索索引 / `code-search-index` | 仅探测 | 只读 rg 版本；没有建立、更新或查询索引。 缺少工具的部分分支仍可返回 ready=true。 | [server/next-features.ts:170](D:/27247/Desktop/Sakura/server/next-features.ts:170) |
| 本地 AI 助手 / `local-ai-assistant` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存本地模型端点和上下文策略，不执行隐式命令。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 自然语言命令规划 / `natural-command-planner` | 仅提示文本 | 只是把请求拼到 # 注释；不产生可执行命令、计划步骤或模型调用，却返回 ready=true。 | [server/next-features.ts:369](D:/27247/Desktop/Sakura/server/next-features.ts:369) |
| 共享终端 / `shared-terminal` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存共享终端会话和成员访问状态。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 共享桌面视图 / `shared-desktop-view` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存只读桌面查看会话。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 会话交接 / `session-handoff` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存可恢复的会话交接令牌元数据。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 文件锁 / `file-locks` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：登记项目文件锁和过期时间。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 行级评审线程 / `review-threads` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存文件、行号和评审意见线程。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 项目权限 / `project-permissions` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存项目成员和角色权限。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 团队模板 / `team-templates` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存可复制的项目和资源模板。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 入门清单 / `onboarding-checklist` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存团队成员入门步骤和完成状态。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 变更审批 / `change-approval` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存变更摘要、审批人和审批状态。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 活动摘要 / `activity-digest` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“从任务和执行历史生成活动摘要。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| Windows/Linux 进程互操作 / `process-interop` | 仅探测 | 只列 Linux 进程；没有 Windows/Linux 跨系统进程协议。 缺少工具的部分分支仍可返回 ready=true。 | [server/next-features.ts:171](D:/27247/Desktop/Sakura/server/next-features.ts:171) |
| 宿主盘挂载策略 / `host-drive-policy` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存宿主目录挂载的只读和路径策略。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 文件关联 / `file-associations` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存扩展名到 Sakura 工作区的关联。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 按应用剪贴板策略 / `clipboard-policy` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存剪贴板按应用的读写和敏感内容策略。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 音频摄像头麦克风直通 / `media-passthrough` | 目录占位 | 落到 ready=false、executed=false 的未实现回退；缺少“检查客户机音视频设备和直通声明。”的对应处理。 | [server/next-features.ts:397](D:/27247/Desktop/Sakura/server/next-features.ts:397) |
| USB 热插拔 / `usb-hotplug` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存 USB 设备热插拔事件和规则。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| CUDA/ROCm 直通 / `gpu-compute-passthrough` | 仅探测 | 只查 nvidia-smi/rocminfo；没有 GPU 设备直通配置。 缺少工具的部分分支仍可返回 ready=true。 | [server/next-features.ts:172](D:/27247/Desktop/Sakura/server/next-features.ts:172) |
| Jupyter/Marimo 环境 / `notebook-environment` | 仅探测 | 只查 Jupyter/Marimo 版本；没有安装、启动、认证与会话管理。 缺少工具的部分分支仍可返回 ready=true。 | [server/next-features.ts:173](D:/27247/Desktop/Sakura/server/next-features.ts:173) |
| 认证浏览器 IDE / `authenticated-ide-preview` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存浏览器 IDE 会话和认证过期时间。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 桌面录制与回放 / `desktop-recording` | 仅探测 | 只读 ffmpeg 版本；没有录制、停止、存储或回放。 缺少工具的部分分支仍可返回 ready=true。 | [server/next-features.ts:174](D:/27247/Desktop/Sakura/server/next-features.ts:174) |
| 插件市场 / `plugin-marketplace` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存插件目录、来源和安装状态。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 签名沙箱插件 / `signed-plugin-sandbox` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：计算插件摘要并记录签名与沙箱策略。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| Schema 驱动面板 / `schema-panels` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存面板 Schema 版本和校验状态。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| GraphQL API / `graphql-api` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：登记 GraphQL API 版本和查询限制。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| Webhook 事件 / `webhook-events` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存 Webhook 订阅和最近投递状态。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 事件自动化 DSL / `automation-dsl` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：校验并保存事件自动化规则，默认只预览。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 移动伴侣 / `mobile-companion` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存移动设备配对和只读通知策略。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 浏览器扩展 / `browser-extension` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存浏览器扩展连接状态和权限摘要。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| Windows 托盘伴侣 / `tray-companion` | 仅本地记录 | 仅写通用 lastInput/checkedAt；没有专用配置校验、状态模型与实际执行/策略应用。目录目标：保存托盘进程连接和启动策略。 | [server/next-features.ts:385](D:/27247/Desktop/Sakura/server/next-features.ts:385) |
| 功能开关与灰度 / `feature-rollout` | 仅本地记录 | 只保存 percentage/version；未把功能开关应用到服务。 | [server/next-features.ts:379](D:/27247/Desktop/Sakura/server/next-features.ts:379) |

## 工程操作协议逐项对照（37 条）

全部操作当前受 action 校验错误阻断；下表检查的是执行器本身，避免修好入口后误认为功能已经完成。

| 操作 | 尚需完成 / 修正 | 声明 |
| --- | --- | --- |
| 归档 / 解压 / `archive` | 解压只先 tar -t 再 tar -x；没有所声明的全成员路径、符号链接及越界校验。 | [server/engineering-operations.ts:13](D:/27247/Desktop/Sakura/server/engineering-operations.ts:13) |
| 文件证据清单 / `hash-manifest` | 只输出 sha256sum；output 参数、大小/mtime 字段及 20,000 文件/512 MiB 上限未实现。 | [server/engineering-operations.ts:14](D:/27247/Desktop/Sakura/server/engineering-operations.ts:14) |
| Windows 文件名预检 / `case-conflict-report` | 只比较小写名称；缺 Windows 保留名、非法字符及路径语义预检。 | [server/engineering-operations.ts:15](D:/27247/Desktop/Sakura/server/engineering-operations.ts:15) |
| 导入项目任务 / `task-import` | 只打印静态任务名；save 参数未用于保存收藏命令。 | [server/engineering-operations.ts:16](D:/27247/Desktop/Sakura/server/engineering-operations.ts:16) |
| 生成项目上手步骤 / `project-onboarding` | 只列文件、输出 README 和清单名；没有生成初始化步骤。 | [server/engineering-operations.ts:17](D:/27247/Desktop/Sakura/server/engineering-operations.ts:17) |
| 校验环境变量 / `env-schema` | 未注入项目最终环境；boolean 未处理，choices 使用字面变量文本，错误未聚合为失败。 | [server/engineering-operations.ts:18](D:/27247/Desktop/Sakura/server/engineering-operations.ts:18) |
| 项目 Shell 启动环境 / `shell-profiles` | 有读/写 profile 及显式加载命令的实现；仍需修复公共入口和失败传播。 | [server/engineering-operations.ts:19](D:/27247/Desktop/Sakura/server/engineering-operations.ts:19) |
| 工具链兼容性检查 / `toolchain-check` | 只打印工具版本；没有读取项目版本约束或检查兼容性。 | [server/engineering-operations.ts:20](D:/27247/Desktop/Sakura/server/engineering-operations.ts:20) |
| 初始化前置检查 / `bootstrap-dry-run` | 仅 sh -n 语法检查；声明的工具和路径前置检查未实现。 | [server/engineering-operations.ts:21](D:/27247/Desktop/Sakura/server/engineering-operations.ts:21) |
| 项目模板打包 / `project-template-pack` | 基础 tar 打包；未实现声明中的通用私钥排除、成员边界检查。 | [server/engineering-operations.ts:22](D:/27247/Desktop/Sakura/server/engineering-operations.ts:22) |
| Git Stash / `git-stash` | list/save 有命令；apply/drop 分支缺 stash 子命令，会生成 git apply/git drop。 | [server/engineering-operations.ts:23](D:/27247/Desktop/Sakura/server/engineering-operations.ts:23) |
| 从 Reflog 恢复分支 / `git-reflog` | 有列表和从提交新建分支的命令；公共入口及失败传播仍阻塞使用。 | [server/engineering-operations.ts:24](D:/27247/Desktop/Sakura/server/engineering-operations.ts:24) |
| Cherry-pick / Revert / `git-cherry-pick` | continue/abort 缺 --；revert 分支没有使用提交参数构造 git revert。 | [server/engineering-operations.ts:25](D:/27247/Desktop/Sakura/server/engineering-operations.ts:25) |
| Git Bisect / `git-bisect` | start 拼接 good 再 bad，与 Git 所需顺序相反；未检查干净工作区。 | [server/engineering-operations.ts:26](D:/27247/Desktop/Sakura/server/engineering-operations.ts:26) |
| 交互式 Rebase / `git-rebase` | plan 直接运行交互式 rebase；apply/abort 都变成 --continue，todo 未使用。 | [server/engineering-operations.ts:27](D:/27247/Desktop/Sakura/server/engineering-operations.ts:27) |
| 分支与提交策略检查 / `git-policy` | 只打印分支名和提交标题；branchPrefixes、commitTypes、message 未用于校验。 | [server/engineering-operations.ts:28](D:/27247/Desktop/Sakura/server/engineering-operations.ts:28) |
| 暂存区密钥扫描 / `precommit-secrets` | 仅打印 clean/suspected-secret，缺路径行号及失败拦截，未连接提交入口。 | [server/engineering-operations.ts:29](D:/27247/Desktop/Sakura/server/engineering-operations.ts:29) |
| CODEOWNERS 映射 / `code-ownership` | 只打印 CODEOWNERS 文件；paths 参数和规则匹配未实现。 | [server/engineering-operations.ts:30](D:/27247/Desktop/Sakura/server/engineering-operations.ts:30) |
| 重复运行检查不稳定性 / `flaky-tests` | 重复执行并打印 code/ms；没有不稳定分类，失败退出码不能使任务失败。 | [server/engineering-operations.ts:31](D:/27247/Desktop/Sakura/server/engineering-operations.ts:31) |
| 读取覆盖率 / `coverage-history` | 只 cat 覆盖率文件；未实现多格式解析、覆盖率趋势比较。 | [server/engineering-operations.ts:32](D:/27247/Desktop/Sakura/server/engineering-operations.ts:32) |
| 性能基准 / `benchmark-regression` | 只打印多轮耗时；baselineMs、thresholdPercent 及中位数比较未实现。 | [server/engineering-operations.ts:33](D:/27247/Desktop/Sakura/server/engineering-operations.ts:33) |
| 生成 CycloneDX SBOM / `sbom` | 不是声明的 CycloneDX；只返回锁文件包路径或原文，没有标准版本/完整性模型。 | [server/engineering-operations.ts:34](D:/27247/Desktop/Sakura/server/engineering-operations.ts:34) |
| 依赖许可证报告 / `license-report` | 只列 LICENSE/COPYING/package.json 路径；未解析依赖许可或 allowed 参数。 | [server/engineering-operations.ts:35](D:/27247/Desktop/Sakura/server/engineering-operations.ts:35) |
| 执行发布门禁 / `release-gates` | 多条命令未启用遇错退出，前一项失败可能被后一项成功掩盖；任务包装也忽略 code。 | [server/engineering-operations.ts:36](D:/27247/Desktop/Sakura/server/engineering-operations.ts:36) |
| 构建来源清单 / `artifact-provenance` | 仅提交、脏状态和最多 500 个哈希；缺工具版本与完整来源模型。 | [server/engineering-operations.ts:37](D:/27247/Desktop/Sakura/server/engineering-operations.ts:37) |
| 生成变更日志 / `changelog` | 已有 git log 生成文本的命令；公共入口仍阻断。 | [server/engineering-operations.ts:38](D:/27247/Desktop/Sakura/server/engineering-operations.ts:38) |
| 双目录可复现构建 / `reproducible-build` | 复制当前工作区两次而非导出同一提交；只打印两组哈希，没有比较和失败判定。 | [server/engineering-operations.ts:39](D:/27247/Desktop/Sakura/server/engineering-operations.ts:39) |
| POSIX ACL / `posix-acl` | 有 getfacl/setfacl 调用；缺失工具可只返回成功提示，结果失败未传播。 | [server/engineering-operations.ts:40](D:/27247/Desktop/Sakura/server/engineering-operations.ts:40) |
| 时钟同步 / `guest-clock-policy` | sync 用客户机自己的 date 设置自身时间，没有读取宿主时间；错误被 \|\| true 隐藏。 | [server/engineering-operations.ts:41](D:/27247/Desktop/Sakura/server/engineering-operations.ts:41) |
| 客户机静态路由 / `static-routes` | 有 ip route 命令；Schema 仅约束字符串长度，缺声明中的 IP/CIDR 与默认路由保护。 | [server/engineering-operations.ts:42](D:/27247/Desktop/Sakura/server/engineering-operations.ts:42) |
| 进程资源采样 / `process-history` | 仅一次 workspaces.metrics 进程摘要；没有 PID 启动标识及结构化进程历史。 | [server/engineering-operations.ts:43](D:/27247/Desktop/Sakura/server/engineering-operations.ts:43) |
| 磁盘 I/O 采样 / `disk-io-metrics` | 只读一次 /proc/diskstats；没有间隔采样、吞吐和平均延迟计算。 | [server/engineering-operations.ts:44](D:/27247/Desktop/Sakura/server/engineering-operations.ts:44) |
| 网络流量采样 / `network-metrics` | 只读一次累计计数；没有一秒增量/速率计算。 | [server/engineering-operations.ts:45](D:/27247/Desktop/Sakura/server/engineering-operations.ts:45) |
| 命令风险预检 / `command-risk` | 已有启发式正则风险分类；公共入口仍阻断。 | [server/engineering-operations.ts:46](D:/27247/Desktop/Sakura/server/engineering-operations.ts:46) |
| 执行条件命令宏 / `command-macros` | 有 when 条件、argv 引用、超时和步骤结果；最终失败没有向任务状态传播。 | [server/engineering-operations.ts:47](D:/27247/Desktop/Sakura/server/engineering-operations.ts:47) |
| 运行运维手册 / `runbooks` | 有顺序步骤；失败后跳过后续步骤，但整条任务仍可被标记完成。 | [server/engineering-operations.ts:48](D:/27247/Desktop/Sakura/server/engineering-operations.ts:48) |
| 扩展能力适配器 / `feature-run` | 仅再次调用通用适配器；不会补齐目录项的真实实现。 | [server/engineering-operations.ts:49](D:/27247/Desktop/Sakura/server/engineering-operations.ts:49) |

## 不应误列为完全缺失的能力

- 暂停/恢复已在 automation 的专用 HTTP 路由和 Machines 实现，扩展目录适配器未连接该实现。
- 停机 QCOW2 整理、Node/Python 版本管理、单文件诊断、文本剪贴板、Git fetch/pull/push/merge、内置插件 API 都有真实代码；它们与更大的规划目标不是同一范围。
- [docs/development-workbench.md:28](D:/27247/Desktop/Sakura/docs/development-workbench.md:28) 仍写“没有远程拉取/推送”，但 [plugins/git/client.tsx:146](D:/27247/Desktop/Sakura/plugins/git/client.tsx:146) 已提供这些入口，属于文档过期。
- 主机/客户机未安装 Docker、acl、语言工具等属于环境依赖；只有检测逻辑而无相应执行器，才归类为实现未完成。

## 验收覆盖仍需补齐

- 上一轮 253 项单测、5 项界面测试及真实 QEMU 验收验证的是既有核心流程和五项优化，不覆盖这 250 条规划能力。
- 本次新增的隔离审计调用复现了 37 个工程操作、200 个配置入口和空闲关机/就绪误报等问题。Machines/Workspaces 使用模拟对象，未启动或修改用户虚拟机；这不能代替工程操作的真实客户机测试。
- Windows/Linux CI 矩阵已配置但尚无本次远端运行结果；GPU、远程主机、团队身份服务等也不能由本地基础 VM 测试推定完成。

建议顺序：先修公共请求协议、失败传播及误报状态；再逐项完成 37 个工程操作；最后按领域补齐远程、权限、网络/存储、桌面及平台功能。

审计数据：[250 条结构化明细](D:/27247/Desktop/Sakura/artifacts/implementation-audit.json)、[隔离复现结果](D:/27247/Desktop/Sakura/artifacts/implementation-probe-results.json)、[复现脚本](D:/27247/Desktop/Sakura/artifacts/implementation-probes.ts)。
