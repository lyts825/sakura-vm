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
  'ha-failover': '每 15 秒监测本机主实例；显式启用后，仅在本次服务运行期间见过来源 QEMU 正常运行并确认进程已退出、达到故障阈值且目标副本新鲜并通过回执与平台校验时，持久封锁来源再请求目标启动。目标客户机进入运行状态后才记录接管成功；退出接管先持久封锁已停机的目标。宿主整机失联、网络分区、应用健康确认和流量切换仍缺独立见证与协调机制。',
  'live-migration': '已接入源 QMP 状态、已配对目标资源与只读迁移计划；真实 QEMU 双进程测试覆盖 NBD 磁盘镜像、内存预复制、切换前暂停、故障回退和配对 TLS 通道。配对接口可同步客户机身份并创建暂停目标 QEMU，受限目标 QMP、持久来源栅栏、目标完成确认和就绪查询也已实现；尚未把这些步骤与故障后安全清理接成可执行的跨主机迁移任务。',
  'network-isolation': '项目设置可将托管初始化、命令、服务、健康检查、流水线、收藏命令、显式项目终端、代码诊断、语言服务、调试适配器及开发工具任务放入仅回环的独立网络命名空间，执行前拒绝额外接口或路由；普通管理员终端、客户机自行启动的进程及部分扩展仍使用共享客户机网络，故仍为部分实现。',
  'clipboard-policy': '已实现 Sakura 网页应用入口与独立 Linux 应用窗口的复制/粘贴、实例覆盖、文件与图片限制、敏感文本检测，以及 noVNC 缓存撤回；单应用 Xvnc 会话可在启动时独立禁止双向剪贴板传递，普通 Windows/Linux 应用进程仍缺系统级策略。',
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
