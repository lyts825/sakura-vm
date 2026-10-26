/** 六个工程包以原鉴权固定记录组装版本、报告、审阅与观察，保留来源及失败范围。 */
import { suiteJson, type SuiteJson, type SuiteRecord, type SuiteRef } from '../shared/contracts/suite-common.ts';
import { canonical, digest, integer, list, obj, reject, str, type R } from './seventh-engineering-common.ts';
import { extensionAction } from './seventh-engineering-extension.ts';
import { virtualServices } from './seventh-engineering-virtualization.ts';
import { seventhVirtualizationWorkerInput } from './seventh-engineering-profiles.ts';
export type SeventhEngineeringLifecycleProduct={kind:'definition'|'review'|'result';content:SuiteJson;references:SuiteRef[];seal:boolean};
const prefixes:Record<string,string>={'schedule-semantics-lab':'schedlab','extension-authoring-studio':'extforge','dependency-resolution-studio':'depsolve','protocol-state-lab':'protostate','replica-sync-lab':'replab','service-virtualization-studio':'virtservice'};
export const SEVENTH_ENGINEERING_LIFECYCLE_ACTIONS:Record<string,string[]>={
  'schedule-semantics-lab':['observations.capture','observations.readEvents','observations.coverage','reports.assemble','reports.review','reports.seal'],
  'extension-authoring-studio':['bundles.assemble','bundles.seal','reviews.review','reviews.compare','reviews.seal','reports.assemble','reports.review','reports.seal'],
  'dependency-resolution-studio':['locks.assemble','locks.seal','reports.assemble','reports.review','reports.seal'],
  'protocol-state-lab':['traces.coverage','reports.assemble','reports.review','reports.seal'],
  'replica-sync-lab':['reports.assemble','reports.review','reports.seal'],
  'service-virtualization-studio':['packages.assemble','packages.seal','traffic.capture','traffic.readRequests','reports.assemble','reports.review','reports.seal'],
};
const pin=(r:SuiteRecord):SuiteRef=>({domain:r.domain,id:r.id,revision:r.revision});
function recordValue(row:SuiteRecord):R {return obj(row.content);}
function output(row:SuiteRecord):R {
  let content=recordValue(row);
  if(content.format==='sakura-seventh-result/1') {
    if(content.state!=='completed')return {outcome:'failed',executionState:content.state,error:content.error??null};
    content=obj(content.output);
  }
  if(content.receipt&&content.output&&typeof content.output==='object')return {...obj(content.output),receipt:content.receipt};
  return content;
}
function fixed(records:readonly SuiteRecord[],packId:string) {
  if(!records.length||records.length>1000)reject('ENGINEERING_FIXED_RECORDS_REQUIRED');
  const prefix=prefixes[packId]??reject('ENGINEERING_PACKAGE_UNSUPPORTED'),workspace=records[0].workspaceId,seen=new Set<string>();
  for(const row of records) {
    if(!row.domain.startsWith(prefix+'-')||row.workspaceId!==workspace)reject('ENGINEERING_RECORD_SCOPE');
    if(row.state!=='sealed')reject('ENGINEERING_FIXED_RECORD_NOT_SEALED',row.domain);
    if(!/^[a-f0-9]{64}$/.test(row.revision))reject('ENGINEERING_RECORD_REVISION');
    const key=row.domain+'/'+row.id+'/'+row.revision;if(seen.has(key))reject('ENGINEERING_DUPLICATE_RECORD');seen.add(key);
  }
  return {prefix,workspace,references:records.map(pin)};
}
function one(records:readonly SuiteRecord[],domain:string,kind?:SuiteRecord['kind']) {
  const rows=records.filter(r=>r.domain===domain&&(!kind||r.kind===kind));if(rows.length!==1)reject('ENGINEERING_RECORD_SELECTION',domain);return rows[0];
}
function localResult(records:readonly SuiteRecord[],domain:string) {
  const row=one(records,domain,'result');if(row.origin!=='local')reject('ENGINEERING_EXTERNAL_EVIDENCE',domain);return {row,value:output(row)};
}
function referenceClosure(records:readonly SuiteRecord[]) {
  const ids=new Set(records.map(r=>r.domain+'/'+r.id+'/'+r.revision));
  return records.flatMap(r=>r.references.filter(p=>!ids.has(p.domain+'/'+p.id+'/'+p.revision)).map(ref=>({from:pin(r),missing:ref})));
}
function summary(row:SuiteRecord) {
  const value=output(row),receipt=value.receipt?obj(value.receipt):null;
  const outcome=value.outcome??(value.valid===false?'failed':['unknown','inconclusive'].includes(String(value.state))?'inconclusive':value.state==='unsatisfiable'?'failed':value.state??null);
  return {ref:pin(row),kind:row.kind,origin:row.origin,resultKind:value.kind??null,source:value.source??null,outcome,cleanup:receipt?.cleanup??null,executionState:receipt?.state??value.executionState??null,external:row.origin==='imported'};
}
export async function computeSeventhEngineeringLifecycle(packId:string,action:string,input:Record<string,unknown>,records:readonly SuiteRecord[]):Promise<SeventhEngineeringLifecycleProduct> {
  if(!(SEVENTH_ENGINEERING_LIFECYCLE_ACTIONS[packId]??[]).includes(action))reject('ENGINEERING_LIFECYCLE_UNSUPPORTED',action);
  const scope=fixed(records,packId),make=(kind:SeventhEngineeringLifecycleProduct['kind'],content:R,seal=true):SeventhEngineeringLifecycleProduct=>({kind,content:suiteJson.parse({format:'sakura-seventh-engineering-lifecycle/1',packId,action,...content}),references:scope.references,seal});
  if(action==='locks.assemble'||action==='locks.seal') {
    const solved=localResult(records,'depsolve-solves'),proof=localResult(records,'depsolve-proofs');
    if(!['optimal','feasible'].includes(String(solved.value.state)))reject('DEPENDENCY_LOCK_NO_FEASIBLE_SOLUTION');
    const selected=list(solved.value.selected,20000).map(v=>obj(v));if(!selected.length)reject('DEPENDENCY_LOCK_EMPTY');
    if(selected.some(p=>typeof p.sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.sha256)))reject('DEPENDENCY_LOCK_MATERIALS_MISSING');
    if(proof.value.valid!==true||proof.value.modelDigest!==solved.value.inputDigest||proof.value.assignmentDigest!==digest(selected))reject('DEPENDENCY_LOCK_PROOF_MISMATCH');
    const versions=selected.map(p=>({name:str(p.name),version:str(p.version),sha256:str(p.sha256)}));
    const edges=selected.flatMap(p=>[['dependency',p.dependencies],['peer',p.peers],...(solved.value.includeOptional===true?[['optional',p.optional]]:[])].flatMap(([kind,values])=>Object.entries(obj(values??{})).map(([name,range])=>({from:p.name,to:name,range,kind}))));
    return make('definition',{format:'sakura-neutral-lock/1',modelDigest:solved.value.inputDigest,platform:solved.value.platform??null,roots:solved.value.roots??{},versions,edges,selectionState:solved.value.state,proof:pin(proof.row),installationVerified:false,origin:'local-fixed-evidence'});
  }
  if(action==='bundles.assemble'||action==='bundles.seal') {
    const build=localResult(records,'extforge-builds'),inspection=localResult(records,'extforge-inspections'),signature=localResult(records,'extforge-signatures'),declaration=one(records,'extforge-manifests','definition');
    const metadata=recordValue(declaration),manifest=metadata.manifest?obj(metadata.manifest):metadata;
    if(build.value.source!=='actual-vm-compiler'||build.value.outcome!=='passed'||obj(build.value.receipt).cleanup!=='confirmed')reject('EXTENSION_BUILD_EVIDENCE_REQUIRED');
    if(inspection.value.valid!==true||inspection.value.sha256!==build.value.sha256||manifest.sha256!==build.value.sha256)reject('EXTENSION_BUNDLE_ARTIFACT_MISMATCH');
    if(signature.value.valid!==true||signature.value.manifestDigest!==manifest.sha256)reject('EXTENSION_BUNDLE_SIGNATURE_REQUIRED');
    const verified=obj(await extensionAction('signatures.verify',{manifest,signature:signature.value.signature,publicKey:signature.value.publicKey}));if(verified.valid!==true)reject('EXTENSION_BUNDLE_SIGNATURE_MISMATCH');
    const wasmUrl=typeof input.wasmUrl==='string'?input.wasmUrl:'./'+str(manifest.id)+'.wasm';
    if(wasmUrl.startsWith('/')||wasmUrl.includes('://')||wasmUrl.split('/').includes('..'))reject('EXTENSION_BUNDLE_RELATIVE_URL');
    return make('definition',{format:'sakura-community-extension-candidate/1',catalogEntry:{...manifest,signature:signature.value.signature,wasmUrl},artifact:{reference:pin(build.row),sha256:build.value.sha256,bytes:build.value.bytes},signature:verified,installableCandidate:true,installed:false,trustRegistered:false});
  }
  if(action==='packages.assemble'||action==='packages.seal') {
    const contracts=recordValue(one(records,'virtservice-contracts','definition')),matchers=recordValue(one(records,'virtservice-matchers','definition')),states=recordValue(one(records,'virtservice-states','definition')),transitions=recordValue(one(records,'virtservice-transitions','definition')),scenario=recordValue(one(records,'virtservice-scenarios','definition'));
    const faults=records.find(r=>r.domain==='virtservice-faults'),payloads=records.find(r=>r.domain==='virtservice-payloads'),faultRules=faults?list(recordValue(faults).rules??[],4000).map(v=>obj(v)):[],payloadValues=payloads?obj(recordValue(payloads).payloads??{}):{};
    const services=list(contracts.services,20).map(v=> {
      const service=obj(v),id=str(service.id),rules=list(matchers.rules,4000).map(v=>obj(v)).filter(r=>r.service===id).map(rule=> {
        const transition=list(transitions.rules??[],4000).map(v=>obj(v)).find(r=>r.service===id&&r.id===rule.id),fault=faultRules.find(r=>r.service===id&&r.id===rule.id);
        return {id:rule.id,method:rule.method??'GET',path:rule.path,priority:rule.priority??0,whenState:rule.whenState??{},response:rule.response??{status:200,body:rule.payloadRef?payloadValues[str(rule.payloadRef)]??reject('VIRTUAL_PAYLOAD_REFERENCE'):null},set:transition?.set??{},calls:transition?.calls??[],delayMs:fault?.delayMs??0,disconnect:fault?.disconnect??false};
      });
      return {id,initialState:obj(states.states)[id]??reject('VIRTUAL_INITIAL_STATE_REFERENCE'),rules};
    });
    virtualServices({services});
    const workerInput=seventhVirtualizationWorkerInput.parse({protocol:'sakura-seventh-virtualization/1',services,requests:scenario.requests??[],seed:scenario.seed??1});
    return make('definition',{format:'sakura-multi-service-environment/1',workerInput,modelDigest:digest(workerInput.services),fixedSources:scope.references,activeSessions:0,executionStarted:false});
  }
  if(['observations.capture','observations.readEvents','observations.coverage','traffic.capture','traffic.readRequests','traces.coverage'].includes(action)) {
    const sourceDomains=packId==='schedule-semantics-lab'?['schedlab-simulations','schedlab-harness']:packId==='service-virtualization-studio'?['virtservice-sessions']:['protostate-runs','protostate-traces'];
    const candidates=records.filter(r=>sourceDomains.includes(r.domain)&&r.kind==='result');if(!candidates.length)reject('ENGINEERING_OBSERVATION_SOURCE_REQUIRED');
    const observations=candidates.flatMap<R>(row=> {
      const value=output(row),receipt=value.receipt?obj(value.receipt):null;
      const events=Array.isArray(value.observations)?value.observations:Array.isArray(value.traces)?value.traces:Array.isArray(value.traffic)?value.traffic:Array.isArray(value.received)?value.received:[];
      if(!events.length&&value.outcome!=='passed')return [{source:pin(row),origin:row.origin,event:null,incomplete:true}];
      return events.map((event,index)=>({source:pin(row),origin:row.origin,index,event,realObservation:row.origin==='local'&&String(value.source??'').startsWith('actual-vm-'),cleanup:receipt?.cleanup??null}));
    });
    const offset=integer(input.offset,0,0,observations.length),limit=integer(input.limit,100,1,1000),full=action.endsWith('.capture');
    return make('result',{kind:'engineering-observation-index',sources:candidates.map(summary),total:observations.length,offset,items:full?observations:observations.slice(offset,offset+limit),next:!full&&offset+limit<observations.length?offset+limit:null,coverageComplete:candidates.every(r=>{const v=output(r);return !v.tracesTruncated&&v.complete!==false&&v.outcome!=='inconclusive';}),byteOrEventLossInferred:false});
  }
  if(action==='reviews.compare') {
    const reviews=records.filter(r=>r.kind==='review');if(reviews.length!==2)reject('ENGINEERING_TWO_REVIEWS_REQUIRED');
    return make('result',{kind:'engineering-review-comparison',left:pin(reviews[0]),right:pin(reviews[1]),sameDecision:recordValue(reviews[0]).decision===recordValue(reviews[1]).decision,sameContent:canonical(reviews[0].content)===canonical(reviews[1].content),independentReviewers:reviews[0].actor!==reviews[1].actor});
  }
  if(action.endsWith('.review')||action==='reviews.seal') {
    const decision=str(input.decision),reason=str(input.reason,'reason',4000);if(!['accepted','rejected','exception'].includes(decision))reject('ENGINEERING_REVIEW_DECISION');
    const results=records.filter(r=>r.kind==='result');if(!results.length)reject('ENGINEERING_REVIEW_EVIDENCE_REQUIRED');
    return make('review',{kind:'engineering-review',decision,reason,evidence:results.map(summary),originalTechnicalResultsUnchanged:true,businessReviewer:typeof input.reviewer==='string'?input.reviewer:null,independentReviewerNotInferred:true});
  }
  if(action==='reports.assemble'||action==='reports.seal') {
    const evidence=records.filter(r=>r.kind==='result');if(!evidence.length)reject('ENGINEERING_REPORT_EVIDENCE_REQUIRED');
    const summaries=evidence.map(summary),unresolved=referenceClosure(records),actual=summaries.filter(s=>String(s.source??'').startsWith('actual-vm-')&&!s.external),unknownCleanup=actual.filter(s=>s.cleanup!=='confirmed'),failed=summaries.filter(s=>s.outcome==='failed'||s.executionState==='failed');
    const required:Record<string,string[][]>={
      'schedule-semantics-lab':[['schedlab-simulations','schedlab-harness'],['schedlab-checks']],
      'extension-authoring-studio':[['extforge-builds'],['extforge-inspections'],['extforge-trials']],
      'dependency-resolution-studio':[['depsolve-solves'],['depsolve-proofs']],
      'protocol-state-lab':[['protostate-runs'],['protostate-properties']],
      'replica-sync-lab':[['replab-runs'],['replab-judgments']],
      'service-virtualization-studio':[['virtservice-sessions'],['virtservice-assertions']],
    };
    const missingEvidenceDomains=required[packId].filter(group=>!evidence.some(r=>group.includes(r.domain)&&r.origin==='local'));
    const executionRequired=['schedule-semantics-lab','extension-authoring-studio','protocol-state-lab','service-virtualization-studio'].includes(packId),scopeComplete=(!executionRequired||actual.length>0)&&missingEvidenceDomains.length===0;
    const outcome=failed.length?'failed':!scopeComplete||unknownCleanup.length||summaries.some(s=>s.external||s.outcome==='inconclusive'||s.outcome==='unknown')?'inconclusive':'passed';
    if(action==='reports.seal'&&unknownCleanup.length)reject('ENGINEERING_REPORT_CLEANUP_PENDING');
    return make('result',{kind:'engineering-report',outcome,evidence:summaries,realExecutionEvidence:actual.length,executionRequired,scopeComplete,missingEvidenceDomains,unresolvedReferences:unresolved,fullInputClosure:unresolved.length===0,limitations:records.filter(r=>r.origin==='imported').map(pin),reviews:records.filter(r=>r.kind==='review').map(pin),businessAcceptanceDoesNotOverrideTechnicalFailures:true},unknownCleanup.length===0);
  }
  reject('ENGINEERING_LIFECYCLE_UNSUPPORTED',action);
}
