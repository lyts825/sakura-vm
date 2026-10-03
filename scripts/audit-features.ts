import { readFile, writeFile } from 'node:fs/promises';
import { featureCatalogView } from '../server/feature-suite.ts';
import { extendedFeatureCatalog } from '../server/extended-features.ts';
import { nextFeatureCatalog } from '../server/next-features.ts';

const convert = (rows: readonly (readonly string[])[]) =>
  rows.map(([id, name, category, priority, summary, state]) => ({
    id,
    name,
    category,
    priority,
    summary,
    state,
  }));
const groups = [
  { name: '第一批', file: 'server/feature-suite.ts', rows: featureCatalogView() },
  { name: '第二批', file: 'server/extended-features.ts', rows: convert(extendedFeatureCatalog) },
  { name: '第三批', file: 'server/next-features.ts', rows: convert(nextFeatureCatalog) },
];
const all = groups.flatMap((group) => group.rows),
  unfinished = all.filter((item) => item.state !== 'available');
const notes: Record<string, string> = {
  'ha-failover': "本机 QEMU 进程退出接管已可用；与宿主失联接管并存时先确认见证撤防，撤防和慢速目标核对后重新检查策略及故障状态。独立 HTTPS 见证节点提供来源持久启动登记、Redfish 系统 UUID 核对与带外关机确认、目标副本启动、应用健康和流量切换；含只读部署预检及正常关闭时等待隔离操作。持久状态使用跨进程独占锁；恢复及每次接管核对来源仍关闭、精确目标身份、应用和流量，已接管目标停机可重启同一副本，状态写入失败禁止来源启动。退出接管支持失败阶段和重试，先确认目标持久退役再解除来源；只读演练工具生成具体计划并记录基线及两次稳定接管，接口观察不证明物理节点独立。见证程序纳入运行包摘要与更新，入口随活动版本切换，校验失败拒绝运行。独立服务进程已联测真实 Linux 历史快照、副本虚拟机及 HTTP 应用，覆盖错误 BMC 身份、未就绪和切流拒绝、见证重启与目标退役；BMC 和流量控制仍使用同一测试电脑上的适配器。2026-10-01 只读检查未发现可用外部见证、目标主机、Redfish、健康或切流配置，未调用实际隔离或用户虚拟机。真实第三节点、BMC、健康端点和流量系统尚未完成故障演练，故保持部分实现。第 4 版见证状态已接通离线版本迁移、受控配置更换和损坏/缺失状态恢复，原字节备份与提交未确认回执保留。恢复封锁须逐一核对全部历史副本并确认持久退役后解除；可选自动回切在来源健康、精确退役和流量确认后持久完成，策略关闭后已有待回切仍继续。用法见见证维护文档，新增接口与状态回归通过，物理外部演练仍未完成。",
  'network-isolation': "单应用窗口新增独立完整 native 运行域、固定降权入口、专属目录映射视图及原账号、boot、构建和真实监听核对；主机 intent 先于首次 native prepare 持久保存，应答失联只恢复原 UUID，重载只读恢复，不重发票据。应用及 WM 的准确 exec 成功后才发布 running；停止及创建者观察到的自然退出按原完整域清理 detached 子进程，失败保留票据、租约和配置门闩。多个服务实例保留其他 UUID 与已核销、已收紧记录，原 owner 只退休自己的内存租约；旧 UID-only 窗口显示归属待核对，不自动重开或清理。新的真实桌面联测结果另按实际场景记录。托管项目入口已接通仅回环的独立网络命名空间，涵盖项目命令、服务、终端、工程任务、编辑器、Agent、构建与相关桥接；各入口的准备、恢复、绑定保护和实测范围见项目网络隔离文档。默认项目 API/SDK/CLI、初始化、主命令、普通服务、就绪与命令式健康检查、运行时显式探测和版本选择验证，以及构建农场、收藏命令、流水线步骤和单次 SSH/GPG Agent 命令使用持久项目 UID/GID、独立 home 和固定启动器，命令与环境通过有界 stdin 或 root 独占保护帧运输，降权后运行密封只读脚本，root argv 不携带正文；宿主持久保存准确账号票据并在上层全域清理确认后核销，冷重启保留原票据并登记退休，关闭历史持久归档且 run ID 不可重放。构建每次准备捕获准确配置和 live 身份，子目录保留原目录绑定，同项目多个槽位具有独立完整票据；取消保留租约到全域清理结束，清理失败的错误码和原记录在重载后保留。单次 SSH/GPG Agent 固定提交项目及捕获配置，每次明确确认；root 源监听保持私有权限，项目入口逐连接/协议请求核对 UID/GID、进程创建身份、boot 和完整任务域。同项目多任务转发互不关闭；域和准确资源清理确认后才核销账号票据，失败保留原资源、错误码与本次宿主流供恢复。GPG 当前支持 Windows x64 原生 extra socket，固定来源文件和原进程，宿主 helper 在发送 nonce 前持久保存准确回执，临时 GNUPGHOME 按原归属清理；Unix、MSYS 和命名管道来源明确拒绝。既有 root 目录须明确核对并应用保存的迁移计划，缺失目录不会自动建立，链接、权限扩展、跨挂载、其他项目重叠与超限回执均拒绝，中断/绑定确认失联保留门闩和原计划重试；读取不自动安装或应用，项目成员不得迁移属主。私有项目停止先冻结固定 generation/release ID，再清理所有归属，最后核销准确命名空间；同 inode 新代也拒绝旧请求，失联继续保留 pending。旧 root 运行按原完整回执停止，不自动视为新账号运行。共享及私有项目的首次 Git 检出已接通固定 smart-HTTP 对象预取，使用已应用网络档案中的独立只读认证；源码与凭据通过有界 stdin 运送，系统下载器不执行工作树、项目环境、Git 配置、钩子或过滤器。数据完整核对后仅授予原项目 GID 只读 bundle，项目 UID 在原网络内核对摘要、默认分支并检出，origin 保留原仓库地址；空仓库可初始化，已有仓库不自动更新，非空目录拒绝。下载前保存准确 boot、任务 UUID、账号与 nonce 归属，失败/取消后只在全域停止和准确对象确认后清理，未知状态保留记录；旧下载不得在新 boot 入场。普通网页终端与持久 tmux 会话已接通项目账号、独立 home、固定原生 PTY 入口和独立完整运行票据。全部窗格与服务器复核真实 UID/GID、创建身份、网络及 cgroup；socket 在项目 Shell 启动前封闭，重连和只读授权固定原运行 UUID。退出或停止清理整个 cgroup 和准确资源，准备与清理共用运行锁；失败保留原票据及租约，重载恢复孤立匿名运行，冷重启只在原资源确认不存在后登记退休，同名新会话不复活旧授权。收藏命令和流水线步骤固定原项目、捕获配置及准确 live 实例，环境仅解析一次，正文与参数使用保护帧；流水线各步骤独立任务 UUID、cgroup 和时限，准备租约保持到产物及最终记录保存，取消等待完整清理，原 503 和错误码在步骤、运行及任务历史重载后保留。专属项目 SSH 的 Shell、命令、SFTP 与编辑器入口已迁移为持久项目 UID/GID、独立 home 和原服务 cgroup。固定 ForceCommand 只带账号、run 与摘要，真实客户端命令和环境通过有界帧降权执行，独立描述符保留二进制 stdin、EOF 和 PTY；环境快照为 root 独占 JSON。所有发行版的共享与私有项目均导出核对后的独立入口。启动前保存宿主 intent，原完整 daemon/boot/cgroup inode 票据用于重载及清理，应答丢失先恢复原票据，原全域停止后才退休受保护 SSH 回执并核销；中断只留下 SSH 回执时仅允许清理恢复，不能授权会话。浏览器 IDE、集成终端和扩展宿主已接入项目 UID/GID、独立 home、受保护 stdin 及完整原服务票据；密码与项目环境不进入 root argv。共享和私有模式都使用本机回环桥接，原账号、boot、构建、cgroup inode、进程创建身份、正文摘要和实际 UID 持有的监听核对后才开放；连接完成后再次核对，重载不安装或发行新票据。停止失败先保留检查状态，禁止原入口重开；客户机守护逻辑在控制服务关闭后仍按时清理整个 cgroup，最终核销由活跃或重载的控制服务确认。旧 root 会话保留原记录供明确处理，不自动收编。工程扩展的工作区、Git、测试、命令宏和 Runbook，以及分片、矩阵子任务和环境指纹已接通原项目账号、捕获配置、完整短任务票据与保护帧；可信源码在降权后解压校验，直接结果保存与任务导入保持原租约，原清理 503 及错误码继续传播。轻量代码诊断已接通捕获配置、非枚举原项目身份、受保护正文和完整任务清理，结果继续脱敏，取消或清理 503 不转换为编译诊断。Notebook 安装、Jupyter/Marimo 与内核已接入捕获配置、项目账号和完整服务票据，系统预取与 UID 离线安装分开，所有模式经实际 UID 监听核对的回环桥接；停止先保留检查状态，整域和准确资源确认后核销，失败保留原票据和清理错误。Git 工作台的所有 Git 命令与路径探测已接入原账号、配置、live、保护帧及完整任务清理，操作保持原租约，冲突编辑器文件读写保留管理员 SFTP 范围。开发工具版本与清单探测、seccomp 受限命令已接入捕获项目、保护帧和完整 UID 任务；系统软件包安装及策略自检保持固定管理环境，原 live 变化停止后续步骤。离线缓存安装使用原完整任务的 UID 可写副本，原管理缓存只复制惰性数据；原任务域及 native 关闭后才按完整归属退休，未知状态保留原证明并阻止重新绑定。Lint/format 保存结果保持原工程租约，有限开发命令保留原生 cwd。临时 TCP 隧道的 Python 探测与 broker 已接通原项目账号、捕获配置、保护帧和独立完整服务票据；桥接核对原 UID 监听，失联启动保持准备租约到整域核销，重载不安装或修复网络。独立 LSP/DAP 已接通原项目账号、捕获配置及调用者输入、保护帧与持续二进制协议，原完整 task/native 域核销后才释放准备租约，失联原 token 保留可重试；SSH 通道应答有界且拒绝迟到或替换 live。Envoy 版本探测、固定配置校验和长期边车已接通原项目 UID/GID、捕获配置/live、保护帧及独立完整任务/服务票据。有限任务在配置删除前精确核销，失联启动与清理保留原配置、票据及租约供停止重试；普通状态不执行 Envoy 或安装，首次明确检查/启动在固定网络准备后重读原 boot/二进制。KDE、中文输入法与 X11/Wayland 应用入口已接通捕获原项目 UID/GID、独立 home、保护帧和完整 Desktop/native 票据。图形与应用入口复核原运行、端点及真实进程，停止先核销匹配的应用及整桌面域，再清理原运行目录和防火墙；失联/清理失败保留原证明及租约供停止重试。私有项目账号在共享网络新建的 IPv4/IPv6 连接也已按 UID 阻断，涵盖以该账号从系统 SSH、cron、用户服务及自行启动程序发起的连接。固定 systemd/OpenRC 入口恢复原绑定的规则并设置 SSH/定时服务依赖；创建/删除应答丢失和配置升级中断保留原意图，未知表及 handle 变化拒绝。其他 UID、特权代理转交的套接字、显式管理员命令及客户机 root 修改策略仍不属于该账号边界。客户机热目录最多保留 1,024 张票据，满额时在固定控制器内每批归档最多 512 张本次 boot 已关闭且任务域无进程的完整原回执；归档不覆盖未知对象，写入核对失败保留原票据，旧 run ID 仍拒绝重放，归档查询与重复关闭不恢复热票据；普通服务与主命令生命周期和真实故障证明按批次保留。这是网络分段与已接通入口的权限改进，不能承诺实例级断网或覆盖所有入口，功能保持部分实现。普通 SSH、cron/at 和用户会话启动器新增 NoNewPrivileges 设置及真实 root 守护/旧会话进程核对；未继承时保留原意图并要求明确重启，不自动中断服务。该系统服务设置影响客户机中所有普通账号的执行时提权，删除项目不会自动撤回。原生入口拒绝标准描述符及保护帧上的网络 socket，保留文件、管道、PTY 和 Unix socket；运行后由特权代理另行传递描述符仍在范围外。首次准入、有效 systemd/OpenRC 配置和旧版本中断恢复的 72 项专项回归通过。真实 Alpine 诊断确认原 O_PATH 目录同步返回 errno 9；启动链接现使用同一受控目录的可读句柄同步，pending 重试已有链接时也须同步成功后才 reload/applied。新的独立 Alpine VM 验证入口保留提权基线、真实 SSH/cron、冷启动与完整进程关闭证据，其结果另按实际场景记录。",
  'clipboard-policy': "已实现网页应用入口、独立 Linux 窗口的方向、实例覆盖、格式和敏感文本规则，收紧 noVNC 规则断开旧桥接并拒绝重连。Windows x64 宿主支持普通 x64/x86 进程按完整映像路径与摘要接入，核对用户、会话、PID/创建时间和架构，规则热更新、重载、拒绝计数与停用已实现。Win32/OLE 检查当前规则、延迟数据与包装缓存；标准 ANSI/Unicode Edit/RichEdit 在复制或剪切前检查实际选区，拒绝时保留旧剪贴板及源文本，支持旧控件、新控件、重建和父窗口初始化内的嵌套子控件。OLE 在清空旧内容前预检完整全局内存正文。真实 Windows Runtime Desktop Clipboard、.NET Framework 4.8.1 WinForms/WPF 双架构、现代 .NET 10.0.9 双架构常规 API及文本控件已验证；实际32位运行时来自测试目录内固定官方包并核对摘要，双架构各717项断言包含选区保持及控件销毁重建。普通未打包原生 EXE 可受控早期启动，在原始应用 DLL/TLS 前同步加载策略，持久归属后才恢复主线程；丢失提交回执时保留并刷新归属，纯 IL CLR 的固定 x64/x86、AnyCPU 和优先 32 位已接通受控启动，磁盘标记与实际挂起进程位数双重核对；CLR 类型初始化和 Main 前已有 ready 策略。混合模式、ReadyToRun、本机入口及歧义 CLR 映射拒绝。系统或已核对 WinSxS Common Controls 可用，私有 DLL与清单重定向拒绝。KDE 原生入口可按 ELF 路径与摘要显式启动 X11 或原生 Wayland 应用，分别保存规则、归属和会话。X11 的 INCR/MULTIPLE 双向完整检查、每项独立身份、预算与超时、普通 fork 新连接及整个会话清理已实测。原生 Wayland 支持 Plasma v5会话偏好、Qt/GTK clipboard 与 primary selection 双向完整正文检查，收紧取消未交付数据，FD队列允许晚到，格式、敏感、UTF-8和大小受规则限制；正文只接收可写FIFO，门户传输令牌及未知/特权管理协议拒绝，慢源可能超时。公开服务现在从完整原项目 Desktop/native 票据发现端点，桌面实际使用项目 UID；停止桌面先精确退休匹配的注册应用域。新增 desktopOwner/applicationOwner 分别展示桌面项目账号与应用账号，Wayland 与独立窗口继续使用各自 sandbox UID。当前完整桌面权限和嵌套 XWayland 凭据通过 14 个实际源码模型；初次启动只对明确未就绪错误重试，身份错误立即按原完整域回滚。Wayland 新 UID 通过专属 idmapped mount 访问原项目目录，0700/0600 读写和项目私有0700 ELF执行已通过8个自有真实Linux helper场景，原属主、权限、ACL及源摘要不变。程序降权后从映射视图重新打开并核对原inode/元数据/摘要，通过该FD执行，关闭原Root文件句柄；两个旧挂载FD实际拒绝执行，实际映射ELF确认管理FD关闭、NNP=1及有效capabilities为空。32项相关回归通过，当前20资产源码与打包字节吻合；尚未完成新的真实桌面联测。原入口历史联测继续保留。公开服务从真实绑定的桌面发现端点，固定 socket creator、KWin child、继承FD及内核inode，child替换后旧代理不自动跟随；应用使用新UID、私有DBus/runtime及应用/代理独立cgroup，并核对项目网络和目录权限。20个固定来源资产带原始协议许可证、摘要与分发校验，规则和归属支持重载、克隆及导出导入。Debian真实原生桌面、Qt/GTK、私有项目网络、528000字节正文、热更新、primary和子进程清理已通过，编译HTTP/SDK也通过。无法撤回已交付或合成器/工具包缓存的内容；接入前、系统级启动 DLL、受保护或打包程序、自定义底层接口、既有普通Linux程序、特殊fork路径和系统级强制边界仍未完成，因此保持部分实现。第 6 版原生运行包已接通普通 CreateProcessW/A 及 CreateProcessAsUserW/A 子孙进程提前继承，包括跨 EXE、x64/x86、原生 DLL/TLS 和 CLR 初始化阶段创建；保留命令、环境、cwd、标准句柄及调用者 CREATE_SUSPENDED 语义。创建前发布准确具名 Job 保留并原子分配；普通 apply 在建立 mapping 或任何 remote loader 前拒绝准备中 child。服务按准确身份仲裁扫描与采用，持久归属先于早期插入，旧快照不会删除 prepared 记录；helper 实际关闭后才释放仲裁。broker 在父进程退出或管道 EOF 时清理准确 Job，并保留复制句柄到原请求结束，最后恢复前复核原父身份。第 4 版初轮证明继续保留；第 5 版实际 30 场景及 38 个专项单测和旧资产保留。第 6 版实际 70 场景及 39 个专项单测通过，来源未变，12 个 broker、窗口站启动器及对照父进程实际关闭且自有进程残留为零。AsUser 固定源 primary token 的准确内核对象、访问权限、TokenId/ModifiedId、用户和会话，调用前后复核源令牌与真实 child primary token；NULL 保留原 Windows 语义并拒绝新增 impersonation。规则 active 时 WithTokenW/WithLogonW 因真实 OS 不接受带 Job 属性的扩展启动形式而明确返回不支持；inactive 调用原 API，标准句柄按内核对象比较。调用者 opaque STARTUPINFOEX、调试标志明确拒绝。第 7 版新增普通本地 EXE 的 ShellExecuteW/A 和带原 SEE_MASK_NOASYNC 的 ShellExecuteExW/A open：核对显式 asInvoker 清单与直接关联，通过公开属性列表生命周期在原表附加准确 Job，保留原命令、环境、cwd、句柄及 Shell 暂停恢复语义。属性表公开操作与原同步创建共用短锁，准备失败同时回收准确 child 句柄，不能仅凭 Job 推断清理。异步、委托、打包激活及其他底层路径仍未覆盖；新真实 Windows 场景结果另按实际记录。",
  'availability-report': '目前为 uptime 探测，尚无持续可用性记录与完整报告。',
  'multi-host-inventory': '目前返回本机信息，尚未实现多主机汇总。',
  'hardware-compatibility': '目前返回本机信息，尚未建立经验证的硬件兼容矩阵。',
  'host-disk-health': '目前返回本机信息，尚未实现实际磁盘健康检查。',
};
const count = (rows: typeof all, state: string) => rows.filter((item) => item.state === state).length;
let output = `# 未完成功能清单\n\n根据当前工作区源码生成。最初基线为 \`c669881\`，其目录中有 200 条未完成记录。\n\n目前共 ${all.length} 条目录记录，其中 ${count(all, 'available')} 条有实现入口，**${unfinished.length} 条仍未完成**（${count(all, 'planned')} 条规划、${count(all, 'experimental')} 条部分实现）。按标识去重后为 ${new Set(unfinished.map((item) => item.id)).size} 个未完成标识；不同条目仍有范围重叠。\n\n本轮已接通 ${200 - unfinished.length} 条原未完成目录记录，包括 Git 和目录同步冲突的图形解决。实现范围、使用方式与验证见 [本轮实现记录](capability-completion.md)。**这不表示全部功能已经完成**；available 也不代表当前实例已安装所需工具。\n\n| 目录 | 总数 | 已有入口 | 部分实现 | 规划 | 未完成 |\n| --- | ---: | ---: | ---: | ---: | ---: |\n`;
for (const group of groups)
  output += `| ${group.name} | ${group.rows.length} | ${count(group.rows, 'available')} | ${count(group.rows, 'experimental')} | ${count(group.rows, 'planned')} | ${group.rows.filter((item) => item.state !== 'available').length} |\n`;
for (const group of groups) {
  if (!group.rows.some((item) => item.state !== 'available')) continue;
  const source = await readFile(group.file, 'utf8');
  output += `\n## ${group.name}\n`;
  let category = '';
  for (const item of group.rows.filter((item) => item.state !== 'available')) {
    if (category !== item.category) {
      category = item.category;
      output += `\n### ${category}\n\n`;
    }
    const line = source.slice(0, source.indexOf("'" + item.id + "'")).split('\n').length;
    output += `- [ ] **${item.name}**（${item.priority} · ${item.state === 'planned' ? '规划' : '部分实现'}） · [\`${item.id}\`](../${group.file}#L${line}) — ${notes[item.id] || item.summary + ' 对应完整流程尚未实现。'}\n`;
  }
}
output +=
  '\n重新生成：`npm run features:audit`。上述目录状态由源码声明，真实硬件、多主机和外部身份服务仍需要对应环境验证。\n';
await writeFile('docs/unfinished-features.md', output);
console.log(
  `Unfinished: ${unfinished.length}; available entries: ${count(all, 'available')}; catalog records: ${all.length}`,
);
