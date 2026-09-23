# Sakura

参考 WSL 交互方式的本地 Linux 工作空间：通过 Web 或命令行创建发行版、启动终端、编辑文件和管理磁盘快照。

**真正运行 Linux 内核。** [PosixLoom](https://github.com/lyts825/posixloom) 负责命令编排、会话与 Windows 进程树管理，[QEMU](https://www.qemu.org/) 负责虚拟化。当前不是 WSL 的替代实现，也不依赖现有的 WSL 发行版。

## 快速启动

目前验证的平台：Windows x64、Node.js 22.12+、Git、Rust stable（需要 MSVC C++ 构建工具）。无需管理员权限或安装 WSL。TCG 回退模式无需启用系统虚拟化组件。

```powershell
npm ci
npm run setup
npm run build
npm start
```

打开 **http://127.0.0.1:7337**，点击「创建发行版」。默认 2 vCPU、512 MiB 内存、8 GiB 增量磁盘及自动加速模式，首次启动自动配置网络和独立 SSH 密钥。系统就绪后终端自动连接。

`setup` 将固定版本的 PosixLoom、QEMU 和 Alpine 下载到项目目录，不修改系统 PATH、注册表或 WSL。下载需要网络；镜像与 QEMU 会校验 SHA-512。之后常规启停可离线使用。Windows 下会提取便携 QEMU；已有安装可以设置 `SAKURA_QEMU_DIR` 指向同时包含 `qemu-system-x86_64.exe`、`qemu-img.exe` 的目录。

开发模式：`npm run dev`（同一端口，Vite HMR）。关闭浏览器不会停止虚拟机；退出后台服务会先尝试关闭虚拟机。不要同时启动两个使用相同数据目录的服务。

## 启动性能

新实例默认选择「自动」加速：服务启动时通过一台暂停且不挂载磁盘的临时虚拟机检查 WHPX，主机已支持时使用硬件加速，否则使用 TCG。不会启用 Windows 功能或要求重启主机。已有实例保留原来的加速选项；停机后可在「配置」中切换为「自动」。运行时卡片显示实际使用的 TCG / WHPX。

新 Alpine 实例通过 NoCloud 直接配置独立 NAT 网络（`10.0.2.15/24`，网关 `10.0.2.2`，DNS `10.0.2.3`），省去 DHCP 等待。QEMU 只创建需要的设备，并提供 VirtIO 随机数设备。首次初始化后，Alpine 默认引导菜单等待由 10 秒缩短为 1 秒，chronyd 改为异步启动，并移除只负责一次性配置的 Tiny Cloud 启动钩子；后续启动可直接进入网络和 SSH。官方基础镜像保持原样，首次开机仍包含其 10 秒等待。

旧实例首次使用新版启动时，会在初始化完成后迁移仍为官方默认值的引导和网络配置，并移除已完成的一次性 Tiny Cloud 启动钩子，下次启动生效。原文件备份在客户机相同目录下的 `*.sakura-backup`；自定义配置及符号链接会保留。需要自行管理这些设置时，在客户机创建 `/etc/sakura/keep-boot-config`，即可停止后续配置迁移，并按需从备份恢复。

Windows 的 TCG 使用单线程和自动指令时钟，处理本机测试中出现的早期 IO-APIC 定时器崩溃；其多个虚拟 CPU 共享一个模拟线程，多核计算吞吐量会受到限制。其他主机继续使用多线程 TCG。相关时钟行为见 [QEMU 的 icount 说明](https://www.qemu.org/docs/master/system/invocation.html)。

“运行中”表示已通过 SSH 执行初始化完成检查；界面会即时接收状态变化，CLI 的检测间隔为 250 毫秒。启动检测以 270 秒为总时间预算，停止实例会取消检测，内核崩溃会立即显示错误。

本机 WHPX 实测首启约 22–25 秒，后续启动约 6–7 秒；测量条件、TCG 回退的取舍及验证记录见 [启动性能验证](docs/boot-performance.md)。

## 已实现

- **开发工作台与安全维护**：Git、多文件代码编辑器、Ctrl / ⌘ + K 命令面板、开发工具与网络管理、服务持续健康检查、Windows 私密配置、Docker / Compose、数据目录迁移、加密和外部目录备份。入口、CLI 与验证方法见 [开发工作台说明](docs/development-workbench.md)。
- **工作区恢复与自动化**：会话恢复、多项目隔离、文件历史与回收站、流水线产物、远程 Git、运行时版本、代码检查、同步删除决策、任务事件和 QCOW2 磁盘整理。入口与 API 索引见 [工作区恢复与自动化](docs/development-next.md)。

- **能力中心**：集中管理实例计划启动/停止、空闲停止、资源历史与阈值告警、动态内存目标、资源预设、Linux 工作区搜索、apk/apt 软件包任务、测试与格式化开发任务、Git Worktree、数据库容器、端口发现、网络诊断和只读安全扫描；同时提供 50 项新能力路线图。入口与接口说明见 [能力中心](docs/feature-suite.md)。

- **扩展能力工作台**：登记并执行第二批 100 项虚拟机、存储、同步、开发、Git、质量、网络、安全、运维和集成功能；每项都有实时检查或便携适配器，宿主组件或外部服务不可用时会保留执行记录和明确原因。支持暂停/恢复运行中的实例，以及扩展能力的 CLI/API 操作。详见 [能力中心](docs/feature-suite.md#第二批-100-项扩展能力)。

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

新增管理功能的操作、配置示例和验证方式见 [工作空间管理](docs/workspace-management.md)。

## Linux 图形桌面（实验性）

创建实例或在停机后的「配置」中将内存设为至少 **1024 MiB**（建议 **2048 MiB**），启动后进入「桌面」标签，点击「安装并启用桌面」。安装会从对应发行版的官方软件仓库下载 KDE Plasma、TigerVNC、Dolphin、Konsole 和中文字体，需要联网及数百 MiB 磁盘空间，页面会显示进度和失败信息；失败后可重试。

安装完成后自动连接桌面，重启实例时桌面服务也会自动启动。浏览器关闭或切换标签后，客户机中的桌面会话继续运行，再次打开即可连接。短暂断线会自动重连，最多尝试 5 次；认证失败会停止重试并显示提示，也可手动点击「重新连接」。支持鼠标、键盘、自适应分辨率和全屏；浏览器保留的系统快捷键仍由浏览器处理。

桌面以独立的普通用户 `sakura-desktop` 运行，文件保存在 `/home/sakura-desktop`；原有 SSH 终端继续使用 root。桌面使用 noVNC，经已有鉴权的 WebSocket 和 SSH 隧道连接客户机回环地址，无需添加 VNC 端口转发。图形组件保存在该实例的增量磁盘中，可随离线快照恢复；恢复安装前的快照后，需要重新安装。

提供 Alpine / Debian / Ubuntu 的 KDE Plasma 软件渲染桌面；Alpine 在 TigerVNC 的 X11 画布中运行嵌套 KWin/Wayland，Debian / Ubuntu 使用发行版可用的 Plasma 会话入口。桌面支持文本剪贴板互通和可选中文输入法；「外观与布局」支持分辨率、缩放、主题、壁纸、强调色、面板位置、自动隐藏和动画偏好，配置写入实例并在重启后恢复。仍不包含 GPU/3D 加速、声音转发和 WSLg 的单应用窗口集成。TCG 下桌面响应较慢，建议使用可用的硬件加速。Alpine 客户机诊断命令：`rc-service sakura-desktop status`；Debian / Ubuntu 使用 `systemctl status sakura-desktop`，日志：`/var/log/sakura-desktop.log`。安装中断后如提示锁仍被占用，请等待原安装结束或重启实例后重试。

已修复并发连接时短暂拒绝连接导致的直接失败，并加入桌面自动重连、显式网卡 MSI-X 配置。此前本机 WHPX 曾出现 SSH 与桌面同时长时间失联，本轮未复现该现象，仍不能认定其根因已解决；详细验证与限制见 [图形桌面验证记录](docs/linux-desktop.md)。

## 界面与快捷操作

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
```

`shell` 和 `exec` 会按需启动发行版。命令在 Linux 内执行，不会送入 Windows Shell。

## 结构与数据

```text
src/                    React + xterm.js 控制台
server/index.ts         HTTP / WebSocket、鉴权、静态服务
server/runtime.ts       PosixLoom 原生命令插件，精确 argv 调用 QEMU
server/machines.ts      发行版生命周期、SSH / SFTP、快照
server/seed.ts          本地 NoCloud ISO 与每实例 SSH 密钥
server/desktop.ts       图形桌面安装状态与 SSH / WebSocket 转发
server/desktop-guest.ts KDE Plasma / Fcitx5 安装、OpenRC 与 systemd 会话脚本
server/features.ts      文件、项目、资源、同步、镜像与迁移 API
server/workspaces.ts    模板安装、项目任务与客户机采样
server/sync.ts          Windows / Linux 目录同步与冲突检测
server/bundles.ts       独立磁盘导入导出与克隆
server/qmp.ts           QEMU Machine Protocol
scripts/setup.mjs       固定版本的运行时准备
scripts/cli.mjs         WSL 风格命令行入口
.vendor/posixloom/      固定到 92688083ff25d98f44194356f9ec93df0f1f0027
.tools/qemu/            便携 QEMU
.data/images/           只读基础镜像
.data/machines/<id>/    增量磁盘、NoCloud 种子、私有 SSH 密钥
.data/machines.json     发行版与快照元数据
```

调用链：`Web/CLI → 本地 API → PosixLoom Service → Rust Native Host / Job Object → QEMU → Linux`。SSH 仅连接到 QEMU 分配的本机随机端口，默认不对外开放 SSH，不生成共享密码。浏览器获得的是短期服务访问凭证，不会收到实例 SSH 私钥。

可在「系统设置 → 数据目录迁移」执行停机复制、校验与路径修复，重启服务后切换到新目录。手动备份时先停止服务，再复制整个数据目录。增量磁盘依赖基础镜像：**不要单独删除或移动 `.data/images`**。手动移动项目后仍需修复 backing 路径，且基础镜像必须保持相同内容，详见 [迁移说明](docs/development-workbench.md#数据目录迁移)。

可配置环境变量：`SAKURA_PORT`（默认 7337）、`SAKURA_DATA_DIR`、`SAKURA_QEMU_DIR`，以及可选的 `SAKURA_IMAGE_DIR`、`SAKURA_IMAGE_PATH`。WHPX 需要用户已在 Windows 中启用 Windows Hypervisor Platform；本项目不会修改系统功能或重启主机。自动模式在 WHPX 不可用时使用 TCG。

## 当前范围

- 支持 Alpine Linux 3.23.4、Debian 12、Ubuntu 24.04 的官方 x86_64 云镜像；目录互通采用双向同步。提供常用开发工具安装，尚未提供通用镜像格式导入、完整发行版包管理界面、WSLg、Windows 驱动器直接挂载、基于压力的自动内存回收和跨系统进程互操作。
- TCG 是软件模拟。自动模式会检测本机是否能使用 WHPX；其他主机的启动时间和兼容性仍取决于硬件及系统配置。内存限制是 QEMU 配额，Web 的「已分配内存」不是客户机实时使用量。
- 快照只包含磁盘，不保存 RAM 或运行中的进程。恢复会覆盖快照之后的数据。
- TCP 转发仅监听 `127.0.0.1`；客户机使用 NAT 上网。此版本面向受信任的本机开发，不是公网多用户管理平台，也不宣称防御恶意客户机。
- 停机先执行 `sync; poweroff` / QMP ACPI，等待 15 秒后通过 PosixLoom 取消进程树；超时强制关闭可能丢失未写入的数据。宿主机重启后发行版保持停止状态，不自动恢复进程。
- PosixLoom 的单命令超时上限约 24.8 天，也限制本版单次 VM 连续运行时长。
- 文件面板支持二进制传输；文本预览/编辑仍有 1 MiB 限制。TTY 使用 SSH PTY，串口页面用于启动日志。

## 验证

```powershell
npm test             # 输入边界、ISO、生命周期与 QMP 测试
npm run build        # TypeScript + 生产构建
npm run test:features # 新功能真实 VM 集成测试（需联网安装模板）
npm run test:vm      # 真实 QEMU 启动计时、SSH/SFTP、NAT 转发、重启、快照与旧配置迁移
```

真实 VM 测试需要先完成 `setup`；测试实例及其磁盘会在结束时删除。

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
