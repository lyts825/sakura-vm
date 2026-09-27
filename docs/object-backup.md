# S3/MinIO 备份目标

启用平台、快照实例包、备份策略和私密配置插件后，在实例的“能力中心”选择 **S3/MinIO 备份目标**。先在该实例的私密配置中保存对象存储凭据，值为 JSON：

```json
{"accessKeyId":"your-access-key","secretAccessKey":"your-secret-key"}
```

临时凭据还可加 `sessionToken`。私密值由现有私密配置服务保护；目标配置只保存私密配置的名称，不包含密钥。生产对象存储请使用 HTTPS；HTTP 适用于受信任的本机 MinIO 测试。

在能力参数中提交以下 JSON，`endpoint` 省略时使用 AWS S3，设置时应为无路径、查询和凭据的 S3 兼容服务地址：

```json
{"mode":"save","target":{"endpoint":"https://minio.example.com","bucket":"sakura-backups","region":"us-east-1","prefix":"workstations","credentialSecret":"S3Credentials"}}
```

保存时会用凭据检查存储桶。`check` 动作搭配相同参数仅验证，不保存。随后在备份页创建本地备份，取得备份 UUID，再提交 `{"mode":"upload","backupId":"<备份 UUID>"}`。普通、加密和内容块备份都受支持。上传会先检查本地备份，8 MiB 分片上传，重新下载远端对象并核对长度及 SHA-256，校验成功后才发布远端清单。重复上传同一份备份会验证已存在的远端对象并返回 `executed: false`。如果本机备份是用一次性密码创建的，请将密码保存为私密配置，并在上传参数中填写 `passwordSecret`；使用备份策略的密码引用时可省略此参数。

`{"mode":"list"}` 列出最多 100 份远端备份及 `remoteId`。拿到形如 `<来源实例 UUID>/<备份 UUID>` 的 ID 后，可以运行：

```json
{"mode":"verify","remoteId":"<来源实例 UUID>/<备份 UUID>"}
{"mode":"restore","remoteId":"<来源实例 UUID>/<备份 UUID>","restoreName":"restored-vm"}
{"mode":"delete","remoteId":"<来源实例 UUID>/<备份 UUID>"}
```

校验和恢复都会下载对象、核对清单声明的 SHA-256，并再次检查备份包内的磁盘哈希；加密备份还需密码私密配置。恢复创建新实例，结果包含 `restoredVmId`，不会覆盖来源。删除仅移除远端对象及清单；仍在备份保留锁定期内的远端备份不能通过应用删除。目标可以在另一实例上重新配置为相同桶和前缀，以列出并恢复已删除来源实例的远端备份；加密备份需在新实例的私密配置中重新保存密码，并用 `passwordSecret` 指定。

远端对象保留与本地备份策略独立；当前通过能力操作手动上传和删除，不会自动复制后续的计划备份，也不会自动清理远端历史。对象键为 `<prefix>/sakura-backups/<来源实例 UUID>/<备份 UUID>.sakura[.enc]`，相邻的 `.json` 是校验清单。请为存储桶单独配置访问权限、容量与生命周期策略。

专项验证：`npm run test:object-backup` 使用真实 Alpine/QEMU 实例分别创建内容块和加密备份，上传到本地 S3 协议服务，删除本地备份后从远端恢复、启动并核对文件。`npm test` 还覆盖分片上传、重复上传、损坏远端对象后的拒绝恢复和远端删除。
