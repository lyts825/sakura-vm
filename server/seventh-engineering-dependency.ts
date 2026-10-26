/** 固定元数据上的有限依赖求解、独立赋值核验和有界冲突解释。 */
import { checkpoint, digest, integer, list, obj, reject, result, str, strings, unique, type R } from './seventh-engineering-common.ts';
type Package = { name:string; version:string; sha256:string|null; dependencies:Record<string,string>; peers:Record<string,string>; optional:Record<string,string>; os:string[]; arch:string[] };
type Model = { packages:Package[]; roots:Record<string,string>; os:string; arch:string; includeOptional:boolean };
function requirements(value: unknown): Record<string,string> { return Object.fromEntries(Object.entries(obj(value ?? {})).map(([k,v])=>[str(k),str(v)])); }
function version(value: string) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if (!m) reject('DEPENDENCY_VERSION', value); const numbers = m.slice(1,4).map(Number);
  if(numbers.some(n=>!Number.isSafeInteger(n))||(m[4]??'').split('.').some(part=>/^0\d+$/.test(part)))reject('DEPENDENCY_VERSION');
  return {numbers,pre:m[4]??null};
}
function compare(a: string, b: string) {
  const x=version(a), y=version(b); for(let i=0;i<3;i++)if(x.numbers[i]!==y.numbers[i])return x.numbers[i]-y.numbers[i];
  if(x.pre===y.pre)return 0; if(x.pre===null)return 1; if(y.pre===null)return -1;
  const aa=x.pre.split('.'), bb=y.pre.split('.'); for(let i=0;i<Math.max(aa.length,bb.length);i++) {
    if(aa[i]===undefined)return -1;if(bb[i]===undefined)return 1;if(aa[i]===bb[i])continue;
    const an=/^\d+$/.test(aa[i]),bn=/^\d+$/.test(bb[i]); if(an&&bn)return Number(aa[i])-Number(bb[i]); if(an!==bn)return an?-1:1;return aa[i]<bb[i]?-1:1;
  }return 0;
}
function matches(v:string,range:string) {
  const parsed=version(v); if(range==='*')return parsed.pre===null;
  return range.split('||').some(branch=> {
    const parts=branch.trim().split(/\s+/); let permitsPre=false;
    const accepted=parts.every(term=> {
      const m=/^(>=|<=|>|<|=)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(term);if(!m)reject('DEPENDENCY_RANGE_UNSUPPORTED',range);
      const target=version(m[2]);if(target.pre!==null&&target.numbers.every((x,i)=>x===parsed.numbers[i]))permitsPre=true;
      const c=compare(v,m[2]);return m[1]==='>='?c>=0:m[1]==='<='?c<=0:m[1]==='>'?c>0:m[1]==='<'?c<0:c===0;
    });return accepted&&(parsed.pre===null||permitsPre);
  });
}
function parse(input:R):Model {
  const rows=list(input.packages ?? obj(input.catalog ?? {}).packages,20000).map(value=> {
    const p=obj(value), name=str(p.name), v=str(p.version);version(v);
    const sha=p.sha256===undefined||p.sha256===null?null:str(p.sha256);if(sha&&!/^[a-f0-9]{64}$/.test(sha))reject('DEPENDENCY_DIGEST');
    return {name,version:v,sha256:sha,dependencies:requirements(p.dependencies),peers:requirements(p.peerDependencies),optional:requirements(p.optionalDependencies),os:p.os?strings(p.os,20):[],arch:p.arch?strings(p.arch,20):[]};
  });
  unique(rows,p=>p.name+'@'+p.version);
  for(const p of rows)for(const r of [...Object.values(p.dependencies),...Object.values(p.peers),...Object.values(p.optional)])matches(p.version,r);
  const roots=requirements(input.roots); if(!Object.keys(roots).length)reject('DEPENDENCY_EMPTY_ROOTS');
  for(const r of Object.values(roots))matches('0.0.0',r);
  const platform=obj(input.platform??{});if(input.multipleInstances===true)reject('DEPENDENCY_MULTI_INSTANCE_UNSUPPORTED');
  return {packages:rows, roots,os:typeof platform.os==='string'?platform.os:'linux',arch:typeof platform.arch==='string'?platform.arch:'x86_64',includeOptional:input.includeOptional===true};
}
function edges(p:Package, optional:boolean){return [...Object.entries(p.dependencies).map(([name,range])=>({name,range,kind:'dependency'})),...Object.entries(p.peers).map(([name,range])=>({name,range,kind:'peer'})),...(optional?Object.entries(p.optional).map(([name,range])=>({name,range,kind:'optional'})):[])];}
function compatible(p:Package,m:Model){return (!p.os.length||p.os.includes(m.os))&&(!p.arch.length||p.arch.includes(m.arch));}
function verifyAssignment(model:Model,assignment:Package[]) {
  unique(assignment,p=>p.name);const found=new Map(assignment.map(p=>[p.name,p]));const failures:R[]=[];
  for(const [name,range]of Object.entries(model.roots)){const p=found.get(name);if(!p||!matches(p.version,range))failures.push({kind:'root',name,range,actual:p?.version??null});}
  for(const p of assignment) {
    if(!compatible(p,model))failures.push({kind:'platform',name:p.name});
    for(const {name,range,kind}of edges(p,model.includeOptional)){const dep=found.get(name);if(!dep||!matches(dep.version,range))failures.push({kind,from:p.name,name,range,actual:dep?.version??null});}
  }
  return {valid:failures.length===0,failures,completeMaterials:assignment.every(p=>p.sha256!==null)};
}
function solve(model:Model, input:R, signal?:AbortSignal) {
  const maxNodes=integer(input.maxNodes,100000,1,1000000), until=Date.now()+integer(input.maxMilliseconds,5000,1,120000);
  const old=requirements(input.oldLock), roots=Object.keys(model.roots), names=[...new Set(model.packages.map(p=>p.name))].sort();
  const candidates=new Map(names.map(name=>[name,model.packages.filter(p=>p.name===name&&compatible(p,model)).sort((a,b)=>Number(b.version===old[name])-Number(a.version===old[name])||compare(b.version,a.version))]));
  let nodes=0,cutoff=false;let best:Package[]|null=null,bestScore:number[]|null=null;
  const score=(solution:Package[])=>[solution.filter(p=>old[p.name]&&old[p.name]!==p.version).length,solution.filter(p=>roots.includes(p.name)&&old[p.name]!==p.version).length,solution.filter(p=>!roots.includes(p.name)&&old[p.name]!==p.version).length,...names.map(name=>{const p=solution.find(x=>x.name===name);return p?(candidates.get(name)??[]).findIndex(x=>x.version===p.version):999999;})];
  const less=(a:number[],b:number[])=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]<b[i];return false;};
  const search=(selected:Map<string,Package>,requirements:Map<string,string[]>)=> {
    checkpoint(signal);if(++nodes>maxNodes||Date.now()>until){cutoff=true;return;}
    for(const [name,p]of selected)if(!(requirements.get(name)??[]).every(r=>matches(p.version,r)))return;
    const next=[...requirements.keys()].filter(k=>!selected.has(k)).sort((a,b)=>(candidates.get(a)?.length??0)-(candidates.get(b)?.length??0)||a.localeCompare(b))[0];
    if(!next){const solution=[...selected.values()].sort((a,b)=>a.name.localeCompare(b.name));if(!verifyAssignment(model,solution).valid)return;const s=score(solution);if(!bestScore||less(s,bestScore)){best=solution;bestScore=s;}return;}
    for(const p of candidates.get(next)??[]) {
      if(!(requirements.get(next)??[]).every(r=>matches(p.version,r)))continue;
      const req=new Map([...requirements].map(([k,v])=>[k,[...v]]));for(const {name,range}of edges(p,model.includeOptional))req.set(name,[...(req.get(name)??[]),range]);
      const assignment=new Map(selected);assignment.set(next,p);search(assignment,req);if(cutoff)return;
    }
  };
  search(new Map(),new Map(Object.entries(model.roots).map(([k,v])=>[k,[v]])));
  const selected=best as Package[]|null;
  return result('dependency-solve',{state:selected?(cutoff?'feasible':'optimal'):cutoff?'unknown':'unsatisfiable',searchComplete:!cutoff,nodes,selected:selected??[],score:bestScore,validation:selected?verifyAssignment(model,selected):null,objective:['changed-old-lock','changed-direct','changed-transitive','deterministic-version-preference'],inputDigest:digest(model),platform:{os:model.os,arch:model.arch},includeOptional:model.includeOptional,roots:model.roots});
}
export function dependencyAction(action:string,input:R,signal?:AbortSignal):unknown {
  if(['catalogs.validate','roots.validate','platforms.validate','constraints.compile','constraints.explain','candidates.preview'].includes(action)) {
    const model=parse(input);return result('dependency-model',{valid:true,model,versions:model.packages.length,packages:new Set(model.packages.map(p=>p.name)).size});
  }
  if(action==='solves.run')return solve(parse(input),input,signal);
  if(['proofs.checkAssignment','locks.validate','proofs.coverage'].includes(action)) {
    const model=parse(input),selection=requirements(input.assignment);const selected=Object.entries(selection).map(([name,v])=>model.packages.find(p=>p.name===name&&p.version===v)??reject('DEPENDENCY_UNKNOWN_SELECTION',name+'@'+v)).sort((a,b)=>a.name.localeCompare(b.name));
    return result('dependency-validation',{...verifyAssignment(model,selected),modelDigest:digest(model),assignmentDigest:digest(selected)});
  }
  if(action==='proofs.explainConflict') {
    const model=parse(input);const original=solve(model,input,signal);if(original.state!=='unsatisfiable')return result('dependency-conflict',{state:original.state,rootSubset:[],minimal:false});
    let roots={...model.roots},complete=true;
    for(const key of Object.keys(roots)){checkpoint(signal);if(Object.keys(roots).length===1)break;const reduced={...roots};delete reduced[key];const probe=solve({...model,roots:reduced},{maxNodes:2000,maxMilliseconds:100},signal);if(probe.state==='unsatisfiable')roots=reduced;else if(probe.state==='unknown')complete=false;}
    return result('dependency-conflict',{state:'unsatisfiable',rootSubset:roots,minimal:complete,minimality:'inclusion-only',originalDigest:original.digest});
  }
  if(action==='comparisons.compare') {
    const left=requirements(input.left),right=requirements(input.right);return result('dependency-comparison',{changes:[...new Set([...Object.keys(left),...Object.keys(right)])].sort().filter(k=>left[k]!==right[k]).map(name=>({name,before:left[name]??null,after:right[name]??null}))});
  }
  reject('ENGINEERING_ACTION_UNSUPPORTED',action);
}
