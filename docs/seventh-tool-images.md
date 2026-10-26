# 第七批固定工具镜像

## 准备方式

调度探针、扩展编译、协议状态测试和多服务仿真使用独立的 Alpine x86_64 虚拟机。每次执行从本体 `ImageAssetsV1` 登记的镜像创建隔离副本。运行阶段不下载软件包，不读取宿主共享目录。

新安装可以使用“环境镜像工坊”制作工具镜像，也可以显式导入已有的独立 qcow2。运行包不包含开发者的测试镜像。导入完整性通过后，首个工具任务仍须通过客户机依赖探针。

当前真实宿主执行要求 Windows x64 的原生监管可用。四个工程 profile 各自全局最多保留 1 个活动或未核销会话。默认容量不足时应先由管理员设置 `SAKURA_SUITE_CAPACITY_BYTES`；一台工具 VM 至少预留 8 GiB，另计镜像和材料。不要将清理未确认的会话当作可用空位。

## 在本体内制作镜像

在插件管理中显式启用 `foundry`，重启服务。镜像工坊是准备工具，不是四个工程包的必需运行依赖。已有合格镜像时可直接导入。

先从发行版镜像页显式下载支持的 Alpine x86_64 基础镜像，再在镜像工坊“来源”固定它。保留原 SSH、Tiny Cloud 首次启动初始化和 cgroup v2 支持；缺少初始化器或真实 cgroup 时，后续阶段会拒绝执行。来源阶段也可使用现有独立 qcow2，不会修改原镜像。

在“蓝图”选择来源，填写所需包与验收命令。下面的 JSON 可交给工坊 CLI；将 `sourceId` 替换为来源阶段返回的 UUID。蓝图中的命令经过明确审阅后，只在工坊客户机中执行。

```json
{
  "action": "save",
  "expectedRevision": 0,
  "blueprint": {
    "name": "第七批 Alpine 工具",
    "sourceId": "<来源记录 UUID>",
    "packages": ["python3", "clang21", "lld21", "musl-dev", "linux-headers"],
    "commands": [
      "python3 -I -S -c 'import json,socket,http.server,http.client,threading,subprocess,hashlib;import sys;print(sys.version.split()[0])'",
      "clang --version && wasm-ld --version"
    ],
    "tools": ["python3", "clang", "wasm-ld"],
    "memoryMiB": 2048,
    "timeoutMinutes": 30
  }
}
```

仅使用调度、协议和多服务工具时，Python 3 已满足这些 profile 的工具依赖。上面的联合蓝图另含扩展编译器。已实测的组合为 Python 3.12.15、Clang 21.1.2 和 LLD 21.1.2。仓库返回其他版本时，以材料清单和真实探针为准，不能沿用这组版本的验收结论。

依次完成“离线材料 → 制作 → 身份清理 → 验收 → 镜像库发布”。只有离线材料阶段在明确批准后创建 NAT 临时实例，取得当前基础镜像仓库中的软件包。材料镜像、包文件名、版本和 SHA-256 随结果保存。制作、清理和双实例验收继续断网。缺包失败时修订蓝图并重新取材，不会在运行工具时补装依赖。

对应 CLI 为：

```powershell
node scripts/foundry.mjs act --section blueprints --workspace tools --file seventh-blueprint.json
node scripts/foundry.mjs plan --section depot --workspace tools --task materials --id <蓝图记录ID> --reviewed
node scripts/foundry.mjs execute --section depot --workspace tools --plan <计划令牌> --reviewed
```

后续各阶段使用相同的 `plan`、`execute` 形式。`build` 在 `builders` 引用成功的材料记录；`sanitize` 在 `sanitizers` 引用成功的制作记录；`check` 在 `checks` 引用清理后的记录；`publish` 在 `catalog` 引用成功且已核销资源的双实例验收记录。计划只用一次，执行前核对网络范围和输入摘要。完整操作与恢复方式见 [环境镜像工坊](foundry-workbench.md)。

发布记录中的 `image.id` 和 `image.digest` 来自本体镜像账本。四个工程包的 `images` 命令可读取同一镜像，无需重复导入。保留工坊验收记录，再用 `--image <digest>` 显式运行工具模板。

## 导入已有镜像

启用相应工程包并重启服务，配置账户模式需要的 `SAKURA_TOKEN`。以下命令只向本机已认证 API 传输普通文件，不启动宿主命令，不下载依赖：

```powershell
npm run sakura -- extension-forge image-import D:\images\seventh-prepared.qcow2
npm run sakura -- extension-forge images
npm run sakura -- extension-forge image-verify <镜像SHA-256>
```

CLI 接受无 backing 链的 qcow2 v2/v3；文件最多 32 GiB，虚拟容量最多 128 GiB。它按 512 KiB 分块上传，并核对完整 SHA-256。最终格式检查和不可变资产登记由本体执行。文件名与镜像摘要不证明来源可信；导入前应了解镜像来源和内容。

中断后先查询原上传，再从本体已确认的偏移继续。不要为同一中断自动创建新上传：

```powershell
npm run sakura -- extension-forge image-imports
npm run sakura -- extension-forge image-import D:\images\seventh-prepared.qcow2 --resume <原上传ID>
npm run sakura -- extension-forge image-discard <不再需要的原上传ID>
```

`schedule-lab`、`protocol-state` 和 `service-virtualization` 提供相同的镜像命令。上传归属固定到原主体和消费者，恢复应使用原包与同一账户。镜像创建结束后可通过 `images` 在其他工程包读取公共资产。

## 执行与核销

先创建本包空间，再读取模板。模板 ID 以当前服务返回的值为准：

```powershell
npm run sakura -- extension-forge spaces create create-space.json
npm run sakura -- extension-forge templates
npm run sakura -- extension-forge run-template <workspaceId> <templateId> --image <镜像SHA-256> --seconds 120
```

`create-space.json` 的内容为 `{"name":"扩展编译空间"}`。只对 `start` 模板设置 `--image` 和 `--seconds`。其他模板可用覆盖参数 JSON；固定动作仍由服务解析，CLI 不能选择解释器、shell 或任意工具。

原计划与工具回执保留输入摘要、实际工具版本、准确 VM 身份和清理结果。请求中断后用原领域的 `status` 查询，必要时 `reconcile` 核销原资源；恢复不会重放编译或网络请求。清理为 `pending` 或 `unknown` 时保留预留，并返回退出码 4。退出码 1 表示已知业务失败，2 表示输入或传输错误，3 表示不确定或不支持。工具未通过时，不能以 HTTP 请求成功作为验收通过。
