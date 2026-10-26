/** 本包独立交换服务；材料、保护引用、隔离接受和清理均回原所有者。 */
import {z} from 'zod';
import {SuiteExchange,type SuiteExportProjection} from './suite-exchange.ts';
import type {PluginMetadata} from './plugin-metadata.ts';
import {suiteFail,suiteHash,suiteSha,type SuiteAuthorize} from './suite-store.ts';
import * as S from '../shared/contracts/suite-common.ts';
import {SEVENTH_BUNDLE_LIMIT,seventhAcceptPreview,type SeventhExchangeV1} from '../shared/contracts/seventh-exchange.ts';
import {verifySeventhBundle,sanitizeSeventhContent,projectSeventhRecords} from './seventh-offline.ts';
import catalog from '../shared/seventh-catalog.json';
import {seventhMaterialUpload,type SeventhMaterialsV1} from '../shared/contracts/seventh-common.ts';
const key=(ref:S.SuiteRef)=>`${ref.domain}:${ref.id}:${ref.revision}`;
const pin=(row:S.SuiteRecord):S.SuiteRef=>({domain:row.domain,id:row.id,revision:row.revision});
function projection(packId:string,peers:Readonly<Record<string,S.SuiteRecordsV1>>,materials:Readonly<Record<string,S.SuiteByteMaterialsV1>>):SuiteExportProjection {
  const collect=async(scope:S.SuiteScope,selected:S.SuiteRef[])=> {
    const rows=new Map<string,S.SuiteRecord>(),active=new Set<string>();
    const visit=async(ref:S.SuiteRef)=>{if(rows.has(key(ref)))return;if(active.has(key(ref))||rows.size+active.size>=1000)suiteFail('SEVENTH_EXCHANGE_GRAPH');active.add(key(ref));const store=Object.hasOwn(peers,ref.domain)?peers[ref.domain]:suiteFail('SEVENTH_EXCHANGE_DOMAIN');const row=await store.get({...scope,id:ref.id,revision:ref.revision});if(row.state!=='sealed'||row.workspaceId!==scope.workspaceId)suiteFail('SEVENTH_EXCHANGE_FIXED');for(const dependency of row.references)await visit(dependency);rows.set(key(ref),row);active.delete(key(ref));};
    for(const ref of selected)await visit(ref);
    const guards=[];
    for(const row of rows.values()){const ref=pin(row),policy=row.kind==='source'?await (materials[row.domain]??suiteFail('SEVENTH_EXCHANGE_MATERIAL_OWNER')).policy({...scope,id:row.id,revision:row.revision}):null;if(policy&&(!policy.allowRead||!policy.allowExport))suiteFail('SUITE_SOURCE_PERMISSION','原材料当前禁止导出',403);guards.push({ref,policyRevision:row.policyRevision,authorizationDigest:row.authorizationDigest??suiteFail('SEVENTH_EXCHANGE_PERMISSION'),policy});}
    return {rows:[...rows.values()],guards};
  };
  const authorize=async(scope:S.SuiteScope,selected:S.SuiteRef[],binding:S.SuiteJson)=>{const now=await collect(scope,selected);if(suiteHash(now.guards)!==suiteHash(binding))suiteFail('SEVENTH_EXCHANGE_PERMISSION_CHANGED');};
  return {id:'seventh-historical-v1',authorize,async project(scope,selected){
    const original=await collect(scope,selected),projected=projectSeventhRecords(original.rows),result:{reference:S.SuiteRef;data:Uint8Array}[]=[];let bytes=0;
    for(const row of original.rows)if(row.kind==='source'){
      const ref=pin(row),metadata=S.suiteMaterial.parse(row.content),owner=materials[row.domain]??suiteFail('SEVENTH_EXCHANGE_MATERIAL_OWNER'),parts:Buffer[]=[];
      bytes+=metadata.bytes;if(bytes>SEVENTH_BUNDLE_LIMIT-128*1024)suiteFail('SUITE_BUNDLE_LIMIT');
      let offset=0;do{const part=await owner.readSource({...scope,id:row.id,revision:row.revision,offset,length:Math.max(1,Math.min(512*1024,metadata.bytes-offset)),purpose:'export'}),chunk=Buffer.from(part.data,'base64');if(part.offset!==offset+chunk.length||(!chunk.length&&!part.eof))suiteFail('SUITE_MATERIAL_PROTOCOL');parts.push(chunk);offset=part.offset;if(part.eof)break;}while(offset<metadata.bytes);
      const data=Buffer.concat(parts);if(data.length!==metadata.bytes||suiteSha(data)!==metadata.digest)suiteFail('SUITE_MATERIAL_DIGEST');result.push({reference:projected.mapped.get(key(ref))!,data});
    }
    await authorize(scope,selected,S.suiteJson.parse(original.guards));
    return {rows:projected.rows,materials:result,binding:S.suiteJson.parse(original.guards),summary:{packId,objects:projected.rows.length,materialBytes:bytes,sourceTrust:'unauthenticated',executionAllowed:false,approvalsTransferred:false}};
  }};
}
export class SeventhExchange extends SuiteExchange implements SeventhExchangeV1 {
  readonly pack:typeof catalog[number];
  constructor(packId:string,meta:PluginMetadata,blobs:PluginMetadata,uploads:PluginMetadata,auth:SuiteAuthorize,root:S.SuiteMaterialsV1,peers:Readonly<Record<string,S.SuiteRecordsV1>>,materialStores:Readonly<Record<string,S.SuiteByteMaterialsV1>>) {
    const pack=catalog.find(p=>p.id===packId)??suiteFail('SEVENTH_EXCHANGE_PACK');
    const exchange=pack.members.find(m=>m.id.endsWith('-exchange'))??suiteFail('SEVENTH_EXCHANGE_DOMAIN');
    const owners=new Set(pack.members.filter(m=>m.material).map(m=>m.id));
    if(Object.keys(materialStores).some(id=>!owners.has(id))||[...owners].some(id=>!Object.hasOwn(materialStores,id)))suiteFail('SEVENTH_EXCHANGE_MATERIAL_OWNER');
    super(exchange.id,meta,blobs,uploads,auth,root,peers,'sakura-'+packId+'/1',sanitizeSeventhContent,{sourceDomain:pack.root,receivedName:'接收的'+pack.name,materialStores,bundleLimit:SEVENTH_BUNDLE_LIMIT,projection:projection(packId,peers,materialStores),materialUpload:(store,input)=>(store as SeventhMaterialsV1).beginUpload(seventhMaterialUpload.parse(input)),verifyBundle:data=>{verifySeventhBundle(packId,data);}});
    this.pack=pack;
  }
  async previewAccept(raw:z.infer<typeof seventhAcceptPreview>):Promise<S.SuitePlan> {
    const p=seventhAcceptPreview.parse(raw);if(p.inspection.domain!==this.domain)suiteFail('SEVENTH_IMPORT_INSPECTION');
    const row=await this.get({workspaceId:p.workspaceId,id:p.inspection.id,revision:p.inspection.revision});
    const content=z.object({format:z.literal('sakura-suite-import/1'),manifestDigest:S.suiteDigest}).passthrough().parse(row.content);
    if(row.kind!=='import'||row.origin!=='local'||row.state!=='sealed')suiteFail('SEVENTH_IMPORT_INSPECTION');
    return this.plan({workspaceId:p.workspaceId},'accept-import',{inspection:p.inspection,manifestDigest:content.manifestDigest},[p.inspection]);
  }
  async templates(_input:Record<string,never>={}):Promise<S.SuiteJson> {
    await this.authorize();return {packId:this.pack.id,format:'sakura-'+this.pack.id+'/1',maximumBytes:SEVENTH_BUNDLE_LIMIT,steps:['previewExport','export','download','beginImport','appendImport','inspectImport','previewAccept','acceptImport'],missingReferences:'refused-require-complete-subgraph',executionAllowed:false};
  }
  async view(raw:S.SuiteScope):Promise<S.SuiteJson> {
    const scope=S.suiteScope.parse(raw);await this.access(scope);
    return S.suiteJson.parse({packId:this.pack.id,format:'sakura-'+this.pack.id+'/1',maximumBytes:SEVENTH_BUNDLE_LIMIT,records:await this.list({...scope,limit:100}),transfers:await this.transfers(scope),quarantines:await this.quarantines(scope),imports:await this.imports(scope)});
  }
}
