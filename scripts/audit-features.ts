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
  'clipboard-policy': '已实现 Sakura 网页应用入口的复制/粘贴、实例覆盖、文件与图片限制、敏感文本检测，以及 noVNC 缓存撤回；仍缺按 Windows/Linux 独立应用进程的系统级策略。',
  'vcpu-hotplug':
    '已实现预留插槽、QMP 添加和客户机上线校验。当前 WHPX 拒绝在线添加；Alpine 6.18 在 TCG 下未识别预留 CPU，正常添加流程仍待兼容内核验证。',
  'merge-editor':
    '已有文件草稿、Git 普通文本冲突及目录同步文本冲突的三方编辑；仍缺 Git 删除、链接、子模块和二进制冲突工作流。',
  'plugin-api': '内置插件框架与签名 Webhook 投递已实现；第三方隔离插件及完整事件触发工作流仍未实现。',
  'guest-quota': '目前为 quota 探测，尚无完整配额设置与管理流程。',
  'availability-report': '目前为 uptime 探测，尚无持续可用性记录与完整报告。',
  'multi-host-inventory': '目前返回本机信息，尚未实现多主机汇总。',
  'hardware-compatibility': '目前返回本机信息，尚未建立经验证的硬件兼容矩阵。',
  'storage-pools': '目前返回本机信息，尚未实现存储池管理。',
  'host-disk-health': '目前返回本机信息，尚未实现实际磁盘健康检查。',
  'reverse-proxy': '已有 HTTPS 路由、WebSocket、证书轮换及浏览器可访问的 .sakura.localhost 别名；系统级解析器尚不识别这些别名。',
  'local-dns-alias': '可为服务生成稳定的 .sakura.localhost 域名和通配证书，Chromium 已验证可访问；Windows Node/系统级 DNS 尚不能直接解析。',
};
const count = (rows: typeof all, state: string) => rows.filter((item) => item.state === state).length;
let output = `# 未完成功能清单\n\n根据当前工作区源码生成。最初基线为 \`c669881\`，其目录中有 200 条未完成记录。\n\n目前共 ${all.length} 条目录记录，其中 ${count(all, 'available')} 条有实现入口，**${unfinished.length} 条仍未完成**（${count(all, 'planned')} 条规划、${count(all, 'experimental')} 条部分实现）。按标识去重后为 ${new Set(unfinished.map((item) => item.id)).size} 个未完成标识；不同条目仍有范围重叠。\n\n本轮已接通 ${200 - unfinished.length} 条原未完成目录记录，另完善了文本三方合并。实现范围、使用方式与验证见 [本轮实现记录](capability-completion.md)。**这不表示全部功能已经完成**；available 也不代表当前实例已安装所需工具。\n\n| 目录 | 总数 | 已有入口 | 部分实现 | 规划 | 未完成 |\n| --- | ---: | ---: | ---: | ---: | ---: |\n`;
for (const group of groups)
  output += `| ${group.name} | ${group.rows.length} | ${count(group.rows, 'available')} | ${count(group.rows, 'experimental')} | ${count(group.rows, 'planned')} | ${group.rows.filter((item) => item.state !== 'available').length} |\n`;
for (const group of groups) {
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
  '\n## 目录以外的范围\n\n- 插件独立下载与热卸载；当前仍只加载内置插件。\n- 基于客户机内存压力的自动回收。\n- 完整发行版包管理界面。\n- 持久保存 RAM 和运行中进程的快照/恢复。\n\n重新生成：`npm run features:audit`。上述目录状态由源码声明，真实硬件、多主机和外部身份服务仍需要对应环境验证。\n';
await writeFile('docs/unfinished-features.md', output);
console.log(
  `Unfinished: ${unfinished.length}; available entries: ${count(all, 'available')}; catalog records: ${all.length}`,
);
