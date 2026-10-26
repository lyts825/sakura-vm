# 通知模板工作室插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；应用保持 2.8.1，核对基线为 `4afb3b9a`。包 ID 为 `notification-template-studio`，包含 14 个拟议插件，运行实现待开始。共同约定见[第七批总览](plugin-pack-seventh-design.md)。

用户维护多渠道通知模板、变量和语言版本，使用合成收件人渲染样例，检查缺项、长度与转义，再将结果送入本地虚拟收件箱复核，交付模板版本及覆盖证据。首版不发送邮件、短信、推送或聊天消息。

[本地化](localization-studio-pack-design.md)继续负责翻译与术语流程，[可观测性规则](observability-studio-pack-design.md)负责告警条件回放，[事件队列](event-lab-pack-design.md)负责消息代理实验。本包只负责通知内容、渲染语义和本地模拟投递。

## 2. 内部插件与直接依赖

所有插件、服务和方法均为拟议，依赖使用完整 ID。原模板、资产、渲染件和虚拟投递各有唯一所有者。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `ntpl-spaces` 通知空间 | 空间、模板、额度和访问修订；NtplSpacesV1：create、templates、archive | — | — |
| `ntpl-variables` 变量约定 | 字段类型、必填、默认值和敏感标记；NtplVariablesV1：define、validate | `ntpl-spaces` | — |
| `ntpl-channels` 渠道档案 | 站内、纯文本和受限邮件的长度/内容规则；NtplChannelsV1：define、check | `ntpl-spaces` | — |
| `ntpl-templates` 内容模板 | 标题、正文、片段及有限条件语法；NtplTemplatesV1：compose、parse、diff | `ntpl-spaces`, `ntpl-variables`, `ntpl-channels` | — |
| `ntpl-locales` 语言变体 | 语言、格式约定、回退顺序和变量覆盖；NtplLocalesV1：define、checkCoverage | `ntpl-spaces`, `ntpl-variables`, `ntpl-templates` | — |
| `ntpl-assets` 模板资产 | 本地 PNG/JPEG、尺寸、替代文本与许可；NtplAssetsV1：upload、inspect、pin | `ntpl-spaces` | — |
| `ntpl-audiences` 合成收件人 | 明示为合成的成员、变量、偏好和边界样例；NtplAudiencesV1：define、generate | `ntpl-spaces`, `ntpl-variables`, `ntpl-locales` | — |
| `ntpl-rules` 内容选择 | 模板/语言/渠道选择及本地抑制规则；NtplRulesV1：compose、simulate | `ntpl-spaces`, `ntpl-channels`, `ntpl-templates`, `ntpl-locales`, `ntpl-audiences` | — |
| `ntpl-renders` 固定渲染 | 完整渲染计划、文本/HTML 字节及逐样例来源；NtplRendersV1：preview、start、status、cancel、reconcile | `ntpl-spaces`, `ntpl-variables`, `ntpl-channels`, `ntpl-templates`, `ntpl-locales`, `ntpl-assets`, `ntpl-audiences`, `ntpl-rules` | — |
| `ntpl-inboxes` 虚拟收件箱 | 本地模拟投递意图、去重记录及渲染引用；NtplInboxesV1：previewDelivery、deliverLocal、list、reconcile | `ntpl-spaces`, `ntpl-audiences`, `ntpl-rules`, `ntpl-renders` | — |
| `ntpl-checks` 内容检查 | 未定义变量、转义、长度、链接及语言缺项；NtplChecksV1：evaluate、explain | `ntpl-spaces`, `ntpl-variables`, `ntpl-channels`, `ntpl-templates`, `ntpl-locales`, `ntpl-assets`, `ntpl-renders`, `ntpl-inboxes` | — |
| `ntpl-releases` 模板版本 | 固定来源、覆盖、人工复核和接受记录；NtplReleasesV1：assemble、review、seal | `ntpl-spaces`, `ntpl-variables`, `ntpl-channels`, `ntpl-templates`, `ntpl-locales`, `ntpl-assets`, `ntpl-audiences`, `ntpl-rules`, `ntpl-renders`, `ntpl-inboxes`, `ntpl-checks` | — |
| `ntpl-exchange` 通知交接 | 模板、资产和选定模拟证据的封套；NtplExchangeV1：export、inspectImport、acceptImport | `ntpl-spaces`, `ntpl-variables`, `ntpl-channels`, `ntpl-templates`, `ntpl-locales`, `ntpl-assets`, `ntpl-audiences`, `ntpl-rules`, `ntpl-renders`, `ntpl-inboxes`, `ntpl-checks`, `ntpl-releases` | — |
| `ntpl-workbench` 通知工作台 | 模板编辑、渠道/语言矩阵和虚拟收件箱导航；NtplWorkbenchV1：view、templates | `ntpl-spaces`, `ntpl-variables`, `ntpl-channels`, `ntpl-templates`, `ntpl-locales`, `ntpl-assets`, `ntpl-audiences`, `ntpl-rules`, `ntpl-renders`, `ntpl-inboxes`, `ntpl-checks`, `ntpl-releases`, `ntpl-exchange` | — |

虚拟收件箱仅保存本地条目和渲染引用。`deliverLocal` 不访问外部服务，没有真实地址或密钥参数；本地去重结果不得表述为邮件服务的实际投递保证。

## 3. 模板与完整流程

| 模板 | 内容 | 验证重点 |
| --- | --- | --- |
| 状态变化通知 | 前后状态、对象名称和本地详情标识 | 缺失变量、文本转义和重复事件 |
| 周期摘要样例 | 有界条目列表、合计和空状态 | 长度、列表上限及没有数据时的文案 |
| 多语言操作提示 | 有效时间、语言回退和替代说明 | 时区格式、变量齐全及语言覆盖 |

1. 创建空间，定义变量类型、渠道档案和合成收件人字段。
2. 编辑模板和片段，选择语言变体、日期格式及回退顺序。
3. 上传本地资产并检查许可、尺寸与替代文本；链接只记录声明，不主动访问。
4. 定义内容选择与本地抑制规则，创建正常、缺失和边界样例。
5. 预览完整语言/渠道/样例矩阵，批准有界渲染，查看逐项错误。
6. 将选定渲染结果显式写入虚拟收件箱，核对重复、抑制及显示顺序。
7. 复核文字和覆盖缺项，封存模板版本，导出模板、资产及选定证据。
8. 接收端核验后建立新空间；真实投递若后续实现，须另有明确连接器与授权设计。

## 4. 语法与模拟边界

模板语法只支持类型化变量、有限条件、有界列表和固定格式器。片段引用必须无环；拒绝任意 JavaScript、动态模板加载和外部查询。默认转义按输出上下文执行，禁止将普通变量直接标为可信 HTML。

首版渠道为站内消息、纯文本消息和受限 HTML 邮件样例；不实现 SMTP、短信运营商、移动推送或第三方聊天协议。长度档案由用户显式选择并保留版本，不声称与任意实际服务限制一致。

拟议宿主接口 `NotificationRenderComputeV1` 在受管有界计算 worker 中执行固定语法解析、格式和渲染。工具不得读取网络、密钥或任意路径。受限 HTML 预览在隔离渲染器显示，禁止脚本、表单提交及外部资源加载。

日期和数字格式固定语言、时区、格式器版本及参考时点。“现在”必须从计划读取，不依赖回放时系统时钟。缺失语言按固定回退表处理，并同时报告发生回退的条目。

虚拟投递固定事件 ID、合成收件人 ID、模板修订及本地去重窗口。同一内容被不同事件触发仍是两个条目；抑制决定保存原因。模拟成功只代表本地条目已持久化，不代表真实消息送达、阅读或退信。

## 5. 页面、HTTP 与 CLI

页面包括变量、模板、语言、渠道、资产、样例、选择规则、渲染、虚拟收件箱和版本。渲染矩阵显示总数、缺项和失败；邮件样例始终有“本地预览”状态，不展示真实送达标识。

以下均为拟议鉴权 POST 路径，CLI 前缀为 `sakura notifytpl`。不存在 `send`、任意收件地址或外部服务分发入口。

| 操作 | HTTP 路径 | CLI 动作 |
| --- | --- | --- |
| 模板解析 | `/api/ntpl-templates/parse` | `template check` |
| 语言覆盖 | `/api/ntpl-locales/checkCoverage` | `locales check` |
| 渲染计划/执行 | `/api/ntpl-renders/preview`、`/api/ntpl-renders/start` | `render preview/start` |
| 查询/停止/核销 | `/api/ntpl-renders/status`、`/api/ntpl-renders/cancel`、`/api/ntpl-renders/reconcile` | `render status/cancel/reconcile` |
| 本地投递 | `/api/ntpl-inboxes/previewDelivery`、`/api/ntpl-inboxes/deliverLocal` | `inbox preview/deliver-local` |
| 检查与交接 | `/api/ntpl-checks/evaluate`、`/api/ntpl-exchange/export` | `checks evaluate`、`export` |

离线 `verify` 核对模板语法、引用、清单及模拟记录，不访问模板中的链接，也不发送或重新投递消息。

## 6. 容量、恢复与交接

设计上限为 100 个模板、20 种语言、3 个渠道和 500 个合成成员；单次渲染矩阵最多 5,000 项，每项 256 KiB、总输出 64 MiB。模板深度 16、单列表 100 项、计算最多 2 分钟，同时一个渲染任务。

单包 1 GiB，封套 128 MiB，虚拟收件箱最多 10,000 条，含 32 MiB 恢复账本。原资产、渲染件、隔离接收和暂存均计费。上限待实测，现有共同 8 GiB 不构成本包已接入的证据。

语法错误、循环、变量类型不符及矩阵超限在执行前拒绝。渲染部分失败逐项保留，不能让成功样例掩盖缺失语言。未知投递结果按原本地意图查询，不能因重试建立重复条目。

仅现有 owner 权限有效；合成成员标签不成为真实用户账号。升级保留语法版本、旧渲染及映射；导入不携带秘密、批准或真实地址。发布版本保护资产与选定证据，清理前核对引用和活动读取。

可重新渲染的定义必须在同一封套中带齐模板、变量、语言、渠道和所需资产。缺少引用时只接受只读参考档案；不允许跨封套隐式拼接后渲染或模拟投递。

## 7. 实施与验收

先完成固定语法、变量与语言规则，再实现有界渲染和本地收件箱，最后交付版本、工作台及安装态核验。

1. 三个模板在本包独立完成编辑、真实本地渲染、复核及交接。
2. HTML 特殊字符、长文本、空列表及多语言格式按固定规则输出。
3. 外部图片、脚本和模板中的 URL 不触发网络请求，预览不会执行内容。
4. 缺失语言、变量类型错误及渠道超限逐项报告，不静默截断后标通过。
5. 同一虚拟投递意图重复提交只返回原条目，新事件 ID 按规则形成新条目。
6. 固定参考时点后跨时区重放产生相同格式，回退语言在结果中可见。
7. 取消、满盘和重启不发布不完整渲染，未知本地投递保留原意图供核对。
8. 封套篡改拒绝接受，单包无需邮件或短信账号，所有结果明确为本地模拟。
