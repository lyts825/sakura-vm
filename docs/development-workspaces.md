# 开发工作区与数据互通

## 创建与开发

在「镜像库」下载 Debian 12 或 Ubuntu 24.04，下载完成后会验证官方 SHA-512 / SHA-256 清单，并保存来源与校验值。Alpine 继续由 `npm run setup` 准备。镜像下载失败可以重试；已存在的基础镜像不会被覆盖。

「创建发行版」可选择 Alpine、Debian、Ubuntu，以及 Node.js、Python、Rust 模板。模板从发行版官方软件仓库安装工具，同时提供 Git 和 tmux；首次安装需要网络，版本跟随所选发行版的软件仓库。Debian / Ubuntu 至少分配 1024 MiB 内存和 4 GiB 磁盘。

在实例的「项目」中保存：

- Linux 项目目录、可选 HTTPS Git 仓库。
- 开发模板、初始化命令、启动命令。
- Windows 预览端口，对应转发规则在「服务」中设置。

「启动开发」会按需启动 Linux，准备缺失的工具和仓库，执行尚未完成的初始化，然后在 tmux 会话内运行启动命令。「准备环境」会重新执行初始化命令；自定义命令应可重复执行。命令在 Linux 内以终端相同的 root 用户运行。任务提供状态、最近 32 KiB 日志和错误信息；失败后可重试。

修改启动命令或预览端口不会重新执行已经完成的初始化；目录、模板、仓库或初始化命令改变后，下次启动才重新准备。项目已经运行时，再次点击「启动开发」会保留现有进程。应用新的启动配置需要先停止项目。

项目配置存储在实例目录的 `project.json`，会随克隆和导入导出迁移。停止项目结束它的 tmux 会话；关闭浏览器保持项目运行。虚拟机重启后需再次启动项目。应用应以前台模式运行，并监听 `0.0.0.0` 或客户机网卡地址。

## 多终端与桌面

每个实例最多打开 8 个终端标签，支持双击重命名、双栏分屏。标签保存在当前浏览器；安装开发模板或点击「安装终端会话恢复支持」后，新连接使用 tmux，刷新网页后可重新连接原会话。安装 tmux 前已经打开的终端需要重新连接一次。关闭标签会结束对应会话；客户机重启不保留运行中的进程。

桌面工具栏的「剪贴板」提供发送文本到 Linux、接收 Linux 复制文本和复制到 Windows 的操作。包含中文的文本可双向传输，浏览器的剪贴板权限与用户手势要求仍然适用。

「中文输入法」安装 Fcitx 5 与拼音组件，随后重启 KDE Plasma；先保存桌面中的工作。使用 `Ctrl+Space` 切换输入法。安装脚本为已有用户保留输入法配置，失败可重试。

Alpine 使用 OpenRC 桌面服务，Debian / Ubuntu 使用 systemd 桌面服务；后者诊断命令为 `systemctl status sakura-desktop`。桌面仍以 `sakura-desktop` 普通用户运行，仅通过原有鉴权 WebSocket / SSH 隧道访问。

## 文件与 Windows 目录

「文件」支持多文件选择或拖拽上传、下载任意类型的普通文件、创建文本文件与文件夹、重命名和删除。传输上限为单文件 2 GiB，文本编辑仍为 1 MiB。上传先写临时文件，成功后才替换目标；覆盖同名文件需要勾选。删除非空文件夹需输入名称确认，目录中的符号链接只删除链接本身，单次最多处理 20000 个条目。

文本编辑只接受有效的 UTF-8 内容，1 MiB 限制按编码后的字节数计算。新建文本文件遇到同名文件会报错并保留原文件；编辑保存也先写临时文件，写入成功后才替换，失败时保留原内容。编辑保存和覆盖上传均保留原文件的所有者、用户组与权限。非 UTF-8 文件仍可直接下载。

批量上传显示文件序号和总字节进度；取消会终止当前文件及后续队列，已经完成的文件保留。全部文件会先检查大小，避免上传到一半才发现后面的文件超限。取消或失败后自动刷新列表，清理传输状态。

下载与实例导出由浏览器直接接收文件流，网页不再预先缓存整个文件。可在浏览器下载列表查看进度和取消；下载中断后重新点击下载，目前不支持断点续传。取消导出也会中止磁盘准备工作。

「同步」输入现有 Windows 文件夹的绝对路径与 Linux 目录，保存后可手动双向同步或每 15 秒自动同步。这是两份目录的文件同步，不是实时文件系统挂载：

- 使用内容散列比较文件。两侧同时修改会报告冲突并保留原文件，可明确选择以 Windows 或 Linux 为准。
- 删除不传播；一侧删除的文件可能从另一侧重新出现。
- 保留空目录；跳过符号链接、目录联接、`.git`、`node_modules`、`.data`、`.tools`、`.vendor` 和 `.sakura-` 临时文件。
- 单文件上限 256 MiB，每轮最多扫描 20000 个条目；不保留 Linux 所有者及 Windows ACL 的对应关系。
- Linux 文件名必须能安全映射到 Windows，拒绝设备名、路径穿越、数据流、含控制字符的名称和仅大小写不同的冲突路径。
- 同步配置保存在本机，不会随克隆和导出复制，以免新实例自动写入原宿主目录。

## 资源与服务

「资源」每 5 秒采样客户机 CPU、可用内存、根分区使用量、运行时间以及内存占用最高的进程。CPU 通过 `/proc/stat` 两次采样计算，曲线显示最近 30 次结果；此数据与首页的资源分配配额不同。

网页在后台时暂停项目、资源、服务、同步状态和镜像列表的新轮询，回到前台后立即刷新。页面切换会取消尚未完成的状态请求，后台项目与同步任务继续运行。

「服务」支持规则命名、查看客户机监听端口、一键打开网页和运行中更新 TCP 转发。更新使用 QEMU 控制接口，失败时尝试恢复原规则；映射仍仅监听 `127.0.0.1`。监听状态并不保证应用协议或健康检查成功。

## 快照、克隆与迁移

在停机后的「快照」标签创建、删除恢复点，修改名称与备注。恢复时默认先保存当前状态，需要预留一个快照名额。磁盘操作期间会阻止同实例的启动和其他磁盘操作。

可以克隆当前磁盘或某个快照。导出 `.sakura` 文件包含独立 QCOW2 磁盘、资源配置、项目配置和连接凭证，带有磁盘 SHA-256 校验；无需原基础镜像即可导入。只保存所选时刻的磁盘，不包括快照历史、RAM 或正在运行的进程。导入导出文件当前最大 32 GiB；大文件可通过 CLI 流式传输。

克隆与导入生成新的实例 ID，清空端口转发，并在首次启动时更新控制连接密钥和主机名。导出包含私有数据与连接凭证，请只导入自己信任的文件，并妥善保存导出包。镜像库还可单独导入 RAW、独立单文件 VMDK、VHDX 或含一个 VMDK 的 OVA 云镜像；它们不会按 Sakura 备份恢复原有连接凭证，而是使用新的 NoCloud 身份首次启动。源客户机须支持 NoCloud/Tiny Cloud 初始化和所选发行版的启动流程。镜像上传上限为 8 GiB，虚拟磁盘最大 128 GiB；低于发行版最低容量的源磁盘自动扩容并标记待扩展客户机文件系统。可提交预期 SHA-256，在转换前校验上传文件。外部基础磁盘、多磁盘 OVA 和加密磁盘不属于受支持格式。

创建实例、修改停止中的实例配置或导入镜像时，可选择 BIOS 或 UEFI/OVMF 启动固件。UEFI 需要 QEMU 安装目录中的 x86_64 OVMF 代码和变量模板；Sakura 在首次启动时为每个实例创建独立的持久 NVRAM。修改固件不会改写磁盘分区或安装引导程序，因此现有磁盘必须自行具备所选模式的启动环境。Sakura 实例包当前不携带 UEFI NVRAM；从包恢复或克隆后会按模板重新生成固件变量，依赖自定义启动项的系统需在客户机中重新登记。

## 命令行示例

```powershell
npm run sakura -- images
npm run sakura -- image debian
npm run sakura -- create app-dev debian python
npm run sakura -- project app-dev configure project.json
npm run sakura -- project app-dev start
npm run sakura -- metrics app-dev
npm run sakura -- sync app-dev configure sync.json
npm run sakura -- sync app-dev both
npm run sakura -- stop app-dev
npm run sakura -- snapshot app-dev before-update
npm run sakura -- clone app-dev app-copy
npm run sakura -- export app-dev app-dev.sakura
npm run sakura -- import app-restored app-dev.sakura
```

`project.json` 示例：

```json
{
  "directory": "/workspace/app",
  "template": "python",
  "repository": "",
  "setup": "printf 'Hello Sakura' > index.html",
  "command": "python3 -m http.server 8080 --bind 0.0.0.0",
  "previewPort": 18080
}
```

`sync.json` 示例：

```json
{ "host": "D:\\Projects\\app", "guest": "/workspace/app", "auto": false }
```

镜像准备命令在后台执行，可在镜像库查看进度；`project` 与 `sync` 的 CLI 操作会跟随任务日志直到完成。

## 验证

```powershell
npm test
npm run build
npm run test:vm
npm run test:features
```

新增集成测试使用临时数据目录和专用实例，覆盖二进制传输、中断保留原文件、符号链接删除边界、实时监控、端口热更新、项目安装/启动/停止、同步与冲突、快照备份/删除、克隆身份更新和独立导入导出。默认会安装 Python 模板，需要联网。

`SAKURA_TEST_TEMPLATES=1` 追加 Node.js / Rust 模板；`SAKURA_TEST_DISTROS=1` 追加 Debian / Ubuntu 启动与重启验证，需要先在镜像库下载对应镜像。`SAKURA_TEST_DISTROS_ONLY=1` 只跑额外发行版；`SAKURA_TEST_DISTRO=debian` 或 `ubuntu` 选择一个发行版；`SAKURA_TEST_DISTRO_DESKTOP=1` 追加其 KDE Plasma 与中文输入安装。

独立测试服务可通过 `SAKURA_IMAGE_DIR` 复用 Debian / Ubuntu 基础镜像目录，`SAKURA_IMAGE_PATH` 指向 Alpine 基础镜像；实例数据仍由 `SAKURA_DATA_DIR` 隔离。

### 2026-09-21 本机验证记录

在 Windows x64 / WHPX 上使用独立测试数据目录完成以下验证：

| 检查                           | 结果                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 自动化测试、类型检查、生产构建 | 38 项测试通过；严格未使用项检查、生产构建和 Git 空白检查通过                                                           |
| 原有虚拟机回归                 | SSH、SFTP、NAT、重启、快照及旧配置迁移通过                                                                             |
| 新功能真实虚拟机回归           | 二进制传输、中断保留原文件、目录删除、实时采样、端口热更新、项目启动/停止通过                                          |
| Windows 目录同步               | 双向复制、空目录、双侧修改冲突、大小写冲突拦截、显式解决冲突通过                                                       |
| 快照与迁移                     | 恢复前备份、删除、克隆身份更新与重启、独立导出/导入及项目配置保留通过                                                  |
| 开发模板                       | Alpine 中 Node.js、Python、Rust 安装及版本检查通过；下载添加超时和有限重试                                             |
| Debian / Ubuntu                | 官方镜像校验、首次启动、重启持久化、KDE Plasma 安装、Fcitx5 安装与进程启动通过                                               |
| 浏览器交互                     | 多终端及分屏、项目启动、服务状态、资源图表、文件/同步/镜像入口通过；中文文本剪贴板双向传输及终端断开后恢复环境变量通过 |

验证不代表长期稳定性或所有硬件兼容性。中文输入法验证覆盖安装、配置及进程启动，未穷举各图形应用的输入行为。

本次优化回归：50 项自动化测试、严格类型检查、生产构建和真实虚拟机功能测试通过。新增验证覆盖一次性下载链接的有效期、重放拒绝、目标绑定、断线取消、停服等待清理，整批上传取消与重试，以及跨重启采样缓存。隔离浏览器实测完成 128 MiB 文件上传、取消覆盖上传后原文件保留且后续文件未上传、原生下载事件和无控制台错误；HTTP 实测核对二进制 SHA-256，并验证未鉴权与跨源请求被拒绝。

官方资料：[Debian 云镜像](https://cloud.debian.org/images/cloud/bookworm/latest/)、[Ubuntu 云镜像](https://cloud-images.ubuntu.com/noble/current/)、[NoCloud](https://docs.cloud-init.io/en/latest/reference/datasources/nocloud.html)、[noVNC 剪贴板 API](https://novnc.com/noVNC/docs/API.html)。
