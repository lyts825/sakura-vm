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

`POST` 的动作包括 `sample`、`memory-target`、`apply-preset`、`disk-analysis`、`dev`、`search`、`package`、`network-test`、`discover-ports`、`security-scan` 和 `acknowledge`。所有客户机命令都经过参数校验和单引号数据引用；软件包与开发任务走任务中心，不会占用 HTTP 请求直到命令结束。资源预设只修改实例配置，不会在运行中的实例上强制关机。

能力中心同时展示 50 项能力路线图。已有模块（项目服务、网络配置、容器、运行时、Git、同步、快照、维护和桌面）会在路线图中标记为可用或实验性；需要宿主机驱动、QEMU 设备或多用户认证的能力保留为规划状态，不会伪装成已经启用的功能。

## 第二批 100 项扩展能力

第二批能力通过统一的扩展能力接口登记。接口不会把清单条目伪装成已经完成：`available` 会直接执行检查或任务，`experimental` 会运行已有适配器并返回限制，`planned` 会返回缺失的宿主组件、客户机工具或外部服务。

```text
GET  /api/extended-features
GET  /api/vms/:id/extended-features
POST /api/vms/:id/extended-features
```

POST 支持三类动作：

```json
{ "action": "check", "featureId": "qcow2-scrub" }
{ "action": "configure", "featureId": "session-lock", "enabled": true }
{ "action": "operation", "operation": "hash-manifest", "parameters": { "path": "src" } }
```

工程操作会进入任务中心，沿用取消、日志、持久历史和重试边界。路径只接受项目内相对路径；归档、Git、命令宏和 Runbook 会在执行前进行参数校验。涉及宿主 TPM、GPU、IPv6、VPN、反向隧道、跨主机管理等功能时，页面会显示依赖状态，不会自动安装宿主驱动或连接外部服务。

CLI：

```powershell
npm run sakura -- extended my-dev view
npm run sakura -- extended my-dev check qcow2-scrub
npm run sakura -- extended my-dev operation operation.json
```
