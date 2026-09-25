# 沙箱工作台

沙箱插件为临时实验和脚本执行创建独立的 Linux 虚拟机。每个沙箱使用单独的 QCOW2 增量磁盘、SSH 密钥和 QEMU 进程；创建时不会复制现有实例的文件、环境变量或私密配置。

## 启用与使用

在「插件中心」启用 **沙箱工作台**（标识为 `sandbox`），退出并重启 Sakura 服务。也可通过命令行选择：

```powershell
npm run sakura -- plugin enable sandbox
```

插件可以单独启用，不依赖项目、容器或自动化插件；`lab` 和 `complete` 整合包也包含它。默认安装仍为空插件配置。

打开「沙箱工作台」，填写名称，选择资源、网络和到期处理方式，点击「创建沙箱」。新沙箱处于停止状态。可点击「启动」后在工作空间使用终端，也可直接提交命令，由工作台自动启动并等待 Linux 就绪。

Alpine 镜像通过 `npm run setup` 准备。Debian / Ubuntu 需要提前在镜像库下载对应镜像；缺少镜像时创建会返回明确错误。无需联网即可创建已准备镜像的隔离环境。

## 策略

| 项目     | 默认值       | 范围与行为                                                         |
| -------- | ------------ | ------------------------------------------------------------------ |
| CPU      | 1 vCPU       | 1–4 个虚拟 CPU                                                     |
| 内存     | 512 MiB      | 256–4096 MiB；Debian / Ubuntu 至少 1024 MiB                        |
| 磁盘     | 4 GiB        | 2–32 GiB；发行版最低容量仍由镜像规则检查                           |
| 存活时间 | 60 分钟      | 从创建开始计时，5–1440 分钟，停机和服务退出期间继续计算            |
| 网络     | 隔离         | `isolated` 或允许联网的 `nat`，创建后固定                          |
| 到期处理 | 停止并销毁   | `delete` 删除磁盘和密钥；`stop` 保留磁盘供检查或导出，禁止再次启动 |
| 命令超时 | 60 秒        | 1–3600 秒，从系统就绪开始计算，不能超过沙箱剩余存活时间            |
| 工作目录 | `/workspace` | 已存在的 Linux 绝对目录                                            |

资源和网络策略创建后不能通过普通实例配置、磁盘扩容或端口管理接口修改。沙箱共用现有的最多 32 个实例、同时运行 4 个实例的全局限制。vCPU 数量控制虚拟硬件配置；磁盘容量指虚拟磁盘容量，QCOW2 元数据及可选快照仍占用额外宿主机空间。

隔离模式使用 QEMU 用户态网络的 `restrict=on`，并禁用 IPv6，只保留回环地址上的 SSH 管理转发。不创建共享目录、SMB/TFTP 服务或额外的业务端口转发。QEMU 对该选项的定义及显式转发的例外见 [官方网络参数说明](https://www.qemu.org/docs/master/system/invocation.html)。本地集成测试同时检查管理 SSH 可用、宿主机端口不可达、外部 TCP 不可达、DNS 查询不可用。

NAT 模式允许客户机访问互联网及宿主机可达的网络，适合安装依赖。它不提供出站网络隔离，也不是域名或地址白名单模式。

## 命令与清理

命令作为引用后的字符串通过 SSH 传给 **客户机 root 的 `sh`**，不会在 Windows Shell 中求值。同一个沙箱同时只能执行一个工作台任务；工作目录中的引号和命令参数均按 Linux Shell 规则处理。

命令正常结束后先在剩余超时预算内同步磁盘，再关闭整个 QEMU 实例。命令失败、超时、输出超过 1 MiB 或被取消时也会关闭整个实例，已脱离父进程的后台程序同样被终止。超时和取消可能中断未完成的文件写入。下次执行会重新启动同一磁盘，直到沙箱到期或被销毁。

到期检查属于 `Machines` 宿主层，每秒检查一次。停用沙箱插件不取消已有期限；服务重启后会先检查到期状态，到期的保留型沙箱不能启动或恢复，到期的销毁型沙箱会被清理。清理遇到磁盘操作锁时会先终止虚拟机，随后重试删除；删除失败写入实例日志。服务退出后虚拟机由原有运行时关闭机制停止，离线期间到期的磁盘在下次启动服务时清理。

「停止」会取消当前任务并终止虚拟机；「销毁」还会删除沙箱磁盘及密钥。销毁前界面会说明删除范围。执行记录独立保留在任务历史中，包含命令、工作目录、输出、退出码或错误；最多保存最近 200 条，每条日志保留最近 32 KiB。服务重启会把未完成任务标记为中断，不自动重放命令。任务中心的通用重试入口会要求回到工作台检查命令后重新执行。

新记录的 `execution` 字段独立保存命令、工作目录、超时设置、退出码、结束原因和启动/执行/同步及产物/关机/总耗时。日志截断不会影响这些字段；旧记录继续显示其已有日志。工作台支持将整条记录导出为 JSON。

执行时可在 `artifacts` 中指定工作目录内的相对文件路径。最多 8 个普通文件，总量不超过 8 MiB；支持二进制文件。命令返回后，在原超时预算内同步磁盘并通过 SFTP 取回产物，再终止整台虚拟机。非零退出的命令也会尝试收集产物；超时、取消或到期可能中断收集。越界路径、指向工作目录外的链接、超出大小限制和不完整读取会报告失败，已经完整保存的产物仍可下载。

产物保存在宿主数据目录的 `plugins/sandbox/artifacts`，下载时验证 SHA-256，销毁实例不删除产物。产物跟随最近 200 条任务记录保留；插件启动和后续执行时清理已淘汰记录的文件。

该功能面向本机开发工作流。实例内命令拥有客户机 root 权限；Sakura 管理凭证仍属于受信任的本机用户，其他已启用插件可能按该用户的操作访问沙箱。它不提供第三方 Node.js 插件隔离、多租户权限系统、宿主 QEMU 进程的 OS 级沙箱，也不承诺防御虚拟化逃逸。

## CLI

```powershell
npm run sakura -- sandboxes
npm run sakura -- sandbox create sandbox-demo
npm run sakura -- sandbox run sandbox-demo -- sh -lc 'uname -a; printf hello'
npm run sakura -- sandbox logs sandbox-demo
npm run sakura -- sandbox start sandbox-demo
npm run sakura -- shell sandbox-demo
npm run sakura -- sandbox stop sandbox-demo
npm run sakura -- sandbox destroy sandbox-demo
npm run sakura -- sandbox run-config sandbox-demo run.json
npm run sakura -- sandbox artifact <run-id> <artifact-id> report.txt
```

`run-config` 接受执行配置，例如：

```json
{
  "command": "printf hello > report.txt",
  "cwd": "/workspace",
  "timeoutSeconds": 60,
  "artifacts": ["report.txt"]
}
```

`logs` 返回的 `execution.artifacts` 包含产物 ID。CLI 下载校验内容后独占创建目标文件，已有同名文件会报错。

`run` 返回后台任务 ID，使用 `logs` 查看状态和输出。销毁后仍可按沙箱名称或原实例 ID 查看执行记录。命令行参数逐个引用后交给客户机，需要管道、重定向等 Shell 语法时使用 `sh -lc`。

创建时可以传入 JSON 配置文件：

```json
{
  "distro": "alpine",
  "cpus": 2,
  "memoryMiB": 1024,
  "diskGiB": 8,
  "network": "isolated",
  "lifetimeMinutes": 30,
  "onExpire": "stop"
}
```

```powershell
npm run sakura -- sandbox create sandbox-demo sandbox.json
```

## API

接口使用现有本机鉴权和同源检查。请求及响应由插件的逐操作 Schema 验证，未启用插件返回 403；普通实例不能作为沙箱操作目标。

| 方法   | 路径                                                          | 用途                                                                |
| ------ | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| GET    | `/api/sandboxes`                                              | 沙箱列表、是否到期、执行历史和历史存储错误                          |
| GET    | `/api/sandboxes/artifact?run=<run-id>&artifact=<artifact-id>` | 返回产物元数据和 Base64 二进制内容，销毁实例后仍可调用              |
| POST   | `/api/sandboxes`                                              | 创建，201；字段同配置示例并包含 `name`                              |
| GET    | `/api/vms/:vmId/sandbox`                                      | 查看单个沙箱                                                        |
| POST   | `/api/vms/:vmId/sandbox`                                      | `{"action":"start"}` 或 `{"action":"stop"}`                         |
| DELETE | `/api/vms/:vmId/sandbox`                                      | 取消任务、终止并销毁沙箱                                            |
| POST   | `/api/vms/:vmId/sandbox/run`                                  | 提交命令，202；`command`、`cwd`、`timeoutSeconds`、可选 `artifacts` |

策略保存在实例元数据的 `sandbox` 字段中，普通创建接口不接受此字段。API 未开放延期或撤销策略，避免清理期限被配置保存或重启隐式重置。

## 验证

```powershell
npm run verify
npm run test:sandbox
npm run test:integration
```

单元测试覆盖输入约束、普通实例保护、策略持久化、配置绕过、QEMU 参数、到期强制停止、停用插件后的启动清理、引号处理、失败/超时/取消、历史保留及独立激活。浏览器测试覆盖创建、执行、取消、销毁后查看日志、创建错误和手机宽度。

`test:sandbox` 使用独立临时数据目录与现有 Alpine 基础镜像，真实验证 SSH、网络隔离、命令完成后的磁盘同步、后台进程终止、超时、取消和到期删除。结束后删除测试实例，结果写入 `artifacts/sandbox-smoke.log`。其他发行版和主机上的性能、兼容性仍需按实际环境验证。
