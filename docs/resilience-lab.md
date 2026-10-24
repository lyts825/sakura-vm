# 可靠性演练工作台

## 使用范围

`resilience-lab` 包含 10 个独立插件。启用后重启服务，打开“可靠性演练”。页面默认不选择来源、模板或 VM，不自动下载、创建副本或注入故障。

演练只使用 fixtures 通过 ImageAssets 创建的专用副本。来源 VM、用户已有 VM、宿主网卡和宿主磁盘不接受故障操作。每台副本最多使用 2 GiB 内存、2 vCPU 和 32 GiB 虚拟磁盘；恢复期间最多保留两台副本。

当前支持 Windows x64 宿主与 Alpine x86_64 客户机。其他客户机镜像会在创建副本前明确拒绝。故障可用性取决于本机实测回执。编译成功、工具存在或计划到期都不代表故障已经撤回。

## 首次准备

先登记一个固定镜像。可以在页面分块上传本地 qcow2，或显式准备内置基础镜像。上传需要完整 SHA-256；服务端重新计算摘要。内置来源准备可能下载镜像，演练阶段不会下载或安装工具。

固定镜像需要 Python 3、完整 iproute2（含 tc）、netem、cgroup v2 的 cpu/pids 控制器及 tmpfs。基础 Alpine 不一定包含这些工具。工具缺失时，准备失败并保留副本清理入口。请在独立的镜像准备阶段补齐工具，再上传固定镜像。

镜像还须能用新 seed 完成首次初始化。不能直接导入仍保留旧 Tiny Cloud 完成标记的实例磁盘。固定预备工具只在本包拥有的 Alpine 副本中重新登记现有 Tiny Cloud 启动项、清除已知初始化状态，保证检查点副本取得新身份；不会下载工具或改动原来源 VM。

登记来源时须审阅来源说明。首版使用 20 个默认合成条目，可通过严格 API 调整到 10～1,000 个。每个条目有固定 ID 和摘要。真实备份不能通过修改来源字段直接成为已审阅的合成输入。

在来源区点击“显式预备与监管自检”。这会创建一台隔离副本，核验固定工具、宿主独立监管和客户机监管。首次验证前，故障能力显示未就绪。自检不依赖工坊、交付或应用运行包。完成后在“待处理资源”预览并核销自检副本。

CLI 使用相同 owner 会话和服务：

```text
sakura resilience status --workspace local
sakura resilience image-import --file prepared.qcow2 --distro alpine --architecture x86_64
sakura resilience fixtures prepareBuiltin --file builtin-source.json
sakura resilience fixtures prepare --file prepare.json
```

逐操作 JSON 文件必须包含 `scope: { "workspaceId": "local" }`。作用域首次写入时绑定实际认证 owner；知道另一个 workspaceId 不会获得读取或写入权限。

## 场景与执行

| 模板 | 故障范围 | 恢复验证 |
| --- | --- | --- |
| HTTP 延迟与重试 | 专用 veth 的独占 netem 句柄 | 撤回原规则，重新读取固定业务结果 |
| 工作进程重启 | 固定业务进程的原 PID、启动时刻和进程组 | 使用独立恢复授权启动固定版本 |
| CPU 争用 | 单个压力进程及专用 cgroup | 核对内核配额、压力退出和业务结果 |
| 数据卷写满 | 最大 128 MiB 的专用 tmpfs 保留文件 | 验证写入失败、释放空间和重新写入读回 |
| 检查点恢复 | 停止原副本，从固定冷检查点创建独立副本 | 比对已确认请求集合、持久样本及旧新身份 |

保存场景只生成新修订。预览固定来源、样本、参数、预算和阈值，有效期为 5 分钟。批准与执行是两个动作，批准只消费一次。修改参数后必须重新预览和批准。

正常基线和恢复稳定窗口各至少 60 秒。无样本、工具缺失、错误数超限、重复请求或读回摘要不符都会阻止通过。故障阶段同时保存固定适配器观察和业务探针，命令退出码不能替代实际故障证据。

```text
sakura resilience scenarios save --file scenario.json
sakura resilience runs preview --file preview.json
sakura resilience runs approve --file approval.json
sakura resilience runs start --file start.json
sakura resilience watch --id RUN_ID
sakura resilience cancel --id RUN_ID
sakura resilience reconcile --id RUN_ID
```

`watch` 只查询状态，断开不会取消运行。显式取消先撤销后续业务动作，再处理原故障和资源。运行分别显示业务结果、安全收尾和清理状态。任务结束不能替代资源核销。

## 监管与故障处理

fixtures 始终持有原 `OwnedImageVm`。guard 持有不可转让的管理租约，faults、probes 和 recovery 分别取得绑定真实插件实例及 generation 的动作票据。HTTP 不提供任意消费者授权入口。

客户机监管使用固定截止和原资源句柄。Windows 独立监管持有原 QEMU 进程句柄和创建 FILETIME。主控制器冻结时，独立监管直接停止原进程，不依赖主控制器转发 QMP。注入前还会核验监管原进程仍然存活。

故障截止、演练总截止和安全清理权能分别处理。正常撤回不允许延长故障；取消或代次变化会撤销业务恢复。安全清理只能作用于原资源，不能创建副本或重启业务。

服务重启后，未结束运行进入 `reconcile-required`。系统不重放故障、数据写入或恢复命令。规则漂移、同 ID 重建、boot 改变、元数据提交失败和清理失败会保留原账本及额度。不能通过人工填写“已处理”清除未知状态。

## 证据与离线交接

报告分为通过、未通过和不完整。未完成清理的报告仍可封存，但只能标记不完整。报告包含固定来源、场景、逐请求样本、分位数算法、恢复和清理证据。

首版使用纯 JSON 数据封套，包含 report、scenario 和 samples 三个声明条目。上限收紧为 200 MiB，不接受压缩包、活动 HTML、脚本或可执行附件。校验器检查规范路径、重复项、大小写碰撞、字节数、摘要、引用、样本汇总及通过条件。

```text
sakura resilience reports seal --file seal.json
sakura resilience export --id REPORT_ID --output report.json
node scripts/resilience-cli.mjs verify --file report.json --offline
sakura resilience import --file report.json
sakura resilience accept --id IMPORT_ID
```

离线 verify 使用纯 Node，不启动 Sakura 服务，也不联网。有效摘要只说明文件一致，结果仍标记 `sourceTrust: unauthenticated`。导入先进入隔离区，接受后成为外部参考。导入的 VM、项目、PID、boot 和运行 ID 只作为来源文字，不映射为本机执行权限。重新演练必须重新选择本地来源并审批。

“隔离导入历史”会恢复当前档案的导入记录。可清理导入原包来释放 30 个导入槽位；已接受的外部报告独立保留，可另行固定或归档。导入清理最多保留 1,000 条摘要回执，达到上限明确拒绝继续清理；重复清理同一记录不会影响其他内容。

## 入口映射

HTTP 采用 `/api/resilience-领域/操作`。读操作使用 GET，其他操作使用 POST。`shared/contracts/resilience-lab.ts` 的 `resilienceRequests` 和 `resilienceResponses` 是逐操作契约；未知字段直接拒绝。没有绕过领域校验的通用 act。

| 插件 | 主要入口 |
| --- | --- |
| targets | register、view、get |
| fixtures | prepareBuiltin、beginImport、appendImport、finishImport、prepare、cleanupPreview、cleanup |
| guard | view、contain、reconcile |
| faults | catalogue、observe |
| probes | view |
| recovery | preview、apply |
| scenarios | templates、save、view |
| runs | preview、approve、start、get、cancel、reconcile |
| reports | seal、export、import、imports、discardImport、accept、compare、retention、pin、archive |
| workbench | view |

业务进程由固定客户机适配器以普通账户运行，记录原进程身份。default 项目只保存 `/workspace/resilience` 的配置边界和实际修订。没有调用 Workspaces.runPrepared，也没有把项目配置登记当作执行证明。

## 验证记录

2026-10-24 已通过真实公共服务与 HTTP 的全部五个模板，包括固定 60 秒正常基线、实际故障、恢复窗口、原副本核销、报告封存和导出。检查点模板创建新副本并逐项读回原已确认请求集合，没有重新生成数据替代恢复。该轮最终七个测试副本均确认清理，服务正常关闭。

同轮显式预备的独立宿主监管在控制器冻结时，于截止后 36 ms 停止原临时 QEMU。此前四类固定客户机适配器及客户机监管也通过实测；客户机监管撤回原 CPU 故障的延迟为 107 ms。五份报告均通过纯 Node 离线完整性复核，来源仍标记为未认证。

隔离导入列表、接受后的独立报告、幂等清理、固定与归档保护已通过实际 HTTP 验证。启动失败核销、取消窗口禁止注入、退出查询失败保持未知及迟到核销不能覆盖已释放状态的四项定向回归通过。

实际取消发生在注入等待窗口，核心故障意图仍为空，原副本确认清理。另一次测试强制结束原控制器进程后重启服务，旧运行保留为不确定结果；核销确认原资源已结束，旧计划重放被拒绝。最终测试数据根没有登记中的 VM，服务正常关闭。完整发布状态以主任务最终验证记录为准；这些结果仅覆盖已说明的宿主和客户机组合，不推导生产演练可用性。
