/** 固定因果历史的副本模型；只操作传入副本数据，不连接真实同步服务。 */
import { canonical, checkpoint, integer, list, obj, reject, result, str, strings, unique, type R } from './seventh-engineering-common.ts';
type Operation={id:string;replica:string;sequence:number;key:string;kind:string;value:unknown;predecessors:string[];timestamp:number};
function parse(input:R) {
  const replicas=strings(input.replicas??['a','b'],32);unique(replicas,x=>x);
  const ids=new Map<string,string>();
  const operations:Operation[]=[];
  for(const item of list(input.operations??[],100000)) {
    const v=obj(item),replica=str(v.replica),sequence=integer(v.sequence,0,1),id=typeof v.id==='string'?v.id:replica+':'+sequence;
    if(!replicas.includes(replica))reject('REPLICA_UNKNOWN_REPLICA',replica);
    const op={id,replica,sequence,key:str(v.key),kind:str(v.kind),value:v.value??null,predecessors:strings(v.predecessors??[],1000),timestamp:integer(v.timestamp,sequence,0)};
    if(!['set','delete','increment','add','remove'].includes(op.kind))reject('REPLICA_OPERATION');
    if(op.kind==='increment'&&(typeof op.value!=='number'||!Number.isSafeInteger(op.value)))reject('REPLICA_COUNTER');
    if(Buffer.byteLength(canonical(op.value))>4096)reject('REPLICA_VALUE_LIMIT');
    const identity=replica+':'+sequence,bytes=canonical({...op,id:identity});
    if(ids.has(identity)){if(ids.get(identity)!==bytes)reject('REPLICA_IDENTITY_CONFLICT',identity);continue;}
    ids.set(identity,bytes);operations.push(op);
  }
  unique(operations,o=>o.id);const byId=new Map(operations.map(op=>[op.id,op]));
  const missing=operations.flatMap(op=>op.predecessors.filter(id=>!byId.has(id)).map(id=>({operation:op.id,missing:id})));
  const ancestors=new Map<string,Set<string>>(),visiting=new Set<string>();
  const visit=(id:string):Set<string>=>{if(ancestors.has(id))return ancestors.get(id)!;if(visiting.has(id))reject('REPLICA_CAUSAL_CYCLE');visiting.add(id);const all=new Set<string>();for(const p of byId.get(id)?.predecessors??[]){all.add(p);if(byId.has(p))for(const a of visit(p))all.add(a);}visiting.delete(id);ancestors.set(id,all);return all;};
  for(const id of byId.keys())visit(id);
  return {replicas,operations,byId,missing,ancestors};
}
function run(input:R,signal?:AbortSignal) {
  const model=parse(input),policy=typeof input.policy==='string'?input.policy:'manual';
  if(!['manual','timestamp','replica-priority','counter','set'].includes(policy))reject('REPLICA_POLICY');
  const delivered=new Map(model.replicas.map(r=>[r,new Set<string>()])),events=list(input.deliveries??model.operations.flatMap(op=>model.replicas.map(to=>({to,operationId:op.id}))),500000);
  const traces:R[]=[];const duplicates:R[]=[];
  for(const [index,item]of events.entries()) {
    checkpoint(signal);const e=obj(item),to=str(e.to),operationId=str(e.operationId),op=model.byId.get(operationId);if(!delivered.has(to)||!op)reject('REPLICA_DELIVERY_REFERENCE');
    const set=delivered.get(to)!;if(set.has(operationId)){duplicates.push({index,to,operationId});continue;}
    set.add(operationId);if(traces.length<10000)traces.push({index,to,operationId,delivered:set.size});
  }
  const snapshots=model.replicas.map(replica=> {
    const seen=delivered.get(replica)!, byKey=new Map<string,Operation[]>();
    for(const id of seen){const op=model.byId.get(id)!;byKey.set(op.key,[...(byKey.get(op.key)??[]),op]);}
    const values:R={},conflicts:R[]=[];
    for(const [key,ops]of byKey) {
      checkpoint(signal);const maximal=ops.filter(op=>!ops.some(other=>model.ancestors.get(other.id)?.has(op.id)));
      if(policy==='counter') {
        if(ops.some(op=>op.kind!=='increment'))reject('REPLICA_COUNTER_OPERATION');
        const total=ops.reduce((n,o)=>n+Number(o.value),0);if(!Number.isSafeInteger(total))reject('REPLICA_COUNTER_OVERFLOW');values[key]=total;
      } else if(policy==='set') {
        if(ops.some(op=>!['add','remove'].includes(op.kind)))reject('REPLICA_SET_OPERATION');
        const adds=ops.filter(o=>o.kind==='add').filter(add=>!ops.some(remove=>remove.kind==='remove'&&canonical(remove.value)===canonical(add.value)&&model.ancestors.get(remove.id)?.has(add.id)));
        values[key]=[...new Map(adds.map(o=>[canonical(o.value),o.value])).values()].sort((a,b)=>canonical(a).localeCompare(canonical(b)));
      } else {
        if(ops.some(op=>!['set','delete'].includes(op.kind)))reject('REPLICA_REGISTER_OPERATION');
        let selected=maximal;
        if(policy==='timestamp')selected=[...maximal].sort((a,b)=>b.timestamp-a.timestamp||b.replica.localeCompare(a.replica)||b.sequence-a.sequence).slice(0,1);
        if(policy==='replica-priority') {const priority=strings(input.priority??model.replicas,32);selected=[...maximal].sort((a,b)=>priority.indexOf(a.replica)-priority.indexOf(b.replica)||b.sequence-a.sequence).slice(0,1);}
        if(selected.length>1){conflicts.push({key,candidates:selected});values[key]={conflict:selected.map(o=>({id:o.id,value:o.value,deleted:o.kind==='delete'}))};}
        else if(selected[0]?.kind==='set')values[key]=selected[0].value;
      }
    }
    const missingPredecessors=[...seen].flatMap(id=>[...(model.ancestors.get(id)??[])].filter(p=>!seen.has(p)).map(predecessor=>({operation:id,predecessor})));
    return {replica,values,delivered:[...seen].sort(),conflicts,missingPredecessors};
  });
  const pending=model.replicas.flatMap(replica=>model.operations.filter(op=>!delivered.get(replica)!.has(op.id)).map(op=>({replica,operationId:op.id})));
  const dataEqual=snapshots.every(s=>canonical(s.values)===canonical(snapshots[0]?.values)),operationsEqual=snapshots.every(s=>canonical(s.delivered)===canonical(snapshots[0]?.delivered));
  const complete=!pending.length&&!model.missing.length&&!snapshots.some(s=>s.missingPredecessors.length);
  const conflicts=snapshots.reduce((n,s)=>n+s.conflicts.length,0);
  return result('replica-replay',{source:'finite-model',snapshots,traces,tracesTruncated:events.length>10000,eventCount:events.length,duplicates,pending,missingPredecessors:model.missing,dataEqual,operationsEqual,causallyComplete:complete,outcome:complete?(dataEqual&&!conflicts?'passed':'failed'):'inconclusive',claimScope:'only-the-fixed-finite-delivery-history'});
}
export function replicaAction(action:string,input:R,signal?:AbortSignal):unknown {
  if(['models.validate','schemas.validate','replicas.validate','operations.compose','channels.validate','policies.validate','scenarios.preview'].includes(action)) {const model=parse(input);return result('replica-model',{valid:!model.missing.length,replicas:model.replicas,operations:model.operations,missingPredecessors:model.missing});}
  if(action==='clocks.validate') {
    const clocks=list(input.clocks??[],100000).map(v=>{const c=obj(v),vector=c.vector?Object.fromEntries(Object.entries(obj(c.vector)).map(([replica,value])=>[str(replica),integer(value)])):null;return {replica:str(c.replica),counter:integer(c.counter),vector};});
    return result('replica-clocks',{valid:true,clocks,wallClockIsCausalProof:false});
  }
  if(['runs.run','judgments.evaluate','judgments.explain','snapshots.capture'].includes(action))return run(input,signal);
  if(action==='conflicts.inspect') {const replay=run(input,signal),snapshots=list(replay.snapshots,32).map(v=>obj(v));return result('replica-conflicts',{source:'fixed-model-history',conflicts:snapshots.flatMap(s=>list(s.conflicts,10000).map(conflict=>({replica:s.replica,conflict}))),causallyComplete:replay.causallyComplete,pending:replay.pending,outcome:replay.outcome});}
  if(action==='conflicts.proposeResolution') {const key=str(input.key),replica=str(input.replica),sequence=integer(input.sequence,1,1);return result('replica-resolution',{operation:{id:replica+':'+sequence,replica,sequence,key,kind:input.delete===true?'delete':'set',value:input.value??null,predecessors:strings(input.predecessors??[],1000)},applied:false});}
  if(action==='comparisons.compare'||action==='judgments.compare') {return result('replica-comparison',{equal:canonical(input.left??null)===canonical(input.right??null),left:input.left??null,right:input.right??null});}
  reject('ENGINEERING_ACTION_UNSUPPORTED',action);
}
