# Sakura

参考 WSL 交互方式的本地 Linux 工作空间：通过 Web 或命令行创建发行版、启动终端、编辑文件和管理磁盘快照。

**真正运行 Linux 内核。** [PosixLoom](https://github.com/lyts825/posixloom) 负责命令编排、会话与 Windows 进程树管理，[QEMU](https://www.qemu.org/) 负责虚拟化。当前不是 WSL 的替代实现，也不依赖现有的 WSL 发行版。

## 快速启动

目前验证的平台：Windows x64、Node.js 22+、Git、Rust stable（需要 MSVC C++ 构建工具）。无需管理员权限或安装 WSL。默认 TCG 模式无需启用系统虚拟化组件。

```powershell
npm ci
npm run setup
npm run build
npm start
```

打开 **http://127.0.0.1:7337**，点击「创建发行版」。默认 2 vCPU、512 MiB 内存、8 GiB 增量磁盘，首次启动自动配置网络和独立 SSH 密钥。系统就绪后终端自动连接。

`setup` 将固定版本的 PosixLoom、QEMU 和 Alpine 下载到项目目录，不修改系统 PATH、注册表或 WSL。下载需要网络；镜像与 QEMU 会校验 SHA-512。之后常规启停可离线使用。Windows 下会提取便携 QEMU；已有安装可以设置 `SAKURA_QEMU_DIR` 指向同时包含 `qemu-system-x86_64.exe`、`qemu-img.exe` 的目录。

开发模式：`npm run dev`（同一端口，Vite HMR）。关闭浏览器不会停止虚拟机；退出后台服务会先尝试关闭虚拟机。不要同时启动两个使用相同数据目录的服务。

## 已实现

- 创建、启动、正常关机、删除多个独立 Alpine Linux 发行版。
- 每实例独立 QCOW2 增量磁盘，完整 Linux 文件系统在重启后保留。
- 浏览器 SSH 交互终端：颜色、Ctrl+C、窗口缩放、多终端连接；启动时显示串口日志。
- SFTP 文件目录浏览，1 MiB 内文本预览、编辑和上传。
- 离线磁盘快照及恢复；运行中禁止快照、恢复、删除和修改资源。
- CPU、内存、TCG / WHPX 与本机 TCP 端口转发配置。
- 单机控制服务、随机访问凭证、同源及 Host 检查，管理端口和 QEMU 控制端口仅监听回环地址。
- 同时最多运行 4 个实例，最多 32 个发行版、每实例 20 个快照；日志保留最近 128 KiB。

## 界面与快捷操作

- 右上角切换「花昼 / 夜樱」主题，选择保存在当前浏览器中。
- 发行版右上角的展开按钮进入专注模式，为终端和文件操作留出更多空间；再次点击可退出。
- 在工作空间按 `/` 聚焦发行版搜索；输入框和终端中的按键不会被截获。
- 终端、文件、快照、配置标签支持左右方向键切换，以及 Home / End 跳转。
- 窄屏自动使用顶部导航和横向发行版列表，系统的减少动态效果偏好也会生效。

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

备份时先停止服务，再复制整个 `.data`。增量磁盘依赖基础镜像：**不要单独删除或移动 `.data/images`**。文件中的 backing 路径为绝对路径；移动项目后需使用 `qemu-img rebase -u -b <新基础镜像绝对路径> -F qcow2 <增量磁盘>` 更新引用，且基础镜像必须是原来相同的文件。

可配置环境变量：`SAKURA_PORT`（默认 7337）、`SAKURA_DATA_DIR`、`SAKURA_QEMU_DIR`。WHPX 需要用户已在 Windows 中启用 Windows Hypervisor Platform；本项目不会修改系统功能或重启主机。未启用时选择 TCG。

## 当前范围

- 内置 Alpine Linux 3.23.4 x86_64 官方 Tiny Cloud 镜像；尚未提供 Ubuntu / Debian 导入、发行版包管理界面、WSLg、Windows 驱动器自动挂载、自动内存回收和跨系统进程互操作。
- TCG 是软件模拟。WHPX 配置入口已实现，但需要在启用 WHPX 的主机上另行验证。内存限制是 QEMU 配额，Web 的「已分配内存」不是客户机实时使用量。
- 快照只包含磁盘，不保存 RAM 或运行中的进程。恢复会覆盖快照之后的数据。
- TCP 转发仅监听 `127.0.0.1`；客户机使用 NAT 上网。此版本面向受信任的本机开发，不是公网多用户管理平台，也不宣称防御恶意客户机。
- 停机先执行 `sync; poweroff` / QMP ACPI，等待 15 秒后通过 PosixLoom 取消进程树；超时强制关闭可能丢失未写入的数据。宿主机重启后发行版保持停止状态，不自动恢复进程。
- PosixLoom 的单命令超时上限约 24.8 天，也限制本版单次 VM 连续运行时长。
- 文件面板只处理文本，不提供二进制传输和 Windows 目录映射。TTY 使用 SSH PTY，串口页面用于启动日志。

## 验证

```powershell
npm test             # 输入边界、ISO、生命周期与 QMP 测试
npm run build        # TypeScript + 生产构建
npm run test:vm      # 真实 QEMU 启动、SSH/SFTP、重启持久化、快照恢复
```

真实 VM 测试需要先完成 `setup`；测试实例及其磁盘会在结束时删除。

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

Sakura 代码采用 MIT 许可。PosixLoom 为 MIT；QEMU 为 GPL-2.0；Alpine 包各自遵循上游许可。运行时与镜像不作为本项目源码提交，`setup` 从原始发布站下载。再分发二进制时应同时履行各组件许可义务。

- [PosixLoom SDK 与架构](https://github.com/lyts825/posixloom)
- [QEMU Windows 构建](https://qemu.weilnetz.de/w64/)
- [QEMU WHPX 文档](https://www.qemu.org/docs/master/system/whpx.html)
- [Alpine 官方云镜像](https://www.alpinelinux.org/cloud/)
- [Alpine Tiny Cloud](https://gitlab.alpinelinux.org/alpine/cloud/tiny-cloud)
