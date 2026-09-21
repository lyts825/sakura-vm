# 能力中心

能力中心位于主导航的「能力中心」，对每个实例保存一份宿主机侧的自动化与观测设置，文件为数据目录中的 `feature-suite.json`。它不会写入实例磁盘，因此导出或克隆实例时不会把本机计划带到另一台主机。

当前可直接使用的能力包括：

- 计划启动、计划停止和空闲停止；
- CPU、内存、磁盘历史采样与阈值告警；
- Linux 工作区内容搜索；
- apk / apt 软件包查询、安装、卸载和索引更新；
- 监听端口发现；
- DNS、HTTPS 和监听端口诊断；
- SSH 设置、待更新软件包和可写系统文件的只读安全检查；
- 任务中心中的软件包任务日志、取消和重试。

服务端接口为：

```text
GET  /api/feature-suite
GET  /api/vms/:id/advanced
PUT  /api/vms/:id/advanced
POST /api/vms/:id/advanced
```

`POST` 的动作包括 `sample`、`search`、`package`、`network-test`、`discover-ports`、`security-scan` 和 `acknowledge`。所有客户机命令都经过参数校验和单引号数据引用；软件包安装、卸载和更新走任务中心，不会占用 HTTP 请求直到命令结束。

能力中心同时展示 50 项能力路线图。已有模块（项目服务、网络配置、容器、运行时、Git、同步、快照、维护和桌面）会在路线图中标记为可用或实验性；需要宿主机驱动、QEMU 设备或多用户认证的能力保留为规划状态，不会伪装成已经启用的功能。
