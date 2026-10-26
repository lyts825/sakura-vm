/** 无eval的有限表单解释器；a bounded form interpreter without dynamic code. */
import {
  type Data,
  cancelled,
  digest,
  graph,
  integer,
  list,
  number,
  object,
  reject,
  rows,
  strings,
  text,
  unique,
} from './seventh-creation-common.ts';

function expression(
  value: unknown,
  answers: Data,
  budget: { remaining: number },
  deps?: Set<string>,
): unknown {
  if (--budget.remaining < 0) reject('FORM_STEP_LIMIT');
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return list(value, 100).map((v) => expression(v, answers, budget, deps));
  const e = object(value);
  if (e.field !== undefined) {
    const key = text(e.field);
    deps?.add(key);
    return answers[key];
  }
  const args = list(e.args ?? [], 100).map((v) => expression(v, answers, budget, deps));
  const arity: Record<string, number> = {
    eq: 2,
    ne: 2,
    lt: 2,
    lte: 2,
    gt: 2,
    gte: 2,
    not: 1,
    subtract: 2,
    in: 2,
  };
  if (arity[String(e.op)] !== undefined && args.length !== arity[String(e.op)])
    reject('FORM_EXPRESSION_ARITY');
  switch (e.op) {
    case 'eq':
      return args[0] === args[1];
    case 'ne':
      return args[0] !== args[1];
    case 'lt':
      return number(args[0]) < number(args[1]);
    case 'lte':
      return number(args[0]) <= number(args[1]);
    case 'gt':
      return number(args[0]) > number(args[1]);
    case 'gte':
      return number(args[0]) >= number(args[1]);
    case 'and':
      return args.every((v) => v === true);
    case 'or':
      return args.some((v) => v === true);
    case 'not':
      return args[0] !== true;
    case 'add':
      return args.reduce<number>((a, b) => a + number(b), 0);
    case 'subtract':
      return number(args[0]) - number(args[1]);
    case 'multiply':
      return args.reduce<number>((a, b) => a * number(b), 1);
    case 'in':
      return list(args[1], 100).includes(args[0]);
    default:
      reject('FORM_EXPRESSION_OPERATOR');
  }
}
function prepare(input: Data) {
  const fields = rows(input.fields, 200);
  unique(fields.map((f) => text(f.id)));
  const known = new Set(fields.map((f) => text(f.id)));
  for(const field of fields){if(!['text','integer','number','boolean','enum','date','repeated'].includes(text(field.type)))reject('FORM_FIELD_TYPE');if(field.type==='enum'&&!list(field.values,1000).length)reject('FORM_ENUM_EMPTY');if(field.min!==undefined)number(field.min);if(field.max!==undefined)number(field.max);if(field.min!==undefined&&field.max!==undefined&&number(field.min)>number(field.max))reject('FORM_FIELD_RANGE');if(field.maxLength!==undefined)integer(field.maxLength,0,262144);if(field.hidden!==undefined&&!['clear','retain'].includes(String(field.hidden)))reject('FORM_HIDDEN_POLICY');}
  let compileSteps=0;
  const dependencies = (value: unknown, depth = 0): string[] => {
    if(++compileSteps>10000)reject('FORM_EXPRESSION_BUDGET');
    if (depth > 16) reject('FORM_EXPRESSION_DEPTH');
    if (!value || typeof value !== 'object') return [];
    if(Array.isArray(value))return list(value,100).flatMap(v=>dependencies(v,depth+1));
    const e = object(value);
    if (e.field !== undefined){if(Object.keys(e).some(k=>k!=='field'))reject('FORM_EXPRESSION_SHAPE');return [text(e.field)];}
    const arity:Record<string,number>={eq:2,ne:2,lt:2,lte:2,gt:2,gte:2,not:1,subtract:2,in:2};const op=text(e.op);if(!['eq','ne','lt','lte','gt','gte','not','subtract','in','and','or','add','multiply'].includes(op))reject('FORM_EXPRESSION_OPERATOR');if(Object.keys(e).some(k=>!['op','args'].includes(k)))reject('FORM_EXPRESSION_SHAPE');if(arity[op]!==undefined&&list(e.args??[],100).length!==arity[op])reject('FORM_EXPRESSION_ARITY');
    return list(e.args ?? [], 100).flatMap((v) => dependencies(v, depth + 1));
  };
  for (const field of fields)
    for (const dep of dependencies(field.visible)) if (!known.has(dep)) reject('FORM_UNKNOWN_FIELD');
  const pages=rows(input.pages??[],20);unique(pages.map(p=>text(p.id)));
  for (const page of pages){for(const field of strings(page.fields??[],200))if(!known.has(field))reject('FORM_UNKNOWN_FIELD');for(const dep of dependencies(page.when)) if (!known.has(dep)) reject('FORM_UNKNOWN_FIELD');}
  for(const rule of rows(input.rules??[],500)){if(rule.field!==undefined&&!known.has(text(rule.field)))reject('FORM_UNKNOWN_FIELD');for(const dep of [...dependencies(rule.when),...dependencies(rule.assert)])if(!known.has(dep))reject('FORM_UNKNOWN_FIELD');}
  const nodes = fields.map((f) => {
    const deps = new Set(dependencies(f.compute));
    for (const dep of deps) if (!known.has(dep)) reject('FORM_UNKNOWN_FIELD');
    return { id: text(f.id), deps: [...deps] };
  });
  return { fields, order: graph(nodes) };
}
function evaluate(input: Data) {
  const { fields, order } = prepare(input);
  const original = object(input.answers ?? {});
  const values: Data = { ...original };
  const errors: Data[] = [];
  const hidden: string[] = [];
  const budget = { remaining: 1000 };
  if (Object.keys(original).some((key) => !fields.some((field) => field.id === key)))
    reject('FORM_UNKNOWN_ANSWER');
  for (const id of order) {
    const f = fields.find((f) => f.id === id)!;
    if (f.compute !== undefined) values[id] = expression(f.compute, values, budget);
  }
  for (const f of fields) {
    const id = text(f.id);
    const visible = f.visible === undefined || expression(f.visible, values, budget) === true;
    if (!visible) {
      hidden.push(id);
      if (f.hidden === 'clear') delete values[id];
      continue;
    }
    let value = values[id];
    if (value === undefined && f.default !== undefined) value = f.default;
    if (typeof value === 'string' && f.trim === true) value = value.trim();
    if(value===undefined)delete values[id];else values[id] = value;
    if (f.required === true && (value === undefined || value === null || value === '')) {
      errors.push({ field: id, code: 'REQUIRED' });
      continue;
    }
    if (value == null || value === '') continue;
    let valid = true;
    switch (f.type) {
      case 'text':
        valid = typeof value === 'string' && value.length <= integer(f.maxLength ?? 4096, 0, 262144);
        break;
      case 'integer':
        valid = typeof value === 'number' && Number.isSafeInteger(value);
        break;
      case 'number':
        valid = typeof value === 'number' && Number.isFinite(value);
        break;
      case 'boolean':
        valid = typeof value === 'boolean';
        break;
      case 'enum':
        valid = list(f.values, 1000).includes(value);
        break;
      case 'date': {
        const stamp = typeof value === 'string' ? Date.parse(value + 'T00:00:00Z') : NaN;
        valid =
          typeof value === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          Number.isFinite(stamp) &&
          new Date(stamp).toISOString().slice(0, 10) === value;
        break;
      }
      case 'repeated': {
        const rr = rows(value, 100);
        unique(rr.map((r) => text(r.id)));
        break;
      }
      default:
        reject('FORM_FIELD_TYPE');
    }
    if (!valid) errors.push({ field: id, code: 'TYPE' });
    if (
      typeof value === 'number' &&
      ((f.min !== undefined && value < number(f.min)) || (f.max !== undefined && value > number(f.max)))
    )
      errors.push({ field: id, code: 'RANGE' });
  }
  for (const rule of rows(input.rules ?? [], 500)) {
    if (expression(rule.when, values, budget) === true && expression(rule.assert, values, budget) !== true)
      errors.push({ field: rule.field ?? null, code: text(rule.code ?? 'RULE_FAILED') });
  }
  const path: string[] = [];
  for (const p of rows(input.pages ?? [], 20)) {
    if (p.when === undefined || expression(p.when, values, budget) === true) path.push(text(p.id));
  }
  return {
    definitionDigest: digest({fields:input.fields,rules:input.rules??[],pages:input.pages??[]}),
    original,
    values,
    hidden,
    errors,
    path,
    passed: errors.length === 0,
    steps: 1000 - budget.remaining,
    digest: digest(values),
  };
}
export function computeForms(action: string, input: Data, signal?: AbortSignal): unknown {
  cancelled(signal);
  if(action==='fields.validate'||action==='schemas.check'){const prepared=prepare(input);return {passed:true,fields:prepared.fields.length,order:prepared.order,definitionDigest:digest({fields:input.fields,rules:input.rules??[],pages:input.pages??[]})};}
  if(action==='fixtures.generate'){
    const {fields}=prepare(input),count=integer(input.count??3,1,100);const examples=Array.from({length:count},(_,index)=>{const answers:Data={};for(const field of fields){if(field.compute!==undefined)continue;const id=text(field.id);answers[id]=field.default??(field.type==='text'?('sample-'+(index+1)).slice(0,integer(field.maxLength??4096,0,262144)):field.type==='enum'?list(field.values)[index%list(field.values).length]:field.type==='date'?'2026-01-01':field.type==='boolean'?index%2===0:field.type==='repeated'?[]:field.type==='integer'?Math.ceil(number(field.min??Math.min(0,number(field.max??0)))):number(field.min??Math.min(0,number(field.max??0))));}return {id:'fixture-'+(index+1),answers,...evaluate({...input,answers})};});return {examples,passed:examples.every(e=>e.passed),scope:'deterministic type/range fixtures; conditional business rules are evaluated, not assumed satisfied'};
  }
  if (action === 'logic.checkGraph') {
    const p = prepare(input);
    return { passed: true, order: p.order };
  }
  if (action === 'pages.checkReachability') {
    const pages = rows(input.pages, 20);
    const ids = pages.map((p) => text(p.id));
    unique(ids);
    const order = graph(pages.map((p) => ({ id: text(p.id), deps: p.autoNext ? [text(p.autoNext)] : [] })));
    return {
      passed: true,
      order,
      pages: ids,
      coverage: 'structural links only; conditional reachability requires examples',
    };
  }
  if (action === 'previews.answer'||action==='previews.open') return evaluate(input);
  if(action==='previews.navigate'){
    const result=evaluate(input),pages=rows(input.pages??[],20);unique(pages.map(p=>text(p.id)));
    const current=input.currentPageId===undefined?result.path[0]??null:text(input.currentPageId);
    if(current!==null&&!result.path.includes(current))reject('FORM_PAGE_NOT_VISIBLE');
    const index=current===null?-1:result.path.indexOf(current),direction=String(input.direction??'next');
    if(!['next','previous','goto'].includes(direction))reject('FORM_NAVIGATION_DIRECTION');
    const page=pages.find(p=>p.id===current),ids=new Set(list(page?.fields??[],200).map(v=>text(v)));
    const currentErrors=result.errors.filter(e=>e.field===null||!ids.size||ids.has(String(e.field)));
    const blocked=direction!=='previous'&&currentErrors.length>0;
    const requested=direction==='goto'?text(input.targetPageId):direction==='previous'?result.path[Math.max(0,index-1)]??null:result.path[index+1]??current;
    if(requested!==null&&!result.path.includes(requested))reject('FORM_PAGE_NOT_VISIBLE');
    const target=blocked?current:requested;
    return {...result,navigation:{direction,currentPageId:current,targetPageId:target,blocked,errors:currentErrors,atEnd:index===result.path.length-1,canSubmit:result.passed&&index===result.path.length-1}};
  }
  if (action === 'validations.run') {
    const examples = rows(input.examples, 2000);
    const outcomes = examples.map((e) => ({
      id: text(e.id),
      ...evaluate({ ...input, answers: object(e.answers) }),
    }));
    const expected = rows(input.pages ?? [], 20).map((p) => text(p.id));
    const visited = new Set(outcomes.flatMap((o) => o.path));
    return {
      definitionDigest:digest({fields:input.fields,rules:input.rules??[],pages:input.pages??[]}),
      passed: outcomes.length > 0 && outcomes.every((o) => o.passed),
      outcomes,
      coverage: { visited: [...visited], missing: expected.filter((id) => !visited.has(id)) },
    };
  }
  reject('CREATION_ACTION_UNSUPPORTED');
}
