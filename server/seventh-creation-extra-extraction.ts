/** 固定页几何、字段约定和纠错候选的有限计算；不执行 OCR 或推断人工批准。 */
import {type Data,cancelled,digest,integer,list,number,object,reject,rows,strings,text,unique} from './seventh-creation-common.ts';
import {computeExtraction} from './seventh-creation-extraction.ts';
export const EXTRA_EXTRACTION_ACTIONS:readonly string[]=['layouts.detect','layouts.validate','tables.check','schemas.validate','checks.evaluate','corrections.propose','corrections.compare'];
type Box=[number,number,number,number];
const box=(value:unknown):Box=>{const b=list(value,4).map(v=>number(v,0,100000));if(b.length!==4||b[0]>b[2]||b[1]>b[3])reject('EXTRACT_COORDINATE_RANGE');return b as Box;};
const contains=(a:Box,b:Box)=>b[0]>=a[0]&&b[1]>=a[1]&&b[2]<=a[2]&&b[3]<=a[3];
const overlap=(a:Box,b:Box)=>Math.min(a[2],b[2])>Math.max(a[0],b[0])&&Math.min(a[3],b[3])>Math.max(a[1],b[1]);
const union=(boxes:Box[]):Box=>[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))];
function sourcePages(value:unknown){const pages=rows(value,200);computeExtraction('fields.extract',{pages,fields:[]});let total=0;for(const page of pages){text(page.id,128);total+=rows(page.spans??[],20000).length;}if(total>20000)reject('EXTRACT_SPAN_BUDGET');return pages;}
const finding=(code:string,details:Data={},severity='error')=>({code,severity,...details});
function schemaFields(input:Data){
 const fields=rows(object(input.schema??input).fields,1000);unique(fields.map(f=>text(f.id,128)));
 const known=new Set(['text','string','number','integer','decimal','boolean','date']);
 for(const field of fields){if(!known.has(text(field.type,32)))reject('EXTRACT_SCHEMA_TYPE');if(field.required!==undefined&&typeof field.required!=='boolean')reject('EXTRACT_SCHEMA_REQUIRED');if(field.anchor!==undefined)text(field.anchor,1024);if(field.region!==undefined)box(field.region);if(field.min!==undefined){number(field.min);if(decimal(field.min)===null)reject('EXTRACT_SCHEMA_PRECISION');}if(field.max!==undefined){number(field.max);if(decimal(field.max)===null)reject('EXTRACT_SCHEMA_PRECISION');}if(field.min!==undefined&&field.max!==undefined&&number(field.min)>number(field.max))reject('EXTRACT_SCHEMA_RANGE');if(field.pattern!==undefined||field.script!==undefined)reject('EXTRACT_SCHEMA_RULE_UNSUPPORTED');}
 return fields;
}
function decimal(value:unknown):bigint|null{const s=typeof value==='number'?String(value):typeof value==='string'?value:'';if(!/^[+-]?\d{1,30}(?:\.\d{1,9})?$/.test(s))return null;const negative=s.startsWith('-'),[whole,part='']=s.replace(/^[+-]/,'').split('.');const n=BigInt(whole)*1000000000n+BigInt(part.padEnd(9,'0'));return negative?-n:n;}
export function computeExtraExtraction(action:string,input:Data,signal?:AbortSignal):unknown{
 cancelled(signal);
 if(action==='schemas.validate'){const fields=schemaFields(input);return {passed:true,fields:fields.map(f=>({id:f.id,type:f.type,required:f.required===true})),schemaDigest:digest(fields),scope:'finite literal anchors and coordinate regions'};}
 if(action==='layouts.detect'){
  const pages=sourcePages(input.pages),tolerance=number(input.lineTolerance??input.rowTolerance??3,0,100),gap=number(input.blockGap??12,0,1000);
  return {layouts:pages.map(page=>{cancelled(signal);const spans=rows(page.spans??[],20000).map((s,index)=>({...s,index,b:box(s.bbox)} as Data&{index:number;b:Box})).sort((a,b)=>a.b[1]-b.b[1]||a.b[0]-b.b[0]);
   const lines:{y:number;spans:typeof spans}[]=[];for(const span of spans){const line=lines.at(-1);if(line&&Math.abs(line.y-span.b[1])<=tolerance)line.spans.push(span);else lines.push({y:span.b[1],spans:[span]});}
   const blocks:{lines:typeof lines;bbox:Box}[]=[];for(const line of lines){line.spans.sort((a,b)=>a.b[0]-b.b[0]);const bounds=union(line.spans.map(s=>s.b)),previous=blocks.at(-1);if(previous&&bounds[1]-previous.bbox[3]<=gap&&Math.min(bounds[2],previous.bbox[2])>=Math.max(bounds[0],previous.bbox[0])){previous.lines.push(line);previous.bbox=union([previous.bbox,bounds]);}else blocks.push({lines:[line],bbox:bounds});}
   return {pageId:page.id,sourceDigest:digest(page),regions:blocks.map((block,index)=>({id:String(page.id)+'-region-'+(index+1),kind:block.lines.length>=2&&block.lines.every(line=>line.spans.length>=2)?'table-candidate':'text-block',bbox:block.bbox,spanIndices:block.lines.flatMap(l=>l.spans.map(s=>s.index)),text:block.lines.map(l=>l.spans.map(s=>text(s.text)).join(' ')).join('\n'),readingOrder:index})),state:'requires-review'};
  }),scope:'bounded top-to-bottom line and adjacent-block geometry; candidates require review'};
 }
 if(action==='layouts.validate'){
  const pages=sourcePages(input.pages),layouts=rows(input.layouts,200),findings:Data[]=[];unique(layouts.map(l=>text(l.pageId,128)));if(!layouts.length&&pages.length)findings.push(finding('LAYOUTS_EMPTY'));
  for(const layout of layouts){cancelled(signal);const page=pages.find(p=>p.id===layout.pageId);if(!page){findings.push(finding('PAGE_MISSING',{pageId:layout.pageId}));continue;}const regions=rows(layout.regions,5000),ids=new Set<string>(),spans=rows(page.spans??[],20000);if(!regions.length&&spans.length)findings.push(finding('REGIONS_EMPTY',{pageId:page.id}));for(const region of regions){const id=text(region.id,128),bounds=box(region.bbox);if(ids.has(id))findings.push(finding('REGION_DUPLICATE',{id}));ids.add(id);if(!contains([0,0,number(page.width),number(page.height)],bounds))findings.push(finding('REGION_OUTSIDE_PAGE',{id}));for(const index of list(region.spanIndices??[],20000)){const n=integer(index,0,19999),span=spans[n];if(!span)findings.push(finding('SPAN_MISSING',{id,index:n}));else if(!contains(bounds,box(span.bbox)))findings.push(finding('SPAN_OUTSIDE_REGION',{id,index:n}));}}}
  return {passed:findings.length===0,findings,layoutDigest:digest(layouts),sourceDigest:digest(pages)};
 }
 if(action==='tables.check'){
  const tables=rows(input.tables,200),pages=input.pages===undefined?[]:sourcePages(input.pages),findings:Data[]=[];if(!tables.length)findings.push(finding('TABLES_EMPTY'));
  for(const table of tables){cancelled(signal);const page=pages.find(p=>p.id===table.pageId),tableRows=rows(table.rows,10000),ids=new Set<string>();if(!tableRows.length)findings.push(finding('TABLE_EMPTY',{pageId:table.pageId}));const columns=input.expectedColumns===undefined?null:integer(input.expectedColumns,1,1000);
   for(const row of tableRows){const rowId=text(row.id,128),cells=rows(row.cells,1000);if(columns!==null&&cells.length!==columns)findings.push(finding('COLUMN_COUNT',{rowId,expected:columns,actual:cells.length}));let previous:Box|null=null;for(const cell of cells){const id=text(cell.id,128),bounds=box(cell.bbox);text(cell.text);if(ids.has(id))findings.push(finding('CELL_DUPLICATE',{id}));ids.add(id);if(previous&&overlap(previous,bounds))findings.push(finding('CELL_OVERLAP',{id,rowId}));if(previous&&bounds[0]<previous[0])findings.push(finding('CELL_ORDER',{id,rowId}));if(page&&!contains([0,0,number(page.width),number(page.height)],bounds))findings.push(finding('CELL_OUTSIDE_PAGE',{id}));previous=bounds;}}
   if(input.headers!==undefined){const expected=strings(input.headers,1000),actual=tableRows.length?rows(tableRows[0].cells,1000).map(c=>text(c.text).trim()):[];if(digest(actual)!==digest(expected))findings.push(finding('HEADER_MISMATCH',{pageId:table.pageId,expected,actual}));}
   if(pages.length&&!page)findings.push(finding('PAGE_MISSING',{pageId:table.pageId}));
  }return {passed:findings.length===0,findings,tablesDigest:digest(tables),scope:'candidate cell geometry, declared columns and literal headers; no review approval'};
 }
 if(action==='checks.evaluate'){
  const values=rows(input.fields??[],10000),findings:Data[]=[],byId=new Map<string,Data>();if(!values.length&&input.tables===undefined)reject('EXTRACT_CHECK_INPUT');
  for(const value of values){const id=text(value.id,128);if(byId.has(id))findings.push(finding('DUPLICATE_FIELD',{id}));else byId.set(id,value);if(['missing','type-error','ambiguous'].includes(String(value.state)))findings.push(finding('FIELD_'+String(value.state).toUpperCase().replace('-','_'),{id}));}
  if(input.schema!==undefined)for(const field of schemaFields(input)){const id=text(field.id),value=byId.get(id)?.value,empty=value===undefined||value===null||value==='';if(empty){if(field.required===true)findings.push(finding('REQUIRED',{id}));continue;}let valid=true;const d=decimal(value);if(['number','integer','decimal'].includes(String(field.type)))valid=d!==null&&(field.type!=='integer'||d%1000000000n===0n);else if(['text','string'].includes(String(field.type)))valid=typeof value==='string';else if(field.type==='boolean')valid=typeof value==='boolean';else if(field.type==='date')valid=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;if(!valid)findings.push(finding('TYPE',{id,type:field.type}));if(d!==null&&((field.min!==undefined&&d<decimal(field.min)!)||(field.max!==undefined&&d>decimal(field.max)!)))findings.push(finding('RANGE',{id}));}
  for(const rule of rows(input.constraints??[],1000)){if(rule.kind!=='sum')reject('EXTRACT_CONSTRAINT_UNSUPPORTED');const ids=strings(rule.fields,1000),parts=ids.map(id=>decimal(byId.get(id)?.value)),target=typeof rule.equals==='string'&&byId.has(rule.equals)?decimal(byId.get(rule.equals)?.value):decimal(rule.equals),tolerance=decimal(rule.tolerance??0);if(target===null||tolerance===null||tolerance<0n||parts.some(v=>v===null)){findings.push(finding('SUM_VALUE_MISSING',{fields:ids}));continue;}const sum=(parts as bigint[]).reduce((a,b)=>a+b,0n),difference=sum-target;if((difference<0n?-difference:difference)>tolerance)findings.push(finding('SUM_MISMATCH',{fields:ids,equals:rule.equals,differenceScaled:difference.toString(),scale:9}));}
  if(input.tables!==undefined){const table=computeExtraExtraction('tables.check',{tables:input.tables,...(input.pages?{pages:input.pages}:{} )},signal) as {findings:Data[]};findings.push(...table.findings);}
  return {passed:findings.length===0,findings,inputDigest:digest(input),scope:'missing/type/duplicate and exact decimal sum constraints; not semantic content verification'};
 }
 if(action==='corrections.propose'){
  const pages=sourcePages(input.pages),edits=rows(input.edits,10000),seen=new Set<string>();if(!edits.length)reject('EXTRACT_CORRECTIONS_EMPTY');
  const changes=edits.map(edit=>{cancelled(signal);const page=pages.find(p=>p.id===edit.pageId);if(!page)reject('EXTRACT_PAGE_REFERENCE');const sourceDigest=digest(page);if(edit.expectedDigest!==sourceDigest)reject('EXTRACT_REVISION_CONFLICT');const index=integer(edit.span,0,19999),span=rows(page.spans??[],20000)[index];if(!span)reject('EXTRACT_SPAN_REFERENCE');const key=String(page.id)+'/'+index;if(seen.has(key))reject('EXTRACT_DUPLICATE_EDIT');seen.add(key);const reason=text(edit.reason,4096).trim();if(!reason)reject('EXTRACT_CORRECTION_REASON');return {pageId:page.id,span:index,previous:text(span.text),value:text(edit.value),reason,bbox:span.bbox,sourceDigest};});return {changes,sourceDigest:digest(pages),proposalDigest:digest(changes),state:'proposed',applied:false};
 }
 if(action==='corrections.compare'){
  const before=sourcePages(input.before??input.pages),after=input.after===undefined?sourcePages(object(computeExtraction('corrections.apply',{pages:before,edits:input.edits})).pages):sourcePages(input.after),changes:Data[]=[];
  for(const id of new Set([...before,...after].map(p=>text(p.id)))){cancelled(signal);const a=before.find(p=>p.id===id),b=after.find(p=>p.id===id);if(!a||!b){changes.push({pageId:id,kind:a?'page-removed':'page-added'});continue;}const left=rows(a.spans??[],20000),right=rows(b.spans??[],20000);for(let i=0;i<Math.max(left.length,right.length);i++){const old=left[i]??null,next=right[i]??null;if(digest(old)!==digest(next))changes.push({pageId:id,span:i,before:old,after:next});}}
  return {beforeDigest:digest(before),afterDigest:digest(after),changes,equal:changes.length===0,scope:'fixed page id and span position comparison; no implicit alignment or approval'};
 }
 reject('CREATION_ACTION_UNSUPPORTED');
}
