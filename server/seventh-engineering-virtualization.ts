/** 多服务定义校验和有限确定性联合状态解释；真实 HTTP 执行由固定客户机工具负责。 */
import { canonical, checkpoint, digest, integer, list, obj, reject, result, str, unique, type R } from './seventh-engineering-common.ts';
export type VirtualRule={id:string;method:string;path:string;priority:number;whenState:R;response:{status:number;body:unknown};set:R;calls:{service:string;method:string;path:string;body:unknown}[];delayMs:number;disconnect:boolean};
export type VirtualService={id:string;initialState:R;rules:VirtualRule[]};
export function virtualServices(input:R):VirtualService[] {
  const services=list(input.services,20).map(v=> {
    const s=obj(v),id=str(s.id);if(!/^[a-z][a-z0-9-]{0,63}$/.test(id))reject('VIRTUAL_SERVICE_ID');
    const rules=list(s.rules??[],200).map((v,i)=> {
      const r=obj(v),response=obj(r.response??{}),method=typeof r.method==='string'?r.method.toUpperCase():'GET',path=str(r.path);
      if(!['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(method)||!path.startsWith('/')||path.includes('://')||path.length>1024)reject('VIRTUAL_ROUTE');
      const calls=list(r.calls??[],20).map(v=>{const c=obj(v);return {service:str(c.service),method:typeof c.method==='string'?c.method:'GET',path:str(c.path),body:c.body??null};});
      return {id:typeof r.id==='string'?r.id:id+'-'+i,method,path,priority:integer(r.priority,i,0,1000000),whenState:obj(r.whenState??{}),response:{status:integer(response.status,200,100,599),body:response.body??null},set:obj(r.set??{}),calls,delayMs:integer(r.delayMs,0,0,30000),disconnect:r.disconnect===true};
    });
    unique(rules,r=>r.id);const decisions=new Set<string>();for(const r of rules){const key=r.method+' '+r.path+' '+r.priority;if(decisions.has(key))reject('VIRTUAL_AMBIGUOUS_PRIORITY');decisions.add(key);}
    return {id,initialState:obj(s.initialState??{}),rules:rules.sort((a,b)=>a.priority-b.priority)};
  });unique(services,s=>s.id);const ids=new Set(services.map(s=>s.id));for(const s of services)for(const r of s.rules)for(const c of r.calls)if(!ids.has(c.service)||!c.path.startsWith('/')||c.path.includes('://'))reject('VIRTUAL_INTERNAL_REFERENCE');return services;
}
export function virtualReplay(input:R,signal?:AbortSignal) {
  const services=virtualServices(input),byId=new Map(services.map(s=>[s.id,s])),snapshot=input.snapshot?obj(input.snapshot):null;
  const states:R=Object.fromEntries(services.map(s=>[s.id,structuredClone(snapshot?obj(snapshot.states)[s.id]??s.initialState:s.initialState)])),traffic:R[]=[],covered=new Set<string>(),maxCalls=integer(input.maxCalls,10000,1,10000),maxHops=integer(input.maxHops,16,1,16);
  let calls=0;const invoke=(serviceId:string,method:string,path:string,body:unknown,depth:number,parent:number|null):R=> {
    checkpoint(signal);if(++calls>maxCalls||depth>maxHops)reject('VIRTUAL_CALL_BUDGET');const service=byId.get(serviceId);if(!service)reject('VIRTUAL_SERVICE_REFERENCE');
    const state=obj(states[serviceId]),rule=service.rules.find(r=>r.method===method&&r.path===path&&Object.entries(r.whenState).every(([k,v])=>canonical(state[k]??null)===canonical(v)));
    const sequence=calls;if(!rule){const response={status:404,body:{error:'unmatched-mock-request'}};traffic.push({sequence,parent,service:serviceId,method,path,response,matched:false});return response;}
    covered.add(serviceId+'/'+rule.id);Object.assign(state,structuredClone(rule.set));
    const record:R={sequence,parent,service:serviceId,method,path,requestBody:body,rule:rule.id,response:structuredClone(rule.response),delayMs:rule.delayMs,disconnect:rule.disconnect,matched:true};traffic.push(record);
    const responses=[];for(const call of rule.calls)responses.push(invoke(call.service,call.method,call.path,call.body,depth+1,sequence));record.internalResponses=responses;
    return {...rule.response,disconnected:rule.disconnect};
  };
  const responses=list(input.requests??[],1000).map(v=>{const r=obj(v);return invoke(str(r.service),typeof r.method==='string'?r.method:'GET',str(r.path),r.body??null,0,null);});
  const checkpointValue={schemaVersion:1,states:structuredClone(states),requestCursor:responses.length,modelDigest:digest(services),seed:integer(input.seed,1,0,4294967295)};
  const missingRules=services.flatMap(s=>s.rules.filter(r=>!covered.has(s.id+'/'+r.id)).map(r=>s.id+'/'+r.id));
  return result('virtual-service-model',{source:'deterministic-model',realHttpObserved:false,states,responses,traffic,checkpoint:{...checkpointValue,digest:digest(checkpointValue)},coverage:{covered:[...covered].sort(),uncovered:missingRules},outcome:traffic.some(t=>t.matched===false)?'failed':'passed'});
}
export function virtualizationAction(action:string,input:R,signal?:AbortSignal):unknown {
  if(['contracts.validate','matchers.validate','states.validate','transitions.validate','faults.validate','packages.validate','scenarios.preview'].includes(action))return result('virtual-service-definition',{valid:true,services:virtualServices(input),maxHops:integer(input.maxHops,16,1,16),externalForwarding:false});
  if(['assertions.evaluate','assertions.explain','traffic.coverage'].includes(action)) {
    const replay=virtualReplay(input,signal),failures:R[]=[];
    if(input.expectedStates!==undefined&&canonical(input.expectedStates)!==canonical(replay.states))failures.push({kind:'joint-state',expected:input.expectedStates,actual:replay.states});
    if(input.expectedResponses!==undefined&&canonical(input.expectedResponses)!==canonical(replay.responses))failures.push({kind:'responses',expected:input.expectedResponses,actual:replay.responses});
    return result('virtual-service-assertions',{...replay,failures,outcome:failures.length?'failed':replay.outcome});
  }
  if(action==='assertions.compare') {const left=obj(input.left),right=obj(input.right);return result('virtual-service-comparison',{sameModel:left.modelDigest===right.modelDigest,statesEqual:canonical(left.states??{})===canonical(right.states??{}),left,right});}
  if(action==='sessions.checkpoint') {
    const snapshot=obj(input.snapshot);if(input.inFlight!==0||input.admissionStopped!==true)reject('VIRTUAL_CHECKPOINT_NOT_QUIESCENT');
    return result('virtual-service-checkpoint',{states:structuredClone(obj(snapshot.states)),modelDigest:str(snapshot.modelDigest),requestCursor:integer(snapshot.requestCursor),seed:integer(snapshot.seed,1,0,4294967295),materialOnly:true});
  }
  if(action==='sessions.fork') {
    if(integer(input.activeSessions,0,0,2)>=2)reject('VIRTUAL_ACTIVE_SESSION_LIMIT');const snapshot=obj(input.snapshot);
    return result('virtual-service-fork-plan',{snapshot:structuredClone(snapshot),sourceDigest:digest(snapshot),createsNewSession:true,executionStarted:false});
  }
  reject('ENGINEERING_ACTION_UNSUPPORTED',action);
}
