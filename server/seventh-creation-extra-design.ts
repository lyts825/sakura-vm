/** 真实变量差异、受限 SVG 重建和有限状态矩阵；不执行脚本或测量浏览器布局。 */
import {DOMParser,DOMImplementation,XMLSerializer,type Node as XmlNode,type Element as XmlElement} from '@xmldom/xmldom';
import {type Data,cancelled,digest,graph,list,number,object,reject,rows,strings,text,unique} from './seventh-creation-common.ts';
import {computeDesign} from './seventh-creation-design.ts';
export const EXTRA_DESIGN_ACTIONS:readonly string[]=['tokens.diff','icons.sanitize','components.validate','states.expand'];
const svgNs='http://www.w3.org/2000/svg';
const tags=new Set(['svg','g','path','circle','rect','line','polyline','polygon','ellipse','title','desc']);
const numeric=new Set(['width','height','stroke-width','opacity','fill-opacity','stroke-opacity','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry']);
const simple:Record<string,readonly string[]>={'stroke-linecap':['butt','round','square'],'stroke-linejoin':['miter','round','bevel'],'fill-rule':['nonzero','evenodd'],'clip-rule':['nonzero','evenodd'],role:['img','presentation']};
function sanitize(input:Data,signal?:AbortSignal){
 const svg=text(input.svg,262144);if(/<!|<\?/.test(svg))reject('DESIGN_SVG_DECLARATION');
 let document;try{document=new DOMParser({onError:()=>{throw new Error('malformed SVG');}}).parseFromString(svg,'image/svg+xml');}catch{reject('DESIGN_SVG_PARSE');}
 const root=document.documentElement;if(!root||root.localName!=='svg'||(root.namespaceURI&&root.namespaceURI!==svgNs)||root.prefix)reject('DESIGN_SVG_ROOT');
 const output=new DOMImplementation().createDocument(svgNs,'svg',null),outputRoot=output.documentElement,removed:Data[]=[],ids=new Set<string>();if(!outputRoot)reject('DESIGN_SVG_ROOT');let count=0;
 const attribute=(name:string,value:string)=>{
  if(value.length>65536||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)||/url\s*\(|(?:javascript|data):/i.test(value))return false;
  if(numeric.has(name))return /^(?:\d+(?:\.\d*)?|\.\d+)(?:px|%)?$/.test(value)||(['x','y','x1','y1','x2','y2','cx','cy'].includes(name)&&/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value));
  if(name==='fill'||name==='stroke')return /^(?:none|currentColor|transparent|#[a-f\d]{3,8}|[a-z]{1,30})$/i.test(value);
  if(name==='viewBox')return /^\s*-?(?:\d+(?:\.\d*)?|\.\d+)\s+-?(?:\d+(?:\.\d*)?|\.\d+)\s+(?:\d+(?:\.\d*)?|\.\d+)\s+(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(value);
  if(name==='d')return /^[MmZzLlHhVvCcSsQqTtAa\d.,+eE\s-]*$/.test(value);
  if(name==='points')return /^[\d.,+eE\s-]*$/.test(value);
  if(name==='transform')return /^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\(\s*[\d.,+eE\s-]+\)\s*)+$/.test(value);
  if(name==='aria-label')return value.length<=256;
  if(name==='id'){if(!/^[a-zA-Z][\w.-]{0,127}$/.test(value)||ids.has(value))return false;ids.add(value);return true;}
  return simple[name]?.includes(value)??false;
 };
 const visit=(node:XmlNode,parent:XmlElement,depth:number)=>{
  cancelled(signal);if(++count>5000||depth>32)reject('DESIGN_SVG_LIMIT');
  if(node.nodeType===3){if(['title','desc'].includes(parent.localName??parent.tagName))parent.appendChild(output.createTextNode(text(node.nodeValue??'',4096)));else if(node.nodeValue?.trim())removed.push({kind:'text',reason:'non-title text'});return;}
  if(node.nodeType!==1){removed.push({kind:'node',reason:'non-element node'});return;}
  const element=node as XmlElement,name=element.localName??element.tagName;if(!tags.has(name)||element.prefix||(element.namespaceURI&&element.namespaceURI!==svgNs)){removed.push({kind:'element',name,reason:'outside fixed SVG subset'});return;}
  const target=depth===0?outputRoot:output.createElementNS(svgNs,name);
  for(let i=0;i<element.attributes.length;i++){const a=element.attributes.item(i)!;if(a.name==='xmlns'&&depth===0)continue;if(a.prefix||!attribute(a.name,a.value)){removed.push({kind:'attribute',element:name,name:a.name,reason:'outside fixed literal subset'});continue;}target.setAttribute(a.name,a.value);}
  if(depth!==0)parent.appendChild(target);for(let child=element.firstChild;child;child=child.nextSibling)visit(child,target,depth+1);
 };
 visit(root,outputRoot,0);const clean=new XMLSerializer().serializeToString(outputRoot),checked=object(computeDesign('icons.inspect',{svg:clean}));
 return {...checked,removed,changed:clean!==svg,originalDigest:digest(svg),safeForPreview:true,scope:'rebuilt allowlisted SVG DOM with no scripts, event attributes, URL resources or animation'};
}
export function computeExtraDesign(action:string,input:Data,signal?:AbortSignal):unknown{
 cancelled(signal);
 if(action==='icons.sanitize')return sanitize(input,signal);
 if(action==='tokens.diff'){
  const before=Array.isArray(input.before)?{tokens:input.before}:object(input.before??{tokens:input.beforeTokens}),after=Array.isArray(input.after)?{tokens:input.after}:object(input.after??{tokens:input.afterTokens});
  const left=object(computeDesign('tokens.resolve',before,signal)),right=object(computeDesign('tokens.resolve',after,signal)),a=new Map(rows(before.tokens,5000).map(t=>[text(t.id),t])),b=new Map(rows(after.tokens,5000).map(t=>[text(t.id),t])),valuesA=object(left.values),valuesB=object(right.values),changes:Data[]=[];
  for(const id of [...new Set([...a.keys(),...b.keys()])].sort()){cancelled(signal);const original=a.get(id),next=b.get(id);if(!original||!next){changes.push({id,kind:original?'removed':'added',before:original??null,after:next??null,resolvedBefore:valuesA[id]??null,resolvedAfter:valuesB[id]??null});continue;}const definitionChanged=digest(original)!==digest(next),resolvedChanged=digest(valuesA[id])!==digest(valuesB[id]);if(definitionChanged||resolvedChanged)changes.push({id,kind:'changed',definitionChanged,resolvedChanged,typeChanged:original.type!==next.type,before:original,after:next,resolvedBefore:valuesA[id],resolvedAfter:valuesB[id]});}
  return {equal:changes.length===0,changes,beforeDigest:digest(before),afterDigest:digest(after),beforeResolvedDigest:left.digest,afterResolvedDigest:right.digest,scope:'typed definitions and transitively resolved token values'};
 }
 if(action==='components.validate'){
  const components=rows(input.components,200),ids=components.map(c=>text(c.id,128));unique(ids);const known=new Set(ids),findings:Data[]=[],tokens=input.tokens===undefined?new Set<string>():new Set(Object.keys(object(object(computeDesign('tokens.resolve',{tokens:input.tokens},signal)).values))),icons=new Set(strings(input.icons??[],5000));
  const kinds=new Set(['text','button','input','select','container','table','status']),props=new Set(['label','text','placeholder','disabled','value','ariaLabel','required','multiple','rows','columns','name','type']);
  const nodes=components.map(component=>{cancelled(signal);const id=text(component.id);if(!kinds.has(text(component.kind,64)))findings.push({id,code:'COMPONENT_KIND'});const children=strings(component.children??[],200),slots=object(component.slots??{}),dependencies=[...children,...Object.values(slots).flatMap(v=>strings(v,200))];for(const ref of dependencies)if(!known.has(ref))findings.push({id,code:'CHILD_MISSING',reference:ref});for(const ref of strings(component.tokens??[],5000))if(!tokens.has(ref))findings.push({id,code:'TOKEN_MISSING',reference:ref});if(component.icon!==undefined&&!icons.has(text(component.icon)))findings.push({id,code:'ICON_MISSING',reference:component.icon});for(const [name,value]of Object.entries(object(component.props??{}))){if(!props.has(name)||/^(?:on|dangerously|srcdoc)/i.test(name))findings.push({id,code:'PROP_UNSUPPORTED',name});else if(!['string','number','boolean'].includes(typeof value)&&value!==null)findings.push({id,code:'PROP_TYPE',name});if(typeof value==='number')number(value);}
   return {id,deps:[...new Set(dependencies.filter(d=>known.has(d)))]};});
  let order:string[]=[];try{order=graph(nodes);}catch(error){if((error as {code?:string}).code==='CREATION_GRAPH_CYCLE')findings.push({code:'COMPONENT_CYCLE'});else throw error;}
  return {passed:components.length>0&&findings.length===0,findings:components.length?findings:[{code:'COMPONENTS_EMPTY'}],order,definitionDigest:digest(components),scope:'fixed component kinds, child/slot graph, literal props, token and icon references'};
 }
 if(action==='states.expand'){
  const axes=object(input.axes),names=Object.keys(axes).sort();if(!names.length||names.length>16)reject('DESIGN_STATE_AXES');const values=names.map(name=>{text(name,128);const items=list(axes[name],32);if(!items.length)reject('DESIGN_STATE_AXIS_EMPTY');for(const value of items)if(value!==null&&!['string','boolean','number'].includes(typeof value))reject('DESIGN_STATE_VALUE');else if(typeof value==='number')number(value);unique(items.map(v=>digest(v)));return items;});const total=values.reduce((n,v)=>n*v.length,1);if(total>6400)reject('DESIGN_STATE_LIMIT');
  const exclusions=rows(input.exclusions??[],500);for(const exclusion of exclusions){const when=object(exclusion.when);if(!Object.keys(when).length)reject('DESIGN_STATE_EXCLUSION_EMPTY');for(const [name,value]of Object.entries(when))if(!Object.hasOwn(axes,name)||!list(axes[name],32).some(v=>Object.is(v,value)))reject('DESIGN_STATE_EXCLUSION_REFERENCE');}
  let combinations:Data[]=[{}];for(let at=0;at<names.length;at++){cancelled(signal);combinations=combinations.flatMap(row=>values[at].map(value=>({...row,[names[at]]:value})));}
  const excluded:Data[]=[],included:Data[]=[];for(const value of combinations){const rule=exclusions.find(e=>Object.entries(object(e.when)).every(([key,v])=>Object.is(value[key],v)));if(rule)excluded.push({values:value,reason:typeof rule.reason==='string'?text(rule.reason,1024):'declared exclusion'});else included.push({id:digest(value).slice(0,24),values:value});}
  return {total,states:included,required:included.map(s=>String(s.id)),excluded,definitionDigest:digest(input),scope:'finite Cartesian product minus literal declared exclusions'};
 }
 reject('CREATION_ACTION_UNSUPPORTED');
}
