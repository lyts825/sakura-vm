# 能力中心

能力中心位于主导航的「能力中心」，对每个实例保存一份宿主机侧的自动化与观测设置，文件为数据目录中的 `feature-suite.json`。它不会写入实例磁盘，因此导出或克隆实例时不会把本机计划带到另一台主机。

当前可直接使用的能力包括：

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

能力中心同时展示 50 项能力目录。已有模块（项目服务、网络配置、容器、运行时、Git、同步、快照、维护和桌面）以及便携适配器都会提供可执行的检查和运行入口；需要宿主机驱动、QEMU 设备或多用户认证时，适配器会返回能力探测结果，并将配置与执行历史保存在本地。

## 第二批 100 项扩展能力

第二批能力通过统一的扩展能力接口登记。100 项都已经接入可执行适配器：能在客户机中执行的功能会运行实时检查，宿主组件不可用时使用便携实现并记录 `liveProbe: false` 或 `executed: false` 与原因，避免丢失操作请求。

```text
GET  /api/extended-features
GET  /api/vms/:id/extended-features
POST /api/vms/:id/extended-features
```

POST 支持三类动作：

```json
{ "action": "check", "featureId": "qcow2-scrub" }
{ "action": "run", "featureId": "session-lock" }
{ "action": "configure", "featureId": "session-lock", "enabled": true, "options": { "timeoutMinutes": 30 } }
{ "action": "operation", "operation": "hash-manifest", "parameters": { "path": "src" } }
```

工程操作会进入任务中心，沿用取消、日志、持久历史和重试边界。路径只接受项目内相对路径；归档、Git、命令宏和 Runbook 会在执行前进行参数校验。涉及宿主 TPM、GPU、IPv6、VPN、反向隧道、跨主机管理等功能时，页面会返回便携适配器状态，不会自动安装宿主驱动或连接外部服务；检查结果和最近 50 次执行记录可从实例扩展能力视图读取。

CLI：

```powershell
npm run sakura -- extended my-dev view
npm run sakura -- extended my-dev check qcow2-scrub
npm run sakura -- extended my-dev operation operation.json
```

## 第三批 100 项平台能力

第三批目录覆盖远程主机与集群、虚拟硬件、存储灾备、网络治理、安全合规、可观测性、开发与 AI、团队协作、操作系统集成以及平台扩展。每项都通过统一的配置、检查和执行接口接入，执行记录和任务日志使用独立的 `next-features` 存储，因此可以和第二批能力分别重试、审计和清理。

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

本批功能会优先执行安全的宿主机或客户机探测；需要外部主机、驱动、认证服务或云端目标时，适配器会返回 `ready`、`executed` 和原因，并持久化请求与配置，不会自动安装驱动、发送凭据或执行未经确认的自然语言命令。
