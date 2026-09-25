# 能力中心

能力中心位于主导航的「能力中心」，对每个实例保存一份宿主机侧的自动化与观测设置，文件为数据目录中的 `feature-suite.json`。它不会写入实例磁盘，因此导出或克隆实例时不会把本机计划带到另一台主机。

启用 `automation` 后可使用能力中心的手动操作；计划启停、定期采样和阈值告警还需要启用 `automation-scheduler`。当前已实现的操作包括：

- 计划启动、计划停止和空闲停止；
- CPU、内存、磁盘历史采样与阈值告警；
- Linux 工作区内容搜索；
- 按目录查看客户机磁盘占用；
- apk / apt 软件包查询、安装、卸载和索引更新；
- 监听端口发现；
- DNS、HTTPS 和监听端口诊断；
- SSH 设置、待更新软件包和可写系统文件的只读安全检查；
- 任务中心中的软件包任务日志、取消和重试；
- 运行中的 virtio-balloon 动态内存目标；
- 停止实例后应用轻量命令行、日常开发、编译构建和图形桌面资源预设；
- 测试发现与执行、Lint、格式化、依赖报告、环境锁文件校验、按锁文件安装依赖和 Git Worktree 开发任务；
- 通过 Docker 创建带持久化数据卷和本机回环端口的 PostgreSQL、Redis 或 MySQL 开发服务（密码不会写入任务日志）。

服务端接口为：

```text
GET  /api/feature-suite
GET  /api/vms/:id/advanced
PUT  /api/vms/:id/advanced
POST /api/vms/:id/advanced
```

`POST` 的动作包括 `sample`、`memory-target`、`apply-preset`、`disk-analysis`、`dev`、`search`、`package`、`network-test`、`discover-ports`、`security-scan`、`feature-check`、`feature-run` 和 `acknowledge`。所有客户机命令都经过参数校验和单引号数据引用；软件包与开发任务走任务中心，不会占用 HTTP 请求直到命令结束。资源预设只修改实例配置，不会在运行中的实例上强制关机。

能力中心同时展示 50 项路线图。目录中的「已有入口」说明相关操作存在于对应模块，不代表当前实例已具备依赖；规划中的项目不会被标为可用。通用 `feature-check` / `feature-run` 只记录目录和基础环境信息，返回 `ready: false`、`executed: false`，请通过对应插件的实际操作检查或执行能力。需要宿主机驱动、QEMU 设备或多用户认证的项目也不会因生成了本地记录就标为就绪。

## 第二批 100 项扩展能力

第二批能力通过统一的扩展能力接口登记。目录不等于实现：有实际宿主或客户机操作的项目会运行检查；仅有适配器入口的项目返回 `ready: false`、`executed: false` 和原因。执行历史保留，页面将最近一次检查显示为可用、仅本地记录或不可用。

```text
GET  /api/extended-features
GET  /api/vms/:id/extended-features
POST /api/vms/:id/extended-features
```

POST 支持四类动作：

```json
{ "action": "check", "featureId": "qcow2-scrub" }
{ "action": "run", "featureId": "vm-suspend", "options": { "mode": "pause" } }
{ "action": "configure", "featureId": "session-lock", "enabled": true, "options": { "timeoutMinutes": 30 } }
{ "action": "operation", "operation": "hash-manifest", "parameters": { "path": "src" } }
```

工程操作会进入任务中心，沿用取消、日志、持久历史和重试边界。路径只接受项目内相对路径；归档、Git、命令宏和 Runbook 会在执行前进行参数校验。涉及宿主 TPM、GPU、IPv6、VPN、反向隧道、跨主机管理等尚无完整实现的功能时，目录显示规划状态，运行请求返回明确错误，不会自动安装宿主驱动或连接外部服务；检查结果和最近 50 次执行记录可从实例扩展能力视图读取。

CLI：

```powershell
npm run sakura -- extended my-dev view
npm run sakura -- extended my-dev check qcow2-scrub
npm run sakura -- extended my-dev operation operation.json
```

## 第三批 100 项平台能力

第三批目录覆盖远程主机与集群、虚拟硬件、存储灾备、网络治理、安全合规、可观测性、开发与 AI、团队协作、操作系统集成以及平台扩展。统一接口允许保存配置与只读检查；只有标为已实现入口的项目允许执行。工具探测通过不会使规划项变为可用，未实现项目的运行请求返回 501。执行记录和任务日志使用独立的 `next-features` 存储，可与第二批能力分别重试、审计和清理。

```text
GET  /api/next-features
GET  /api/vms/:id/next-features
POST /api/vms/:id/next-features
```

POST 示例：

```json
{ "action": "check", "featureId": "multi-host-inventory" }
{ "action": "run", "featureId": "rpo-rto-planner", "options": { "backupGiB": 20, "bandwidthMbps": 200 } }
{ "action": "configure", "featureId": "feature-rollout", "enabled": true, "options": { "percentage": 25 } }
```

CLI：

```powershell
npm run sakura -- next my-dev view
npm run sakura -- next my-dev check multi-host-inventory
npm run sakura -- next my-dev run rpo-rto-planner plan.json
```

本批功能会优先执行安全的宿主机或客户机探测；需要外部主机、驱动、认证服务或云端目标时，适配器会返回 `ready`、`executed` 和原因，检查仅追加检查历史，不更改策略、配对码或锁定状态。

## 工程操作修复与依赖

37 项工程协议已接通执行器。除目录适配器和宿主操作外，工程执行器需要客户机 Python 3.9 或更高版本，只使用标准库；Git、ACL、ip 等工具由所选操作决定。缺少依赖会明确失败，不会把提示文本当作成功。能力中心可编辑参数、查看操作说明和任务日志，不再直接提交不可修改的示例。

归档仅支持 tar/tar.gz 等 Python tarfile 可读取的 tar 格式。解压前校验全部成员，拒绝绝对路径、越界路径、链接、特殊文件和重复成员；目标必须是新目录。哈希与归档扫描上限为 20,000 项和 512 MiB。项目模板排除常用秘密文件名并检测私钥头部。

覆盖率支持 Istanbul summary、LCOV、coverage.py；覆盖率、进程、I/O 和网络历史保存在项目 `.sakura/engineering/`。SBOM 支持 npm package-lock v2/v3，输出格式采用 [CycloneDX 1.5 JSON](https://cyclonedx.org/docs/1.5/json/)。许可证未知或不在允许列表时返回待审查并使任务失败。工具链仅对支持的版本范围作结论，复杂范围返回待核对。

Rebase 支持线性历史，先生成只读计划，apply 必须包含范围内的全部提交；丢弃使用显式 drop。冲突会保留现场及计划消息，continue/abort 使用正确的 Git 序列。可复现构建从同一提交导出两个独立目录，实际比较产物内容。

发布门禁与 Runbook 首次失败后跳过后续步骤；命令宏按 when 执行，但任何失败都会保留为最终失败。任务取消会终止工程执行器及其子进程。Git 工作台提交前检查暂存区高置信度密钥特征，只输出文件和行号。

## 应急锁定

能力中心提供“停止并锁定实例”和“解除应急锁定”。锁定会停止虚拟机、取消相关任务、关闭客户机连接；后续启动、配置写入、命令、文件访问与桌面连接受到阻断。已启动的独立 Linux 服务也随实例停止。解除锁定不会自动重新启动实例。

核心接口不依赖 platform 插件，以便插件关闭后仍可解除锁定：

```text
GET  /api/vms/:id/lockdown
POST /api/vms/:id/lockdown   { "locked": true | false }
```

锁定记录保存在宿主数据目录的 `incident-lockdown.json`，重启后仍有效；读取与能力检查不会修改该记录。详情见 [本次修复记录](implementation-fixes.md)。
