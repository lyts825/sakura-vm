/** 第七批七个创作包的显式计算分派；fixed domain dispatch for the seven creation packs. */
import {
  type Data,
  type CreationTemplate,
  assertBytes,
  cancelled,
  digest,
  reject,
} from './seventh-creation-common.ts';
import { computeFeatures } from './seventh-creation-features.ts';
import { computeDesign } from './seventh-creation-design.ts';
import { computeForms } from './seventh-creation-forms.ts';
import { computeNotifications } from './seventh-creation-notifications.ts';
import { computeTraining } from './seventh-creation-training.ts';
import { computeSolver, validateIntegerModel } from './seventh-creation-solver.ts';
import { computeExtraction } from './seventh-creation-extraction.ts';
import { runCreationNative, type CreationNativeOptions } from './seventh-creation-native.ts';
import {EXTRA_SOLVER_ACTIONS,EXTRA_NOTIFICATION_ACTIONS,computeExtraSolver,computeExtraNotification} from './seventh-creation-extra.ts';
import {EXTRA_EXTRACTION_ACTIONS,computeExtraExtraction} from './seventh-creation-extra-extraction.ts';
import {EXTRA_DESIGN_ACTIONS,computeExtraDesign} from './seventh-creation-extra-design.ts';

export const SEVENTH_CREATION_ACTIONS: Record<string, readonly string[]> = {
  'feature-engineering-studio': [
    'schemas.validate',
    'partitions.checkOverlap',
    'transforms.checkGraph',
    'joins.checkCardinality',
    'windows.checkAvailability',
    'fits.fit',
    'fits.inspect',
    'selections.rank',
    'runs.start',
    'runs.run',
    'checks.evaluate',
  ],
  'classical-training-lab': [
    'targets.check',
    'estimators.validate',
    'partitions.checkOverlap',
    'searches.expand',
    'searches.freeze',
    'runs.start',
    'predictions.predict',
    'metrics.calculate',
    'metrics.slice',
    'comparisons.compare',
    'comparisons.select',
    'explanations.inspect',
    'explanations.explain',
  ],
  'constraint-solver-studio': [
    ...EXTRA_SOLVER_ACTIONS,
    'domains.validate',
    'objectives.validate',
    'constraints.checkTypes',
    'runs.start',
    'validation.verify',
    'conflicts.analyze',
  ],
  'document-extraction-studio': [
    ...EXTRA_EXTRACTION_ACTIONS,
    'pages.prepare',
    'ocr.start',
    'fields.extract',
    'tables.reconstruct',
    'corrections.apply',
  ],
  'design-system-studio': [
    ...EXTRA_DESIGN_ACTIONS,
    'tokens.resolve',
    'themes.validate',
    'icons.inspect',
    'states.checkCoverage',
    'builds.start',
    'checks.evaluate',
  ],
  'form-flow-studio': ['fields.validate','schemas.check','fixtures.generate','logic.checkGraph', 'pages.checkReachability', 'validations.run', 'previews.answer','previews.open','previews.navigate'],
  'notification-template-studio': [
    ...EXTRA_NOTIFICATION_ACTIONS,
    'templates.parse',
    'locales.checkCoverage',
    'audiences.generate',
    'rules.simulate',
    'renders.start',
    'inboxes.deliverLocal',
    'checks.evaluate',
  ],
};
export const CREATION_NATIVE_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  'classical-training-lab': ['runs.start', 'predictions.predict'],
  'constraint-solver-studio': ['runs.start'],
  'document-extraction-studio': ['pages.prepare', 'ocr.start'],
};
export async function computeSeventhCreation(
  packId: string,
  action: string,
  input: Data,
  signal?: AbortSignal,
  nativeOptions?: CreationNativeOptions,
): Promise<unknown> {
  cancelled(signal);
  assertBytes(input);
  if (!SEVENTH_CREATION_ACTIONS[packId]?.includes(action)) reject('CREATION_ACTION_UNSUPPORTED');
  if (packId === 'feature-engineering-studio') return computeFeatures(action, input, signal);
  if (packId === 'design-system-studio') return EXTRA_DESIGN_ACTIONS.includes(action)?computeExtraDesign(action,input,signal):computeDesign(action, input, signal);
  if (packId === 'form-flow-studio') return computeForms(action, input, signal);
  if (packId === 'notification-template-studio') return (EXTRA_NOTIFICATION_ACTIONS as readonly string[]).includes(action)?computeExtraNotification(action,input,signal):computeNotifications(action, input, signal);
  if (packId === 'classical-training-lab') {
    if (action === 'runs.start') {
      const result=await runCreationNative('train',input,signal,nativeOptions) as Data;
      const indices=result.trainingIndices as number[],matrix=input.X as unknown[],labels=input.y as unknown[]|undefined;
      return {...result,inputMatrixDigest:result.trainingDigest,trainingDigest:digest({indices,X:indices.map(index=>matrix[index]),y:labels?indices.map(index=>labels[index]):null}),trainingDigestAlgorithm:'sha256-canonical-json/1'};
    }
    if (action === 'predictions.predict') {
      const result=await runCreationNative('predict',input,signal,nativeOptions) as Data;
      return {...result,nativeModelDigest:result.modelDigest,modelDigest:digest(input.model)};
    }
    return computeTraining(action, input);
  }
  if (packId === 'constraint-solver-studio') {
    if((EXTRA_SOLVER_ACTIONS as readonly string[]).includes(action))return computeExtraSolver(action,input,signal);
    if (action === 'runs.start') {
      validateIntegerModel(input);
      const result = (await runCreationNative('solve', input, signal, nativeOptions)) as Data;
      if (result.assignment) {
        const verification = computeSolver('validation.verify', {
          ...input,
          assignment: result.assignment,
        }) as Data;
        if (!verification.passed) reject('SOLVE_NATIVE_ASSIGNMENT_INVALID');
        return { ...result, independentValidation: verification };
      }
      return result;
    }
    return computeSolver(action, input);
  }
  if (packId === 'document-extraction-studio') {
    if(EXTRA_EXTRACTION_ACTIONS.includes(action))return computeExtraExtraction(action,input,signal);
    if (action === 'pages.prepare')
      return runCreationNative('extract', { ...input, mode: 'text' }, signal, nativeOptions);
    if (action === 'ocr.start')
      return runCreationNative('extract', { ...input, mode: 'ocr' }, signal, nativeOptions);
    return computeExtraction(action, input);
  }
  reject('CREATION_PACK_UNSUPPORTED');
}

function tinyPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const content = 'BT /F1 24 Tf 30 100 Td (ORDER 1234) Tj ET';
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = out.length;
  out +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
      .join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out).toString('base64');
}
const exampleRows = [
  { id: 'a', amount: 1, kind: 'A' },
  { id: 'b', amount: 3, kind: 'B' },
  { id: 'c', amount: null, kind: 'A' },
  { id: 'd', amount: 1000, kind: 'C' },
];
const trainRows = {
  X: [[0], [1], [2], [3], [4], [5]],
  y: [1, 3, 5, 7, 9, 11],
  trainIndices: [0, 1, 2, 3],
  validationIndices: [4, 5],
};
export const SEVENTH_CREATION_TEMPLATES: Record<string, CreationTemplate[]> = {
  'feature-engineering-studio': [
    {
      id: 'numeric-category',
      name: '数值与类别基线',
      description: '仅使用训练成员拟合填充、缩放和词表。',
      domain: 'runs',
      method: 'start',
      input: {
        rows: exampleRows,
        partitions: { train: ['a', 'b', 'c'], validation: ['d'] },
        columns: [
          { name: 'amount', kind: 'numeric', fill: 'mean', standardize: true },
          { name: 'kind', kind: 'category' },
        ],
      },
    },
    {
      id: 'history',
      name: '实体历史特征',
      description: '同时核对事件发生时刻与可用时刻。',
      domain: 'windows',
      method: 'checkAvailability',
      input: {
        observations: [{ id: 'o', entity: 'a', at: '2026-01-03T00:00:00Z' }],
        events: [{ entity: 'a', at: '2026-01-02T00:00:00Z', availableAt: '2026-01-02T00:00:00Z', value: 3 }],
        lookbackMs: 172800000,
      },
    },
    {
      id: 'join',
      name: '多表静态特征',
      description: '核对维表键与关联后行数。',
      domain: 'joins',
      method: 'checkCardinality',
      input: {
        left: [
          { id: 'a', key: 1 },
          { id: 'b', key: 2 },
        ],
        right: [{ key: 1, label: 'A' }],
        key: 'key',
        cardinality: 'one-to-one',
      },
    },
  ],
  'classical-training-lab': [
    {
      id: 'regression',
      name: '数值回归',
      description: '真实训练线性回归并在固定验证集选择候选。',
      domain: 'runs',
      method: 'start',
      input: {
        ...trainRows,
        task: 'regression',
        candidates: [
          { id: 'linear', algorithm: 'linear' },
          { id: 'constant', algorithm: 'constant' },
        ],
      },
    },
    {
      id: 'classification',
      name: '二分类基线',
      description: '真实训练逻辑回归与限深树，保留混淆表。',
      domain: 'runs',
      method: 'start',
      input: {
        ...trainRows,
        y: [0, 0, 0, 1, 1, 1],
        task: 'classification',
        candidates: [
          { id: 'logistic', algorithm: 'logistic' },
          { id: 'tree', algorithm: 'tree', maxDepth: 2 },
        ],
      },
    },
    {
      id: 'clustering',
      name: '小型聚类',
      description: '固定种子产生可导出的聚类中心。',
      domain: 'runs',
      method: 'start',
      input: {
        X: [[0], [1], [2], [10], [11], [12]],
        trainIndices: [0, 1, 2, 3, 4, 5],
        task: 'clustering',
        seed: 7,
        candidates: [{ id: 'k2', algorithm: 'kmeans', k: 2 }],
      },
    },
  ],
  'constraint-solver-studio': [
    {
      id: 'allocation',
      name: '有限任务分配',
      description: '布尔分配必须覆盖任务且最小化成本。',
      domain: 'runs',
      method: 'start',
      input: {
        variables: [
          { id: 'a', min: 0, max: 1 },
          { id: 'b', min: 0, max: 1 },
        ],
        constraints: [{ terms: { a: 1, b: 1 }, op: 'eq', rhs: 1 }],
        objective: { terms: { a: 3, b: 2 }, direction: 'min' },
      },
    },
    {
      id: 'schedule',
      name: '固定时段排程',
      description: '有界开始时刻满足先后关系。',
      domain: 'runs',
      method: 'start',
      input: {
        variables: [
          { id: 'startA', min: 0, max: 5 },
          { id: 'startB', min: 0, max: 5 },
        ],
        constraints: [{ terms: { startB: 1, startA: -1 }, op: 'gte', rhs: 2 }],
        objective: { terms: { startB: 1 }, direction: 'min' },
      },
    },
    {
      id: 'combination',
      name: '资源组合选择',
      description: '在容量约束下最大化覆盖。',
      domain: 'runs',
      method: 'start',
      input: {
        variables: [
          { id: 'x', min: 0, max: 5 },
          { id: 'y', min: 0, max: 5 },
        ],
        constraints: [{ terms: { x: 2, y: 3 }, op: 'lte', rhs: 8 }],
        objective: { terms: { x: 3, y: 4 }, direction: 'max' },
      },
    },
  ],
  'document-extraction-studio': [
    {
      id: 'text-pdf',
      name: '文本层文档',
      description: '实际解析PDF页文本及原页坐标。',
      domain: 'pages',
      method: 'prepare',
      input: { format: 'pdf', dataBase64: tinyPdf() },
    },
    {
      id: 'scanned-page',
      name: '扫描页识别',
      description: '实际栅格化并调用固定英语OCR工具。',
      domain: 'ocr',
      method: 'start',
      input: { format: 'pdf', dataBase64: tinyPdf(), language: 'eng' },
    },
    {
      id: 'field',
      name: '固定字段提取',
      description: '字段值保留原文片段与页坐标。',
      domain: 'fields',
      method: 'extract',
      input: {
        pages: [
          { id: 'page-1', width: 300, height: 160, spans: [{ text: 'ORDER 1234', bbox: [30, 35, 200, 65] }] },
        ],
        fields: [{ id: 'order', pageId: 'page-1', anchor: 'ORDER', type: 'number' }],
      },
    },
  ],
  'design-system-studio': [
    {
      id: 'tokens',
      name: '基础令牌',
      description: '编译颜色、间距与语义别名。',
      domain: 'builds',
      method: 'start',
      input: {
        namespace: 'demo',
        tokens: [
          { id: 'blue', type: 'color', value: '#2255aa' },
          { id: 'primary', type: 'color', alias: 'blue' },
          { id: 'space', type: 'length', value: '8px' },
        ],
        components: [{ id: 'button', kind: 'button' }],
      },
    },
    {
      id: 'themes',
      name: '主题矩阵',
      description: '主题覆盖保留类型与引用检查。',
      domain: 'themes',
      method: 'validate',
      input: {
        tokens: [{ id: 'surface', type: 'color', value: '#ffffff' }],
        themes: [{ id: 'dark', overrides: { surface: '#111111' } }],
      },
    },
    {
      id: 'states',
      name: '组件状态',
      description: '逐项报告组件状态覆盖。',
      domain: 'states',
      method: 'checkCoverage',
      input: { required: ['normal', 'focus', 'disabled'], examples: ['normal', 'focus', 'disabled'] },
    },
  ],
  'form-flow-studio': [
    {
      id: 'simple',
      name: '基础录入',
      description: '字段类型、规范值和错误摘要。',
      domain: 'validations',
      method: 'run',
      input: {
        fields: [{ id: 'name', type: 'text', required: true, trim: true }],
        pages: [{ id: 'main' }],
        examples: [{ id: 'valid', answers: { name: ' Example ' } }],
      },
    },
    {
      id: 'branch',
      name: '条件申请',
      description: '声明条件分支与隐藏字段清除。',
      domain: 'previews',
      method: 'answer',
      input: {
        fields: [
          { id: 'business', type: 'boolean' },
          {
            id: 'company',
            type: 'text',
            required: true,
            visible: { op: 'eq', args: [{ field: 'business' }, true] },
            hidden: 'clear',
          },
        ],
        answers: { business: false, company: 'Old' },
        pages: [{ id: 'start' }, { id: 'company', when: { op: 'eq', args: [{ field: 'business' }, true] } }],
      },
    },
    {
      id: 'calculation',
      name: '有限明细计算',
      description: '计算字段按无环依赖求值。',
      domain: 'previews',
      method: 'answer',
      input: {
        fields: [
          { id: 'count', type: 'integer', min: 1 },
          { id: 'price', type: 'number', min: 0 },
          {
            id: 'total',
            type: 'number',
            compute: { op: 'multiply', args: [{ field: 'count' }, { field: 'price' }] },
          },
        ],
        answers: { count: 2, price: 3.5 },
        pages: [{ id: 'main' }],
      },
    },
  ],
  'notification-template-studio': [
    {
      id: 'status',
      name: '状态变化通知',
      description: '本地渲染固定变量，不调用任何消息服务。',
      domain: 'renders',
      method: 'start',
      input: {
        templates: [
          { id: 'status', locale: 'en', channel: 'text', body: '{{name}}: {{before}} -> {{after}}' },
        ],
        audiences: [
          {
            id: 'synthetic-1',
            locale: 'en',
            variables: { name: 'Task', before: 'queued', after: 'complete' },
          },
        ],
      },
    },
    {
      id: 'digest',
      name: '周期摘要样例',
      description: '检查长度、空状态与转义。',
      domain: 'renders',
      method: 'start',
      input: {
        templates: [
          { id: 'digest', locale: 'en', channel: 'html', body: '<p>{{title}}</p><strong>{{count}}</strong>' },
        ],
        audiences: [{ id: 'synthetic-1', locale: 'en', variables: { title: '<sample>', count: 3 } }],
      },
    },
    {
      id: 'locales',
      name: '多语言提示',
      description: '保留语言覆盖与回退缺项。',
      domain: 'locales',
      method: 'checkCoverage',
      input: { required: ['en', 'zh-CN'], present: ['en', 'zh-CN'] },
    },
  ],
};
