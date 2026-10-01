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
  'ha-failover': '本机 QEMU 进程退出接管已可用；与宿主失联接管并存时先确认见证撤防，撤防和慢速目标核对后重新检查策略及故障状态。独立 HTTPS 见证节点提供来源持久启动登记、Redfish 系统 UUID 核对与带外关机确认、目标副本启动、应用健康和流量切换；含只读部署预检及正常关闭时等待隔离操作。持久状态使用跨进程独占锁；恢复及每次接管核对来源仍关闭、精确目标身份、应用和流量，已接管目标停机可重启同一副本，状态写入失败禁止来源启动。退出接管支持失败阶段和重试，先确认目标持久退役再解除来源；只读演练工具生成具体计划并记录基线及两次稳定接管，接口观察不证明物理节点独立。见证程序纳入运行包摘要与更新，入口随活动版本切换，校验失败拒绝运行。独立服务进程已联测真实 Linux 历史快照、副本虚拟机及 HTTP 应用，覆盖错误 BMC 身份、未就绪和切流拒绝、见证重启与目标退役；BMC 和流量控制仍使用同一测试电脑上的适配器。2026-10-01 只读检查未发现可用外部见证、目标主机、Redfish、健康或切流配置，未调用实际隔离或用户虚拟机。真实第三节点、BMC、健康端点和流量系统尚未完成故障演练，故保持部分实现。',
  'network-isolation': '项目设置可将托管初始化、命令、服务、健康检查、流水线、收藏命令、网页与 CLI 普通终端、可恢复 tmux 会话、基础 API/SDK/CLI 项目命令、单次 SSH/GPG Agent 命令、系统调用受限命令、临时 TCP 隧道、代码诊断、语言服务、调试适配器、开发工具任务、运行时与开发工具版本检查、Git 工作台、Notebook、浏览器 IDE、单应用图形窗口、KDE 桌面、构建农场命令、Envoy 边车与受管容器放入仅回环的独立网络命名空间；项目环境变量和仓库检出也在命名空间内执行，下载仍走共享网络。依赖预取使用干净的下载环境，不解析项目密钥或加载项目导入钩子，npm 只接收完整 registry 锁定依赖并禁用脚本、项目 npmrc 与 Git prepare，pip 只下载二进制 wheels；安装回到私有项目离线执行。命令执行默认绑定活动项目，加载目录和环境、遮盖密钥；短任务使用固定 boot ID、PID 创建时间、cgroup inode和有限锚点登记归属，取消清理经独立 SSH 重试并确认所属 cgroup 已空和释放后才清理本次暂存，未确认时明确报错并保留归属；实例管理需明确指定 instance 范围。终端恢复和只读分享核对项目、目录、模式、会话唯一标识及所有窗格的实际网络空间，停止和布局按项目隔开；停用项目插件也不放宽已保存的网络设置。Notebook 二进制依赖预取后在命名空间内离线安装；浏览器交互环境和图形连接通过 SSH 桥接访问。KDE 会话持久绑定项目，连接核对启动文件和实际进程网络，停止清理桌面用户及脱离会话的子进程；每次开机重核配置后恢复，停机修改绑定设置会关闭旧自动恢复，克隆与导出保留绑定。构建节点持久绑定项目，目录限制在该项目内，后台并发执行也检查网络并遮盖密钥、清理任务 cgroup；项目缺失或密钥服务未加载时拒绝执行。Envoy 边车允许私有项目复用端口，核对配置、会话标识、实际程序及网络和监听；运行时保护目录与网络设置，停止清理所属遗留代理，取消只清理本次启动。Debian、Ubuntu 已通过真实流量与重启恢复，Alpine 当前只验证二进制不兼容时的拒绝。Debian、Ubuntu 私有容器使用独立 Docker 与 containerd，镜像共享预取后导入项目；支持 Dockerfile、显式 host 网络的 Compose、官方 Dev Container CLI 和数据库预设。客户端固定连接并拒绝网络权限越界，目录及网络绑定保护包括停止的容器且不依赖容器插件；客户机重启后经核对手动恢复。含私有项目的 Debian、Ubuntu 以及全部 Alpine 实例撤销名称别名，并生成按实例 UUID 与项目区分的 SSH 入口；专属密钥、固定主机公钥和仅回环桥接连接本项目 sshd，编辑器、SFTP、后台子进程与缓存按项目分开；能力中心下载的各编辑器配置复用同一已核对项目入口，缺失或插件停用时拒绝导出实例入口。配置、启动标识、进程网络与监听经核对，停止清理整个服务 cgroup；Alpine 使用 OpenRC、开机身份及 PID 创建时间核对真实 cgroup v2，原生停止等待 init 回收进程，不伪装 systemd 状态；核心绑定保护不依赖 IDE 插件，启动文件丢失和密钥服务缺失时仍可清理，重载后可恢复桥接，客户机重启后手动启动。Windows OpenSSH、SFTP、TCP 转发及官方 VS Code 后端已实机验证，官方 VS Code 桌面与 Remote-SSH 在 Debian、Ubuntu 各两个项目的远程扩展、编辑保存、集成终端、任务及外网拒绝也已通过。官方 Neovim 0.12.5 已在 Alpine、Debian、Ubuntu 各两个项目真实打开、修改、UTF-8 保存和重新打开文件，Windows 使用固定项目目录的相对 URI 避免 netrw 绝对路径空格转义；Alpine 拒绝不受客户端支持的 VS Code/JetBrains 后端。官方 JetBrains Gateway 在 Debian、Ubuntu 各两个项目验证严格固定公钥、真实 SSH/SFTP、TCP 转发、WebStorm 后端及分别停止清理；专属启动器通过 VM_OPTIONS 固定项目 Java 配置与缓存，默认任意 Gateway 部署不在验证范围内。匹配 Client 已启动但要求 JetBrains Account，图形编辑保存与许可仍未验证。认证 npm/pip 预取使用另存的只读下载凭证，SFTP 独占临时文件而非 argv、环境或项目 npmrc/pip.conf；有界回环代理只在准确端点范围内发送认证，拒绝跨范围重定向及双重编码路径，公共传递 wheel 不带凭证。Alpine、Debian、Ubuntu 真实认证、取消、原缓存保留与私有离线安装通过；pip 通过 renameat2 原子发布完整缓存，不支持时拒绝替换，取消后当前目录只指向完整旧版或新版。普通常驻服务以每次运行的持久 cgroup 管理 setsid 与双重 fork 子进程，先持久保存完整 pane 身份再允许项目代码执行；停止核对 boot/run/inode/pane，以独立 SSH 重试清理并保留未确认记录，主 pane 退出不丢弃后台后代归属。自动健康检查先核对归属，自动重启清理失败暂停后续检查，成功手动操作才恢复。项目 SSH 启动回滚也按同一 live/boot/run 重试，拒绝旧回滚终止新服务。非 Sakura 生成的系统 SSH、显式实例管理命令、自行启动进程、部分扩展及旧版主项目 tmux 命令的常驻后代仍有范围缺口；项目也尚无持久独立 UID/GID，因此保持部分实现。',
  'clipboard-policy': '已实现网页应用入口、独立 Linux 窗口的方向、实例覆盖、格式和敏感文本规则，收紧 noVNC 规则断开旧桥接并拒绝重连。Windows x64 宿主支持普通 x64/x86 进程按完整映像路径与摘要接入，核对用户、会话、PID/创建时间和架构，规则热更新、重载、拒绝计数与停用已实现。Win32/OLE 检查当前规则、延迟数据与包装缓存；标准 ANSI/Unicode Edit/RichEdit 在复制或剪切前检查实际选区，拒绝时保留旧剪贴板及源文本，支持旧控件、新控件、重建和父窗口初始化内的嵌套子控件。OLE 在清空旧内容前预检完整全局内存正文。真实 Windows Runtime Desktop Clipboard、.NET Framework 4.8.1 WinForms/WPF 双架构、现代 .NET 10.0.9 双架构常规 API及文本控件已验证；实际32位运行时来自测试目录内固定官方包并核对摘要，双架构各717项断言包含选区保持及控件销毁重建。普通未打包原生 EXE 可受控早期启动，在原始应用 DLL/TLS 前同步加载策略，持久归属后才恢复主线程；丢失提交回执时保留并刷新归属，CLR/AnyCPU 早期启动仍拒绝。系统或已核对 WinSxS Common Controls 可用，私有 DLL与清单重定向拒绝。KDE 原生入口可按 ELF 路径与摘要显式启动 X11 或原生 Wayland 应用，分别保存规则、归属和会话。X11 的 INCR/MULTIPLE 双向完整检查、每项独立身份、预算与超时、普通 fork 新连接及整个会话清理已实测。原生 Wayland 支持 Plasma v5会话偏好、Qt/GTK clipboard 与 primary selection 双向完整正文检查，收紧取消未交付数据，FD队列允许晚到，格式、敏感、UTF-8和大小受规则限制；正文只接收可写FIFO，门户传输令牌及未知/特权管理协议拒绝，慢源可能超时。公开服务从真实绑定的桌面发现端点，固定 socket creator、KWin child、继承FD及内核inode，child替换后旧代理不自动跟随；应用使用新UID、私有DBus/runtime及应用/代理独立cgroup，并核对项目网络和目录权限。20个固定来源资产带原始协议许可证、摘要与分发校验，规则和归属支持重载、克隆及导出导入。Debian真实原生桌面、Qt/GTK、私有项目网络、528000字节正文、热更新、primary和子进程清理已通过，编译HTTP/SDK也通过。无法撤回已交付或合成器/工具包缓存的内容；接入前、系统级启动 DLL、受保护或打包程序、自定义底层接口、既有普通Linux程序、特殊fork路径和系统级强制边界仍未完成，因此保持部分实现。',
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
