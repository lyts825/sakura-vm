/** 第七批纯Node命令，使用固定目录、鉴权API与有界离线核验。 */
import {readFile,lstat} from 'node:fs/promises';
import {createSuiteCli,suiteInputFile} from './suite-cli.mjs';
import {verifySeventhFile} from './seventh-verify.mjs';
import {seventhImageCli,seventhVmDomains} from './seventh-image-cli.mjs';
import {seventhMaterialCli} from './seventh-material-cli.mjs';
let catalog;
async function packs(){if(!catalog){const packaged=new URL('../.sakura-server/seventh-catalog.json',import.meta.url);const source=new URL('../shared/seventh-catalog.json',import.meta.url);catalog=JSON.parse(await readFile(await lstat(packaged).then(()=>packaged,()=>source),'utf8'));}return catalog;}
export const seventhAliases=new Set(['quality-desk','lineage-atlas','entity-desk','temporal-desk','geo-desk','graph-desk','experiment-plan','features','trainlab','solve','extractdoc','designsys','forms','notifytpl','schedule-lab','extension-forge','dependency-solve','protocol-state','replica-lab','service-virtualization']);
async function executeSeventhCli(alias,args,options={}){
 const pack=(await packs()).find(p=>p.alias===alias);if(!pack)throw new Error('未知插件包别名');
 const source=pack.members.find(m=>m.material)??pack.members[0];
 const {cli}=createSuiteCli({prefix:pack.prefix,label:pack.name,sourceDomain:source.id.slice(pack.prefix.length+1),maximumFile:256*1024**2,maximumBundle:64*1024**2,verify:file=>verifySeventhFile(pack.id,file)});
 if(args[0]==='upload'){if(!options.api)throw new Error('材料上传需要已认证本机服务');return seventhMaterialCli(pack,args,options.api);}
 if(['images','image-import','image-imports','image-discard','image-verify'].includes(args[0])){if(!options.api)throw new Error('镜像操作需要已认证本机服务');return seventhImageCli(pack,args,options.api);}
 if(args[0]==='templates'){if(args.length!==1)throw new Error('templates 不接受参数');if(!options.api)throw new Error('模板读取需要已认证本机服务');return options.api('/'+pack.prefix+'-workbench/templates','POST',{});}
 if(args[0]==='run-template'){
   if(!options.api||!args[1]||!args[2])throw new Error(`用法：${alias} run-template <workspaceId> <templateId> [覆盖参数.json] [--image <镜像 SHA-256>] [--seconds <1..900>]`);
   const templates=await options.api('/'+pack.prefix+'-workbench/templates','POST',{}),template=templates.find(t=>t.id===args[2]);
   if(!template)throw new Error('模板不存在');const rest=args.slice(3),override=await suiteInputFile(rest[0]&&!rest[0].startsWith('--')?rest.shift():undefined),flags=new Set();
   while(rest.length){const flag=rest.shift(),value=rest.shift();if(flags.has(flag)||!['--image','--seconds'].includes(flag)||!value)throw new Error('模板选项无效或重复');flags.add(flag);if(!seventhVmDomains[alias]||template.method!=='start')throw new Error('此模板不是 VM 工具会话');if(flag==='--image'){if(!/^[a-f0-9]{64}$/.test(value))throw new Error('镜像 SHA-256 格式无效');override.image={assetId:value,digest:value};}else{if(!/^[1-9]\d{0,2}$/.test(value)||Number(value)>900)throw new Error('工具期限须为 1..900 秒');override.maxSeconds=Number(value);}}
   const domain=pack.prefix+'-'+template.domain;
   const plan=await options.api('/'+domain+'/preview-action','POST',{workspaceId:args[1],method:template.method,input:{...template.input,...override},references:[],bindings:{}});
   const result=await options.api('/'+domain+'/execute-action','POST',{workspaceId:args[1],planId:plan.id,digest:plan.digest});
   outcome(result);return result;
 }
 const value=await cli(args,options);if(value?.help)value.help=value.help.replaceAll('sakura '+pack.prefix,'sakura '+alias)+`\n  sakura ${alias} upload <workspaceId> <文件> [--domain <本包材料域>] [--format <格式>] [--export] [--resume <原上传ID>]\n  sakura ${alias} templates\n  sakura ${alias} run-template <workspaceId> <templateId> [覆盖参数.json] [--image <镜像 SHA-256>] [--seconds <1..900>]`+(seventhVmDomains[alias]?`\n  sakura ${alias} images\n  sakura ${alias} image-import <已预备 qcow2> [--resume <原上传 ID>]\n  sakura ${alias} image-imports\n  sakura ${alias} image-verify <镜像 SHA-256>\n  sakura ${alias} image-discard <原上传 ID>\n镜像须显式导入。首个 VM 任务核验实际工具；导入完整性不等于工具已安装。每个 profile 全局最多 1 个活动或未核销会话。`:``);
 outcome(value);return value;
}
export async function seventhCli(alias,args,options={}){
 try{return await executeSeventhCli(alias,args,options);}catch(error){error.exitCode??=/CLEANUP_PENDING|CLEANUP_UNKNOWN/.test(error.code??'')?4:/UNSUPPORTED|NOT_SUPPORTED|UNAVAILABLE|SEVENTH_RUNNING/.test(error.code??'')?3:2;throw error;}
}
function outcome(value){if(value?.state==='interrupted')process.exitCode=3;if(value?.result)outcome(value.result);const c=value?.content;
 if(c&&['unknown','pending'].includes(c.cleanup)){process.exitCode=4;return;}
 if(c?.receipt&&['unknown','pending'].includes(c.receipt.cleanup)){process.exitCode=4;return;}
 if(!c||c.format!=='sakura-seventh-result/1')return;const output=c.output;
 if(output?.receipt?.cleanup==='unknown'||output?.receipt?.cleanup==='pending'||['unknown','pending'].includes(output?.materialCleanup))process.exitCode=4;
 else if(c.state==='failed'||c.state==='cancelled'||['failed','rejected'].includes(output?.outcome)||output?.receipt?.outcome==='failed')process.exitCode=1;
 else if(['inconclusive','not-supported'].includes(output?.outcome)||['inconclusive','not-supported'].includes(output?.receipt?.outcome))process.exitCode=3;
}
