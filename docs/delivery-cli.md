# 项目交付命令行

## 连接本地服务

CLI 调用已启动的 Sakura 服务，适合脚本化交接和传输较大的交付包。先启用 `delivery` 插件包并重启，再运行 `npm run delivery -- help`。业务命令始终需要明确的实例 ID 和项目 ID。

源码目录和运行发行包使用同一个入口：`node scripts/delivery.mjs`，不加载 TypeScript 或 tsx。`help` 不需要编译产物。实际联网使用编译的受管网络入口；源码目录须先运行 `npm run build`，运行包按 README 安装运行依赖即可，不需要开发依赖或源码。每次命令结束时关闭本次网络作用域和工作进程。运行包附带这份说明，位于 `.sakura-server/docs/delivery-cli.md`。

默认地址为 `http://127.0.0.1:7337`。`--url` 只接受本机 HTTP 根地址，拒绝远程主机和重定向。认证读取 `SAKURA_TOKEN`，也支持 `--token`。令牌属于本地管理会话，不应写入交付定义、源码或版本记录。

以下 PowerShell 示例从当前本地会话取得令牌。启用了应用锁时，先在界面解锁。

```powershell
$env:SAKURA_TOKEN = (Invoke-RestMethod http://127.0.0.1:7337/api/bootstrap).token
npm run delivery -- view --vm <实例ID> --project <项目ID>
```

命令输出 JSON，错误写入标准错误并返回非零退出码。`view --section` 可查看 `workbench`、`inputs`、`artifacts`、`runners`、`reports`、`gates`、`previews` 和 `releases`。

## 保存定义并捕获输入

`template-preview` 校验文件并显示待应用的定义。它不会保存定义，也不会执行命令。审阅命令、环境要求、联网权限和实际文件范围后，再显式保存。

```powershell
npm run delivery -- template-preview --file delivery.json --vm <实例ID> --project <项目ID>
npm run delivery -- template-save --file delivery.json --revision 0 --vm <实例ID> --project <项目ID>
npm run delivery -- input-preview --file delivery.json --vm <实例ID> --project <项目ID>
npm run delivery -- input-capture --plan <预览返回的token> --vm <实例ID> --project <项目ID>
```

更新已有定义时，同时传入 `--id` 和当前 `--revision`。文件可直接包含定义，也可包含预览返回的 `definition` 字段。草稿模式必须显式选择文件，并在 `input-preview` 中加入 `--reviewed-draft`。

源码捕获要求源实例已运行，项目账号已获授权，客户机具有系统 Git 和 Python 3。提交模式固定 Git 对象，草稿模式复核索引和文件摘要。默认排除 `.env`、私钥、缓存和依赖目录。符号链接、硬链接、特殊文件、子模块和未解析的 Git LFS 指针会阻塞捕获。路径冲突不会静默跳过。

输入预览展示完整文件清单、排除项和基础镜像摘要。确认令牌有效期为 5 分钟，只能使用一次。捕获前后发现源码、索引、项目配置或镜像变化时，重新预览。

## 执行和登记

```powershell
npm run delivery -- run --input <输入快照ID> --reviewed --vm <实例ID> --project <项目ID>
npm run delivery -- status --run <运行ID> --vm <实例ID> --project <项目ID>
npm run delivery -- cancel --run <运行ID> --vm <实例ID> --project <项目ID>
npm run delivery -- candidate --input <输入快照ID> --run <运行ID> --manifest <输出清单ID> --vm <实例ID> --project <项目ID>
npm run delivery -- gate-policy --file policy.json --vm <实例ID> --project <项目ID>
npm run delivery -- gate --file evaluation.json --vm <实例ID> --project <项目ID>
npm run delivery -- register --file registration.json --vm <实例ID> --project <项目ID>
```

`gate-policy` 文件包含规则字段和 `expectedRevision`。`gate` 文件包含 `candidate`、`policyId`、`evidenceIds`、`reviewed` 和可选的 `waivers`。`register` 文件包含 `candidateId`、`decisionId`、`namespace`、`version` 和 `notes`。字段约束以运行服务的 `/api/openapi` 为准；源码中的对应声明为 `shared/contracts/delivery-http.ts`。

运行请求成功只表示任务已登记。检查 `status` 中的执行结果和清理结果。资源清理失败或未知时，不把运行当成成功。版本登记仅更新本地版本目录，不部署外部系统。

## 导出和接收

```powershell
npm run delivery -- export --release <版本ID> --out app.sakura-delivery.zip --vm <实例ID> --project <项目ID>
npm run delivery -- import --file app.sakura-delivery.zip --vm <接收实例ID> --project <接收项目ID>
npm run delivery -- accept --file acceptance.json --vm <接收实例ID> --project <接收项目ID>
```

导出默认不附源码，加入 `--include-source` 后附带固定源码。需要签名时，使用 `--signing-key <受管秘密引用>`。CLI 不读取私钥，也不把私钥写入交付包。

传输块上限为 512 KiB。导入先流式计算摘要，再逐块上传并复核完整摘要；导出逐块写入临时文件，核验后发布目标文件。下载租约在 15 分钟内保护制品，结束时释放，到期必须重新开始。导出拒绝覆盖已有文件，失败时移除本次临时文件。上传失败保留服务器记录，可通过制品库的清理预览处理。

`import` 保存隔离导入记录，不执行包内命令。`acceptance.json` 需要 `id`、目标 `namespace`、`allowUntrusted` 和 `reviewed: true`。接收后仍需对导入候选执行 `validate-artifact`，产生本机验证证据。发布者的报告不会替代接收方的执行结果。

## 其他受控操作

`act --section <领域> --file <请求文件>` 提交公开 API 请求体。可用于预览启动与停止、运行恢复、规则比较、通道更新和接收验证。请求文件必须包含对应的 `action` 字段，服务端照常校验修订、授权和审阅要求。

以下示例验证已接收的制品，不要求附带源码。`candidate` 使用接收记录中的完整候选对象。

```json
{
  "action": "start",
  "input": {
    "mode": "validate-artifact",
    "candidate": {},
    "reviewed": true
  }
}
```

将候选内容填入 `candidate` 后，保存为 `acceptance-run.json`，执行：

```powershell
npm run delivery -- act --section runners --file acceptance-run.json --vm <接收实例ID> --project <接收项目ID>
```
