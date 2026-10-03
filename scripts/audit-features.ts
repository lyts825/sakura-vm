import { readFile, writeFile } from 'node:fs/promises';
import { featureCatalogView } from '../server/feature-suite.ts';
import { extendedFeatureCatalog } from '../server/extended-features.ts';
import { nextFeatureCatalog } from '../server/next-features.ts';

const convert = (rows: readonly (readonly string[])[]) =>
  rows.map(([id, name, category, priority, summary, state]) => ({
    id, name, category, priority, summary, state,
  }));
const groups = [
  { name: '第一批', file: 'server/feature-suite.ts', rows: featureCatalogView() },
  { name: '第二批', file: 'server/extended-features.ts', rows: convert(extendedFeatureCatalog) },
  { name: '第三批', file: 'server/next-features.ts', rows: convert(nextFeatureCatalog) },
];
const all = groups.flatMap((group) => group.rows);
const unfinished = all.filter((item) => item.state !== 'available');
const count = (rows: typeof all, state: string) => rows.filter((item) => item.state === state).length;

// Implementation and acceptance are independent: changing catalog state must
// never turn a deferred integration check or historical failure into a pass.
const acceptance = [
  {
    id: 'network-isolation',
    scope: '项目独立网络命名空间、持久 UID 出站限制、托管入口归属和清理、重启恢复，以及完整只读状态检查。客户机管理员、其他 UID 和特权代理不在项目账号限制范围内。',
    pending: '新构建的 Debian/Ubuntu/Alpine 项目入口及冷启动；新项目 UID 桌面、单应用窗口、RFB 与剪贴板完整联测；noexec 运行目录的桌面启动修复。',
    guide: 'project-network-isolation.md',
  },
  {
    id: 'ha-failover',
    scope: '本机故障接管、独立见证与 Redfish 隔离、精确副本启动、健康及切流、持久封锁与状态恢复、退出接管和自动回切。需要部署见证、目标、BMC 与流量端点。',
    pending: '本轮见证失联后的恢复重试及切流归属检查；独立物理第三节点、真实 BMC、健康和流量端点的完整故障及回切演练。',
    guide: 'ha-external-drill.md',
  },
  {
    id: 'clipboard-policy',
    scope: '网页和 noVNC、Windows x64/x86 Win32/OLE 及受控普通后代、显式启动的 Linux X11/Wayland 应用；支持方向、格式、大小、敏感文本和规则更新。既有未接入程序、受保护或打包应用与任意底层绕过不属于受管入口。',
    pending: '本轮 Windows OLE IStream 路径的双架构普通应用验收；新项目 UID 桌面的 X11/Wayland、热更新、子进程和停止清理联测。',
    guide: 'clipboard-policy.md',
  },
];

let output = `# 未完成功能清单\n\n根据当前工作区源码生成。最初基线为 \`c669881\`，其目录中有 200 条未完成记录。\n\n目前共 ${all.length} 条目录记录，其中 **${count(all, 'available')} 条已实现，${unfinished.length} 条实现未完成**（${count(all, 'planned')} 条规划、${count(all, 'experimental')} 条部分实现）。按标识去重后为 ${new Set(unfinished.map((item) => item.id)).size} 个未完成标识；不同条目仍有范围重叠。\n\n实现完成表示目录描述范围内已有实际功能流程，不代表所有环境已经验收或安装依赖。本轮按要求先完成功能，测试留待后续；下方待验收项目不会计为测试通过。实际改动见 [本轮实现记录](capability-completion.md)，原失败和历史验证见 [历史清单](feature-completion-history.md)。\n\n| 目录 | 总数 | 已实现 | 部分实现 | 规划 | 实现未完成 |\n| --- | ---: | ---: | ---: | ---: | ---: |\n`;
for (const group of groups)
  output += `| ${group.name} | ${group.rows.length} | ${count(group.rows, 'available')} | ${count(group.rows, 'experimental')} | ${count(group.rows, 'planned')} | ${group.rows.filter((item) => item.state !== 'available').length} |\n`;

output += '\n## 实现待办\n\n';
if (!unfinished.length) output += '目录声明范围内无剩余实现待办。后续测试发现的缺陷仍需修复。\n';
for (const group of groups) {
  if (!group.rows.some((item) => item.state !== 'available')) continue;
  const source = await readFile(group.file, 'utf8');
  output += `\n### ${group.name}\n\n`;
  for (const item of group.rows.filter((item) => item.state !== 'available')) {
    const line = source.slice(0, source.indexOf("'" + item.id + "'")).split('\n').length;
    output += `- [ ] **${item.name}**（${item.priority} · ${item.state === 'planned' ? '规划' : '部分实现'}） · [\`${item.id}\`](../${group.file}#L${line}) — ${item.summary}\n`;
  }
}

output += '\n## 本轮收尾范围与待验收\n\n以下验收尚未在本轮执行；旧版本的成功记录不能代替当前构建验收。\n';
for (const entry of acceptance) {
  const item = all.find((candidate) => candidate.id === entry.id);
  if (!item) throw new Error(`Acceptance record has no catalog entry: ${entry.id}`);
  output += `\n### ${item.name}\n\n- 实现状态：${item.state === 'available' ? '已实现' : '仍待完成'}。\n- 范围：${entry.scope}\n- [ ] 待验收：${entry.pending}\n- 使用与部署：[相关文档](${entry.guide})。\n`;
}
output += '\n重新生成：`npm run features:audit`。该命令只读取目录并生成文档，不运行功能测试。\n';
await writeFile('docs/unfinished-features.md', output);
console.log(`Unfinished implementation: ${unfinished.length}; implemented: ${count(all, 'available')}; catalog records: ${all.length}; deferred acceptance groups: ${acceptance.length}`);
