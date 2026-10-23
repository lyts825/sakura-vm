# 数据与实验工作台

`data-lab` 是 Sakura 2.6.0 新增的插件包。它面向单机、有界的表格分析，覆盖本地文件或受限 PostgreSQL 捕获、数据版本、SQL、质量检查、Python Notebook、参数实验、结果比较和数据交接。原 `lab` 包保持原有用途。

## 组件与依赖

| 插件               | 使用入口与结果                                             |
| ------------------ | ---------------------------------------------------------- |
| `data-runtime`     | 固定数据环境；查看计算状态、取消运行、核销遗留实例         |
| `data-sources`     | 上传文件、捕获项目内文件、读取凭据引用版本、只读捕获数据库 |
| `data-datasets`    | 按完整输入封存版本，生成脱敏副本，归档历史版本             |
| `data-transforms`  | 保存带修订的 SQL 和参数，在固定版本上执行                  |
| `data-quality`     | 保存质量规则，运行全量检查或明确标注的样本画像             |
| `data-notebooks`   | 保存 Notebook 定义，批执行或打开独立交互会话               |
| `data-experiments` | 创建最多 32 个组合的参数矩阵，按顺序执行和恢复剩余项       |
| `data-lineage`     | 查看版本父链、缺失祖先和有适用条件的指标比较               |
| `data-exchange`    | 导出独立 Study ZIP，验证、隔离接收和核对中断事务           |
| `data-workbench`   | 将上述步骤集中到一个工作台，仍经各服务的公共契约执行       |

包自动解析 `projects` 和 `delivery-artifacts` 等必需依赖，不要求启用整个 `delivery`、`foundry` 或 `app-runtime`。PostgreSQL 来源还需要启用可选的 `secrets` 插件。Notebook 使用本体的显式作用域 V2 端口，保留原 Notebook V1 调用的兼容性。

## 首次准备

1. 在插件管理中启用“数据与实验工作台”，打开顶层“数据与实验工作台”；已有来源实例时也可从项目开发分区进入。
2. 在“数据环境”选择“准备内置镜像环境”。首版环境准备接受 Debian 或 Ubuntu；内置基础镜像须已由 Sakura 下载准备。
3. 首次安装需要勾选“明确允许联网准备固定依赖”，审阅计划后提交。未勾选时只检查已有环境，缺少依赖会报错，不会自动联网。
4. 准备完成后得到一个固定镜像资产及摘要。后续计算默认使用隔离网络的新实例，不在来源实例或宿主 Python 中执行分析代码。

数据环境固定 DuckDB `1.5.6`、nbclient `0.11.0`、nbformat `5.10.4`、ipykernel `6.30.1` 和 JupyterLab `4.4.10`。环境资产摘要覆盖最终镜像；Python 和系统依赖以该镜像中的实际版本为准。首版已实际验证 Debian 12 / x86_64；Ubuntu、aarch64 不应仅因配置可选就视为已通过验证。

## 从文件完成一次分析

1. 在“数据来源”上传 UTF-8 CSV、JSONL 或 Parquet。上传只生成制品清单，随后审阅“登记上传来源”。也可以指定项目内的相对路径进行捕获，不能使用目录通配符。
2. 在“数据版本”选择来源，设置 CSV 分隔符、表头和空值标记，审阅并封存。可在高级参数中提供明确 schema；未提供时由引擎完整扫描输入并记录实际 schema。
3. 需要隐藏字段时，对该版本生成脱敏副本。支持删除列、常量替换、保留前缀和数值分桶。未列出的列保持原值，原始版本不被覆盖；“脱敏”表示执行了所选规则，不是对任意内容的匿名性保证。
4. 在“SQL 变换”保存查询。输入按所列顺序绑定为 `data_0`、`data_1` 等；参数使用 `$threshold` 一类命名占位符。只接受单条 SELECT。写语句、扩展安装和对额外文件的读取会失败。
5. 在“质量验证”保存并运行规则。支持非空、唯一键、数值范围、允许值、行数和引用列匹配。`sample: 0` 表示全量；大于 0 时只检查前 N 行，并明确标为样本。没有规则时只能得到画像，不能得到“全量规则通过”。
6. 在“血缘与比较”选择两条执行证据。输入、代码或参数、镜像、执行环境、schema 或抽样范围不同会显示条件差异；无同名数值指标时不进行数值差值，也不推断显著性或任意逐行配对。

文件捕获会检查普通文件、链接、身份变化和摘要。版本摘要覆盖完整内容清单、解析方式、schema、父版本和不可变执行定义摘要；不把可变运行状态或结果自身摘要放入定义，从而避免自引用。

### 数据格式与预算

| 项目      | 首版限制                                                                    |
| --------- | --------------------------------------------------------------------------- |
| 格式      | UTF-8 CSV；逐行对象的扁平 JSONL；标量列 Parquet                             |
| 数据版本  | 最多 128 个指定文件，合计 512 MiB                                           |
| 单次计算  | 输入 1 GiB，输出 256 MiB；超限失败，不以截断结果封存完整版本                |
| 资源      | 默认 2 CPU、2 GiB；超时默认 300 秒、最高 1800 秒；DuckDB 临时目录预算 4 GiB |
| 并发      | 全局最多 4 个计算，每个项目最多 2 个；交互会话每项目最多 2 个               |
| Notebook  | 最多 500 个单元，单元输出 1 MiB，总单元输出 32 MiB                          |
| 实验      | 最多 32 个参数组合，顺序执行                                                |
| Study ZIP | 包括头部及目录在内最多 1 GiB；STORE 格式，拒绝 ZIP64、压缩条目和未声明内容  |

复杂结构、嵌套列、未知类型和无法无损解释的值应先显式转换。CSV/JSONL 中超出安全推断精度的数字需要明确 schema；需要保留文本时选 VARCHAR。首版拒绝 TIMESTAMP_NS，避免 Python 日期对象截断纳秒。CSV 结果使用记录在 schema 中的类型和保留空值标记；出现保留标记碰撞时拒绝输出。解析失败不会忽略坏行并冒充全量成功。质量样本取前 N 行，不是随机抽样，不能推断全量合格率。

## PostgreSQL 只读捕获

首版接受 PostgreSQL 18，连接目标必须同时指定 TLS 主机名和明确 IP 地址。客户端经宿主受管网络租约连接固定 IP，并校验主机证书。自签 CA 可显式提供；不能关闭证书验证。

先在项目所属实例的“私密配置”中保存密码，再使用“读取凭据引用版本”操作，获得 `{name, version}`。捕获连接只接受 `secretRef` 和该不透明 `secretVersion`，不接受密码正文。提交时在同一秘密锁内核对版本并解析，轮换、删除或重建引用会使旧计划失败。

连接配置示例：

```json
{
  "host": "db.example.test",
  "address": "192.0.2.10",
  "port": 5432,
  "database": "analytics",
  "user": "readonly_capture",
  "secretRef": "PG_PASSWORD",
  "secretVersion": "填入读取到的引用版本",
  "schema": "public",
  "table": "measurements",
  "columns": ["id", "amount"],
  "timeoutSeconds": 60
}
```

捕获使用 `REPEATABLE READ READ ONLY` 事务、固定表列和分批游标，完成后回滚并关闭连接。拒绝超级用户、绕过 RLS 的账号、对目标表有写权限的账号，以及 RLS、生成列、继承/分区、视图、外表和自定义类型。SQL 文本不由用户提供。

为保留 PostgreSQL 大整数、定点数和时间戳的文本精度，捕获输出是 JSONL，列保留数据库文本表示，parse hint 固定为 VARCHAR；日期采用 ISO，时区固定为 UTC。需要数值计算时在后续 SQL 中显式 CAST。客户端不声称能够消除外部数据库服务器、扩展或运维配置产生的全部读时行为。

## Notebook 与参数实验

“保存 Notebook”只保存清除既有输出的 nbformat 4 定义，不执行代码。默认只能绑定脱敏版本；绑定原始版本、执行原始输入和导出原始数据需要各自明确授权。任意 Python 输出不能靠自动内容扫描保证安全。

“执行 Notebook”在新实例和干净内核中执行全部代码单元。当前目录提供 `parameters.json`、`datasets.json` 和 `inputs/` 下的只读输入副本。代码可以将有限数值指标写入 `output/metrics.json`；执行后的 Notebook 和指标进入结果制品。单元报错、超时、输出超额或清理未知都不会显示执行成功。

“打开交互会话”创建专属分析实例，提供 `analysis.ipynb` 和本机回环访问入口。交互编辑不自动改变已保存定义，也不产生一条已完成批执行证据。需要可比较结果时，将编辑后的 Notebook 明确保存为新修订，再执行。关闭会话会停止 Notebook，并依据原创建回执销毁专属实例。

参数实验固定定义修订和最多 32 个参数组合。开始执行后按顺序调用 SQL 或 Notebook；每项保留独立执行证据。失败后显示 `partial`、`failed` 或 `cancelled`，重新执行只处理尚未成功的组合。定义已经改变时必须重新计划；不会悄悄用新代码继续旧实验。

## Study 交接与引用保留

导出包含明确选中的数据版本与其完整文件清单；还可以指定最多 32 条执行证据，携带对应 SQL/质量规则/Notebook 定义、完整结果文件、指标及环境版本清单。选择执行证据时必须另行勾选允许导出输出，任意 Notebook 内容不保证自动脱敏。所选证据的全部输入必须已经在所选版本内，否则拒绝导出。若某个脱敏版本的原始父版本没有选中，Study 记录缺失祖先和声明的数据起点，不自动带出原始数据。

容器根文件为 `study.json`，类型为 `sakura-data-study-v1`，schema 为 1。首版不支持签名，接收端不能把摘要通过解释为发布者可信。它也不能被当作 `sakura-delivery` 发布包接收。

Study 核验所选数据字节、schema 元数据、版本摘要、父链声明和选定执行的定义及输出一致性。执行采用的镜像摘要与版本会被记录，但镜像字节本身不进入 Study；缺失镜像明确列在 `missingEnvironmentImages`。缺少祖先或镜像时，不能把摘要通过解释为整个过程可离线重跑。导入后用“查看研究资料清单”审阅定义和证据；接收不会将外部运行冒充本地已验证运行。

接收步骤为：上传 ZIP → 验证内容 → 保存隔离记录 → 审阅新命名空间 → 接收。拒绝路径越界、大小写冲突、重复条目、摘要错误、缺失文件、额外文件和不支持的容器。接收不会执行 Notebook 或 SQL，也不会授予信任。接收中断时保留 `accepting` 意图，使用“核对中断的接收”核实本地版本后再继续。

历史来源、运行、数据版本和导出持有制品业务引用。归档或停用插件保留这些引用，不等于删除内容。制品库 GC 只能处理没有业务引用和下载保护的内容；不应直接删除其存储文件来释放空间。

## HTTP 与 CLI

所有分区使用 `/api/data-<section>?vmId=<id>&projectId=<id>`。GET 返回所属记录；POST 分为两步：

```json
{ "phase": "preview", "input": { "action": "graph" } }
```

```json
{ "phase": "commit", "token": "预览返回的一次性 token" }
```

计划绑定插件代次、明确项目和定义修订，十分钟后失效，只能消费一次。执行前再次核对；定义变化、插件撤销和重复提交均需重新预览。UI 与 CLI 使用相同端口，首版仅允许 owner 控制权限。

```powershell
npm run data -- view --vm <id> --project default
npm run data -- preview --vm <id> --project default --file action.json
npm run data -- commit --vm <id> --project default --plan <token>
npm run data -- upload --vm <id> --project default --file table.csv
npm run data -- download --vm <id> --project default --manifest <id> --out data-study.zip
```

通过 `SAKURA_TOKEN` 提供认证，CLI 使用宿主控制头 `x-sakura-token`。CLI 仅接受本机 HTTP 地址；文件按 512 KiB 分块传输并校验摘要，下载不会覆盖已有目标。`--section` 可指定单个插件；默认使用工作台。动作字段的准确约束见 [请求 schema](../shared/contracts/data-services.ts)，不要将密码写入动作 JSON。

顶层“数据与实验工作台”提供 `local/default` 本地档案，无需先创建来源实例即可上传文件、准备执行环境和分析。项目文件捕获及 PostgreSQL 凭据引用需要选择实际来源实例；本地档案不会模拟实例身份。

### 离线核验 Study

收到 Study ZIP 后，可在未启动 Sakura 的机器上核验。此命令只需要 Node.js，无需账户、token、VM、网络或编译后的服务器文件；源码目录和运行包使用同一入口。

```powershell
node scripts/data.mjs verify --file data-study.zip
```

核验器按 512 KiB 分块读取，接受最多 1 GiB、10000 个文件的 UTF-8 STORE ZIP。它检查本地头与中央目录、边界、CRC-32、安全路径、重复和大小写冲突，并核对每个声明文件的完整 SHA-256。压缩、加密、ZIP64、额外条目和不支持的元数据字段都会失败；命令不会提取、导入或执行内容。

`study.json` 的 `coreDigest` 覆盖除自身以外的完整 Study 元数据，按数据契约的键排序规则计算。核验同时检查数据版本、制品清单、执行定义和结果文件，以及输入引用、缺失祖先、缺失环境镜像和缺失输出版本的准确声明。存在未携带内容时，结果明确列出对应 ID 或摘要。

成功时输出 JSON，包含 `valid: true`、整包摘要、`coreDigest`、文件数量和缺失项；失败以非零退出码结束。`signature: "unsigned"` 和 `publisherIdentity: null` 表示没有发布者身份证明。摘要通过只确认包内字节与声明一致，不证明外部执行真实，也不证明整个过程可以离线重跑。更改内容并重新计算全部摘要的人仍能生成另一个未签名包。

## 取消、重启与验证范围

计算状态为 `queued → preparing → running → collecting → succeeded/failed/cancelled`，清理结果单独记录 `pending/confirmed/unknown`。运行成功必须同时确认专属实例清理；未知状态需要“核销遗留实例”，不能仅按 PID 或端口杀进程。

环境准备单独保留 `preparations` 意图、原实例身份及清理状态；重启后使用 `reconcile-preparation` 核销中断准备。参数实验首次运行固定环境与预算，续跑拒绝更换环境。

停用时停止新增操作，等待正在取消的计算和会话核销。重启不自动重放计算、远程捕获或内核状态；未终结运行标为 `interrupted`，交互会话标为 `review`。元数据使用严格 schema 和宿主原子修订写入，损坏或未来格式不会当成空数据覆盖。旧 Notebook 会话不自动归属本包。

实现与测试结论按 [项目状态](../PROJECT_STATUS.md) 的当前验收记录为准。设计提案保留在 [包设计](data-lab-pack-design.md)，其中数据库/架构矩阵等验收项不能据提案视作已验证。
