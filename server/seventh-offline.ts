/** 纯数据离线核验，不导入宿主、执行器、网络或插件生命周期。 */
import {createHash} from 'node:crypto';
import {decodeSuiteBundle,canonicalBundle} from '../scripts/suite-bundle.mjs';
import catalog from '../shared/seventh-catalog.json';
import {SEVENTH_BUNDLE_LIMIT} from '../shared/contracts/seventh-exchange.ts';
import * as S from '../shared/contracts/suite-common.ts';
import {parseSuiteJson} from '../shared/suite-json.ts';
const key=(r:S.SuiteRef)=>`${r.domain}:${r.id}:${r.revision}`;
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
/** 只携带历史事实；运行票据、批准和本地主体不能经档案获得新权限。 */
export function sanitizeSeventhContent(domain:string,kind:S.SuiteRecord['kind'],value:S.SuiteJson):S.SuiteJson {
  const scrub=(item:S.SuiteJson,control=false):S.SuiteJson=> {
    if(Array.isArray(item))return item.map(v=>scrub(v,control));
    if(!item||typeof item!=='object')return item;
    control=control||(typeof item.format==='string'&&/execution|seventh-result|vm-output/.test(item.format))||(typeof item.source==='string'&&item.source.startsWith('actual-vm-'));
    const excluded=new Set(['approval','approved','planId','operationId','sessionId','provider','secretRef','secretVersion','generation','authorizationDigest','processId','processCreated','targetIdentity','vm','vmId','owner','actor','token','pid','startTicks','bootId','ticket','reservationId','nativeIntentId','jobName','workRoot','assetRoot','working','controllerPid','controllerCreated']);
    return Object.fromEntries(Object.entries(item).filter(([key])=>!control||!excluded.has(key)).map(([key,v])=>[key,scrub(v,['receipt','worker','identity','approval','provider','targetIdentity','vm'].includes(key)||(key==='execution'&&!!v&&typeof v==='object'&&!Array.isArray(v)&&v.backend==='windows-appcontainer-job'))]));
  };
  if(value&&typeof value==='object'&&!Array.isArray(value)&&value.format==='sakura-seventh-external-reference/1')return scrub(value);
  const clean=scrub(value,kind==='result'||kind==='review'||kind==='import');
  if(kind==='result'||kind==='review'||kind==='import')return {format:'sakura-seventh-external-reference/1',sourceDomain:domain,originalKind:kind,executionAllowed:false,approvalsTransferred:false,sourceClaim:clean};
  if(clean&&typeof clean==='object'&&!Array.isArray(clean))return {...clean,importedDefinition:true,executionAllowed:false,approvalsTransferred:false};
  return clean;
}
export function projectSeventhRecords(rows:readonly S.SuiteRecord[]) {
  const old=new Map(rows.map(r=>[key(r),r])),mapped=new Map<string,S.SuiteRef>(),active=new Set<string>(),result:S.SuiteRecord[]=[];
  const rewrite=(v:S.SuiteJson):S.SuiteJson=> {
    if(Array.isArray(v))return v.map(rewrite);if(!v||typeof v!=='object')return v;
    const parsed=S.suiteRef.safeParse(v);if(parsed.success&&Object.keys(v).length===3)return mapped.get(key(parsed.data))??v;
    return Object.fromEntries(Object.entries(v).map(([name,item])=>[name,rewrite(item)]));
  };
  const visit=(row:S.SuiteRecord)=> {
    const before=key(row);if(mapped.has(before))return;if(active.has(before))throw new Error('SEVENTH_EXCHANGE_CYCLE');active.add(before);
    for(const ref of row.references){const dependency=old.get(key(ref));if(!dependency)throw new Error('SEVENTH_EXCHANGE_INCOMPLETE_READONLY_REQUIRED');visit(dependency);}
    const content=row.kind==='source'?row.content:rewrite(sanitizeSeventhContent(row.domain,row.kind,row.content)),references=row.references.map(r=>mapped.get(key(r))!);
    const revision=sha(canonicalBundle({id:row.id,parent:null,sequence:1,content,references}));
    const next:S.SuiteRecord={...row,sequence:1,parent:null,revision,content,references,state:'sealed'};
    delete next.authorizationDigest;result.push(next);mapped.set(before,{domain:row.domain,id:row.id,revision});active.delete(before);
  };rows.forEach(visit);return {rows:result,mapped};
}
export function decodeSeventhGraph(packId:string,data:Uint8Array) {
  const pack=catalog.find(p=>p.id===packId);if(!pack)throw new Error('SEVENTH_EXCHANGE_PACK');
  const decoded=decodeSuiteBundle(data,'sakura-'+packId+'/1',{maximumBytes:SEVENTH_BUNDLE_LIMIT}),allowed=new Set(pack.members.map(m=>m.id)),materialDomains=new Set(pack.members.filter(m=>m.material).map(m=>m.id));
  const rows:S.SuiteRecord[]=[],materials=new Map<string,Buffer>(),used=new Set<string>();
  for(const entry of decoded.entries.filter(e=>e.path.startsWith('objects/'))) {
    if(entry.data.length>8*1024**2)throw new Error('SEVENTH_EXCHANGE_OBJECT_LIMIT');
    const row=S.suiteRecord.parse(parseSuiteJson(new TextDecoder('utf8',{fatal:true}).decode(entry.data),8*1024**2));
    if(!allowed.has(row.domain)||row.state!=='sealed'||entry.path!==`objects/${row.domain}/${row.id}-${row.revision}.json`)throw new Error('SEVENTH_EXCHANGE_OBJECT');
    if(sha(canonicalBundle({id:row.id,parent:row.parent,sequence:row.sequence,content:row.content,references:row.references}))!==row.revision)throw new Error('SEVENTH_EXCHANGE_REVISION');
    rows.push(row);used.add(entry.path);
    if(row.kind==='source') {
      if(!materialDomains.has(row.domain))throw new Error('SEVENTH_EXCHANGE_SOURCE_DOMAIN');
      const metadata=S.suiteMaterial.parse(row.content),path=`materials/${row.id}-${row.revision}.bin`,bytes=decoded.entries.find(e=>e.path===path)?.data;
      if(!bytes||bytes.length!==metadata.bytes||sha(bytes)!==metadata.digest)throw new Error('SEVENTH_EXCHANGE_MATERIAL');
      materials.set(key(row),bytes);used.add(path);
    }
  }
  if(!rows.length||rows.length>1000||used.size!==decoded.entries.length||new Set(rows.map(r=>r.workspaceId)).size!==1)throw new Error('SEVENTH_EXCHANGE_GRAPH');
  const index=new Map(rows.map(r=>[key(r),r]));if(index.size!==rows.length)throw new Error('SEVENTH_EXCHANGE_DUPLICATE');
  const seen=new Set<string>(),active=new Set<string>();
  const visit=(row:S.SuiteRecord)=>{const id=key(row);if(seen.has(id))return;if(active.has(id))throw new Error('SEVENTH_EXCHANGE_CYCLE');active.add(id);for(const r of row.references){const target=index.get(key(r));if(!target)throw new Error('SEVENTH_EXCHANGE_INCOMPLETE_READONLY_REQUIRED');visit(target);}active.delete(id);seen.add(id);};
  rows.forEach(visit);
  return {rows,materials,manifestDigest:decoded.manifest.digest,manifest:decoded.manifest};
}
export function verifySeventhBundle(packId:string,data:Uint8Array) {
  const graph=decodeSeventhGraph(packId,data);
  return {format:'sakura-'+packId+'/1',bytes:data.byteLength,objects:graph.rows.length,materialObjects:graph.materials.size,materialBytes:[...graph.materials.values()].reduce((n,b)=>n+b.length,0),manifestDigest:graph.manifestDigest,integrity:'verified' as const,sourceTrust:'unauthenticated' as const,referenceGraph:'complete' as const,businessResults:'external-claims' as const,executionAllowed:false as const,approvalsTransferred:false as const,maximumBytes:SEVENTH_BUNDLE_LIMIT};
}
