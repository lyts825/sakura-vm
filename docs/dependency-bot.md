# npm 依赖升级机器人

在运行中的实例选择一个项目，打开“能力中心 → 依赖升级机器人”。项目需要单项目 `package.json` 和 npm v2/v3 `package-lock.json`，客户机需要 Python 3.9+ 与 npm。此功能更新直接依赖的清单和锁文件，不安装 `node_modules`，也不执行安装脚本。

1. 以 `{"mode":"scan"}` 运行扫描。结果列出当前锁定版本、目标版本、变更级别、跳过原因和每个候选的 `planId`。默认只给出同主版本的稳定版本；显式使用 `"allowMajor":true` 才列出跨主版本升级。
2. 审阅候选后，以 `{"mode":"apply","planId":"扫描结果中的 ID"}` 执行单项升级。跨主版本计划须同时传入 `"allowMajor":true`。执行器会重新查询包源并核对两个依赖文件的 SHA-256；计划过期或文件变化时拒绝升级。
3. 成功结果包含 `revisionId`。若需要恢复，以 `{"mode":"restore","revisionId":"升级结果中的 ID"}` 恢复对应的清单和锁文件。恢复仅在两文件仍与升级结果一致时允许。

升级先在项目内的临时目录运行 `npm install --package-lock-only --ignore-scripts`，验证 npm 只改变所选直接依赖声明，并核对锁文件解析后的目标版本，然后逐个替换原文件。原始两文件保存在 `.sakura/dependency-bot/revisions`，最多保留最近 20 次；发布中断会留下恢复记录，此时以 `{"mode":"recover"}` 先恢复到升级前。`status` 可查看当前文件指纹。

当前只处理 npm 直接依赖中的普通稳定版本范围（精确版本、`^`、`~`）。别名、Git、文件依赖、预发布版本、npm workspaces 与 shrinkwrap 会跳过或拒绝。锁文件发布是两次文件替换，不是跨文件原子事务；中断后必须先执行 `recover`。升级结果不代表项目测试通过，仍应运行项目自己的测试并审阅 Git 差异。
