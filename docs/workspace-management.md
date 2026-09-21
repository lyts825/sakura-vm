# 工作空间管理

本轮新增任务中心、编辑保护、同步预览、故障诊断、多服务项目、VS Code 接入、可分享的环境配置、磁盘扩容、自动备份和实例分组。网页与 CLI 共用同一组本地接口。

## 任务中心

侧栏「任务中心」集中显示镜像下载、项目环境准备/启停、目录同步、输入法安装、实例导出、备份和维护任务。可以按实例和状态筛选，查看执行阶段、进度（能确定总量时）、耗时和最近 32 KiB 日志，取消正在执行的操作，或重新执行支持重试的任务。

任务历史位于 `.data/jobs/`，各类任务保留最近 200 条，页面汇总最近 300 条。重启服务后，未结束任务标记为「已中断」，不会自动重放命令。已提交的后台任务不受页面切换影响；尚在等待开机或保存配置的前端流程仍会在离开项目面板时取消。

取消 Linux 安装、初始化或就绪检查时，会结束该任务的独立进程组，并等待清理。取消不会撤销已经完成的软件安装、文件同步或备份发布。磁盘元数据操作会完成当前原子步骤。清理完成后才记录终态。任务历史写入失败会在任务中心显示错误。

## 文件编辑保护

编辑器为每个实例保留一份浏览器本地草稿。切换功能、实例或页面前会询问是否保留草稿并离开；关闭编辑器或打开另一文件前会明确提示放弃/替换草稿。重新打开文件面板会恢复内容。清除浏览器数据也会清除草稿，存储容量不足时页面会提示保存失败。

支持 `Ctrl+S` / `⌘+S`。打开文件时获取 SHA-256 版本；保存时在写入前和原子替换前重新比较，检测外部修改或删除。冲突时显示服务器内容和当前草稿，可以采用服务器版本，或保留草稿继续合并后再保存。保存期间继续输入的文字不会被旧响应丢弃。

## 同步预览与冲突

在「同步」保存目录与忽略规则后，点击「预览双向同步」。预览只扫描，不创建目录、写入文件或更新同步状态。页面显示上传、下载、新建目录、冲突，以及相同文件数；路径筛选可定位大型目录中的文件。

每个冲突可选择 Windows 版本、Linux 版本、暂时跳过，或保留两份。保留两份会把 Linux 版本保存为 `原名.linux-conflict-随机标识`，并在两端保留该副本，原路径采用 Windows 版本。应用时重新扫描并核对预览令牌；任一文件、目录或配置发生变化，就拒绝旧预览并要求重新预览。

忽略规则每行一个，支持 `*` 和 `**`。例如 `*.log`、`dist`、`build/**`。固定排除 `.git`、`node_modules`、Sakura 数据目录、符号链接和目录联接；删除仍不传播。自动同步会跳过冲突，人工解决使用预览界面。

## 多服务项目

「项目」中可以添加最多 12 个命名服务，每个服务包括启动命令、依赖服务、可选就绪命令、5–300 秒超时和环境变量。启动按依赖拓扑排序，只有前置服务就绪后才启动后续服务。名称重复、未知依赖和循环依赖会在保存时拒绝。

每个服务具有独立 tmux 会话和日志，可以分别启停。启动失败或取消时清理本次新启动的服务，已经在运行的服务保留。仍有运行服务依赖某服务时，拒绝单独停止该服务；停止整个项目按依赖逆序执行。移除运行服务的配置前必须先停止它。

未配置多服务时，保留原有单启动命令行为。项目环境变量用于初始化和启动，服务变量覆盖同名项目变量。环境变量属于可分享的配置，会进入项目导出和备份，因此这里应保存非敏感配置。修改运行中的命令或环境后，停止并重新启动才会应用。

## VS Code 接入

Debian/Ubuntu 项目的「配置 VS Code 连接」会生成 `.data/ssh/config`，向用户 `~/.ssh/config` 添加独立 `Include`，并在修改前备份原文件。不会重写用户已有 Host 配置；重复点击不会重复添加 Include。

连接别名为 `sakura-实例名称`，端口随实例启动更新，使用已有的实例私钥和每实例独立 `known_hosts`。仅接受回环连接；SSH 保留主机密钥检查，首次使用 `accept-new`。停止时将端口置为不可用值，避免误连后续占用原端口的进程。页面提供 VS Code 打开链接和命令。

本机需安装 VS Code、Remote-SSH 扩展和 OpenSSH 客户端。Alpine 不在 [Remote-SSH 官方支持范围](https://code.visualstudio.com/docs/remote/linux) 内，页面会说明可用的发行版。

## sakura.json

在「项目 → 分享与导入项目环境」可下载当前配置、在项目目录新建 `sakura.json`，或读取仓库中已有的文件。写入项目目录不会覆盖已有配置文件。

在「实例管理 → 从 sakura.json 创建环境」导入文件或粘贴 JSON，可以按资源和项目配置创建新实例。创建不会自动运行文件内的命令。应用到现有实例更新项目配置，资源调整仍通过已有资源配置与扩容入口完成。

```json
{
  "version": 1,
  "resources": {
    "distro": "debian",
    "memoryMiB": 2048,
    "cpus": 2,
    "diskGiB": 16,
    "forwards": [{ "name": "web", "host": 8080, "guest": 3000 }]
  },
  "project": {
    "directory": "/workspace/app",
    "template": "node",
    "repository": "https://example.com/team/app.git",
    "setup": "npm ci",
    "environment": { "NODE_ENV": "development" },
    "services": [
      {
        "name": "api",
        "command": "npm run api",
        "ready": "curl -fsS http://127.0.0.1:4000/health",
        "timeout": 60
      },
      { "name": "web", "command": "npm run dev -- --host 0.0.0.0", "dependsOn": ["api"] }
    ],
    "previewPort": 8080
  }
}
```

初始化脚本需要自行安装就绪检查用到的工具（示例的 `curl`）。环境配置描述显式命令，不在 Windows 上执行导入文件中的命令。

## 故障诊断与空间管理

「维护 → 开始诊断」检查 WHPX 可用性、主机空间、SSH、DNS、HTTPS、Linux 根文件系统和端口配置，显示检查结果及针对性建议。停止的实例跳过 Linux 内部检查，并检查 Windows 端口是否被其他程序占用或禁止绑定。可以下载包含近期启动日志的脱敏 JSON 报告；报告去除常见密钥、凭证和 Windows 路径，诊断正文不采集项目文件。

空间管理显示基础镜像、每个实例（含内部快照）的磁盘文件大小、独立备份大小和所在卷的可用空间。主机剩余空间低于 10% 时提醒。内部快照共享磁盘块，不将每个快照虚构为独立占用量；见 [QEMU 快照说明](https://www.qemu.org/docs/master/system/images)。

停止实例后，可扩容至 128 GiB，扩容前自动创建恢复快照。下次启动会扩展 Linux 文件系统；失败保留待处理状态，可在维护页重试。支持官方镜像的 `/dev/vda` 整盘 ext 文件系统，以及 `/dev/vdaN` 上的 ext 分区。不会对 LVM、加密、XFS 或其他自定义布局猜测操作。分区工具来自发行版软件源，首次安装需要联网。

[QEMU 扩容](https://www.qemu.org/docs/master/tools/qemu-img.html) 与 Linux 分区/文件系统扩展是不同步骤。完成状态会核对根文件系统容量；恢复扩容前快照也会恢复对应的容量记录，克隆指定快照沿用其容量。

快照、克隆和独立备份同时保留待完成的文件系统扩容状态。扩容后尚未启动或扩展失败时创建的副本，恢复后仍会在下次启动继续扩展；已完成扩展的副本不会重复执行。旧格式快照与备份仍可读取，但无法补回其中未记录的待扩容状态。

## 自动备份

「快照 → 自动备份」设置启用、间隔（1–720 小时）、保留份数（1–30）及总容量（1–512 GiB）。后台每分钟检查一次；实例运行时延后，关机后执行。后台服务退出期间不会调度，重新启动后补做已到期备份。

备份为 `.data/backups/实例ID/备份ID.sakura` 的独立包，包含磁盘、项目配置和实例连接凭证。生成后校验磁盘内容，记录整包 SHA-256；新备份成功发布后才清理超出保留策略的旧备份。单包超过容量上限会报错并保留旧备份。沿用便携包的单包 32 GiB 限制。

列表支持重新校验、删除指定备份、恢复为新实例。恢复前先验证整包与磁盘校验值，再执行现有导入流程。不会覆盖当前实例。删除实例不会自动删除独立备份；保留下来的包可以通过镜像库或 CLI 导入恢复。

## 实例分组与 CLI

「实例管理」支持项目分组、标签、收藏、筛选、多选及批量启停，显示所选实例的 CPU/内存总需求。批量操作逐个返回结果，仍受同时运行 4 个实例的限制。工作空间搜索同时匹配名称、分组与标签，收藏实例优先显示。

```powershell
npm run sakura -- tasks
npm run sakura -- task <任务ID> cancel
npm run sakura -- storage
npm run sakura -- batch start dev-a dev-b
npm run sakura -- organize dev-a organization.json
npm run sakura -- project dev-a start api
npm run sakura -- diagnostics dev-a run
npm run sakura -- resize dev-a 32
npm run sakura -- backup dev-a configure policy.json
npm run sakura -- backup dev-a run
npm run sakura -- backups dev-a
npm run sakura -- backup dev-a restore <备份ID> restored-dev
npm run sakura -- ide dev-a configure
npm run sakura -- recipe dev-a read
npm run sakura -- from-recipe new-dev sakura.json
npm run sakura -- sync-preview dev-a
npm run sakura -- sync-apply dev-a decisions.json
```

`organization.json` 示例：`{"group":"web","tags":["dev"],"favorite":true}`。`policy.json` 示例：`{"enabled":true,"intervalHours":24,"keep":7,"maxGiB":32}`。`decisions.json` 包含预览返回的 `token` 和路径决策，例如 `{"token":"预览令牌","decisions":{"src/app.ts":"both"}}`。

## 验证

`npm test` 包含任务重启恢复、取消清理、服务依赖校验、环境配置边界、SSH 配置幂等性与端口更新、备份校验、草稿保存竞争、文本版本冲突、只读同步预览、过期预览拒绝、保留两份及扩容快照回退等回归测试。

`npm run test:management` 使用独立临时数据目录，验证真实 Alpine 文件版本保护、同步冲突、服务依赖/日志/环境、Linux 进程取消、诊断、QCOW2 与文件系统扩容、定时备份、保留策略、校验、恢复后启动和快照容量回退，并在 Debian/Ubuntu 上验证 SSH 配置与任务执行。测试结束关闭并删除测试实例。

`npm run test:features` 继续覆盖二进制传输、项目准备、双向同步、快照身份、克隆与导入导出。浏览器验证覆盖配置导入、分组、批量启动、任务历史、服务表单、草稿恢复、页面离开提示、快捷键保存和编辑冲突界面。
