/** 有限二进制消息编解码、确定性变体和固定轨迹的状态性质检查。 */
import { canonical, checkpoint, deterministic, integer, list, obj, reject, result, str, type R } from './seventh-engineering-common.ts';
import {createHash} from 'node:crypto';
type Field={name:string;type:string;endian:'le'|'be';length:number|null;lengthFrom:string|null;maximum:number;values:number[]|null;when:{field:string;equals:unknown}|null};
export function protocolFields(input:R):Field[] {
  const fields=list(input.fields??obj(input.grammar??{}).fields,200).map(v=> {
    const f=obj(v),type=str(f.type);if(!['u8','u16','u32','i8','i16','i32','bytes','enum'].includes(type))reject('PROTOCOL_FIELD_TYPE');
    const endian=f.endian===undefined?'be':str(f.endian);if(endian!=='be'&&endian!=='le')reject('PROTOCOL_ENDIAN');
    const when=f.when?obj(f.when):null;
    return {name:str(f.name),type,endian:endian as 'le'|'be',length:f.length===undefined?null:integer(f.length,0,0,65536),lengthFrom:f.lengthFrom===undefined?null:str(f.lengthFrom),maximum:integer(f.maxLength,65536,0,65536),values:f.values===undefined?null:list(f.values,256).map(v=>integer(v,0,0,255)),when:when?{field:str(when.field),equals:when.equals??null}:null};
  });
  const names=new Set<string>();for(const f of fields){if(names.has(f.name))reject('PROTOCOL_DUPLICATE_FIELD');if(f.lengthFrom&&!names.has(f.lengthFrom))reject('PROTOCOL_LENGTH_REFERENCE');if(f.when&&!names.has(f.when.field))reject('PROTOCOL_CONDITION_REFERENCE');names.add(f.name);if(f.type==='bytes'&&f.length===null&&!f.lengthFrom)reject('PROTOCOL_BYTES_LENGTH');}return fields;
}
function bytes(v:unknown) {const value=str(v,'bytesBase64',100000);if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))reject('PROTOCOL_BASE64');const b=Buffer.from(value,'base64');if(b.length>65536)reject('PROTOCOL_MESSAGE_LIMIT');return b;}
export function decodeProtocol(fields:Field[],buffer:Buffer) {
  let offset=0;const values:R={},ranges:R[]=[];
  for(const f of fields) {
    if(f.when&&values[f.when.field]!==f.when.equals)continue;
    if(f.lengthFrom&&values[f.lengthFrom]===undefined)reject('PROTOCOL_MISSING_LENGTH',f.name);
    const size=f.type==='bytes'?(f.lengthFrom?integer(values[f.lengthFrom],0,0,f.maximum):f.length!):Number(f.type.slice(1))/8||1;
    if(size>f.maximum||offset+size>buffer.length)reject('PROTOCOL_TRUNCATED_FIELD',f.name);
    let value:unknown;
    if(f.type==='bytes')value=buffer.subarray(offset,offset+size).toString('base64');
    else {const signed=f.type.startsWith('i');value=f.endian==='le'?(signed?buffer.readIntLE(offset,size):buffer.readUIntLE(offset,size)):(signed?buffer.readIntBE(offset,size):buffer.readUIntBE(offset,size));if(f.values&&!f.values.includes(Number(value)))reject('PROTOCOL_ENUM',f.name);}
    values[f.name]=value;ranges.push({field:f.name,offset,length:size});offset+=size;
  }
  if(offset!==buffer.length)reject('PROTOCOL_TRAILING_BYTES');return {values,ranges,bytes:offset};
}
export function encodeProtocol(fields:Field[],values:R) {
  const chunks:Buffer[]=[];let total=0;
  for(const f of fields) {
    if(f.when&&values[f.when.field]!==f.when.equals){if(values[f.name]!==undefined)reject('PROTOCOL_INACTIVE_FIELD',f.name);continue;}
    if(f.lengthFrom&&values[f.lengthFrom]===undefined)reject('PROTOCOL_MISSING_LENGTH',f.name);
    let chunk:Buffer;
    if(f.type==='bytes') {chunk=bytes(values[f.name]);const count=f.lengthFrom?integer(values[f.lengthFrom],0,0,f.maximum):f.length!;if(chunk.length!==count||count>f.maximum)reject('PROTOCOL_LENGTH_MISMATCH',f.name);}
    else {const size=Number(f.type.slice(1))/8||1,signed=f.type.startsWith('i'),value=integer(values[f.name],0,signed?-(2**(size*8-1)):0,signed?2**(size*8-1)-1:2**(size*8)-1);if(f.values&&!f.values.includes(value))reject('PROTOCOL_ENUM',f.name);chunk=Buffer.alloc(size);if(f.endian==='le'){if(signed)chunk.writeIntLE(value,0,size);else chunk.writeUIntLE(value,0,size);}else {if(signed)chunk.writeIntBE(value,0,size);else chunk.writeUIntBE(value,0,size);}}
    chunks.push(chunk);total+=chunk.length;if(total>65536)reject('PROTOCOL_MESSAGE_LIMIT');
  }return Buffer.concat(chunks);
}
export function protocolAction(action:string,input:R,signal?:AbortSignal):unknown {
  if(action==='targets.inspect') {
    const target=input.target?obj(input.target):input,raw=str(target.artifactBase64,'artifactBase64',700000),artifact=Buffer.from(raw,'base64');
    if(artifact.length<64||artifact.length>512*1024||artifact.subarray(0,6).toString('hex')!=='7f454c460201'||artifact.readUInt16LE(18)!==62||![2,3].includes(artifact.readUInt16LE(16)))reject('PROTOCOL_TARGET_ELF');
    const sha256=createHash('sha256').update(artifact).digest('hex');if(target.sha256!==undefined&&target.sha256!==sha256)reject('PROTOCOL_TARGET_DIGEST');
    return result('protocol-target',{valid:true,architecture:'x86_64',format:'ELF64-little-endian',bytes:artifact.length,sha256,launchProtocol:'SAKURA_LISTEN_ADDRESS/SAKURA_LISTEN_PORT',runtimeVerified:false,executionStarted:false});
  }
  if(['grammars.validate','messages.encode','messages.decode','messages.validate'].includes(action)) {
    const fields=protocolFields(input);if(action==='grammars.validate')return result('protocol-grammar',{valid:true,fields});
    const encoded=input.bytesBase64===undefined?encodeProtocol(fields,obj(input.values)):bytes(input.bytesBase64);
    return result('protocol-message',{bytesBase64:encoded.toString('base64'),...decodeProtocol(fields,encoded)});
  }
  if(action==='generators.generate'||action==='generators.expand') {
    const fields=protocolFields(input),base=obj(input.values),random=deterministic(integer(input.seed,1,0,4294967295)),count=integer(input.count,16,1,100);
    const variants=[];for(let i=0;i<count;i++){checkpoint(signal);const values={...base};const numeric=fields.filter(f=>f.type!=='bytes'),field=numeric[i%numeric.length];if(!field)reject('PROTOCOL_NO_NUMERIC_FIELD');const bits=Number(field.type.slice(1))||8;values[field.name]=field.values?field.values[Math.floor(random()*field.values.length)]:Math.floor(random()*(2**Math.min(bits,32)));try{variants.push({index:i,values,bytesBase64:encodeProtocol(fields,values).toString('base64'),valid:true});}catch(e){variants.push({index:i,values,valid:false,error:e instanceof Error?e.message:'invalid'});}}
    return result('protocol-generation',{seed:input.seed??1,variants,complete:true});
  }
  if(action==='guards.validate') {
    const guards=list(input.guards??[],1000).map(v=>{const c=obj(v),op=typeof c.op==='string'?c.op:'eq';if(!['eq','ne','lt','le','gt','ge','in'].includes(op))reject('PROTOCOL_CONDITION_OPERATOR');if(['lt','le','gt','ge'].includes(op)&&typeof c.value!=='number')reject('PROTOCOL_CONDITION_TYPE');if(op==='in')list(c.value,100);return {field:str(c.field),op,value:c.value??null};});
    return result('protocol-guards',{valid:true,guards,language:'typed-field-comparison-v1'});
  }
  if(action==='traces.decode') {
    const fields=protocolFields(input),frames=list(input.frames??[],10000).map((v,index)=>{checkpoint(signal);try{return {index,...decodeProtocol(fields,bytes(obj(v).bytesBase64)),valid:true};}catch(error){return {index,valid:false,error:error instanceof Error?error.message:'invalid'};}});
    return result('protocol-trace-decode',{frames,decoded:frames.filter(f=>f.valid).length,total:frames.length,outcome:frames.every(f=>f.valid)?'passed':'failed'});
  }
  if(action==='properties.compare')return result('protocol-property-comparison',{left:input.left??null,right:input.right??null,equal:canonical(input.left??null)===canonical(input.right??null),scope:'fixed-result-comparison'});
  if(['machines.validate','scenarios.preview','properties.evaluate','properties.explain'].includes(action)) {
    const machine=obj(input.machine??input),initial=str(machine.initial),states=list(machine.states,200).map(x=>str(x)),transitions=list(machine.transitions,1000).map(v=>obj(v));
    if(new Set(states).size!==states.length||!states.includes(initial))reject('PROTOCOL_STATES');
    for(const t of transitions)if(!states.includes(str(t.from))||!states.includes(str(t.to)))reject('PROTOCOL_TRANSITION_REFERENCE');
    const seen=new Set<string>();for(const t of transitions){const key=str(t.from)+'|'+str(t.event)+'|'+integer(t.priority,0,0,1000000);if(seen.has(key))reject('PROTOCOL_AMBIGUOUS_TRANSITION');seen.add(key);}
    const condition=(raw:unknown,values:R):boolean=>{
      if(raw===undefined)return true;const c=obj(raw),field=str(c.field),actual=values[field],expected=c.value,op=typeof c.op==='string'?c.op:'eq';
      if(actual===undefined)return false;if(op==='eq')return actual===expected;if(op==='ne')return actual!==expected;if(op==='in')return list(expected,100).includes(actual);
      if(typeof actual!=='number'||typeof expected!=='number'||!Number.isFinite(actual)||!Number.isFinite(expected))reject('PROTOCOL_CONDITION_TYPE');
      if(op==='lt')return actual<expected;if(op==='le')return actual<=expected;if(op==='gt')return actual>expected;if(op==='ge')return actual>=expected;reject('PROTOCOL_CONDITION_OPERATOR');
    };
    let current=initial;const variables=structuredClone(obj(machine.variables??{})),trace:R[]=[],failures:R[]=[];
    for(const [index,item]of list(input.events??[],1000).entries()) {
      checkpoint(signal);const event=typeof item==='string'?item:str(obj(item).event),fields=typeof item==='string'?{}:obj(obj(item).fields??{}),next=transitions.filter(t=>t.from===current&&t.event===event).sort((a,b)=>integer(a.priority)-integer(b.priority)).find(t=>condition(t.when,{...variables,...fields}));
      if(!next){failures.push({index,state:current,event,reason:'transition-not-defined'});trace.push({index,from:current,event,to:null});continue;}
      if(next.set)Object.assign(variables,structuredClone(obj(next.set)));
      trace.push({index,from:current,event,to:next.to,fields,variables:structuredClone(variables)});current=str(next.to);
    }
    return result('protocol-state-check',{initial,final:current,variables,trace,failures,outcome:failures.length?'failed':'passed',source:'fixed-model-trace',realNetworkObserved:false});
  }
  if(action==='traces.readFrames') {const frames=list(input.frames??[],10000);const offset=integer(input.offset,0,0,frames.length),limit=integer(input.limit,100,1,1000);return result('protocol-frames',{total:frames.length,offset,frames:frames.slice(offset,offset+limit),next:offset+limit<frames.length?offset+limit:null});}
  if(action==='reductions.reduce') {
    const fields=protocolFields(input),original=bytes(input.bytesBase64);const fails=(b:Buffer)=>{try{decodeProtocol(fields,b);return false;}catch{return true;}};
    if(!fails(original))reject('PROTOCOL_REDUCTION_NO_FAILURE');let candidate=original,attempts=0;const max=integer(input.maxAttempts,100,1,100);
    for(let size=Math.max(1,Math.floor(candidate.length/2));size>=1&&attempts<max;size=Math.floor(size/2))for(let at=0;at+size<=candidate.length&&attempts<max;at++) {checkpoint(signal);const smaller=Buffer.concat([candidate.subarray(0,at),candidate.subarray(at+size)]);attempts++;if(fails(smaller)){candidate=smaller;at=-1;}}
    return result('protocol-reduction',{scope:'parser-failure-only',bytesBase64:candidate.toString('base64'),originalBytes:original.length,reducedBytes:candidate.length,attempts,globallyMinimal:false,realTargetReexecuted:false});
  }
  reject('ENGINEERING_ACTION_UNSUPPORTED',action);
}
