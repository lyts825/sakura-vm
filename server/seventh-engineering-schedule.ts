/** 固定时区资料和有限窗口内的周期展开、错过/重叠/重试模型。 */
import { checkpoint, instant, integer, list, obj, reject, result, str, strings, type R } from './seventh-engineering-common.ts';
const minute=60000;
function zone(input:R) {
  const timeZone=typeof input.timeZone==='string'?input.timeZone:'UTC';
  try {new Intl.DateTimeFormat('en-GB',{timeZone}).format(0);}catch{reject('SCHEDULE_TIMEZONE');}
  const version=process.versions.tz??'icu-'+process.versions.icu;
  if(input.timeZoneVersion!==undefined&&input.timeZoneVersion!==version)reject('SCHEDULE_TIMEZONE_VERSION');
  return {timeZone,version,formatter:new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})};
}
function local(time:number,formatter:Intl.DateTimeFormat) {
  const p=Object.fromEntries(formatter.formatToParts(time).map(x=>[x.type,x.value]));
  return {year:Number(p.year),month:Number(p.month),day:Number(p.day),hour:Number(p.hour),minute:Number(p.minute),second:Number(p.second)};
}
function localEpoch(p:ReturnType<typeof local>){return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);}
function localKey(p:ReturnType<typeof local>){return [p.year,p.month,p.day,p.hour,p.minute].join(':');}
function fields(expression:string) {
  const parts=expression.trim().split(/\s+/);if(parts.length!==5)reject('SCHEDULE_CRON_FIELDS');
  const limits=[[0,59],[0,23],[1,31],[1,12],[0,6]];
  return parts.map((part,index)=> {
    const [lo,hi]=limits[index],values=new Set<number>();
    for(const section of part.split(',')) {
      const m=/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(section);if(!m)reject('SCHEDULE_CRON_SYNTAX');
      const step=m[2]?integer(Number(m[2]),1,1,hi-lo+1):1;
      const [start,end]=m[1]==='*'?[lo,hi]:m[1].includes('-')?m[1].split('-').map(Number):[Number(m[1]),Number(m[1])];
      if(start<lo||end>hi||end<start)reject('SCHEDULE_CRON_RANGE');for(let n=start;n<=end;n+=step)values.add(n);
    }return {values,wild:part==='*'};
  });
}
function cronMatches(p:ReturnType<typeof local>,f:ReturnType<typeof fields>,dayMatching:string) {
  const day=f[2].values.has(p.day),dow=f[4].values.has(new Date(Date.UTC(p.year,p.month-1,p.day)).getUTCDay());
  const dayOk=dayMatching==='and'?day&&dow:f[2].wild?dow:f[4].wild?day:day||dow;
  return f[0].values.has(p.minute)&&f[1].values.has(p.hour)&&f[3].values.has(p.month)&&dayOk;
}
function expand(input:R,signal?:AbortSignal) {
  const start=instant(input.start),end=instant(input.end);if(end<=start||end-start>366*86400000)reject('SCHEDULE_WINDOW');
  const info=zone(input),rule=obj(input.rule??input),events:{at:number;local:string;reason:string}[]=[],max=integer(input.maxEvents,100000,1,100000);
  const exclusions=new Set(strings(input.excludeDates??[],10000));
  const add=(at:number,reason:string)=> {if(at<start||at>=end)return;const p=local(at,info.formatter),date=`${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;if(exclusions.has(date))return;if(events.length>=max)reject('SCHEDULE_EVENT_LIMIT');events.push({at,local:localKey(p),reason});};
  if(rule.type==='interval') {
    const every=integer(rule.everyMs,minute,1,366*86400000),anchor=rule.anchor?instant(rule.anchor):start;
    for(let at=anchor+Math.max(0,Math.ceil((start-anchor)/every))*every;at<end;at+=every){checkpoint(signal);add(at,'interval');}
  } else {
    const f=fields(str(rule.expression??'0 * * * *')),dayMatching=typeof rule.dayMatching==='string'?rule.dayMatching:'or';
    if(!['or','and'].includes(dayMatching))reject('SCHEDULE_DAY_MATCHING');
    const gap=typeof rule.gap==='string'?rule.gap:'skip';if(!['skip','next-valid'].includes(gap))reject('SCHEDULE_GAP_POLICY');
    let previous:ReturnType<typeof local>|null=null;
    for(let at=Math.floor(start/minute)*minute;at<end;at+=minute) {
      checkpoint(signal);const p=local(at,info.formatter);
      if(cronMatches(p,f,dayMatching))add(at,'cron');
      if(gap==='next-valid'&&previous) {
        const jump=localEpoch(p)-localEpoch(previous);
        if(jump>minute&&jump<=6*3600000)for(let missing=localEpoch(previous)+minute;missing<localEpoch(p);missing+=minute){const d=new Date(missing);const absent={year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate(),hour:d.getUTCHours(),minute:d.getUTCMinutes(),second:0};if(cronMatches(absent,f,dayMatching))add(at,'gap-next-valid');}
      } previous=p;
    }
    const repeated=typeof rule.repeated==='string'?rule.repeated:'both';if(!['both','earlier','later'].includes(repeated))reject('SCHEDULE_REPEAT_POLICY');
    if(repeated!=='both'){const selected=new Map<string,typeof events[number]>();for(const e of events){if(!selected.has(e.local)||repeated==='later')selected.set(e.local,e);}events.splice(0,events.length,...[...selected.values()].sort((a,b)=>a.at-b.at));}
  }
  return result('schedule-expansion',{timeZone:info.timeZone,timeZoneVersion:info.version,start:new Date(start).toISOString(),end:new Date(end).toISOString(),complete:true,events:events.map(e=>({scheduledAt:new Date(e.at).toISOString(),localKey:e.local,reason:e.reason})),count:events.length});
}
function simulate(input:R,signal?:AbortSignal) {
  const expansion=expand(input,signal),events=expansion.events as {scheduledAt:string;localKey:string;reason:string}[],policy=obj(input.policy??{}),workload=obj(input.workload??{});
  const duration=integer(workload.durationMs,0,0,86400000),overlap=typeof policy.overlap==='string'?policy.overlap:'queue',concurrency=overlap==='parallel'?integer(policy.concurrency,2,1,64):1;
  if(!['queue','skip','parallel'].includes(overlap))reject('SCHEDULE_OVERLAP');
  const slots=Array<number>(concurrency).fill(-Infinity),maxQueue=integer(policy.maxQueue,1000,0,10000),maxRetries=integer(policy.maxRetries,0,0,20),backoff=integer(policy.backoffMs,1000,0,86400000),factor=integer(policy.backoffFactor,1,1,16),failAttempts=integer(workload.failAttempts,0,0,20);
  const pauses=list(input.pauses??[],1000).map(v=>{const p=obj(v);const start=instant(p.start),end=instant(p.end);if(end<=start)reject('SCHEDULE_PAUSE');return {start,end};});
  const misfire=typeof policy.misfire==='string'?policy.misfire:'skip';if(!['skip','catch-up','coalesce'].includes(misfire))reject('SCHEDULE_MISFIRE');
  const catchup=new Map<number,number>(),traces:R[]=[],pendingStarts:number[]=[];const maxCatchUp=integer(policy.maxCatchUp,100,0,10000);
  type Trigger={index:number;scheduledAt:string;at:number;attempt:number};
  const heap:Trigger[]=[];
  const earlier=(a:Trigger,b:Trigger)=>a.at<b.at||(a.at===b.at&&(a.index<b.index||(a.index===b.index&&a.attempt<b.attempt)));
  const push=(value:Trigger)=>{heap.push(value);let at=heap.length-1;while(at>0){const parent=(at-1)>>1;if(!earlier(heap[at],heap[parent]))break;[heap[at],heap[parent]]=[heap[parent],heap[at]];at=parent;}};
  const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){heap[0]=last;let at=0;while(true){const left=at*2+1,right=left+1;let next=at;if(left<heap.length&&earlier(heap[left],heap[next]))next=left;if(right<heap.length&&earlier(heap[right],heap[next]))next=right;if(next===at)break;[heap[at],heap[next]]=[heap[next],heap[at]];at=next;}}return first;};
  for(const [index,e]of events.entries()) {
    let at=Date.parse(e.scheduledAt);const pause=pauses.find(p=>p.start<=at&&at<p.end);
    if(pause){const count=catchup.get(pause.end)??0;if(misfire==='skip'||(misfire==='coalesce'&&count>0)||count>=maxCatchUp){traces.push({trigger:index,scheduledAt:e.scheduledAt,state:'missed',reason:'pause-'+misfire});continue;}catchup.set(pause.end,count+1);at=pause.end;}
    push({index,scheduledAt:e.scheduledAt,at,attempt:1});
  }
  while(heap.length) {
    checkpoint(signal);const task=pop(),{index,scheduledAt,at,attempt}=task;
    for(let i=pendingStarts.length-1;i>=0;i--)if(pendingStarts[i]<=at)pendingStarts.splice(i,1);
    const slot=slots.indexOf(Math.min(...slots)),available=slots[slot],queued=pendingStarts.length;
    if(available>at&&(overlap==='skip'||queued>=maxQueue)){traces.push({trigger:index,attempt,scheduledAt,state:'skipped',reason:overlap==='skip'?'overlap':'queue-limit'});continue;}
    const start=Math.max(at,available),end=start+duration;slots[slot]=end;pendingStarts.push(start);
    const failed=attempt<=failAttempts;
    traces.push({trigger:index,attempt,scheduledAt,startedAt:new Date(start).toISOString(),endedAt:new Date(end).toISOString(),state:failed?'failed':'completed',source:'virtual-model'});
    if(failed&&attempt<=maxRetries){const ready=end+backoff*factor**(attempt-1);if(!Number.isSafeInteger(ready))reject('SCHEDULE_BACKOFF_OVERFLOW');push({...task,attempt:attempt+1,at:ready});}
    if(traces.length>=100000)reject('SCHEDULE_EVENT_LIMIT');
  }
  return result('schedule-simulation',{source:'virtual-model',timeZone:expansion.timeZone,timeZoneVersion:expansion.timeZoneVersion,traces,count:traces.length,triggerCount:events.length,complete:true,outcome:traces.some(e=>e.state==='failed'&&e.attempt===maxRetries+1)?'failed':'passed',realClockObserved:false});
}
export function scheduleAction(action:string,input:R,signal?:AbortSignal):unknown {
  if(action==='rules.expand')return expand(input,signal);
  if(action==='simulations.run')return simulate(input,signal);
  if(action==='clocks.resolve') {
    const info=zone(input),wall=str(input.local),m=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?$/.exec(wall);if(!m)reject('SCHEDULE_LOCAL_TIME');
    const target={year:+m[1],month:+m[2],day:+m[3],hour:+m[4],minute:+m[5],second:+(m[6]??0)},nominal=localEpoch(target),matches:number[]=[],validated=new Date(nominal);
    if(validated.getUTCFullYear()!==target.year||validated.getUTCMonth()+1!==target.month||validated.getUTCDate()!==target.day||target.hour>23||target.minute>59||target.second>59)reject('SCHEDULE_LOCAL_TIME');
    for(let at=nominal-16*3600000;at<=nominal+16*3600000;at+=minute){checkpoint(signal);if(localEpoch(local(at,info.formatter))===nominal)matches.push(at);}
    return result('schedule-time-resolution',{local:wall,timeZone:info.timeZone,timeZoneVersion:info.version,state:matches.length===0?'missing':matches.length>1?'ambiguous':'unique',candidates:matches.map(at=>new Date(at).toISOString())});
  }
  if(['calendars.validate','rules.validate','policies.validate','workloads.validate','scenarios.preview'].includes(action))return expand(input,signal);
  if(['checks.evaluate','checks.compare','checks.explain'].includes(action)) {
    const expected=list(input.expected??[],100000),actual=list(input.actual??[],100000),tolerance=integer(input.toleranceMs,0,0,60000);
    const observed=actual.map(x=>instant(obj(x).scheduledAt)),missing:R[]=[],extra=[...observed];
    for(const e of expected){const time=instant(obj(e).scheduledAt),at=extra.findIndex(t=>Math.abs(t-time)<=tolerance);if(at<0)missing.push({scheduledAt:new Date(time).toISOString()});else extra.splice(at,1);}
    return result('schedule-check',{outcome:missing.length||extra.length?'failed':'passed',missing,extra:extra.map(t=>new Date(t).toISOString()),toleranceMs:tolerance,compared:expected.length});
  }
  reject('ENGINEERING_ACTION_UNSUPPORTED',action);
}
