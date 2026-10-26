/** 创作包补充计算：差异、独立验证与本地通知预检。 */
import {type Data,cancelled,digest,list,number,object,reject,rows,text,unique} from './seventh-creation-common.ts';
import {computeSolver,validateIntegerModel} from './seventh-creation-solver.ts';
import {computeNotifications,prepareLocalNotificationDelivery} from './seventh-creation-notifications.ts';
export const EXTRA_SOLVER_ACTIONS=['scenarios.diff','solutions.capture','solutions.compare','validation.explain','conflicts.read'] as const;
export const EXTRA_NOTIFICATION_ACTIONS=['variables.validate','channels.check','templates.diff','assets.inspect','inboxes.previewDelivery','checks.explain'] as const;
function diff(before:Data[],after:Data[],key:(row:Data,index:number)=>string){
  const left=new Map(before.map((row,i)=>[key(row,i),row])),right=new Map(after.map((row,i)=>[key(row,i),row]));
  if(left.size!==before.length||right.size!==after.length)reject('CREATION_DIFF_DUPLICATE');
  return [...new Set([...left.keys(),...right.keys()])].sort().flatMap(id=>{const a=left.get(id),b=right.get(id);if(a&&b&&digest(a)===digest(b))return [];return [{id,change:!a?'added':!b?'removed':'modified',before:a??null,after:b??null}];});
}
export function computeExtraSolver(action:string,input:Data,signal?:AbortSignal):unknown{
  cancelled(signal);
  if(action==='scenarios.diff'){const before=object(input.before),after=object(input.after);validateIntegerModel(before);validateIntegerModel(after);return {beforeDigest:digest(before),afterDigest:digest(after),variables:diff(rows(before.variables),rows(after.variables),r=>text(r.id)),constraints:diff(rows(before.constraints??[]),rows(after.constraints??[]),(r,i)=>String(r.id??i)),objectiveChanged:digest(before.objective??{})!==digest(after.objective??{})};}
  if(action==='validation.explain')return {...computeSolver('validation.verify',input) as Data,modelDigest:digest({variables:input.variables,constraints:input.constraints??[],objective:input.objective??{terms:{}}}),scope:'exact integer feasibility and objective; optimality is not proved'};
  if(action==='conflicts.read')return computeSolver('conflicts.analyze',input);
  if(action==='solutions.capture'){const verification=computeSolver('validation.verify',input) as Data;if(!verification.passed)reject('SOLVE_CAPTURE_INFEASIBLE');const model={variables:input.variables,constraints:input.constraints??[],objective:input.objective??{terms:{}}};return {assignment:object(input.assignment),modelDigest:digest(model),assignmentDigest:digest(input.assignment),verification,scope:'independently verified feasible assignment; no solver optimality claim'};}
  if(action==='solutions.compare'){
    const solutions=rows(input.solutions,100);if(!solutions.length)reject('SOLVE_SOLUTION_REQUIRED');unique(solutions.map(s=>text(s.id)));validateIntegerModel(input);
    const compared=solutions.map(s=>{const verification=computeSolver('validation.verify',{...input,assignment:s.assignment}) as Data;return {id:text(s.id),assignment:s.assignment,verification};});
    const direction=object(input.objective??{}).direction==='max'?-1:1;
    const ranked=compared.filter(s=>s.verification.passed).sort((a,b)=>{const x=BigInt(String(a.verification.objective)),y=BigInt(String(b.verification.objective));return x===y?(a.id<b.id?-1:a.id>b.id?1:0):direction*(x<y?-1:1);});
    return {solutions:compared,ranking:ranked.map(s=>({id:s.id,objective:s.verification.objective})),selectedId:ranked[0]?.id??null,scope:'best feasible supplied candidate; global optimality not proved'};
  }
  reject('CREATION_ACTION_UNSUPPORTED');
}
function at(value:Data,path:string){const parts=path.split('.');if(parts.some(part=>['__proto__','constructor','prototype'].includes(part)))reject('NOTIFY_VARIABLE_PATH');let current:unknown=value;for(const part of parts){if(!current||typeof current!=='object'||!Object.hasOwn(current,part))return undefined;current=(current as Data)[part];}return current;}
export function computeExtraNotification(action:string,input:Data,signal?:AbortSignal):unknown{
  cancelled(signal);
  if(action==='variables.validate'){
    const definitions=rows(input.variables,500),values=object(input.values??{});unique(definitions.map(v=>text(v.id)));const findings:Data[]=[];
    for(const v of definitions){const id=text(v.id);if(!/^[a-zA-Z][\w.-]*$/.test(id))reject('NOTIFY_VARIABLE_PATH');at({},id);const type=text(v.type);if(!['string','number','boolean','array','object','date'].includes(type))reject('NOTIFY_VARIABLE_TYPE');const value=at(values,id);if(value===undefined){if(v.required===true)findings.push({id,code:'REQUIRED'});continue;}
      const valid=type==='array'?Array.isArray(value):type==='object'?!!value&&typeof value==='object'&&!Array.isArray(value):type==='date'?typeof value==='string'&&Number.isFinite(Date.parse(value)):type==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===type;
      if(!valid)findings.push({id,code:'TYPE',expected:type});
    }
    return {passed:findings.length===0,findings,definitionDigest:digest(definitions),valuesDigest:digest(values)};
  }
  if(action==='channels.check'){
    const channels=rows(input.channels??input.templates,100),allowed=new Set(['text','html','email','sms','push','inbox']),findings:Data[]=[];
    for(const [i,c]of channels.entries()){const channel=text(c.channel??c.type??c.id),id=String(c.id??i);if(!allowed.has(channel))findings.push({id,code:'CHANNEL_UNSUPPORTED',channel});if(c.maxLength!==undefined)number(c.maxLength,1,262144);if(c.maxTitleLength!==undefined)number(c.maxTitleLength,1,4096);if(c.body!==undefined&&c.maxLength!==undefined&&text(c.body).length>number(c.maxLength))findings.push({id,code:'LITERAL_BODY_LIMIT'});}
    return {passed:channels.length>0&&findings.length===0,findings,channels:channels.length,externalRequests:0,delivery:'local-only'};
  }
  if(action==='templates.diff'){
    const before=rows(input.before,100),after=rows(input.after,100);
    for(const t of [...before,...after])computeNotifications('templates.parse',{body:t.body,variables:(computeNotifications('templates.parse',{body:t.body,variables:[]}) as Data).missing});
    return {beforeDigest:digest(before),afterDigest:digest(after),changes:diff(before,after,r=>`${text(r.id)}\0${r.channel??'text'}\0${r.locale??'en'}`)};
  }
  if(action==='assets.inspect'){
    const assets=rows(input.assets,100);unique(assets.map(a=>text(a.id)));let total=0;const inspected=assets.map(asset=>{const id=text(asset.id),mediaType=text(asset.mediaType),source=text(asset.dataBase64,6*1024**2);if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(source))reject('NOTIFY_ASSET_BASE64');const bytes=Buffer.from(source,'base64');total+=bytes.length;if(total>4*1024**2)reject('NOTIFY_ASSET_LIMIT');const valid=mediaType==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mediaType==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mediaType==='image/gif'?/^GIF8[79]a$/.test(bytes.subarray(0,6).toString()):mediaType==='image/webp'?bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP':false;return {id,mediaType,bytes:bytes.length,digest:digest(source),passed:valid,code:valid?null:'MEDIA_TYPE_OR_SIGNATURE'};});return {passed:inspected.every(a=>a.passed),assets:inspected,totalBytes:total,externalRequests:0,scope:'inline raster type/signature; no remote resource loading'};
  }
  if(action==='inboxes.previewDelivery')return {...prepareLocalNotificationDelivery(input),externalRequests:0,scope:'derived local intent; duplicate admission is checked against persistent host records at delivery'};
  if(action==='checks.explain'){const result=computeNotifications('checks.evaluate',input,signal) as Data;return {...result,findings:rows(result.results).filter(r=>r.state!=='rendered'||r.fallback===true).map(r=>({...r,reason:r.state!=='rendered'?'render rejected by fixed parser/type/channel checks':'requested locale used an explicit template fallback'}))};}
  reject('CREATION_ACTION_UNSUPPORTED');
}
