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
  'ha-failover': '本机 QEMU 进程退出接管已可用；与宿主失联接管并存时先确认见证撤防，撤防和慢速目标核对后重新检查策略及故障状态。独立 HTTPS 见证节点提供来源持久启动登记、Redfish 系统 UUID 核对与带外关机确认、目标副本启动、应用健康和流量切换；含只读部署预检及正常关闭时等待隔离操作。持久状态使用跨进程独占锁；恢复及每次接管核对来源仍关闭、精确目标身份、应用和流量，已接管目标停机可重启同一副本，状态写入失败禁止来源启动。退出接管支持失败阶段和重试，先确认目标持久退役再解除来源；只读演练工具生成具体计划并记录基线及两次稳定接管，接口观察不证明物理节点独立。见证程序纳入运行包摘要与更新，入口随活动版本切换，校验失败拒绝运行。独立服务进程已联测真实 Linux 历史快照、副本虚拟机及 HTTP 应用，覆盖错误 BMC 身份、未就绪和切流拒绝、见证重启与目标退役；BMC 和流量控制仍使用同一测试电脑上的适配器。真实第三节点、BMC、健康端点和流量系统尚未完成故障演练，故保持部分实现。',
  'network-isolation': '项目设置可将托管初始化、命令、服务、健康检查、流水线、收藏命令、网页与 CLI 普通终端、可恢复 tmux 会话、基础 API/SDK/CLI 项目命令、单次 SSH/GPG Agent 命令、系统调用受限命令、临时 TCP 隧道、代码诊断、语言服务、调试适配器、开发工具任务、运行时与开发工具版本检查、Git 工作台、Notebook、浏览器 IDE、单应用图形窗口、KDE 桌面、构建农场命令、Envoy 边车与受管容器放入仅回环的独立网络命名空间；项目环境变量和仓库检出也在命名空间内执行，下载仍走共享网络。依赖预取使用干净的下载环境，不解析项目密钥或加载项目导入钩子，npm 只接收完整 registry 锁定依赖并禁用脚本、项目 npmrc 与 Git prepare，pip 只下载二进制 wheels；安装回到私有项目离线执行。命令执行默认绑定活动项目，加载目录和环境、遮盖密钥，并在超时、取消或断开后结束进程组；实例管理需明确指定 instance 范围。终端恢复和只读分享核对项目、目录、模式、会话唯一标识及所有窗格的实际网络空间，停止和布局按项目隔开；停用项目插件也不放宽已保存的网络设置。Notebook 二进制依赖预取后在命名空间内离线安装；浏览器交互环境和图形连接通过 SSH 桥接访问。KDE 会话持久绑定项目，连接核对启动文件和实际进程网络，停止清理桌面用户及脱离会话的子进程；每次开机重核配置后恢复，停机修改绑定设置会关闭旧自动恢复，克隆与导出保留绑定。构建节点持久绑定项目，目录限制在该项目内，后台并发执行也检查网络并遮盖密钥、清理进程组；项目缺失或密钥服务未加载时拒绝执行。Envoy 边车允许私有项目复用端口，核对配置、会话标识、实际程序及网络和监听；运行时保护目录与网络设置，停止清理所属遗留代理，取消只清理本次启动。Debian、Ubuntu 已通过真实流量与重启恢复，Alpine 当前只验证二进制不兼容时的拒绝。Debian、Ubuntu 私有容器使用独立 Docker 与 containerd，镜像共享预取后导入项目；支持 Dockerfile、显式 host 网络的 Compose、官方 Dev Container CLI 和数据库预设。客户端固定连接并拒绝网络权限越界，目录及网络绑定保护包括停止的容器且不依赖容器插件；客户机重启后经核对手动恢复。含私有项目的 Debian、Ubuntu 实例撤销名称别名，并生成按实例 UUID 与项目区分的 SSH 入口；专属密钥、固定主机公钥和仅回环桥接连接本项目 sshd，编辑器、SFTP、后台子进程与缓存按项目分开；能力中心下载的各编辑器配置复用同一已核对项目入口，缺失或插件停用时拒绝导出实例入口。配置、启动标识、进程网络与监听经核对，停止清理整个服务 cgroup；核心绑定保护不依赖 IDE 插件，启动文件丢失和密钥服务缺失时仍可清理，重载后可恢复桥接，客户机重启后手动启动。Windows OpenSSH、SFTP、TCP 转发及官方 VS Code 后端已实机验证，官方 VS Code 桌面与 Remote-SSH 在 Debian、Ubuntu 各两个项目的远程扩展、编辑保存、集成终端、任务及外网拒绝也已通过。JetBrains 与 Neovim 当前验证档案与真实 SSH，未执行客户端联测；需要项目凭证的认证依赖源当前明确拒绝共享预取。非 Sakura 生成的系统 SSH、显式实例管理命令、自行启动的进程及部分扩展仍属于实例范围，故仍为部分实现。',
  'clipboard-policy': '已实现 Sakura 网页应用入口与独立 Linux 应用窗口的复制/粘贴、实例覆盖、文件与图片限制、敏感文本检测，以及 noVNC 缓存撤回；单应用窗口按实例和程序保存方向规则，Xvnc 执行且请求不能放宽，收紧规则立即断开旧桥接并拒绝重连。各窗口使用独立 Linux 用户、X11 凭据、随机 VNC 密码和 IPv4/IPv6 用户防火墙，限制窗口间及共享 KDE 端口的访问。Windows x64 宿主对 x64/x86 EXE 使用已校验的匹配架构代理，按完整路径与文件摘要保存规则，仅附加当前用户同一会话的进程，核对 PID、创建时间和架构；覆盖 Win32 与 OLE、缓存对象及延迟渲染的当前规则，记录拒绝计数但不保存文本。支持自动扫描新进程、控制服务重载、显式停用与附加失败状态；关闭服务保留进程现有规则。双架构 ABI 相同，x86 接入工具损坏时仍可由主控制程序停用已归属进程；旧第 1 版原生包继续只支持 x64。仅纯文本配置过滤 OLE 格式并检查敏感内容。KDE 原生入口可按完整 ELF 路径与摘要显式启动 Linux X11 应用，执行 Xlib/XCB 的方向、格式、文本大小与敏感规则，支持热更新、服务重载及停用。INCR 双向传输收齐后检查完整文本，混合 API 和重复读取共用缓存，传输中的规则收紧继续有效，含缓存预算与超时；复制超过服务器原子请求上限时拒绝。应用及子进程进入绑定项目网络与专属 cgroup，状态核对实际加载、PID、创建时间及网络，停止清理整个会话并等待内核释放；克隆与导出/导入保留规则和归属。真实 Debian KDE、Qt 5 与原生 Xlib/XCB 已验证。新进程附加前、受保护进程、其他底层接口、既有普通 Linux 程序及原生 Wayland 仍未覆盖，受限状态的 MULTIPLE 仍拒绝，故保持部分实现。',
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
