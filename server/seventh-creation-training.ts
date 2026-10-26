/** 固定模型的分区、指标与选择；validates partitions and computes finite training metrics. */
import {
  type Data,
  digest,
  integer,
  list,
  mean,
  number,
  object,
  reject,
  rows,
  strings,
  text,
  unique,
} from './seventh-creation-common.ts';

export function computeTraining(action: string, input: Data): unknown {
  if (action === 'targets.check') {
    const task = text(input.task);
    if (!['regression', 'classification', 'clustering'].includes(task)) reject('TRAIN_TASK');
    const labels = list(input.labels ?? input.y ?? [], 50000);
    if (task === 'clustering') return { passed: true, task, labelsRequired: false };
    if (!labels.length) reject('TRAIN_LABELS_REQUIRED');
    if (task === 'regression') labels.forEach((v) => number(v));
    else if(labels.some(v=>!['number','string'].includes(typeof v)||typeof v!==typeof labels[0]||(typeof v==='number'&&!Number.isFinite(v))))reject('TRAIN_LABEL_TYPE');
    return {
      passed: true,
      task,
      count: labels.length,
      classes: task === 'classification' ? [...new Set(labels)] : null,
    };
  }
  if (action === 'estimators.validate') {
    const task = text(input.task);
    const estimators = rows(input.candidates ?? input.estimators, 32);
    if (!estimators.length) reject('TRAIN_EMPTY_CANDIDATES');
    for (const candidate of estimators) {
      const name = text(candidate.algorithm);
      const allowed =
        task === 'regression'
          ? ['constant', 'linear', 'ridge']
          : task === 'classification'
            ? ['constant', 'logistic', 'tree']
            : task === 'clustering'
              ? ['kmeans']
              : [];
      if (!allowed.includes(name)) reject('TRAIN_ALGORITHM_TASK');
      if (name === 'ridge') number(candidate.alpha ?? 1, 0);
      if (name === 'logistic') number(candidate.C ?? 1, Number.MIN_VALUE);
      if (name === 'logistic') integer(candidate.maxIterations ?? 1000, 1, 1000);
      if (name === 'tree') integer(candidate.maxDepth ?? 4, 1, 16);
      if (name === 'kmeans') integer(candidate.k ?? 2, 2, 32);
    }
    return { passed: true, task, count: estimators.length, digest: digest(estimators) };
  }
  if (action === 'partitions.checkOverlap') {
    const partitions = object(input.partitions);
    const seen = new Map<string, string>();
    const overlaps: Data[] = [];
    for (const [name, ids] of Object.entries(partitions))
      for (const id of strings(ids)) {
        if (seen.has(id)) overlaps.push({ id, partitions: [seen.get(id), name] });
        else seen.set(id, name);
      }
    if (input.groups) {
      const groups = object(input.groups);
      const assigned = new Map<string, string>();
      for (const [id, p] of seen) {
        const group = text(groups[id]);
        if (assigned.has(group) && assigned.get(group) !== p)
          overlaps.push({ entity: group, partitions: [assigned.get(group), p] });
        else assigned.set(group, p);
      }
    }
    return { passed: overlaps.length === 0, overlaps, assigned: seen.size };
  }
  if (action === 'searches.expand' || action === 'searches.freeze') {
    const definitions = rows(input.candidates, 32);
    if (!definitions.length) reject('TRAIN_EMPTY_CANDIDATES');
    const candidates:Data[]=[];
    for(const [index,definition]of definitions.entries()){
      const grid=object(definition.grid??{}),algorithm=text(definition.algorithm),allowed:Record<string,string[]>={constant:[],linear:[],ridge:['alpha'],logistic:['C','maxIterations'],tree:['maxDepth'],kmeans:['k']};if(!allowed[algorithm])reject('TRAIN_ALGORITHM_TASK');
      let combinations:Data[]=[{}];for(const [key,raw]of Object.entries(grid)){if(!allowed[algorithm].includes(key))reject('TRAIN_GRID_PARAMETER');const values=list(raw,16);if(!values.length)reject('TRAIN_GRID_EMPTY');if(combinations.length*values.length>32)reject('TRAIN_EXPANDED_LIMIT');combinations=combinations.flatMap(c=>values.map(value=>({...c,[key]:value})));}
      for(const [offset,parameters]of combinations.entries()){const {grid:_,...base}=definition;candidates.push({...base,...parameters,id:String(definition.id??index)+(combinations.length>1?'-'+(offset+1):'')});if(candidates.length>32)reject('TRAIN_EXPANDED_LIMIT');}
    }
    unique(candidates.map(c=>text(c.id)));for(const candidate of candidates){const task=input.task??(['logistic','tree'].includes(String(candidate.algorithm))?'classification':candidate.algorithm==='kmeans'?'clustering':'regression');computeTraining('estimators.validate',{task,candidates:[candidate]});}
    const folds = integer(input.folds ?? 1, 1, 5);
    const trainingCount=candidates.length*(folds>1?folds+1:1);
    if (trainingCount > 80) reject('TRAIN_EXPANDED_LIMIT');
    return {
      candidates: candidates.map((c, i) => ({ ...c, id: c.id ?? String(i) })),
      folds,
      trainingCount,
      digest: digest(input),
    };
  }
  if (action === 'metrics.calculate' || action === 'metrics.slice') {
    const actual = list(input.actual, 50000),
      predicted = list(input.predicted, 50000);
    if (!actual.length || actual.length !== predicted.length) reject('TRAIN_METRIC_INPUT');
    if (input.task === 'regression') {
      const residuals = actual.map((a, i) => number(predicted[i]) - number(a));
      return {
        count: actual.length,
        mse: mean(residuals.map((r) => r * r)),
        mae: mean(residuals.map(Math.abs)),
        residuals,
      };
    }
    if(input.task!=='classification')reject('TRAIN_METRIC_TASK');
    const labels=[...actual,...predicted],labelType=typeof labels[0];if(!['string','number'].includes(labelType)||labels.some(v=>typeof v!==labelType||(typeof v==='number'&&!Number.isFinite(v))))reject('TRAIN_LABEL_TYPE');
    const classes=[...new Set(labels as (string|number)[])].sort((a,b)=>typeof a==='number'&&typeof b==='number'?a-b:String(a)<String(b)?-1:String(a)>String(b)?1:0);if(classes.length>256)reject('TRAIN_CLASS_LIMIT');
    const indices=new Map(classes.map((c,i)=>[c,i])),confusion=classes.map(()=>classes.map(()=>0));for(let i=0;i<actual.length;i++)confusion[indices.get(actual[i] as string|number)!][indices.get(predicted[i] as string|number)!]++;
    const perClass=classes.map((label,index)=>{const support=confusion[index].reduce((a,b)=>a+b,0),predictedCount=confusion.reduce((sum,row)=>sum+row[index],0),correct=confusion[index][index],precision=predictedCount?correct/predictedCount:0,recall=support?correct/support:0;return {label,support,predictedCount,precision,recall,f1:precision+recall?2*precision*recall/(precision+recall):0};});
    return {
      count: actual.length,
      accuracy: actual.reduce<number>((n, v, i) => n + (v === predicted[i] ? 1 : 0), 0) / actual.length,
      classes,
      confusion,
      perClass,
    };
  }
  if (action === 'comparisons.compare' || action === 'comparisons.select') {
    const metric = text(input.metric);
    const direction = input.direction === 'max' ? -1 : 1;
    const candidates = rows(input.candidates, 32);
    const ranked = candidates
      .map((c) => ({ id: text(c.id), value: number(object(c.metrics)[metric]) }))
      .sort((a, b) => direction * (a.value - b.value) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (!ranked.length) reject('TRAIN_EMPTY_CANDIDATES');
    return {
      ranking: ranked,
      selectedId: ranked[0].id,
      metric,
      selectionPartition: 'validation',
      testUsedForSelection: false,
    };
  }
  if (action === 'explanations.inspect' || action === 'explanations.explain') {
    const model = object(input.model);
    const algorithm = text(model.algorithm);
    if(!['linear','ridge','logistic','tree','kmeans','constant'].includes(algorithm))reject('TRAIN_MODEL_ALGORITHM');
    if (['linear', 'ridge', 'logistic'].includes(algorithm))
      {if(model.coefficients===undefined||model.intercept===undefined)reject('TRAIN_MODEL_PARAMETERS');return {
        algorithm,
        coefficients: model.coefficients,
        intercept: model.intercept,
        scope: 'model parameters; no causal interpretation',
      };}
    if (algorithm === 'tree')
      return { algorithm, nodes: rows(model.nodes, 100000), scope: 'fixed tree structure' };
    if (algorithm === 'kmeans')
      return {
        algorithm,
        centers: list(model.centers, 32).map((row) => list(row, 256).map((value) => number(value))),
        scope: 'cluster center coordinates',
      };
    if(model.constant===undefined)reject('TRAIN_MODEL_PARAMETERS');return { algorithm, constant: model.constant, scope: 'constant baseline' };
  }
  reject('CREATION_ACTION_UNSUPPORTED');
}
