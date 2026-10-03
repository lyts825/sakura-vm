# 见证配置迁移与状态恢复

见证持久状态使用第 4 版。它保留来源启动授权、完整退役身份、待回切进度以及恢复封锁；旧程序不能读取新版状态，回滚时须保留兼容见证版本。维护命令始终取得与服务相同的规范路径内核独占锁，服务仍运行、原持有者存活或身份不明时拒绝操作。先正常停止见证服务，保留原配置、状态和锁，完成维护后再用对应配置启动。不能把同一状态交给另一个仍可能运行的见证节点。

三个命令都要求新的 `--backup` 和 `--output` 文件路径，拒绝覆盖已有文件。备份保留原始状态字节；缺失状态则保存明确的缺失记录。回执记录原始摘要、完成状态和实际观察，不含令牌、密码或应用地址查询参数。验证失败保持原状态并留下 `rejected` 回执；写入开始后无法确认完成则记录 `commit-unconfirmed` 和能读取到的文件摘要，应先核对状态与备份，不能据此初始化空授权。

## 第 2/3 版迁移

使用与原状态一致的完整配置，保持来源、目标、硬件和端点绑定：

```sh
npm run ha:witness -- --migrate /etc/sakura-ha/witness.json --backup /var/lib/sakura-ha/before-v4.json --output /var/lib/sakura-ha/migrate-v4.json
```

命令只读核对 Redfish 系统 UUID/电源、目标身份、精确计划副本及流量；不会隔离、启动、退役或切流。原 `source`、`fencing`、`fenced`、`promoted` 阶段和计划保持不变，来源授权不会因迁移而扩大。第 2 版缺少硬件 UUID 时，经已认证 Redfish 核对后补上登记；未知版本、未知阶段、不完整条目或错误身份仍拒绝处理。第 4 版已就绪文件也可经同一路径核对并保留。

## 更换目标、阈值及回切绑定

先完成既有接管的退出和流量回切，在来源关闭接管策略并获得见证撤防确认，再准备新的配置文件。原状态须为 `source`、没有布防计划且没有待回切或恢复封锁。来源宿主与硬件 UUID不能原地换成另一套身份。

```sh
npm run ha:witness -- --reconfigure /etc/sakura-ha/witness.json --next-config /etc/sakura-ha/witness-next.json --backup /var/lib/sakura-ha/before-reconfigure.json --output /var/lib/sakura-ha/reconfigure.json
```

命令核对原接口和新接口的硬件、目标及流量身份，然后原子提交新绑定。新增或移除实例也遵循撤防要求；不会删掉其他实例的隔离记录。认证令牌可更新，但目标身份、证书和回切端点变化不能绕过活动接管的保护。成功后用新配置启动见证，在来源停止时重新启用与新目标、阈值一致的策略并复制新的快照副本。

## 损坏或缺失状态恢复

先停止旧见证服务并保护现有文件，选择与当前配置全部实例和硬件绑定一致的合法历史状态备份：

```sh
npm run ha:witness -- --recover /etc/sakura-ha/witness.json --from-state /var/lib/sakura-ha/known-state-backup.json --backup /var/lib/sakura-ha/damaged-original.json --output /var/lib/sakura-ha/recover.json
npm run ha:witness -- /etc/sakura-ha/witness.json
```

恢复会给**全部条目**写入持久 `recoveryHold`，保留备份中的阶段与计划。服务恢复监听后，`recoveryHeld: true`、`armed: false`；来源启动与心跳被拒绝，也不会根据旧备份自动关机、启动目标或切流。只读预检会明确返回未就绪。缺失状态同样先恢复封锁，不创建空来源授权。没有合法备份或第 1 版缺少身份绑定时，本命令无法推断安全状态。

让来源实例保持停止，核对、回迁全部目标期间的新写入或明确接受取舍，停止该来源的所有历史快照副本，再在来源面板确认数据并执行原有“目标停机后退出接管”，API 为 `run` 的 `{ "mode": "rejoin", "dataReconciled": true }`。此操作使用目标 `GET /peer/replicas-status?sourceVmId=...` 的受配对认证完整清单，覆盖同一来源宿主/实例的全部历史转移、启动中、运行及已退役副本。目标需更新到支持该接口的版本，并授予导入和故障副本权限。

见证核对每个副本的目标、来源、转移、实例、快照及 SHA-256 身份，确认所有副本停机，再逐一请求持久退役并读取第二份完整清单。历史记录缺失、清单不完整、错来源、保存的退役字段错配、运行副本、未知流量目标或清单变化时保持封锁。退役响应丢失或过程中又发现新副本时可重复操作，已经退役的副本不会重新启动。只有完整退役证据持久提交后，来源才得到启动授权；重复成功请求使用持久回执。若配置自动回切且流量仍指向其中一个精确副本，退出后继续按来源健康、退役和流量确认完成回切。

这些命令和 HTTPS 测试提供真实接口的操作入口，不证明第三节点物理独立，也不替代已授权的硬件故障演练。[部署与外部演练](ha-external-drill.md) 的硬件验证要求仍适用。
