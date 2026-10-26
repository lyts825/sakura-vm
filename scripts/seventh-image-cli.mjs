/** 只通过已鉴权镜像端口传输 qcow2；本地入口不启动 VM、shell 或下载。 */
import {lstat,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const seventhVmDomains={'schedule-lab':'harness','extension-forge':'builds','protocol-state':'runs','service-virtualization':'sessions'};
export async function seventhImageCli(pack,args,api){
 const domain=seventhVmDomains[pack.alias];if(!domain)throw new Error('此插件包没有 VM 工具会话');
 const route='/'+pack.prefix+'-'+domain,call=(action,input={})=>api(route+'/'+action,'POST',input),[command,file,...flags]=args;
 if(command==='images'){if(file)throw new Error('images 不接受参数');return call('images');}
 if(command==='image-imports'){if(file)throw new Error('image-imports 不接受参数');return call('image-imports');}
 if(command==='image-discard'){if(!uuid.test(file??'')||flags.length)throw new Error('image-discard <原上传 ID>');return call('discard-image-import',{id:file});}
 if(command==='image-verify'){if(!/^[a-f0-9]{64}$/.test(file??'')||flags.length)throw new Error('image-verify <镜像 SHA-256>');return call('verify-image',{assetId:file,digest:file});}
 if(command!=='image-import'||!file||!(flags.length===0||(flags.length===2&&flags[0]==='--resume'&&uuid.test(flags[1]))))throw new Error('image-import <已预备 qcow2> [--resume <原上传 ID>]');
 const initial=await lstat(file);if(!initial.isFile()||initial.isSymbolicLink()||initial.nlink!==1||initial.size<72||initial.size>32*1024**3)throw new Error('镜像须为 32 GiB 以内的独立普通 qcow2 文件');
 const handle=await open(file,'r'),same=value=>value.isFile()&&value.dev===initial.dev&&value.ino===initial.ino&&value.nlink===1&&value.size===initial.size&&value.mtimeMs===initial.mtimeMs&&value.ctimeMs===initial.ctimeMs;
 let upload,offset=0;
 try{
  if(!same(await handle.stat()))throw new Error('镜像文件身份变化');
  const header=Buffer.alloc(72);if((await handle.read(header,0,72,0)).bytesRead!==72||header.readUInt32BE(0)!==0x514649fb||![2,3].includes(header.readUInt32BE(4))||header.readBigUInt64BE(24)>128n*1024n**3n)throw new Error('只接受虚拟容量最多 128 GiB 的 qcow2 v2/v3 镜像');
  if(header.readBigUInt64BE(8)!==0n||header.readUInt32BE(16)!==0)throw new Error('请先将外部 backing 链转换为独立 qcow2 镜像');
  const hash=createHash('sha256'),buffer=Buffer.alloc(512*1024);
  while(offset<initial.size){const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,initial.size-offset),offset);if(!bytesRead)throw new Error('镜像读取中断');hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}
  if(!same(await handle.stat())||!same(await lstat(file)))throw new Error('镜像在读取时变化');
  const digest=hash.digest('hex');
  if(flags.length){upload=(await call('image-imports')).find(u=>u.id===flags[1]);if(!upload||upload.digest!==digest||upload.bytes!==initial.size||upload.distro!=='alpine'||upload.architecture!=='x86_64'||!Number.isSafeInteger(upload.offset)||upload.offset<0||upload.offset>initial.size)throw new Error('原上传与镜像字节不一致');}
  else upload=await call('begin-image-import',{digest,bytes:initial.size,distro:'alpine',architecture:'x86_64',source:'explicit-seventh-prepared-image'});
  if(!uuid.test(upload?.id??'')||upload.digest!==digest||upload.bytes!==initial.size||!Number.isSafeInteger(upload.offset)||upload.offset<0||upload.offset>initial.size)throw new Error('镜像端口未返回有效上传回执');
  offset=upload.offset;
  while(offset<initial.size){const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,initial.size-offset),offset);if(!bytesRead)throw new Error('镜像读取中断');const next=await call('append-image-import',{id:upload.id,offset,data:buffer.subarray(0,bytesRead).toString('base64')});if(next.id!==upload.id||next.digest!==digest||next.offset!==offset+bytesRead)throw new Error('镜像上传回执不一致');offset=next.offset;}
  if(!same(await handle.stat())||!same(await lstat(file)))throw new Error('镜像在上传时变化');
  const asset=await call('finish-image-import',{id:upload.id});if(asset.id!==digest||asset.digest!==digest||asset.bytes!==initial.size)throw new Error('完成镜像摘要不一致');
  return {image:asset,templateOverride:{image:{assetId:asset.id,digest:asset.digest}},next:`sakura ${pack.alias} run-template <workspaceId> <templateId> <覆盖参数.json>`,localToolVerification:'pending-first-vm-run'};
 }catch(error){if(upload?.id)error.message+=`；原上传 ${upload.id}，最后确认偏移 ${offset}。用 image-imports 核对，再 --resume 继续或 image-discard 显式丢弃。`;throw error;}
 finally{await handle.close();}
}
