# SSD/HDD 分层

在能力中心的“SSD/HDD 分层”中，把两个已注册且不同的存储池分别指定为热池和冷池。池的 SSD/HDD 角色由使用者根据实际磁盘选择，Sakura 不猜测介质类型。分层以**整个实例目录**为单位，不在单个 QCOW2 内搬移热块或冷块。

策略使用实例最后一次启动或停止的时间作为最近使用时间。早于 `idleHours` 的停机实例建议进入冷池，其他停机实例建议进入热池。`status` 显示全部实例的当前池、目标池和无法迁移的原因；`apply` 只处理当前实例；`rebalance` 顺序处理所有可迁移的停机实例。`save` 保存热/冷池、闲置小时数、检查间隔和自动检查开关。启用后，平台插件按 `intervalHours` 定期重平衡；服务重启时若到期会再检查。每次迁移复用存储池的文件 SHA-256 校验、持久切换和旧副本清理记录。

示例操作参数：`{"mode":"save","enabled":true,"hotPoolId":"default","coldPoolId":"<已注册池 ID>","idleHours":168,"intervalHours":24}`。保存后先以 `status` 审阅建议，再以 `apply` 或 `rebalance` 立即执行。`enabled:false` 时仍可手动执行。

运行中的实例、临时沙箱、救援实例和存在待清理副本的实例不会由定时任务迁移。目标池不可用或剩余空间低于当前磁盘文件大小加 64 MiB 时会跳过；复制期间若真实空间不足，迁移失败并保持原实例目录。每个实例的执行结果和最近历史保存在主数据目录 `storage-tiering.json`。策略只使用最后使用时间，不测量客户机文件或磁盘块的访问频率；管理员可以通过手动迁移覆盖建议。

验证：`npx tsx --test tests/storage-tiering.test.ts` 覆盖策略、预览、手动迁移、重启恢复和定时重平衡；`npm run test:storage-pools` 在真实 Alpine/QEMU 客户机上用分层动作迁回热池，并启动确认客户机文件未丢失。
