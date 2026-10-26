/** 生成第七批逐插件的明确服务、装配与组合；目录与方法保存在受版本控制的显式清单。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const packs=JSON.parse(await readFile(new URL('../shared/seventh-catalog.json',import.meta.url),'utf8'));
const kernels=JSON.parse(await readFile(new URL('../shared/seventh-kernels.json',import.meta.url),'utf8'));
const base=new URL('../',import.meta.url);
const put=async(p,s)=>{const id=p.split('/')[1],service=vmServices[id],pack=packs.find(pack=>pack.members.some(m=>m.id===id));const kernel=pack?(kernels.find(k=>k.packId===pack.id)?.id??({'protocol-state-lab':'protocolScenarioSessions','service-virtualization-studio':'multiServiceVirtualizationSessions'}[pack.id])):undefined;if(kernel&&!id.endsWith('-exchange')){if(p.endsWith('/manifest.ts'))s=s.replace('services:[',`systemDependencies:[${[kernel,...(service?[service,'imageAssets']:[])].filter((v,i,a)=>a.indexOf(v)===i).map(v=>`'${v}'`).join(',')}],services:[`);if(p.endsWith('/server.ts'))s=s.replace("import {SeventhComputePort} from '../../server/seventh-compute.ts';","import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';").replace(`new SeventhComputePort('${pack.id}','${id}')`,`requiredSeventhComputePort(host.system.optional('${kernel}'))`);}if(service&&p.endsWith('/server.ts'))s=s.replace('host.signal);',`host.signal,host.system.optional('${service}'),host.system.optional('imageAssets'));`);await mkdir(new URL('.',new URL(p,base)),{recursive:true});await writeFile(new URL(p,base),s);};
const common=['save','seal','list','get','archive','references','previewCleanup','cleanup','inspectPlan','previewRecovery','publications','previewPublicationRecovery','recoverPublication','previewAction','executeAction','status','cancel','reconcile','templates','view','availableActions'];
const vmServices={'schedlab-harness':'schedulerProbeSessions','extforge-builds':'extensionBuildSessions','protostate-runs':'protocolScenarioSessions','virtservice-sessions':'multiServiceVirtualizationSessions'};
let types='/** 第七批各领域只声明本域方法；实现不进入公共合同。 */\nimport type * as S from "../../shared/contracts/suite-common.ts";\nimport type * as T from "../../shared/contracts/seventh-common.ts";\nimport type {z} from "zod";\n';
let classes='/** 逐领域固定方法适配；不接收服务名、模块名或任意执行函数。 */\nimport {SeventhService} from "./seventh-runtime.ts";\nimport type * as S from "../shared/contracts/suite-common.ts";\nimport type * as T from "../shared/contracts/seventh-common.ts";\nimport type {z} from "zod";\n';
let v1='',services='',mappings='';
types+='import type {SeventhExchangeV1} from "../../shared/contracts/seventh-exchange.ts";\n';
classes+='import {SeventhExchange} from "./seventh-exchange.ts";\n';
for(const pack of packs){
 for(const member of pack.members){
  const cls=member.service.slice(0,-2),key=cls[0].toLowerCase()+cls.slice(1),domain=member.id.slice(pack.prefix.length+1);
  const exchange=member.id.endsWith('-exchange');
  const extra=member.methods.filter(m=>!common.includes(m)&&m!=='upload'&&m!=='close'&&m!=='pin');
  types+=`export interface ${member.service} extends ${exchange?'SeventhExchangeV1':'T.'+(vmServices[member.id]?'SeventhVmV1':member.id===pack.root?'SeventhRootV1':member.material?'SeventhMaterialsV1':'SeventhRecordsV1')} {\n`;
  classes+=`export class ${cls} extends ${exchange?'SeventhExchange':'SeventhService'} {\n`;
  for(const m of (exchange?[]:extra)){
   const request=m==='create'&&member.id===pack.root?'{name:string}':'z.infer<typeof T.seventhAction> | S.SuiteApproval';
   types+=`  ${m}(input:${request}):Promise<S.SuiteJson>;\n`;
   classes+=m==='edit'?`  override edit(input:any,...rest:any[]):Promise<any>{if(typeof input==='function')return super.edit(input,rest[0],rest[1]);return this.perform('edit',input);}\n`:`  ${m}(input:${request}):Promise<S.SuiteJson>{return this.perform('${m}',input);}\n`;
  }
  if(member.methods.includes('pin')){types+='  pin(input:S.SuitePin):Promise<S.SuiteRecord>;\n';classes+='  pin(input:S.SuitePin){return this.get(input);}\n';}
  if(member.material)types+='  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;\n';
  if(member.methods.includes('close')){types+='  close(input:S.SuiteScope & {expectedRevision:number}):Promise<S.SuiteWorkspace>;\n';classes+='  override async close(input?:S.SuiteScope & {expectedRevision:number}):Promise<any>{if(!input)return super.close();return this.revokeWorkspace({...input,revoked:true});}\n';}
  types+='}\n';classes+='}\n';
  v1+=`export interface ${member.service} extends SeventhContracts.${member.service} {}\n`;
  services+=`  ${cls}: PUBLIC_SERVICE_CONTRACTS['sakura.service.${member.id}.v1'] as ServiceContract<V1.${member.service}>,\n`;
  mappings+=`  '${member.id}/${key}': serviceContracts.${cls},\n`;
  const refs=member.requires.filter(d=>pack.members.some(m=>m.id===d));
  const imports=refs.map((d,i)=>`import {services as peer${i}} from '../${d}/services.ts';`).join('\n');
  const peerMap=refs.map((d,i)=>`'${d}':host.use(peer${i}.domain)`).join(',');
  const root=member.id===pack.root?'undefined':`host.use(peer${refs.indexOf(pack.root)}.domain)`;
  const methods=[...common,...member.methods];
  const read=new Set(['list','get','references','inspectPlan','publications','status','templates','listWorkspaces','workspace','capacity','hostCapacity','pin','readLease','readSource']);
  const metadata=Object.fromEntries([...new Set(methods)].map(m=>[m,read.has(m)]));
  // 清单元数据与完整校验器由 suite-routes.ts 从同一权威生成。
  await put(`plugins/${member.id}/services.ts`,`/** ${member.name}的独立版本服务引用。 */\nimport {serviceRef} from '../../server/service-ref.ts';\nimport {serviceContracts} from '../../server/service-contracts.ts';\nexport const services={domain:serviceRef('${member.id}','${key}',serviceContracts.${cls})};\n`);
  await put(`plugins/${member.id}/manifest.ts`,`/** ${member.name}的明确依赖和线路声明。 */\nimport {definePlugin,pin} from '../../shared/plugin-protocol.ts';\nimport {${pack.prefix}Routes,${pack.prefix}Http} from '../../shared/contracts/${pack.prefix}-routes.generated.ts';\nexport const manifest=definePlugin({id:'${member.id}',name:${JSON.stringify(member.name)},description:${JSON.stringify(member.description)},category:'development',experimental:true,requires:[${member.requires.map(d=>`pin('${d}')`).join(',')}],services:['${key}'],contributes:{${member.id.endsWith('-workbench')?`pages:['${pack.id}'],`:''}http:${pack.prefix}Http('${domain}'),routes:${pack.prefix}Routes('${domain}')}});\n`);
  const materialMap=pack.members.filter(m=>m.material).map(m=>`'${m.id}':host.use(peer${refs.indexOf(m.id)}.domain)`).join(',');
  const constructorArguments=exchange?`'${pack.id}',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('blobs',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),${root},{${peerMap}},{${materialMap}}`:`'${member.id}',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),${root},{${peerMap}},new SeventhComputePort('${pack.id}','${member.id}'),host.signal`;
  await put(`plugins/${member.id}/server.ts`,`/** ${member.name}：绑定本插件元数据、直接提供者和固定计算。 */\nimport type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';\nimport {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';\nimport {${cls}} from '../../server/seventh-domains.generated.ts';\nimport {SeventhComputePort} from '../../server/seventh-compute.ts';\nimport {seventhSchemas} from '../../shared/contracts/seventh-http.ts';\nimport {${pack.prefix}RouteMetadata} from '../../shared/contracts/${pack.prefix}-routes.generated.ts';\nimport {services} from './services.ts';\n${imports}\nexport {manifest} from './manifest.ts';\nconst schemas=seventhSchemas('${member.id}');\nexport async function activate(host:PluginContext){const service=new ${cls}(${constructorArguments});host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.${exchange?'close':'dispose'}());}\nexport const route=suiteRoute('${member.id}',schemas,services.domain,${pack.prefix}RouteMetadata['${domain}']);\nexport const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));\nexport const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));\n`);
  if(member.id.endsWith('-workbench'))await put(`plugins/${member.id}/client.tsx`,`/** ${pack.name}工作台按需加载。 */\nimport type {PluginPageProps} from '../../src/plugin-client.tsx';\nimport {SeventhWorkbench} from '../../src/SeventhWorkbench.tsx';\nconst Page=(props:PluginPageProps)=><SeventhWorkbench {...props} packId='${pack.id}'/>;\nexport const pages={'${pack.id}':Page};\n`);
 }
 await put(`plugins/packs/${pack.id}.ts`,`/** ${pack.name}的完整成员集合。 */\nimport {definePack,member} from '../../shared/plugin-protocol.ts';\nexport const pack=definePack({id:'${pack.id}',name:${JSON.stringify(pack.name)},description:${JSON.stringify(pack.name+'：定义、处理、复核和交接。')},members:[${pack.members.map(m=>`member('${m.id}')`).join(',')}]});\n`);
}
await put('server/seventh-domains.generated.ts',classes);
await put('server/service-contracts/seventh.ts',types);
const append=async(file,marker,source)=>{const p=new URL(file,base);let s=await readFile(p,'utf8');if(s.includes(marker))s=s.slice(0,s.indexOf(marker));await writeFile(p,s+'\n'+marker+'\n'+source);};
await append('server/service-contracts/v1.ts','// seventh-generated-contracts',`import type * as SeventhContracts from './seventh.ts';\n${v1}`);
const sc=new URL('server/service-contracts.ts',base);let st=await readFile(sc,'utf8');if(!st.includes('// seventh-generated-descriptors'))st=st.replace('export const serviceContracts = {','export const serviceContracts = {\n// seventh-generated-descriptors\n'+services+'// seventh-generated-descriptors-end');else st=st.replace(/\/\/ seventh-generated-descriptors\n[\s\S]*?\/\/ seventh-generated-descriptors-end/,'// seventh-generated-descriptors\n'+services+'// seventh-generated-descriptors-end');
// 服务槽位映射由同一文件内的 ServiceContracts 类型持有。
const match=st.match(/export const officialServiceContracts:[^=]+=/);
if(!match)throw new Error('未找到插件服务映射');
const mapMarker='// seventh-generated-slots';
if(st.includes(mapMarker))st=st.replace(/\/\/ seventh-generated-slots\n[\s\S]*?\/\/ seventh-generated-slots-end/,mapMarker+'\n'+mappings+'// seventh-generated-slots-end');
else st=st.replace(match[0]+' {',match[0]+' {\n'+mapMarker+'\n'+mappings+'// seventh-generated-slots-end');
await writeFile(sc,st);
console.log('第七批插件源文件与独立合同已生成。');
