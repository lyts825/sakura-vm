# 环境镜像工坊

## 用途与安装

`foundry` 把已准备的 Linux 基础镜像制作为可重复使用的离线环境。每次制作固定来源字节、软件包材料和蓝图修订。制作完成后清除已知凭据与机器身份，再用两台隔离实例独立验收。

在插件管理中启用“环境镜像工坊”包。包内有 9 个插件，可分别查看阶段记录；启用单个插件时，管理器会检查必需依赖。`environment`、`app-runtime`、`data-lab` 和 delivery 均不是本包的必需依赖。

启用后，从主导航打开“环境镜像工坊”。没有 VM 时也能进入全部阶段，制作首个镜像。已有 VM 的开发页入口继续保留。

| 插件 | 页面与用途 | 必需插件依赖 |
| --- | --- | --- |
| `foundry-sources` | 固定本地基础镜像，分块导入 QCOW2 | 无 |
| `foundry-blueprints` | 保存包清单、命令和验收工具的新修订 | sources |
| `foundry-depot` | 显式联网取得包及其依赖，保存摘要清单 | sources、blueprints |
| `foundry-builders` | 在断网实例内安装已固定材料、执行蓝图 | sources、blueprints、depot |
| `foundry-sanitizers` | 清除已知凭据和身份，恢复首次启动初始化 | builders |
| `foundry-checks` | 两次独立启动，检查工具、编译器、身份和隔离 | sanitizers |
| `foundry-catalog` | 发布、撤回、实例化和回收镜像 | sources、builders、sanitizers、checks |
| `foundry-exchange` | 交接清单、隔离导入和显式接受 | sources、catalog、checks |
| `foundry-workbench` | 阶段导航与汇总 | 前面 8 个插件 |

所有插件通过本体 `ImageAssetsV1` 使用镜像内容和资源账本。停用工坊后，本体仍保留持久实例、引用、租约和未确认资源。

## 完成一次制作

1. 从主导航打开“环境镜像工坊”，选择工坊空间。也可从已有 VM 的开发页进入。空间名称只用于隔离工坊记录，不会绑定或替换 VM。
2. 在“来源”选择发行版和架构，点击“固定已准备的基础镜像”。本地没有基础镜像时，先在发行版镜像页明确下载。也可上传独立 QCOW2；系统核对全长 SHA-256、长度、格式和无 backing file 条件。
3. 在“蓝图”选择来源和模板，审阅包名、命令、工具、内存及期限，然后保存。修改蓝图会创建新记录，原修订保留。
4. 在“离线材料”预览计划，确认联网范围后执行。只有此阶段创建 NAT 临时实例。系统取得包及依赖，保存含版本文件名的 SHA256SUMS 和材料容量。
5. 在“制作”选择成功材料记录，预览并执行。实例从创建起就是 `isolated`；安装只读取已下载材料。缺包会失败，不会降级到联网安装。
6. 在“身份清理”封存干净副本，再进入“验收”。每个阶段都创建独立磁盘，不修改用户基础镜像。
7. 验收成功且清理为 `confirmed` 后，在“镜像库”发布。记录保留实际工具、包版本和双实例验证结果。

默认模板包含 Python、tmux、C 编译器及 libc/Linux 头文件、网络工具、账户工具和防火墙工具。Node.js 模板另含 Node.js 与 npm。页面根据 Debian/Ubuntu 来源把 Alpine 的账户包和头文件包映射到相应名称；自定义蓝图应自行填写目标发行版的包名。

包的版本在联网取材后固定到材料镜像及摘要清单。之后的制作与验收均断网。固定来源不保证两次制作逐字节相同：包维护脚本、时间和随机标识仍可能影响输出。

## 身份清理与验收

固定清理策略删除 root 的常见历史、npm/PyPI/Netrc/Git 凭据、SSH 目录、AWS/Azure/gcloud/Docker 凭据、APT 认证配置、cloud-init 缓存和日志，以及机器 ID、SSH 主机密钥。封存前检查关键路径不存在；首次启动重新注入控制授权并生成身份。

Alpine 镜像在封存前恢复 Tiny Cloud 的四个初始化钩子。Debian/Ubuntu 使用 cloud-init 和 systemd。镜像缺少支持的初始化器时，清理阶段拒绝继续。自定义命令写到其他路径的秘密不在这份固定清理清单中；蓝图、命令和证据会持久保存，不应把秘密直接写入其中。

验收启动两台独立隔离实例，核对所需工具、C 头文件实际编译、独立机器 ID、独立 SSH 主机密钥和独立控制公钥。它还用普通 UID 验证 root 私有文件不可读，并验证外部 TCP 连接失败。两台 VM 都准确停止并删除后，记录才允许发布。

## 使用、撤回和回收

“创建持久隔离实例”生成独立可写磁盘。新实例初始停止，可在本体 VM 页面启动。成功创建后，实例拥有持久归属和资产引用；15 分钟读取租约到期不会让它停机。临时制作与验收实例仍受计划中审阅的绝对期限约束。

消费者通过 `FoundryCatalogV1.previewUse/authorizeUse` 得到固定 `imageRef` 和修订摘要，再用自己的本体身份取得引用或创建 VM。目录不替消费者持有引用。镜像失效时，调用失败，不会改用默认镜像。

撤回阻止新授权，保留已有引用和实例。归档已结束的记录会释放该记录的引用；发布记录须先撤回。镜像库的“预览无引用镜像”列出可回收内容和受保护内容，确认后才删除。预览后引用变化会使计划失效，需要重新预览。未知文件和归属不明的 VM 保留。

delivery 的定义编辑器提供“使用工坊已发布镜像”。选择工坊空间并读取目录后，明确选择修订，再重新审阅和捕获输入。捕获核对目录仍已发布、修订未变化，并为输入持久保留镜像。运行和预览直接按固定 `imageRef` 创建独立实例，记录本体归属回执；后续撤回不改变已经冻结的输入。工坊缺席时仍可使用旧基础镜像，或在高级 JSON 中指定本体已注册的 `imageRef`。已选引用缺失时拒绝执行，必须明确重新选择后才能改回基础镜像。

## 导入与交接

页面支持原始 QCOW2 分块上传与流式磁盘下载，并显示交接描述。浏览器下载需要 `showSaveFilePicker`；不支持时使用下面的 CLI。页面不会把数 GiB 的镜像拼成一个内存 Blob。

CLI 使用单文件 `sakura-image-v1` 交接格式：格式标识、最长 1 MiB 的元数据头、一段完整 QCOW2 和 32 字节校验尾段。导入核对总长度、磁盘 SHA-256，以及覆盖格式头、元数据和磁盘的整体 SHA-256；整体摘要不包含尾段自身。本实现仅接受明确 `signature: null` 的交接头，并把来源标记为“未认证”；完整性校验不认证来源，它不提供签名生成或签名信任链。

交接导入先进入 `quarantined`。显式接收后变为 `accepted`，不会启动内容。将交接描述中的 `image` 和 `blueprint` 交给“身份清理”的导入入口，再执行清理和本机验收，才能发布。导入不覆盖同名镜像，也不替换基础镜像目录。

中断上传保留在“未完成上传”。完整内容可以重新核验并完成导入；废弃暂存可以按上传 ID 丢弃并释放配额。丢弃只操作当前插件和工坊空间拥有的暂存。状态提交失败时保留恢复记录。

## CLI

先构建并启动 Sakura。CLI 是纯 Node 脚本，使用发行包的受管网络入口，不依赖 tsx。认证令牌放入 `SAKURA_TOKEN`，或明确传入 `--token`。默认地址为 `http://127.0.0.1:7337`，可用 `--url` 指定其他本机端口。

```powershell
node scripts/foundry.mjs help
node scripts/foundry.mjs view --section workbench --workspace local
node scripts/foundry.mjs act --section sources --workspace local --file source-action.json
node scripts/foundry.mjs plan --section depot --workspace local --task materials --id <蓝图ID> --reviewed
node scripts/foundry.mjs execute --section depot --workspace local --plan <计划令牌> --reviewed
node scripts/foundry.mjs export --section catalog --workspace local --id <发布记录ID> --out environment.sakura-image
node scripts/foundry.mjs import --workspace local --file environment.sakura-image
```

`source-action.json` 示例：

```json
{"action":"prepare","distro":"alpine","architecture":"x86_64","reviewed":true}
```

通用 `act` 接受页面同一套严格动作模型。接收导入使用 `plan --section exchange --task accept --id <导入记录ID> --reviewed`，再执行该计划。丢弃暂存的动作是 `{"action":"discard-import","id":"<上传ID>","reviewed":true}`。CLI 导出拒绝覆盖现有文件；失败产生的 `.part` 文件保留在指定目标旁，核对后可删除。

## API 与运行边界

9 个阶段使用 `/api/foundry-<阶段>` 的 GET/POST，查询参数为 `workspaceId`。阶段取值是 `sources`、`blueprints`、`depot`、`builders`、`sanitizers`、`checks`、`catalog`、`exchange` 和 `workbench`。路由要求已认证的 owner 会话。GET 返回阶段记录、可执行任务、计划、模板和当前空间未完成上传；POST 接受 [严格动作模型](../shared/contracts/foundry.ts)。

计划有效期为 5 分钟，执行后立即消费；输入摘要变化会拒绝执行。读取租约为 15 分钟，分块上限 512 KiB。单镜像最多 32 GiB，虚拟容量最多 128 GiB，镜像库及已登记暂存预算合计 128 GiB，同时最多 32 个上传和 128 个读取租约。材料最多 2 GiB；蓝图最多 64 个包、20 条命令，内存 512–8192 MiB，临时实例期限 5–180 分钟。

取消任务会停止后续工作并回收准确归属的 VM。清理不确定时显示 `unknown`，需要用“恢复原资源清理”处理。恢复读取本体持久账本，不依赖可能缺失的插件回执。重启不会自动重放制作、联网或发布；恢复只清理原身份资源。

本次真实验收覆盖 Alpine x86_64 的完整制作、身份清理、双实例断网检查、持久实例、CLI 交接、取消和恢复。Debian、Ubuntu 与 aarch64 的输入和适配路径存在，尚未在本次验收中分别完成真实流水线。详细设计与后续扩展边界见 [设计文档](foundry-pack-design.md)。
