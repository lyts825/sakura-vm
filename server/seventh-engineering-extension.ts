/** 社区 WASM 的结构检查、受限候选试跑和精确签名材料。须在受管计算 worker 调用。 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { canonical, checkpoint, integer, list, obj, reject, result, str, unique, type R } from './seventh-engineering-common.ts';
function extensions(value:unknown) {
  const id=(v:unknown)=>{const value=str(v);if(!/^[a-z][a-z0-9-]{0,31}$/.test(value))reject('EXTENSION_INTERFACE_ID');return value;};
  const source=obj(value),routes=list(source.routes??[],8).map(v=>{const r=obj(v);return {id:id(r.id),name:str(r.name,'name',120)};});unique(routes,r=>r.id);
  const panels=list(source.panels??[],4).map(v=> {
    const p=obj(v),fields=list(p.fields??[],8).map(v=>{const f=obj(v),type=str(f.type);if(!['text','number','boolean'].includes(type)||typeof f.required!=='boolean')reject('EXTENSION_FIELD');return {key:id(f.key),label:str(f.label,'label',120),type,required:f.required};});unique(fields,f=>f.key);
    const routeId=id(p.routeId);if(!routes.some(r=>r.id===routeId))reject('EXTENSION_ROUTE_REFERENCE');const description=typeof p.description==='string'?p.description:'';if(description.length>200)reject('EXTENSION_PANEL_DESCRIPTION');return {id:id(p.id),title:str(p.title,'title',120),description,routeId,fields};
  });unique(panels,p=>p.id);return {routes,panels};
}
function manifest(value:unknown) {
  const m=obj(value),id=str(m.id),version=str(m.version),sha256=str(m.sha256),publisher=str(m.publisher);
  if((m.schemaVersion!==undefined&&m.schemaVersion!==1)||!/^[a-z][a-z0-9-]{1,63}$/.test(id)||!/^\d+\.\d+\.\d+$/.test(version)||!/^[a-f0-9]{64}$/.test(sha256)||!/^[a-f0-9]{64}$/.test(publisher)||(typeof m.description==='string'&&m.description.length>500))reject('EXTENSION_MANIFEST');
  return {schemaVersion:1,id,name:str(m.name,'name',120),description:typeof m.description==='string'?m.description:'',version,sha256,publisher,...(m.extensions?{extensions:extensions(m.extensions)}:{})};
}
function wasm(input:R) {const encoded=str(input.wasmBase64,'wasmBase64',700000);if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))reject('EXTENSION_BASE64');const data=Buffer.from(encoded,'base64');if(data.length>512*1024)reject('EXTENSION_WASM_SIZE');return data;}
export function inspectWasm(data:Buffer) {
  if(data.length<8||data.subarray(0,8).toString('hex')!=='0061736d01000000')reject('EXTENSION_WASM_HEADER');
  let offset=8;const types:{params:number[];results:number[]}[]=[],functions:number[]=[],exports=new Map<string,{kind:number;index:number}>();let memory=false;const sections=new Set<number>();
  const read=(end=data.length)=>{let value=0,shift=0;for(let i=0;i<5;i++){if(offset>=end)reject('EXTENSION_WASM_TRUNCATED');const byte=data[offset++];value+=(byte&127)*2**shift;if(!(byte&128)){if(!Number.isSafeInteger(value)||value>0xffffffff)reject('EXTENSION_WASM_LEB');return value;}shift+=7;}reject('EXTENSION_WASM_LEB');};
  const byte=(end:number)=>{if(offset>=end)reject('EXTENSION_WASM_TRUNCATED');return data[offset++];};
  while(offset<data.length) {
    const id=data[offset++],size=read(),end=offset+size;if(end>data.length)reject('EXTENSION_WASM_TRUNCATED');if(id!==0){if(sections.has(id))reject('EXTENSION_WASM_DUPLICATE_SECTION');sections.add(id);}
    if(id===1){const count=read(end);if(count>10000)reject('EXTENSION_WASM_TYPES');for(let i=0;i<count;i++){if(byte(end)!==0x60)reject('EXTENSION_WASM_TYPE');const p=read(end);if(p>64)reject('EXTENSION_WASM_SIGNATURE');const params=Array.from({length:p},()=>byte(end)),r=read(end);if(r>16)reject('EXTENSION_WASM_SIGNATURE');types.push({params,results:Array.from({length:r},()=>byte(end))});}}
    else if(id===2){if(read(end)!==0)reject('EXTENSION_WASM_IMPORTS');}
    else if(id===3){const count=read(end);if(count>10000)reject('EXTENSION_WASM_FUNCTIONS');for(let i=0;i<count;i++)functions.push(read(end));}
    else if(id===4){if(read(end)!==0)reject('EXTENSION_WASM_TABLE');}
    else if(id===5){if(read(end)!==1||read(end)!==1)reject('EXTENSION_WASM_MEMORY_MAX');const minimum=read(end),maximum=read(end);if(minimum>maximum||maximum>256)reject('EXTENSION_WASM_MEMORY_LIMIT');memory=true;}
    else if(id===7){const count=read(end);if(count>100)reject('EXTENSION_WASM_EXPORTS');for(let i=0;i<count;i++){const length=read(end);if(length>256||offset+length>end)reject('EXTENSION_WASM_EXPORT');const name=data.subarray(offset,offset+length).toString('utf8');offset+=length;const kind=byte(end),index=read(end);if(exports.has(name))reject('EXTENSION_WASM_EXPORT');exports.set(name,{kind,index});}}
    if([1,2,3,4,5,7].includes(id)&&offset!==end)reject('EXTENSION_WASM_SECTION_SIZE');offset=end;
  }
  const check=(name:string,params:number[])=>{const e=exports.get(name);if(!e||e.kind!==0)reject('EXTENSION_WASM_EXPORT',name);const t=types[functions[e.index]];if(!t||canonical(t)!==canonical({params,results:[0x7f]}))reject('EXTENSION_WASM_SIGNATURE',name);};
  check('alloc',[0x7f]);check('run',[0x7f,0x7f]);if(!memory||exports.get('memory')?.kind!==2||exports.get('memory')?.index!==0)reject('EXTENSION_WASM_MEMORY_EXPORT');
  if(!WebAssembly.validate(Uint8Array.from(data)))reject('EXTENSION_WASM_INVALID');
  return {valid:true,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),maximumMemoryBytes:16*1024*1024,exports:[...exports.keys()]};
}
async function trial(input:R,signal?:AbortSignal) {
  const data=wasm(input),inspection=inspectWasm(data),cases=list(input.cases??[{input:input.input??{}}],200),results:R[]=[];
  for(const [index,value]of cases.entries()) {
    checkpoint(signal);const c=obj(value),encoded=Buffer.from(JSON.stringify(c.input??{}));if(encoded.length>32768)reject('EXTENSION_INPUT_LIMIT');
    try {
      const {instance}=await WebAssembly.instantiate(Uint8Array.from(data),{}),exports=instance.exports as {memory:WebAssembly.Memory;alloc:(n:number)=>number;run:(p:number,n:number)=>number};
      const p=exports.alloc(encoded.length);if(!Number.isInteger(p)||p<0||p+encoded.length>exports.memory.buffer.byteLength)reject('EXTENSION_ALLOC_RANGE');new Uint8Array(exports.memory.buffer,p,encoded.length).set(encoded);
      const out=exports.run(p,encoded.length);if(!Number.isInteger(out)||out<0||out+4>exports.memory.buffer.byteLength)reject('EXTENSION_OUTPUT_RANGE');
      const view=new DataView(exports.memory.buffer),length=view.getUint32(out,true);if(length>65536||out+4+length>exports.memory.buffer.byteLength)reject('EXTENSION_OUTPUT_LIMIT');
      const output=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(exports.memory.buffer,out+4,length)));
      const passed=c.expected===undefined||canonical(c.expected)===canonical(output);results.push({index,passed,output,asserted:c.expected!==undefined});
    }catch(error){results.push({index,passed:false,error:error instanceof Error?error.message:'WASM_TRAP'});}
  }
  return result('extension-trial',{inspection,results,outcome:results.length&&results.every(c=>c.passed===true)?'passed':'failed',source:'actual-wasm-worker',timeBudgetEnforcedBy:'managed-compute-worker'});
}
export async function extensionAction(action:string,input:R,signal?:AbortSignal):Promise<unknown> {
  if(['manifests.validate','interfaces.preview','bundles.validate'].includes(action)){
    const m=manifest(input.manifest??input),inspection=input.wasmBase64?inspectWasm(wasm(input)):null;
    if(inspection&&inspection.sha256!==m.sha256)reject('EXTENSION_ARTIFACT_DIGEST');
    if(action==='bundles.validate') {
      if(!inspection||!input.publicKey||!input.signature)return result('extension-bundle',{valid:false,installable:false,manifest:m,inspection,missing:[...(!inspection?['wasm']:[]),...(!input.publicKey?['public-key']:[]),...(!input.signature?['signature']:[])]});
      const signature=obj(await extensionAction('signatures.verify',{manifest:m,publicKey:input.publicKey,signature:input.signature},signal));
      return result('extension-bundle',{valid:signature.valid===true,installable:signature.valid===true,manifest:m,inspection,signature});
    }
    return result('extension-manifest',{valid:true,manifest:m,inspection});
  }
  if(action==='inspections.inspect'||action==='inspections.explain')return result('extension-inspection',inspectWasm(wasm(input)));
  if(action==='toolchains.inspect') {
    const profile=obj(input.profile??input),compiler=str(profile.compiler),version=str(profile.version),imageDigest=str(profile.imageDigest),sdkDigest=str(profile.sdkDigest);
    if(compiler!=='clang'||!/^\d+\.\d+\.\d+$/.test(version)||!/^[a-f0-9]{64}$/.test(imageDigest)||!/^[a-f0-9]{64}$/.test(sdkDigest))reject('EXTENSION_TOOLCHAIN_PROFILE');
    return result('extension-toolchain-declaration',{valid:true,compiler,version,imageDigest,sdkDigest,verifiedInGuest:false,executionReady:false,requiredProbe:'clang-and-wasm-ld-in-selected-owned-image'});
  }
  if(action==='trials.run')return trial(input,signal);
  if(action==='cases.validate'){const cases=list(input.cases,200);for(const c of cases)if(Buffer.byteLength(JSON.stringify(obj(c).input??{}))>32768)reject('EXTENSION_INPUT_LIMIT');return result('extension-cases',{valid:true,count:cases.length});}
  if(['signatures.prepareEnvelope','signatures.importSignature','signatures.verify'].includes(action)) {
    const m=manifest(input.manifest),payload=Buffer.from(JSON.stringify(m));
    if(action==='signatures.prepareEnvelope')return result('extension-signing-envelope',{payloadBase64:payload.toString('base64'),payloadUtf8:payload.toString(),sha256:createHash('sha256').update(payload).digest('hex')});
    const pem=str(input.publicKey,'publicKey',1000);if(pem.includes('PRIVATE KEY')||!pem.startsWith('-----BEGIN PUBLIC KEY-----'))reject('EXTENSION_PUBLIC_KEY_ONLY');
    const key=createPublicKey(pem);if(key.asymmetricKeyType!=='ed25519')reject('EXTENSION_KEY_TYPE');
    const fingerprint=createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
    const text=str(input.signature);if(!/^[A-Za-z0-9+/]{86}==$/.test(text))reject('EXTENSION_SIGNATURE_LENGTH');const signature=Buffer.from(text,'base64');if(signature.length!==64)reject('EXTENSION_SIGNATURE_LENGTH');
    const valid=fingerprint===m.publisher&&verify(null,payload,key,signature);
    return result('extension-signature',{valid,fingerprint,manifestDigest:m.sha256,installable:valid,signature:text,publicKey:pem,payloadBase64:payload.toString('base64'),payloadSha256:createHash('sha256').update(payload).digest('hex')});
  }
  if(['catalogs.compose','catalogs.validate','catalogs.exportCatalog'].includes(action)) {
    const base=new URL(str(input.catalogUrl));if(base.protocol!=='https:'||base.username||base.password||base.hash)reject('EXTENSION_CATALOG_URL');
    const entries=list(input.plugins,100).map(v=>{const p=obj(v),m=manifest(p),url=new URL(str(p.wasmUrl),base);if(url.origin!==base.origin||url.protocol!=='https:'||url.username||url.password||url.hash)reject('EXTENSION_CATALOG_ORIGIN');return {...m,signature:str(p.signature),wasmUrl:str(p.wasmUrl)};});unique(entries,e=>e.id+'@'+e.version);
    return result('extension-catalog',{valid:true,catalog:{schemaVersion:1,plugins:entries},networkVerified:false,uploaded:false});
  }
  reject('ENGINEERING_ACTION_UNSUPPORTED',action);
}
