# 项目运行时版本

启用 `runtimes` 插件后，在“开发 → 版本”选择 Node.js、Python 的精确三段版本。没有选择某个工具时显示“未指定”，实际版本仍取决于项目环境中的 `PATH`。应用或清除版本选择只修改项目选择，不删除运行时或版本声明文件。

## 读取与探测

打开面板、刷新页面以及十秒轮询只读取宿主配置和最近完成的采样，不连接客户机、安装工具或发行账号票据。首次读取、服务重启或采样淘汰后显示“尚未探测”；点击“探测项目版本”才运行一次任务。缓存最多保存 256 个项目样本，五分钟、配置变化或宿主登记的实例变化后显示过期；这些缓存限制与客户机每 boot 的 1,024 张保留票据无关，不删除或重新发行旧票据。

采样包括版本、版本声明、时间、配置摘要和采样时的 boot ID。它记录一次已完成的结果，不能证明之后的文件、环境或客户机 boot 一直未变，也不能代替版本选择的实际验证。没有完成的样本不会显示版本匹配；过期或失败后需明确重试。

固定 helper 在项目 UID/GID、独立 home、已核对目录和项目网络内执行；补充组、capabilities 与新权限被固定启动器清除。项目环境和正文使用既有受保护运输，包括网络环境、项目环境、私密配置及当前版本覆盖；宿主只缓存解析后的版号和声明，不缓存程序原始输出或密钥。任务域清理与准确票据核销完成后，才发布成功样本。

`.nvmrc` 优先于 `.node-version`，Python 读取 `.python-version`；支持 major、major.minor、完整三段声明，选择的精确版本优先参与匹配。只允许普通文件，使用 no-follow、nonblocking FD 和前后文件身份核对，每份最多 4 KiB；链接、FIFO、无效 UTF-8、NUL、超限或读取失败明确报告。只将不存在视为可选文件缺失。Node/Python 的单次版本命令各有四秒期限、stdout/stderr 各 4 KiB 预算，只接受严格单行版本格式；探测任务总期限十五秒。脱离会话或留下管道的后代仍由完整任务域清理，清理未确认保留原票据和失败。

## 选择与并发修改

“应用到项目”先固定项目、实例 live 和配置摘要，在项目 UID 下执行所选绝对路径并严格核对版号；新候选环境不会继承旧选择额外加入的 `PATH` 或 `VIRTUAL_ENV`。验证完成后释放 VM 锁，再以原配置摘要调用保存；保存锁内在异步检查和临时文件写入后重新核对实例、项目、取消状态和服务关闭状态。配置、实例或归属变化返回冲突，不覆盖更新后的配置。已原子提交的配置不会因随后断开连接而自动回滚。

选择和显式探测都收到请求取消信号。取消、清理 503 或未确认回执不会作为成功样本发布；清理失败保持具体错误码。安装中的运行时不能凭采样缓存变成可选择版本。

## 安装边界

安装是实例管理员操作，会联网下载并修改 `/opt/sakura-runtimes`；它不加载项目密钥或项目可执行 `PATH`。Node 官方 Linux 包用于 Debian/Ubuntu，按实例配置选择 x64 或 arm64，并核对客户机实际架构；Alpine 继续使用发行版 Node。Python 使用固定 `uv==0.10.11` 的 managed interpreter 与 relocatable venv；固定版本的实现支持 relocatable 参数，创建环境仍查询解释器，因此这部分属于 root 管理员安装，不能宣称整个安装过程都是项目 UID。[固定 uv 源码](https://raw.githubusercontent.com/astral-sh/uv/0.10.11/crates/uv/src/commands/venv.rs)、[uv 参数说明](https://docs.astral.sh/uv/reference/cli/#uv-venv)。

Alpine 的管理员安装依赖包含官方 `coreutils`，使固定 uv 生成的启动脚本可使用 `realpath --`；仅有 BusyBox 的环境会产生错误输出。重复明确安装请求也先核对和补齐系统依赖，再复用已核对的 ready 产物，不重写其脚本或回执。[Alpine 包定义](https://raw.githubusercontent.com/alpinelinux/aports/3.22-stable/main/coreutils/APKBUILD)。

安装状态、锁和回执保存在 root 独占目录。核对路径属主、权限、实际类型及合法链接的固定目标；已有未知目录、错误属主、项目可写路径和没有完整回执的半成品均拒绝，不因目录存在就执行其中的 binary。私有 stage 构建后先保存 prepared 回执，完整任务清理完成后再独立确认为 ready；probe/select 对已选择版本先只读核对 ready 回执，不以旧缓存或 `[ -d ]` 代替。旧版本留下的未登记目录不会被自动接管或删除；可清除项目版本选择，或由管理员审阅旧目录后处理，再安装受管版本。安装下载只接收固定白名单中的网络配置；代理和索引地址不得携带凭证、查询参数或片段。

每次 Python 安装使用 `/opt/sakura-runtimes/python-managed-<installId>` 的独占持久解释器目录，在内部回执登记准确设备与 inode；构建期间顶层保持 `0700`。只对本次创建且仍处于准确私有目录内的新产物，先有界核对整个树的 root 属主、类型、链接与硬链接归属，再按 no-follow FD 和原 inode 规范目录 `0755`、普通文件 `0644` 或可执行文件 `0755`。这也处理固定下载器创建的锁文件权限和私有任务的 umask。venv 使用复制方式安装依赖，不依赖随后删除的 stage 缓存。完整任务结束后核对解释器目录原身份，开放为 `0755` 并保存 ready；成功回执保留该解释器目录，版本环境的链接只允许指向它或准确产物内部。只读验证不会规范权限，也不扫描、修复或复用旧共享 `python-downloads`。

中断恢复只处理准确原安装、原 task/boot 与已登记 stage、解释器目录和 destination inode；先核对所有归属，再删除本次未完成产物。不能确认清理时保留记录，并以 `RUNTIME_INSTALL_CLEANUP_FAILED` 记为持久失败，即使同时收到取消也不能改记为普通取消。管理员安装时的系统包管理、下载和解释器查询仍是明确的 root 边界。架构支持与实际测试范围分开记录；x86_64 的验证不能代替真实 ARM 客户机安装。

## API 与 CLI

`GET /api/vms/:id/runtimes?project=:projectId` 返回只读配置和缓存。`POST` 支持严格请求：

```json
{"action":"probe"}
{"action":"select","node":"22.12.0","python":"3.12.0"}
{"action":"select"}
{"action":"install","tool":"node","version":"22.12.0"}
```

空 `select` 清除全部版本选择；安装返回 202 任务，其余成功操作返回 200。采样状态为 `unprobed`、`cached`、`stale`、`running`、`failed`，并返回 `checkedAt/configVersion/bootId`，失败可带固定 `errorCode`。账户模式的该接口仍只对 owner 开放；本轮没有扩展成员权限。

```text
npm run sakura -- runtimes my-dev inspect
npm run sakura -- runtimes my-dev probe
npm run sakura -- runtimes my-dev select runtime.json
npm run sakura -- runtimes my-dev install node 22.12.0
```

CLI `inspect` 同样只读取缓存，`probe` 明确执行探测；CLI 使用已保存的活动项目。真实验证与限制按批次记录在 [功能实现记录](capability-completion.md) 中。
