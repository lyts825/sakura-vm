/** 从已审阅的第七批成员设计生成显式目录；运行包不读取设计文档。 */
import { readFile, writeFile } from 'node:fs/promises';
const ids = ['data-quality-studio','lineage-atlas','entity-resolution-studio','temporal-data-studio','geospatial-studio','graph-insight-studio','experiment-planner','feature-engineering-studio','classical-training-lab','constraint-solver-studio','document-extraction-studio','design-system-studio','form-flow-studio','notification-template-studio','schedule-semantics-lab','extension-authoring-studio','dependency-resolution-studio','protocol-state-lab','replica-sync-lab','service-virtualization-studio'];
const packs=[];
for(const [index,id] of ids.entries()) {
  const text=await readFile(new URL('../docs/'+id+'-pack-design.md',import.meta.url),'utf8');
  const section=text.split(/^## 2\.[^\n]*$/m)[1].split(/^## 3\./m)[0];
  const members=section.split('\n').filter(l=>/^\|\s*`[a-z]/.test(l)).map(line=>{
    const c=line.split('|').slice(1,-1).map(s=>s.trim());
    const id=c[0].match(/`([^`]+)`/)[1], name=c[0].replace(/`[^`]+`/,'').trim();
    const service=c[1].match(/\b([A-Z][A-Za-z0-9]*V1)\b/)[1];
    const methods=c[1].split(/V1[：:]/)[1].split(/[；。]/)[0].split(/[、,]/).map(s=>s.trim()).filter(s=>/^[a-z][A-Za-z0-9]*$/.test(s));
    const requires=[...c[2].matchAll(/@?[a-z][a-z0-9-]+/g)].map(m=>m[0].replace(/^@/,''));
    return {id,name,service,description:c[1].split('；')[0],methods,requires,material:methods.includes('upload')};
  });
  if(!members.length||members.some(m=>!m.methods.length))throw new Error('成员未完整解析：'+id);
  const name=text.split('\n')[0].replace(/^# /,'').replace(/插件包设计\s*$/,'');
  const alias=text.match(/sakura ([a-z][a-z0-9-]+)/)?.[1];
  packs.push({id,name,alias,prefix:members[0].id.split('-')[0],group:index<7?'data':index<14?'creation':'engineering',root:members[0].id,members});
}
if(packs.flatMap(p=>p.members).length!==285)throw new Error('插件数量不符');
await writeFile(new URL('../shared/seventh-catalog.json',import.meta.url),JSON.stringify(packs,null,2)+'\n');
const membersGuide=[
  '# 第七批插件成员目录',
  '',
  '本目录由 `scripts/seventh-catalog.mjs` 从正式成员表生成，与运行目录共用输入，共 20 个包、285 个内部插件。每行列出独立所有者、领域职责、专有方法与直接必需依赖。包的操作流程及实际容量边界见[使用指南](seventh-plugin-packs.md)。',
  '',
  '普通领域还提供严格的空间内保存、封存、固定修订读取、引用查询、归档、清理预览及批准、执行计划、状态、取消和原任务核对接口；交换插件提供导出、上传、检查、接受及原票据恢复。具体请求与响应以当前 HTTP 模式和服务 V1 契约为准。下面的专有方法不代表任意命令或动态调用入口。',
  ...packs.flatMap(pack=>[
    '',`## ${pack.id}`,'',`${pack.name}，${pack.members.length} 个插件；CLI 别名为 \`${pack.alias}\`。`,'',
    '| 插件 ID 与名称 | 独立服务 | 职责 | 专有方法 | 直接必需插件 |',
    '| --- | --- | --- | --- | --- |',
    ...pack.members.map(member=>`| \`${member.id}\` · ${member.name} | \`${member.service}\` | ${member.description} | ${member.methods.map(method=>'\`'+method+'\`').join('、')} | ${member.requires.length?member.requires.map(id=>'\`'+id+'\`').join('、'):'无'} |`),
  ]),
  '',
].join('\n');
await writeFile(new URL('../docs/seventh-plugin-members.md',import.meta.url),membersGuide);
console.log('第七批显式目录：20包，285插件。');
