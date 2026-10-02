# Sakura

一个从基础终端开始、通过插件扩展的本地 Linux 工作空间。

**真正运行 Linux 内核。** [PosixLoom](https://github.com/lyts825/posixloom) 负责命令编排、会话与 Windows 进程树管理，[QEMU](https://www.qemu.org/) 负责虚拟化。当前不是 WSL 的替代实现，也不依赖现有的 WSL 发行版。

## 基础版与插件

初始版本只提供 **Alpine 实例创建/启停/删除、持久磁盘、单终端与启动日志、基础资源配置、插件管理**。本机鉴权、SSH 密钥、操作锁与安全关机始终有效。

文件、桌面、多终端、项目、Git、同步、备份、监控等均为可选插件。**默认不启用任何插件或整合包**，也不运行它们的后台任务。默认导航为「工作空间 / 插件中心 / 系统设置」，实例标签为「终端 / 配置」。

当前有 **32 个插件、9 个整合包**。在「插件中心」单独选择插件，或按场景选择整合包：

| 整合包                     | 内容                                                   |
| -------------------------- | ------------------------------------------------------ |
| `essentials` 日常使用      | 文件、镜像、快照与多终端                               |
| `developer` 开发工作台     | 项目、代码、Git、工具、网络、私密配置与快捷命令        |
| `operations` 运维与备份    | 备份、同步、监控、诊断、整理与数据迁移                 |
| `desktop` 图形桌面         | KDE Plasma、文件与快照；桌面仍为实验性                 |
| `lab` 实验室               | 沙箱、自动化、独立调度器、容器及扩展能力适配器         |
| `complete` 完整兼容        | 此前全部可选能力，包括实验功能                         |
| `development` 开发工具组合 | 工具安装、项目搜索、代码检查、收藏命令、流水线、运行时 |
| `environment` 环境互通组合 | 环境配方与 IDE 接入，可分别启用                        |
| `monitoring` 监控组合      | 资源采样与项目服务健康检查，可分别启用                 |

整合包可引用子整合包；必需依赖自动补齐并去重，可选配套不会自动启用。选择保存后，**退出并重新启动 Sakura 服务才会生效**，仅刷新浏览器无效；重启会停止当前实例。移除整合包时，其他整合包或独立选择仍需要的插件继续保留。

没有保存插件选择的旧版本升级后进入基础版，已有实例和插件数据保留。已有选择则继续保留；原 `development`、`environment`、`monitoring` 插件选择迁移为同名整合包，旧版单独选中的 `automation` 会保留后台调度，旧 CLI 标识仍可用。需要恢复全部入口可选择 `complete`。停用插件不会卸载客户机软件或撤销已经写入客户机的配置。

内置插件按需激活服务与加载浏览器入口；第三方纯计算插件可从 HTTPS 目录下载，经发布者签名验证后在隔离的 WebAssembly 工作线程运行，并可直接卸载。第三方事件订阅、宿主服务与浏览器入口仍待实现。完整设计见 [插件架构](docs/plugin-architecture.md)、[内置插件协议](docs/plugin-protocol.md)与[第三方插件协议](docs/community-plugins.md)。

## 快速启动

目前验证的平台：Windows x64、Node.js 22.12+、Git、Rust stable（需要 MSVC C++ 构建工具）。无需管理员权限或安装 WSL。TCG 回退模式无需启用系统虚拟化组件。

Windows 源码构建另需 x64 与 i686 MinGW-w64 C++ 编译器，分别通过 `SAKURA_NATIVE_CLIPBOARD_CXX` 和 `SAKURA_NATIVE_CLIPBOARD_CXX32` 指定完整路径。独立运行包已包含两种应用架构的代理，使用运行包无需编译器。范围、设置与验证见 [Windows 应用剪贴板策略](docs/native-clipboard.md)。

KDE 桌面的「原生应用剪贴板」入口可按完整 ELF 路径与摘要启动 Linux X11 应用，执行复制、粘贴、格式与敏感文本规则，支持热更新、服务重载及子进程清理。客户机需要 cgroup v2；现有应用、原生 Wayland 和底层协议路径仍未覆盖。用法和验证见 [Linux X11 应用剪贴板策略](docs/x11-clipboard.md)。

```powershell
npm ci
npm run setup
npm run build
npm start
```

打开 **http://127.0.0.1:7337**，点击「创建发行版」。默认 2 vCPU、512 MiB 内存、8 GiB 增量磁盘及自动加速模式，首次启动自动配置网络和独立 SSH 密钥。系统就绪后终端自动连接。

`setup` 将固定版本的 PosixLoom、QEMU 和 Alpine 下载到项目目录，不修改系统 PATH、注册表或 WSL。下载需要网络；镜像与 QEMU 会校验 SHA-512。之后常规启停可离线使用。Windows 下会提取便携 QEMU；已有安装可以设置 `SAKURA_QEMU_DIR` 指向同时包含 `qemu-system-x86_64.exe`、`qemu-img.exe` 和 `qemu-io.exe` 的目录。

需要 TPM/安全启动或 Virtio-FS 时，可选用已安装 Linux QEMU、swtpm、virtiofsd、OVMF 和 Node.js 22.12+ 的 WSL 发行版：先运行 `npm run check:wsl`，再运行 `npm run start:wsl`。浏览器仍访问同一 Windows 本机地址；WSL 模式使用独立的 Linux 数据目录。准备步骤和限制见 [WSL 后端](docs/wsl-backend.md)。默认 `npm start` 仍使用原生 Windows 后端。

开发模式：`npm run dev`（同一端口，Vite HMR）。关闭浏览器不会停止虚拟机；退出后台服务会先尝试关闭虚拟机。不要同时启动两个使用相同数据目录的服务。

CLI `shell`、`exec` 与命令执行 API 默认使用保存的活动项目，支持项目选择、网络模式、环境和命令取消；实例维护命令需明确使用 `--instance`。用法见 [项目命令执行](docs/project-execution.md)。

浏览器在服务重启后会自动获取新凭证并恢复状态连接；已停止的实例由用户重新启动。终端短暂断线时会退避重连并保留当前页面的输出，启用多终端插件且安装 tmux 时可重新附着会话；已经退出的 Shell 保持结束状态。网络错误后的写操作需要检查结果后重试，只有被服务明确拒绝的过期凭证请求会在重新鉴权后重试。

实例状态优先通过事件更新，事件密集到达时合并读取；连接正常时每 30 秒校验一次，事件通道不可用时每 5 秒补偿刷新。隐藏窗口暂停状态轮询和事件订阅，回到页面后重新同步。

## 启动性能

新实例默认选择「自动」加速：服务启动时通过一台暂停且不挂载磁盘的临时虚拟机检查 WHPX，主机已支持时使用硬件加速，否则使用 TCG。不会启用 Windows 功能或要求重启主机。已有实例保留原来的加速选项；停机后可在「配置」中切换为「自动」。运行时卡片显示实际使用的 TCG / WHPX。

新 Alpine 实例通过 NoCloud 直接配置独立 NAT 网络（`10.0.2.15/24`，网关 `10.0.2.2`，DNS `10.0.2.3`），省去 DHCP 等待。创建增量盘时，Sakura 会先验证固定版本 Alpine 基础镜像中的三个官方默认值，再通过 `qemu-io` 将引导菜单等待改为 1 秒、让 chronyd 异步启动；官方基础镜像保持原样。首次 Tiny Cloud 初始化仍会执行网络、SSH 密钥和用户数据配置，完成后移除一次性启动钩子。

旧实例首次使用新版启动时，会在初始化完成后迁移仍为官方默认值的引导和网络配置，并移除已完成的一次性 Tiny Cloud 启动钩子，下次启动生效。原文件备份在客户机相同目录下的 `*.sakura-backup`；自定义配置及符号链接会保留。需要自行管理这些设置时，在客户机创建 `/etc/sakura/keep-boot-config`，即可停止后续配置迁移，并按需从备份恢复。

Windows 的 TCG 使用单线程和自动指令时钟，处理本机测试中出现的早期 IO-APIC 定时器崩溃；其多个虚拟 CPU 共享一个模拟线程，多核计算吞吐量会受到限制。其他主机继续使用多线程 TCG。相关时钟行为见 [QEMU 的 icount 说明](https://www.qemu.org/docs/master/system/invocation.html)。

“运行中”表示已通过 SSH 执行初始化完成检查；界面会即时接收状态变化，CLI 的检测间隔为 250 毫秒。启动检测以 270 秒为总时间预算，停止实例会取消检测，内核崩溃会立即显示错误。

本机 WHPX 实测新实例首启 6.81 秒，后续启动 5.96–7.22 秒；没有 `qemu-io` 或使用自定义 Alpine 镜像时会保留兼容回退路径。测量条件、TCG 回退的取舍及验证记录见 [启动性能验证](docs/boot-performance.md)。

## 可选插件能力（启用后可用）

以下能力由插件提供，界面入口、API 与后台服务随插件激活。具体插件标识见 [插件清单](docs/plugin-architecture.md#插件划分)。

- **沙箱工作台**：独立 Linux 环境，默认隔离网络，固定 CPU/内存/磁盘配额，限时命令、取消与整机终止，到期停止或自动销毁，执行记录保留；支持独立启用及 CLI/API 操作。入口、策略与验证见 [沙箱说明](docs/sandbox.md)。

  执行记录独立保存命令、目录、退出码及各阶段耗时，可导出 JSON；执行前可指定最多 8 个产物文件，总量不超过 8 MiB，保存成功后可在沙箱销毁后下载。

- **开发工作台与安全维护**：Git、多文件代码编辑器、Ctrl / ⌘ + K 命令面板、开发工具与网络管理、服务持续健康检查、Windows 私密配置、Docker / Compose、数据目录迁移、加密和外部目录备份。入口、CLI 与验证方法见 [开发工作台说明](docs/development-workbench.md)。
- **工作区恢复与自动化**：会话恢复、多项目隔离、文件历史与回收站、流水线产物、远程 Git、运行时版本、代码检查、同步删除决策、任务事件和 QCOW2 磁盘整理。入口与 API 索引见 [工作区恢复与自动化](docs/development-next.md)。

- **能力中心**：集中管理实例计划启动/停止、空闲停止、资源历史与阈值告警、动态内存目标、资源预设、Linux 工作区搜索、apk/apt 软件包任务、测试与格式化开发任务、Git Worktree、数据库容器、端口发现、网络诊断和只读安全扫描；同时提供 50 项新能力路线图。入口与接口说明见 [能力中心](docs/feature-suite.md)。

- **扩展能力工作台**：登记第二批 100 项虚拟机、存储、同步、开发、Git、质量、网络、安全、运维和集成功能。已实现的操作会执行检查；其余入口会明确返回未实现或缺少依赖，保留执行记录。支持暂停/恢复运行中的实例及扩展能力的 CLI/API 操作。详见 [能力中心](docs/feature-suite.md#第二批-100-项扩展能力)。

- **第三批平台能力**：提供远程主机与集群、虚拟硬件、灾备、网络治理、安全合规、可观测性、开发与 AI、团队协作、桌面集成和插件扩展共 100 项目录及统一接口。部分操作已实现；本地记录和待实现入口会明确标记。详见 [能力中心](docs/feature-suite.md#第三批-100-项平台能力)。

- 创建、启动、正常关机、删除 Alpine、Debian 12 和 Ubuntu 24.04 实例；镜像库支持官方镜像下载与校验。
- 每实例独立 QCOW2 增量磁盘，完整 Linux 文件系统在重启后保留。
- 浏览器 SSH 交互终端：颜色、Ctrl+C、窗口缩放、多终端标签、分屏和 tmux 会话恢复；启动时显示串口日志。
- 实验性 KDE Plasma 图形桌面：实例可按需安装，在浏览器内使用鼠标键盘操作，支持自适应分辨率、全屏、重新连接和外观布局自定义。
- SFTP 文件管理与二进制上传/下载（单文件最大 2 GiB），1 MiB 内文本编辑，目录创建、重命名和删除。
- Node.js / Python / Rust 开发模板、可保存的项目配置、初始化与启动命令、运行日志。
- Windows 文件夹双向同步、冲突检测、可选自动同步；客户机实时资源监控。
- 统一任务中心：阶段、耗时、日志、取消/重试与持久历史；文本编辑支持草稿、快捷键保存和外部修改检测。
- 同步变更预览、逐文件冲突决策、自定义忽略规则；多服务项目支持依赖、就绪检查、环境变量与独立日志。
- 可分享的 `sakura.json` 环境配置、Debian/Ubuntu 的 VS Code Remote-SSH 接入、实例分组/标签/收藏与批量启停。
- 一键故障诊断与脱敏报告、磁盘扩容与空间管理、关机后定时备份/保留策略/校验及恢复为新实例。
- 快照删除/备注、恢复前备份、实例克隆、带校验的独立导入导出。
- 离线磁盘快照及恢复；运行中禁止快照、恢复、删除和修改资源。
- CPU、内存、自动 / TCG / WHPX 配置；命名 TCP 端口转发支持运行中修改、监听状态与网页入口。
- 单机控制服务、随机访问凭证、同源及 Host 检查，管理端口和 QEMU 控制端口仅监听回环地址。
- 同时最多运行 4 个实例，最多 32 个发行版、每实例 20 个快照；日志保留最近 128 KiB。

共享及私有项目支持 [首次 Git 检出](docs/project-repository.md)：固定系统代理预取对象，项目账号在原网络内核对 bundle、保留默认分支并检出。只读 Git 凭据在已应用网络档案中单独配置；已有仓库不自动更新，非空目录保留原内容并拒绝首次检出。

新增管理功能的操作、配置示例和验证方式见 [工作空间管理](docs/workspace-management.md)。单次 [SSH Agent 转发](docs/ssh-agent-forward.md) 和 [GPG Agent 转发](docs/gpg-agent-forward.md) 使用项目账号与独立入口，每次明确提交命令，结束后确认资源和账号票据清理。

本轮新增了分块续传、文件预览与剪贴板上传、文本三方合并、Git 工作树与目录版本、可执行能力表单、跨实例搜索/复制/测试、签名补丁、指标与任务结果导出，以及维护窗口、同步队列、备份限速、保留锁和快照差异比较。使用方法及具体边界见 [功能实现记录](docs/capability-completion.md)；完整剩余范围见 [未完成功能清单](docs/unfinished-features.md)，可用 `npm run features:audit` 重新生成。

## Linux 图形桌面（实验性）

先在插件中心启用 `desktop` 插件或「图形桌面」整合包，并重启服务。

创建实例或在停机后的「配置」中将内存设为至少 **1024 MiB**（建议 **2048 MiB**），启动后进入「桌面」标签，点击「安装并启用桌面」。安装会从对应发行版的官方软件仓库下载 KDE Plasma、TigerVNC、Dolphin、Konsole 和中文字体，需要联网及数百 MiB 磁盘空间，页面会显示进度和失败信息；失败后可重试。

安装完成后自动连接桌面，重启实例时桌面服务也会自动启动。浏览器关闭或切换标签后，客户机中的桌面会话继续运行，再次打开即可连接。短暂断线会自动重连，最多尝试 5 次；认证失败会停止重试并显示提示，也可手动点击「重新连接」。支持鼠标、键盘、自适应分辨率和全屏；浏览器保留的系统快捷键仍由浏览器处理。

桌面以独立的普通用户 `sakura-desktop` 运行，文件保存在 `/home/sakura-desktop`；原有 SSH 终端继续使用 root。桌面使用 noVNC，经已有鉴权的 WebSocket 和 SSH 隧道连接客户机回环地址，无需添加 VNC 端口转发。图形组件保存在该实例的增量磁盘中，可随离线快照恢复；恢复安装前的快照后，需要重新安装。

提供 Alpine / Debian / Ubuntu 的 KDE Plasma 软件渲染桌面；Alpine 在 TigerVNC 的 X11 画布中运行嵌套 KWin/Wayland，Debian / Ubuntu 使用发行版可用的 Plasma 会话入口。桌面支持文本剪贴板互通和可选中文输入法；「外观与布局」支持分辨率、缩放、主题、壁纸、强调色、面板位置、自动隐藏和动画偏好，配置写入实例并在重启后恢复。仍不包含 GPU/3D 加速、声音转发和 WSLg 的单应用窗口集成。TCG 下桌面响应较慢，建议使用可用的硬件加速。Alpine 客户机诊断命令：`rc-service sakura-desktop status`；Debian / Ubuntu 使用 `systemctl status sakura-desktop`，日志：`/var/log/sakura-desktop.log`。安装中断后如提示锁仍被占用，请等待原安装结束或重启实例后重试。

已修复并发连接时短暂拒绝连接导致的直接失败，并加入桌面自动重连、显式网卡 MSI-X 配置。此前本机 WHPX 曾出现 SSH 与桌面同时长时间失联，本轮未复现该现象，仍不能认定其根因已解决；详细验证与限制见 [图形桌面验证记录](docs/linux-desktop.md)。

## 界面与快捷操作

下述文件、多终端、桌面及快捷命令面板操作要求启用对应插件；基础终端、主题与实例导航始终可用。

- 右上角切换「花昼 / 夜樱」主题，选择保存在当前浏览器中。
- 内置本地字体：Noto Sans SC 用于界面正文，Noto Serif SC 用于标题和题字，JetBrains Mono 用于终端与代码；统一字重、行距与数字排版。裁剪后的 WOFF2 共约 365 KiB，无需外部字体服务，其他字符使用系统字体回退。
- 手机资源卡片采用纵向排版，状态和关键说明保持可读字号；文件大小与日期对齐显示，终端及编辑器的中文优先使用黑体回退。
- 日式樱花插图采用本地透明手绘素材，随主题切换浅蓝日光与柔和月色，支持花瓣飘落、枝条轻摆和微光浮动。插图右下角可暂停动画，选择会保留；滚出可见区域、页面进入后台或系统启用减少动态效果时自动停止动画。素材与生成记录见 [樱花插图说明](docs/sakura-art.md)。
- 发行版右上角的展开按钮进入专注模式，为终端和文件操作留出更多空间；再次点击可退出。
- 在工作空间按 `/` 聚焦发行版搜索；输入框和终端中的按键不会被截获。
- 发行版列表支持按运行状态筛选，搜索可一键清空；筛选不会关闭当前终端。卡片直接显示 CPU 和内存配置。
- 终端工具栏可调整 11–18px 字号，点击字号恢复默认 13px；选择会保留，调整时保持 SSH 会话和滚动历史。终端底部持续显示实际连接状态。
- 终端、桌面、文件、快照、配置标签支持左右方向键切换，以及 Home / End 跳转；同一发行版内切换这些标签会保持终端会话与历史输出。
- 窄屏自动使用顶部导航和横向发行版列表，系统的减少动态效果偏好也会生效。

新增工作流、传输限制、项目配置和迁移说明见 [开发工作区与数据互通](docs/development-workspaces.md)。

## 命令行

先保持 `npm start` 运行，再在另一个终端使用：

```powershell
npm run sakura -- list
npm run sakura -- start alpine-dev
npm run sakura -- shell alpine-dev
npm run sakura -- exec alpine-dev -- uname -a
npm run sakura -- exec alpine-dev -- sh -lc 'cd /workspace; ls -la'
npm run sakura -- stop alpine-dev

npm run sakura -- plugins
npm run sakura -- plugin enable files
npm run sakura -- pack enable developer
npm run sakura -- pack disable developer
npm run sakura -- help all
```

`shell` 和 `exec` 会按需启动发行版。命令在 Linux 内执行，不会送入 Windows Shell。

默认帮助只列基础与插件管理命令；`help all` 列出全部可选命令。可选命令要求对应插件已经生效。

## 结构与数据

```text
src/                    React + xterm.js 控制台
plugins/<id>/           同包维护 manifest.ts、server.ts 与可选 client.tsx
plugins/packs/          可嵌套整合包清单
shared/plugin-protocol.ts 纯声明类型、辅助函数与协议版本
shared/plugin-schema.ts 严格声明 Schema 与 JSON Schema 来源
shared/plugin-resolver.ts 依赖/组合解析、冲突检查、选择迁移
shared/plugins.ts       从自动生成的目录导出插件声明
server/plugin-manager.ts 插件选择持久化与运行状态
server/plugin-api.ts    生命周期协议、服务归属与依赖访问检查
server/plugins/         生成的可信入口、路由归属与任务聚合
server/plugin-data.ts   插件私有数据路径与逐版迁移
server/index.ts         HTTP / WebSocket、鉴权、静态服务
server/runtime.ts       PosixLoom 原生命令插件，精确 argv 调用 QEMU
server/machines.ts      发行版生命周期、SSH / SFTP、快照
server/seed.ts          本地 NoCloud ISO 与每实例 SSH 密钥
server/desktop.ts       图形桌面安装状态与 SSH / WebSocket 转发
server/desktop-guest.ts KDE Plasma / Fcitx5 安装、OpenRC 与 systemd 会话脚本
server/features.ts      按需加载插件、请求取消与资源清理
server/workspaces.ts    模板安装、项目任务与项目作用域
server/metrics.ts       独立的客户机按需资源采样
server/sync.ts          Windows / Linux 目录同步与冲突检测
server/bundles.ts       独立磁盘导入导出与克隆
server/qmp.ts           QEMU Machine Protocol
scripts/sync-plugin-catalog.ts 从包目录生成声明和可信入口
scripts/setup.mjs       固定版本的运行时准备
scripts/cli.mjs         WSL 风格命令行入口
.vendor/posixloom/      固定到 92688083ff25d98f44194356f9ec93df0f1f0027
.tools/qemu/            便携 QEMU
.data/images/           只读基础镜像
.data/machines/<id>/    增量磁盘、NoCloud 种子、私有 SSH 密钥
.data/machines.json     发行版与快照元数据
.data/plugins.json      独立选择与整合包；缺少文件表示基础版
```

调用链：`Web/CLI → 本地 API → PosixLoom Service → Rust Native Host / Job Object → QEMU → Linux`。SSH 仅连接到 QEMU 分配的本机随机端口，默认不对外开放 SSH，不生成共享密码。浏览器获得的是短期服务访问凭证，不会收到实例 SSH 私钥。

可在「系统设置 → 数据目录迁移」执行停机复制、校验与路径修复，重启服务后切换到新目录。手动备份时先停止服务，再复制整个数据目录。增量磁盘依赖基础镜像：**不要单独删除或移动 `.data/images`**。手动移动项目后仍需修复 backing 路径，且基础镜像必须保持相同内容，详见 [迁移说明](docs/development-workbench.md#数据目录迁移)。

可配置环境变量：`SAKURA_PORT`（默认 7337）、`SAKURA_DATA_DIR`、`SAKURA_QEMU_DIR`，以及可选的 `SAKURA_IMAGE_DIR`、`SAKURA_IMAGE_PATH`。WHPX 需要用户已在 Windows 中启用 Windows Hypervisor Platform；本项目不会修改系统功能或重启主机。自动模式在 WHPX 不可用时使用 TCG。

## 当前范围

- 支持 Alpine Linux 3.23.4、Debian 12、Ubuntu 24.04 的官方 x86_64 云镜像，也可导入支持 NoCloud/Tiny Cloud 的独立 RAW、VMDK、VHDX 和单磁盘 OVA Linux 云镜像；可在 BIOS 与宿主具备 OVMF 文件时的 UEFI 固件之间选择。目录互通支持双向同步与 SSHFS 宿主目录挂载；可选 WSL Linux 后端还可使用 Virtio-FS。提供常用开发工具、发行版包管理、内存压力回收和受控跨系统进程调用；尚未提供 WSLg 或 Windows 驱动器直接挂载。
- TCG 是软件模拟。自动模式会检测本机是否能使用 WHPX；其他主机的启动时间和兼容性仍取决于硬件及系统配置。内存限制是 QEMU 配额，Web 的「已分配内存」不是客户机实时使用量。
- 普通磁盘快照不保存 RAM 或运行中的进程；TCG 模式下可选择[整机状态快照](docs/memory-snapshots.md)并在启动后手动恢复。恢复会覆盖快照之后的数据。
- 客户机 SSH 与端口转发默认仅监听 `127.0.0.1`，客户机使用 NAT 上网；已配对的主机和手机伴侣可按显式配置通过 HTTPS 接入。此版本不宣称防御恶意客户机。
- 停机先执行 `sync; poweroff` / QMP ACPI，等待 15 秒后通过 PosixLoom 取消进程树；超时强制关闭可能丢失未写入的数据。宿主机重启后发行版保持停止状态，不自动恢复进程。
- PosixLoom 的单命令超时上限约 24.8 天，也限制本版单次 VM 连续运行时长。
- 文件面板支持二进制传输；文本预览/编辑仍有 1 MiB 限制。TTY 使用 SSH PTY，串口页面用于启动日志。

## 验证

```powershell
npm test             # 输入边界、ISO、生命周期与 QMP 测试
npm run plugins:check # 插件/整合包声明、可信入口及 JSON Schema 一致性
npm run build        # TypeScript + 生产构建
npm run dist:check   # 编译产物与入口体积检查
npm run test:production # 使用隔离数据目录启动编译后的服务
npm run test:e2e     # 浏览器插件入口回归（先安装 Playwright Chromium）
npm run verify       # 声明、单测、生产构建、分发和浏览器全套检查
npm run release:prepare # 在 release/ 下生成独立运行包
npm run update:status # 查看独立运行包的当前版本指针
npm run test:features # 新功能真实 VM 集成测试（需联网安装模板）
npm run test:vm      # 真实 QEMU 启动计时、SSH/SFTP、NAT 转发、重启、快照与旧配置迁移
npm run test:sandbox # 真实 QEMU 沙箱网络隔离、限时执行、取消及到期清理
npm run test:secure-erase # 真实 Alpine 项目文件预览、逻辑覆盖、校验与删除
npm run test:gpg-agent:identity -- --describe # 原生 GPG 与项目账号实测合同；默认只读预检
npm run test:project-identity:archive -- --describe # 新实例中核对满额票据归档；实测须 --run-new <发行版>
npm run test:multi-monitor # 真实 Alpine Xvnc 单屏、横向双屏、纵向双屏 RandR 布局
npm run test:native-clipboard # 独立窗口站中的真实 Windows Win32/OLE 应用与服务规则
```

真实 VM 测试需要先完成 `setup`；测试实例及其磁盘会在结束时删除。

独立运行包可校验并预启新版本，再切换启动指针；启动失败自动回滚。命令和数据边界见 [自更新说明](docs/self-update.md)。

插件回归覆盖空配置、分包独立激活、嵌套组合、版本与循环、声明冲突、服务越界、HTTP/WS 拦截、旧选择迁移、并发保存、异步清理与数据保留。可选功能集成脚本显式加载插件，不会修改用户的插件选择。

启动耗时写入 `artifacts/boot-timings.json`，分别记录首次初始化和后续启动。设置 `SAKURA_TEST_ACCELERATOR=tcg` 或 `whpx` 可分别验证指定模式；设置 `SAKURA_TEST_NETWORK=1` 可额外验证客户机 DNS 与 HTTPS 联网；默认测试无需互联网。

设置 `SAKURA_TEST_DESKTOP=1` 再运行 `npm run test:vm`，会使用 2 GiB 内存的临时实例，额外验证联网安装 KDE Plasma、非 root 桌面会话、SSH 隧道中的 VNC 协议，以及重启和恢复快照后的桌面自启动。该模式首次运行需要下载图形软件包，耗时较长。

设置 `SAKURA_TEST_CONNECTIONS=1` 可追加 6 路并发、共 300 次 SSH 数据传输，验证集中连接时的短暂拒绝重试。真实 VM 测试也会检查客户机网卡是否启用 MSI-X。

## 版本管理

项目使用 Git 管理，`main` 保存可运行版本。新功能建议在独立分支开发：

```powershell
git switch -c feat/my-feature
# 修改源码后验证
npm test
npm run build
git add <修改的源码路径>
git diff --cached
git commit -m "feat: describe the change"
```

涉及虚拟机生命周期、磁盘或 SSH 的修改，还应运行 `npm run test:vm`。提交包含源码、文档与 `package-lock.json`；依赖、运行时、虚拟磁盘、实例密钥及本地配置由 `.gitignore` 排除。克隆后按快速启动步骤恢复运行环境；实例数据需要单独备份，不随 Git 保存。

## 上游与许可

Sakura 代码采用 MIT 许可。PosixLoom 为 MIT；QEMU 为 GPL-2.0；noVNC 为 MPL-2.0；Alpine 包各自遵循上游许可。运行时与镜像不作为本项目源码提交，`setup` 从原始发布站下载。再分发二进制时应同时履行各组件许可义务。

随源码提供的字体衍生文件采用 SIL OFL 1.1，保留原始版权和许可。字体来源、校验值及重新裁剪方法见 [字体说明](src/assets/fonts/README.md)。

- [PosixLoom SDK 与架构](https://github.com/lyts825/posixloom)
- [QEMU Windows 构建](https://qemu.weilnetz.de/w64/)
- [QEMU WHPX 文档](https://www.qemu.org/docs/master/system/whpx.html)
- [Alpine 官方云镜像](https://www.alpinelinux.org/cloud/)
- [Alpine Tiny Cloud](https://gitlab.alpinelinux.org/alpine/cloud/tiny-cloud)
- [noVNC 浏览器客户端 API](https://novnc.com/noVNC/docs/API.html)
- [TigerVNC Xvnc 文档](https://tigervnc.org/doc/Xvnc.html)
