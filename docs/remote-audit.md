# 远程不可变审计锚点

Sakura 的本地审计日志是一条经 HMAC 校验的链。启用远程审计后，服务每小时检查本地链，将当前序号和链头摘要写入 S3 兼容对象存储；对象上传时要求 `COMPLIANCE` 模式和至少 7 天保留期，然后按对象版本 ID 读回并校验正文、模式与保留日期。没有新事件时，服务会在保留期剩余不足两天前写入续期锚点。上传或读回失败会记录错误，不会报告同步成功。本地写请求仍会继续；状态页明确显示本地序号、远端序号和差距。

先在远端创建已启用 Object Lock 的版本化桶，向运行 Sakura 的进程提供 AWS SDK 凭据（例如 `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`，或可用的 IAM 身份）。凭据不写入 Sakura 配置。账户管理员打开“系统设置 → 账户与只读分享 → 远程不可变审计”，填写桶、区域、可选对象前缀、保留天数和可选自定义端点，验证并保存，然后点击“同步审计锚点”。默认连接 AWS S3；自定义端点要求 HTTPS，本机 `localhost`/`127.0.0.1` 测试端点可使用 HTTP。账户模式和会话锁仍控制接口访问。Sakura 不替用户创建桶或更改桶的 Object Lock 配置。

状态接口为 `GET /api/audit/remote`，写接口为 `POST /api/audit/remote`，动作包括 `configure`、`sync`、`verify` 和 `disable`。手动校验会读回已记录的精确对象版本，并逐条检查当前本地链在该序号确实包含已锚定摘要。配置一旦产生锚点便不能改换桶或保留策略；停用自动同步不会删除远端对象。服务重启会保留主机标识及最后锚点，下一次同步仍验证上一个远端版本。数据目录迁移或控制面锁定期间自动同步暂停。

此功能把**链头摘要**固定在远端，不上传完整审计日志；调查事件仍需要本地日志或另行保管的日志备份。对象只在所显示的保留期内受到保护；主机长期离线可能错过续期。远端管理员仍可配置访问或添加删除标记，外部审计者应保存主机标识和对象版本 ID 并直接核验桶内版本。S3 Object Lock 的保留期作用于[具体对象版本](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)，[桶必须预先启用 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-configure.html)。
