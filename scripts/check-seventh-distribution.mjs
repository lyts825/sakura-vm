/** 核验安装布局里的固定第七批资源；不依赖源码、开发依赖或外部连接。 */
import {readFile,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';
import {verifySeventhNative} from './seventh-runtime-assets.mjs';
export async function checkSeventhWorkerLoaders(root){
 for(const file of ['seventh-worker.mjs','assets/seventh-worker.mjs']){
  const worker=new Worker(pathToFileURL(join(resolve(root),'.sakura-server',file)),{execArgv:[],workerData:{packId:'schedule-semantics-lab',action:'clocks.resolve',input:{local:'2026-01-01T00:00:00',timeZone:'UTC'}},resourceLimits:{maxOldGenerationSizeMb:192,maxYoungGenerationSizeMb:32,stackSizeMb:4}});
  let timer;
  try{const reply=await new Promise((yes,no)=>{timer=setTimeout(()=>no(new Error('发行计算 worker 加载超时：'+file)),10000);worker.once('message',yes);worker.once('error',no);worker.once('exit',()=>no(new Error('发行计算 worker 未返回回执：'+file)));});if(reply?.ok!==true||reply.result?.state!=='unique'||reply.result?.candidates?.[0]!=='2026-01-01T00:00:00.000Z')throw new Error('发行计算 worker 返回无效回执：'+file+' '+(reply?.error??''));}
  finally{clearTimeout(timer);await worker.terminate();}
 }
 return ['root','assets'];
}
export async function checkSeventhDistribution(root,{sourceRoot}={}){
 root=resolve(root);const server=join(root,'.sakura-server');
 const metadata=JSON.parse(await readFile(join(server,'assets/seventh-runtime.json'),'utf8'));
 const expected=['seventh-worker-task.js','seventh-offline.js','seventh-catalog.json',...['seventh-worker.mjs','seventh-engineering-worker.py','seventh-creation-native-worker.py'].flatMap(f=>[f,'assets/'+f])];
 if(metadata.schemaVersion!==1||!Array.isArray(metadata.files)||metadata.files.map(f=>f.file).join(',')!==expected.join(','))throw new Error('第七批运行资源清单无效');
 for(const entry of metadata.files){const path=join(server,entry.file),info=await lstat(path),bytes=await readFile(path);if(!info.isFile()||info.isSymbolicLink()||bytes.length!==entry.size||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('第七批运行资源摘要不符：'+entry.file);}
 const catalog=JSON.parse(await readFile(join(server,'seventh-catalog.json'),'utf8'));
 if(catalog.length!==20||catalog.reduce((n,p)=>n+p.members.length,0)!==285||new Set(catalog.map(p=>p.alias)).size!==20)throw new Error('第七批插件目录数量无效');
 for(const name of ['seventh-cli.mjs','seventh-verify.mjs','seventh-image-cli.mjs','seventh-material-cli.mjs','seventh-runtime-assets.mjs','check-seventh-distribution.mjs']){
  const path=join(root,'scripts',name),result=spawnSync(process.execPath,['--check',path],{encoding:'utf8',windowsHide:true});if(result.status!==0)throw new Error('发行脚本无效：'+name+' '+(result.stderr||result.error?.message||result.status));
 }
 const native=metadata.native?await verifySeventhNative(join(server,'assets/seventh-creation'),{worker:join(server,'seventh-creation-native-worker.py'),...(sourceRoot?{source:join(sourceRoot,'native/seventh-creation-sandbox/Program.cs')}:{} )}):null;
 if(JSON.stringify(native)!==JSON.stringify(metadata.native))throw new Error('发行原生资源摘要不符');
 if(metadata.platform==='win32'&&metadata.architecture==='x64'&&!native)throw new Error('Windows x64 运行包缺少原生工具');
 if(sourceRoot)for(const file of ['seventh-worker.mjs','seventh-engineering-worker.py','seventh-creation-native-worker.py'])if(!(await readFile(join(sourceRoot,'server',file))).equals(await readFile(join(server,file))))throw new Error('第七批 worker 与源码不符：'+file);
 for(const name of ['seventh-tool-images.md','seventh-plugin-packs.md','seventh-plugin-members.md','release-2.12.0.md','release-2.12.1.md','release-2.12.2.md','release-2.12.3.md','release-2.12.4.md','release-2.12.5.md','release-2.12.6.md']){const path=join(server,'docs',name),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw new Error('发行指南不是普通文件：'+name);if(sourceRoot&&!(await readFile(join(sourceRoot,'docs',name))).equals(await readFile(path)))throw new Error('发行指南与源码不符：'+name);}
 for(const name of ['README.md','requirements.txt']){const path=join(server,'native/seventh-creation-sandbox',name),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw new Error('发行工具说明不是普通文件：'+name);if(sourceRoot&&!(await readFile(join(sourceRoot,'native/seventh-creation-sandbox',name))).equals(await readFile(path)))throw new Error('发行工具说明与源码不符：'+name);}
 const workerLoaders=await checkSeventhWorkerLoaders(root);
 return {verified:true,packs:20,plugins:285,files:metadata.files.length,native,workerLoaders};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length>3)throw new Error('用法：node scripts/check-seventh-distribution.mjs [安装目录]');console.log(JSON.stringify(await checkSeventhDistribution(process.argv[2]??process.cwd()),null,2));}
 catch(error){console.error(error.message);process.exitCode=2;}
}
