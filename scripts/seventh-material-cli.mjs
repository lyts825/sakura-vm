/** 固定材料拥有者的分块上传；保留 PDF、WASM、JSONL 等真实格式。 */
import {lstat,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const formats=new Set(['json','jsonl','csv','text','pdf','png','jpeg','webp','wasm','binary','image','bundle','wav','mp4','site']);
const aliases={jsonl:'text',pdf:'image',wasm:'bundle',binary:'bundle'};
export async function seventhMaterialCli(pack,args,api){
 const [,workspaceId,file,...rest]=args;if(!workspaceId||!file)throw new Error('upload <workspaceId> <文件> [--domain <材料域>] [--format <格式>] [--export] [--resume <原上传ID>]');
 let member=pack.members.find(m=>m.material),allowExport=false,resumeId,declared;const seen=new Set();
 while(rest.length){const flag=rest.shift();if(seen.has(flag)||!['--domain','--format','--export','--resume'].includes(flag))throw new Error('材料选项无效或重复');seen.add(flag);if(flag==='--export'){allowExport=true;continue;}const value=rest.shift();if(!value||value.startsWith('--'))throw new Error('材料选项缺少值');if(flag==='--domain')member=pack.members.find(m=>m.material&&(m.id===value||m.id===pack.prefix+'-'+value));if(flag==='--format')declared=value;if(flag==='--resume')resumeId=value;}
 if(!member)throw new Error('材料域必须来自本包固定材料提供者');if(resumeId&&!/^[0-9a-f-]{36}$/i.test(resumeId))throw new Error('原上传 ID 格式无效');
 const extension=file.split('.').at(-1)?.toLowerCase(),inferred=extension==='jpg'?'jpeg':formats.has(extension)?extension:['txt','md','c','h','py','js','ts','xml','html','yaml','yml'].includes(extension)?'text':'binary',format=declared??inferred;
 if(!formats.has(format))throw new Error('材料格式不支持');
 const route='/'+member.id,call=(method,input)=>api(route+'/'+method,'POST',input),initial=await lstat(file);
 if(!initial.isFile()||initial.isSymbolicLink()||initial.nlink!==1||initial.size<1||initial.size>256*1024**2)throw new Error('材料须为 256 MiB 以内的独立普通文件');
 const handle=await open(file,'r'),same=value=>value.isFile()&&value.dev===initial.dev&&value.ino===initial.ino&&value.nlink===1&&value.size===initial.size&&value.mtimeMs===initial.mtimeMs&&value.ctimeMs===initial.ctimeMs;let upload,offset=0;
 try{
  if(!same(await handle.stat()))throw new Error('材料文件身份变化');const hash=createHash('sha256'),buffer=Buffer.alloc(512*1024);
  while(offset<initial.size){const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,initial.size-offset),offset);if(!bytesRead)throw new Error('材料读取中断');hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}
  if(!same(await handle.stat())||!same(await lstat(file)))throw new Error('材料在读取时变化');const digest=hash.digest('hex');
  if(resumeId){upload=(await call('uploads',{workspaceId})).find(u=>u.id===resumeId);if(!upload||upload.digest!==digest||upload.bytes!==initial.size||upload.format!==(aliases[format]??format)||upload.allowExport!==allowExport)throw new Error('原上传与材料、声明格式或导出权限不一致');}
  else upload=await call('begin-upload',{workspaceId,name:file.replaceAll('\\','/').split('/').at(-1),format,bytes:initial.size,digest,allowExport});
  if(!upload?.id||!Number.isSafeInteger(upload.offset)||upload.offset<0||upload.offset>initial.size)throw new Error('材料上传回执无效');offset=upload.offset;
  while(offset<initial.size){const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,initial.size-offset),offset);if(!bytesRead)throw new Error('材料读取中断');const next=await call('append-upload',{workspaceId,id:upload.id,offset,data:buffer.subarray(0,bytesRead).toString('base64')});if(next.id!==upload.id||next.offset!==offset+bytesRead)throw new Error('材料上传偏移回执不一致');offset=next.offset;}
  if(!same(await handle.stat())||!same(await lstat(file)))throw new Error('材料在上传时变化');const result=await call('finish-upload',{workspaceId,id:upload.id});if(result.domain!==member.id||result.content?.format!==format||result.content?.digest!==digest||result.content?.bytes!==initial.size)throw new Error('材料完成回执的拥有者、格式或摘要不一致');return result;
 }catch(error){if(upload?.id)error.message+=`；原材料上传 ${upload.id}，最后确认偏移 ${offset}。使用同一文件、域、格式和权限及 --resume <原上传ID> 继续。`;throw error;}
 finally{await handle.close();}
}
