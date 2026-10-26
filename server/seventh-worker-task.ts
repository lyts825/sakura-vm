/** 只选择固定包及固定算法，输入数据不能改变执行模块。 */
import { parentPort,workerData } from 'node:worker_threads';
import catalog from '../shared/seventh-catalog.json';
import { suiteJson } from '../shared/contracts/suite-common.ts';
try{
  const {packId,action,input}=workerData;
  const pack=catalog.find(p=>p.id===packId);
  if(!pack||typeof action!=='string')throw new Error('SEVENTH_WORKER_INPUT');
  const result=workerData.lifecycle?
    pack.group==='data'?await (await import('./seventh-data-lifecycle.ts')).computeSeventhDataLifecycle(packId,action,input,workerData.records,{at:workerData.at}):pack.group==='creation'?await (await import('./seventh-creation-lifecycle.ts')).computeSeventhCreationLifecycle(packId,action,input,workerData.records):await (await import('./seventh-engineering-lifecycle.ts')).computeSeventhEngineeringLifecycle(packId,action,input,workerData.records):
    pack.group==='data'?await (await import('./seventh-data-compute.ts')).computeSeventhData(packId,action,input):pack.group==='creation'?await (await import('./seventh-creation-compute.ts')).computeSeventhCreation(packId,action,input):await (await import('./seventh-engineering-compute.ts')).computeSeventhEngineering(packId,action,input);
  parentPort!.postMessage({ok:true,result:suiteJson.parse(result)});
}catch(error){const e=error as Error & {code?:string;status?:number};parentPort!.postMessage({ok:false,error:e.message,code:e.code??'SEVENTH_COMPUTE_FAILED',status:e.status??422});}
