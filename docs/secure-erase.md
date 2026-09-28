# 项目文件逻辑擦除记录

此操作只接受运行中实例、当前 `/workspace` 项目下的相对文件路径，且目标必须是**单链接普通文件**；符号链接、硬链接和超过 128 MiB 的文件会拒绝。先预览取得令牌，再明确确认执行：

```json
{"mode":"preview","path":"secrets/old.txt"}
```

将上述 JSON 保存为 `preview.json`，运行 `npm run sakura -- extended <实例名> run secure-erase preview.json`，再运行 `npm run sakura -- task <任务 ID> result` 取得 `previewToken`。文件在预览阶段不会修改。将同一路径与令牌写入 `erase.json`：

```json
{"mode":"erase","path":"secrets/old.txt","previewToken":"<预览返回的 64 位十六进制值>","confirmed":true}
```

运行 `npm run sakura -- extended <实例名> run secure-erase erase.json`，再通过任务结果查看 `logicalOnly`、原始内容 SHA-256、三轮覆盖次数、零内容 SHA-256、删除状态和时间。执行时会重新检查文件身份和内容；预览后文件变化则拒绝。每轮写入都 `fsync`，最后一轮读取验证为零后才删除文件并同步父目录。操作记录同时保存在任务结果与第二批能力执行历史中。

这证明当前客户机可见的目标文件按上述步骤完成**逻辑覆盖与删除**，不证明 SSD 闪存单元、QCOW2 写时复制旧块、宿主临时文件、备份或快照中的数据已经不可恢复。不要将此记录用于物理介质销毁合规证明。中断或取消可能留下部分覆盖的文件且没有成功记录；此时应检查文件状态，不能把取消视作已擦除。需要更强的静态数据保护，应使用虚拟磁盘加密并管理旧明文副本与密钥。
