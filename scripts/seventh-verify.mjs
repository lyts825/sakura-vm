/** 离线核验只加载固定编译入口，导入档案不会执行其内容。 */
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {readSuiteFile} from './suite-files.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
if(!isMainThread){try{const module=await import('../.sakura-server/seventh-offline.js');parentPort.postMessage({value:await module.verifySeventhBundle(workerData.packId,workerData.bytes)});}catch(error){parentPort.postMessage({error:error.message});}}
export async function verifySeventhFile(packId,file){
 const bytes=new Uint8Array(await readSuiteFile(file,64*1024**2));
 const worker=new Worker(new URL(import.meta.url),{workerData:{packId,bytes},transferList:[bytes.buffer],execArgv:[],resourceLimits:{maxOldGenerationSizeMb:384,maxYoungGenerationSizeMb:32,stackSizeMb:4}});
 try{return await new Promise((yes,no)=>{const timeout=setTimeout(()=>no(new Error('离线核验超过60秒')),60000);const finish=work=>{clearTimeout(timeout);work();};worker.once('message',r=>finish(()=>r.error?no(new Error(r.error)):yes(r.value)));worker.once('error',e=>finish(()=>no(e)));worker.once('exit',code=>{if(code)finish(()=>no(new Error('离线核验线程异常退出')));});});}finally{await worker.terminate();}
}
if(isMainThread&&process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==4)throw new Error('用法：node scripts/seventh-verify.mjs <packId> <交接.zip>');console.log(JSON.stringify(await verifySeventhFile(process.argv[2],process.argv[3]),null,2));}
 catch(error){console.error(error.message);process.exitCode=2;}
}
