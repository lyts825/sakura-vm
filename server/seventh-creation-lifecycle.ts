/** 固定修订上的版本、登记与人工复核；builds immutable versions without rewriting machine evidence. */
import {
  isSuiteJsonBounded,
  suiteRecord,
  type SuiteJson,
  type SuiteRecord,
  type SuiteRef,
} from '../shared/contracts/suite-common.ts';
import { type Data, digest, integer, list, object, reject, rows, text } from './seventh-creation-common.ts';
import catalog from '../shared/seventh-catalog.json';

export type CreationLifecycleResult = {
  kind: 'definition' | 'review' | 'result';
  content: SuiteJson;
  references: SuiteRef[];
  seal: boolean;
};
export const SEVENTH_CREATION_LIFECYCLE_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  'feature-engineering-studio': [
    'artifacts.assemble',
    'artifacts.seal',
    'artifacts.compare',
    'reviews.review',
    'reviews.decide',
  ],
  'classical-training-lab': [
    'registry.register',
    'registry.seal',
    'registry.compare',
    'reports.assemble',
    'reports.review',
    'reports.seal',
  ],
  'constraint-solver-studio': [
    'decisions.review',
    'decisions.decide',
    'decisions.seal',
    'sensitivity.compare',
  ],
  'document-extraction-studio': ['datasets.assemble', 'datasets.seal', 'reviews.review', 'reviews.decide'],
  'design-system-studio': ['reviews.review', 'reviews.decide', 'reviews.seal'],
  'form-flow-studio': [
    'submissions.capture',
    'versions.assemble',
    'versions.seal',
    'versions.diff',
    'reviews.review',
    'reviews.decide',
  ],
  'notification-template-studio': ['releases.assemble', 'releases.review', 'releases.seal'],
};
const pin = (record: SuiteRecord): SuiteRef => ({
  domain: record.domain,
  id: record.id,
  revision: record.revision,
});
function recordContent(record: SuiteRecord) {
  return object(record.content, 'CREATION_EVIDENCE_CONTENT');
}
function resultOutput(record: SuiteRecord, packId: string) {
  if (record.kind !== 'result') reject('CREATION_RESULT_REQUIRED');
  const c = recordContent(record);
  if (c.format !== 'sakura-seventh-result/1' || c.packId !== packId) reject('CREATION_RESULT_FORMAT');
  if (c.state !== 'completed') reject('CREATION_EXECUTION_NOT_COMPLETED');
  if (record.origin !== 'local') reject('CREATION_LOCAL_EXECUTION_REQUIRED');
  return object(c.output, 'CREATION_RESULT_OUTPUT');
}
function localResult(records: readonly SuiteRecord[], domain: string, packId: string) {
  const found = records.filter(
    (r) =>
      r.domain === domain && r.kind === 'result' && recordContent(r).format === 'sakura-seventh-result/1',
  );
  if (found.length !== 1) reject('CREATION_SINGLE_RESULT_REQUIRED');
  const record = found[0];
  return { record, output: resultOutput(record, packId) };
}
function machineFacts(records: readonly SuiteRecord[]) {
  return records
    .filter((r) => r.kind === 'result')
    .map((record) => {
      const c = recordContent(record);
      const output =
        c.output && typeof c.output === 'object' && !Array.isArray(c.output) ? object(c.output) : {};
      return {
        reference: pin(record),
        origin: record.origin,
        executionState: c.state ?? 'unspecified',
        businessConclusion:
          typeof output.passed === 'boolean' ? (output.passed ? 'passed' : 'failed') : 'not-evaluated',
        reportedState: typeof output.state === 'string' ? output.state : null,
        coverage: output.coverage ?? null,
        cleanup:
          output.execution && typeof output.execution === 'object'
            ? (object(output.execution).cleanup ?? null)
            : null,
      };
    });
}
function modelSummary(value: unknown) {
  const model = object(value, 'CREATION_MODEL_REQUIRED');
  if (
    model.schemaVersion !== 1 ||
    !['constant', 'linear', 'ridge', 'logistic', 'tree', 'kmeans'].includes(text(model.algorithm))
  )
    reject('CREATION_MODEL_FORMAT');
  if (!isSuiteJsonBounded(model)) reject('CREATION_MODEL_JSON');
  const pre = object(model.preprocessing);
  const means = list(pre.means, 256),
    centers = list(pre.centers, 256),
    scales = list(pre.scales, 256);
  if (
    !means.length ||
    means.length !== centers.length ||
    means.length !== scales.length ||
    scales.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
  )
    reject('CREATION_MODEL_PREPROCESSING');
  if (model.algorithm === 'tree') {
    const nodes = rows(model.nodes, 100000);
    if (!nodes.length) reject('CREATION_MODEL_TREE');
    const done = new Set<number>(),
      active = new Set<number>();
    const visit = (index: number) => {
      if (active.has(index)) reject('CREATION_MODEL_TREE_CYCLE');
      if (done.has(index)) return;
      if (index < 0 || index >= nodes.length) reject('CREATION_MODEL_TREE_REFERENCE');
      active.add(index);
      const node = nodes[index];
      const left = integer(node.left, -1, nodes.length - 1),
        right = integer(node.right, -1, nodes.length - 1);
      if ((left === -1) !== (right === -1)) reject('CREATION_MODEL_TREE_REFERENCE');
      if (left !== -1) {
        integer(node.feature, 0, means.length - 1);
        visit(left);
        visit(right);
      }
      active.delete(index);
      done.add(index);
    };
    visit(0);
  }
  return {
    algorithm: model.algorithm,
    task: model.task ?? null,
    inputFeatures: means.length,
    modelDigest: digest(model),
    format: 'sakura-classical-model/1',
    executableContent: false,
  };
}
function decision(input: Data, required: boolean) {
  const choice = input.decision ?? (required ? null : 'pending');
  if (!['pending', 'accept', 'reject', 'request-changes'].includes(String(choice)))
    reject('CREATION_REVIEW_DECISION');
  const note = text(input.note ?? '', 10000);
  if (required && !note.trim()) reject('CREATION_REVIEW_REASON_REQUIRED');
  return { decision: choice, note };
}
function accepted(input: Data, records: readonly SuiteRecord[]) {
  if (input.decision === 'accept') {
    decision(input, true);
    return true;
  }
  const targets = records.filter(
    (r) => r.kind === 'result' && recordContent(r).format === 'sakura-seventh-result/1',
  );
  return (
    targets.length > 0 &&
    records.some(
      (r) =>
        r.kind === 'review' &&
        r.origin === 'local' &&
        recordContent(r).decision === 'accept' &&
        targets.every((target) =>
          r.references.some(
            (reference) =>
              reference.domain === target.domain &&
              reference.id === target.id &&
              reference.revision === target.revision,
          ),
        ),
    )
  );
}
export function computeSeventhCreationLifecycle(
  packId: string,
  action: string,
  input: Data,
  rawRecords: readonly SuiteRecord[],
): CreationLifecycleResult {
  if (!SEVENTH_CREATION_LIFECYCLE_ACTIONS[packId]?.includes(action)) reject('CREATION_LIFECYCLE_ACTION');
  if (!Array.isArray(rawRecords) || rawRecords.length < 1 || rawRecords.length > 1000)
    reject('CREATION_LIFECYCLE_REFERENCES_REQUIRED');
  const domains = new Set(
    catalog.find((pack) => pack.id === packId)?.members.map((member) => member.id) ?? [],
  );
  const records = rawRecords.map((r) => suiteRecord.parse(r));
  const workspace = records[0].workspaceId;
  for (const record of records) {
    if (!domains.has(record.domain)) reject('CREATION_REFERENCE_PACKAGE');
    if (record.workspaceId !== workspace) reject('CREATION_REFERENCE_WORKSPACE');
    if (record.state === 'draft') reject('CREATION_FIXED_SEALED_REFERENCE_REQUIRED');
  }
  if (input.workspaceId !== undefined && input.workspaceId !== workspace)
    reject('CREATION_REFERENCE_WORKSPACE');
  const references = [...new Map(records.map((r) => [`${r.domain}/${r.id}/${r.revision}`, pin(r)])).values()];
  const facts = machineFacts(records);
  const base = {
    format: 'sakura-seventh-lifecycle/1',
    schemaVersion: 1,
    packId,
    action,
    workspaceId: workspace,
    machineFacts: facts,
    sourceCount: references.length,
    evidenceDigest: digest(references),
  };
  const build = (
    kind: CreationLifecycleResult['kind'],
    content: Data,
    seal = false,
  ): CreationLifecycleResult => {
    const value = { ...base, ...content };
    if (!isSuiteJsonBounded(value)) reject('CREATION_LIFECYCLE_CONTENT_LIMIT');
    return { kind, content: value, references, seal };
  };
  const compare = action.endsWith('.compare') || action.endsWith('.diff');
  if (compare) {
    if (records.length !== 2) reject('CREATION_COMPARISON_TWO_FIXED_RECORDS');
    const [left, right] = records;
    const a = recordContent(left),
      b = recordContent(right);
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return build(
      'result',
      {
        left: pin(left),
        right: pin(right),
        sameContent: digest(a) === digest(b),
        changedKeys: keys.filter((key) => digest(a[key] ?? null) !== digest(b[key] ?? null)),
        conditionsEqual: a.inputDigest !== undefined && a.inputDigest === b.inputDigest,
        scope: 'two fixed records; changed conditions remain visible',
      },
      true,
    );
  }
  if (packId === 'feature-engineering-studio' && action.startsWith('artifacts.')) {
    const { record, output } = localResult(records, 'feat-runs', packId);
    const fitted = object(output.fit);
    const parameters = rows(fitted.parameters, 500);
    if (fitted.digest !== digest(parameters)) reject('CREATION_FEATURE_FIT_DIGEST');
    const outputRows = rows(output.rows, 100000),
      columns = list(output.columns, 2000);
    if (!columns.length || output.outputDigest !== digest(outputRows))
      reject('CREATION_FEATURE_MATRIX_DIGEST');
    return build(
      'definition',
      {
        versionType: 'feature-artifact',
        generation: pin(record),
        trainingDigest: fitted.trainingDigest,
        parameterDigest: fitted.digest,
        matrixDigest: output.outputDigest,
        rows: outputRows.length,
        columns: columns.length,
        upstreamScope: 'only supplied fixed feature evidence',
        readiness:
          output.unknowns && list(output.unknowns).length ? 'contains-unknown-categories' : 'generated',
      },
      action.endsWith('.seal'),
    );
  }
  if (packId === 'classical-training-lab' && action.startsWith('registry.')) {
    const { record, output } = localResult(records, 'ctrain-runs', packId);
    const execution = object(output.execution);
    if (execution.backend !== 'windows-appcontainer-job' || execution.cleanup !== 'confirmed')
      reject('CREATION_NATIVE_TRAINING_EVIDENCE');
    const candidates = rows(output.candidates, 32);
    const id = text(input.candidateId ?? output.selectedId);
    const selected = candidates.filter((c) => c.id === id);
    if (selected.length !== 1 || selected[0].state !== 'completed') reject('CREATION_SELECTED_MODEL');
    const summary = modelSummary(selected[0].model);
    return build(
      'definition',
      {
        versionType: 'classical-model-registration',
        training: pin(record),
        candidateId: id,
        ...summary,
        modelLocation: { reference: pin(record), candidateId: id },
        selectionScope: 'recorded training/validation members',
        endToEndLeakage: 'not-verified-for-external-features',
        runtimePermission: false,
      },
      action.endsWith('.seal'),
    );
  }
  if (packId === 'classical-training-lab' && action === 'reports.assemble') {
    localResult(records, 'ctrain-runs', packId);
    return build(
      'result',
      {
        reportType: 'training',
        selectionClaims: 'fixed evidence only',
        endToEndLeakage: 'upstream provenance required',
        exceptions: rows(input.exceptions ?? [], 100),
        limitations: text(input.limitations ?? '', 10000),
      },
      false,
    );
  }
  if (packId === 'classical-training-lab' && action === 'reports.seal') {
    localResult(records, 'ctrain-runs', packId);
    return build(
      'result',
      {
        reportType: 'training',
        frozen: true,
        humanDecision: input.decision ?? 'not-recorded',
        originalFailuresPreserved: true,
      },
      true,
    );
  }
  if (packId === 'document-extraction-studio' && action.startsWith('datasets.')) {
    const fieldRows = records.filter(
      (r) =>
        r.domain === 'dextract-fields' ||
        r.domain === 'dextract-tables' ||
        r.domain === 'dextract-corrections',
    );
    if (!fieldRows.length) reject('CREATION_EXTRACTION_RESULT_REQUIRED');
    const outputs = fieldRows.map((r) => ({ reference: pin(r), output: resultOutput(r, packId) }));
    const sources = records.filter(
      (r) => r.domain === 'dextract-sources' || r.domain === 'dextract-pages' || r.domain === 'dextract-ocr',
    );
    return build(
      'definition',
      {
        versionType: 'extracted-dataset',
        components: outputs.map((x) => ({ reference: x.reference, contentDigest: digest(x.output) })),
        sourceCoverage: sources.length ? 'fixed-referenced-pages' : 'original-pages-not-included',
        originalCorrectness: 'requires-source-review',
        unresolved: rows(input.unresolved ?? [], 1000),
      },
      action.endsWith('.seal'),
    );
  }
  if (packId === 'form-flow-studio' && action === 'submissions.capture') {
    const { record, output } = localResult(records, 'fform-previews', packId);
    if (!output.values || !Array.isArray(output.errors)) reject('CREATION_PREVIEW_EVIDENCE');
    return build(
      'result',
      {
        submissionType: 'local-preview-sample',
        preview: pin(record),
        values: output.values,
        errors: output.errors,
        path: output.path ?? [],
        synthetic: input.synthetic === true ? 'user-declared' : 'not-asserted',
        publicSubmission: false,
        passed: output.passed === true,
      },
      true,
    );
  }
  if (packId === 'form-flow-studio' && action.startsWith('versions.')) {
    const { record, output } = localResult(records, 'fform-validations', packId);
    const outcomes = rows(output.outcomes, 2000);
    if (!outcomes.length) reject('CREATION_FORM_EXAMPLES_REQUIRED');
    const definitions = records.filter((r) =>
      ['fform-fields', 'fform-schemas', 'fform-logic', 'fform-pages', 'fform-fixtures'].includes(r.domain),
    );
    if (!definitions.length) reject('CREATION_FORM_DEFINITION_REFERENCES_REQUIRED');
    const bindingComplete = definitions.every((definition) =>
      record.references.some(
        (reference) =>
          reference.domain === definition.domain &&
          reference.id === definition.id &&
          reference.revision === definition.revision,
      ),
    );
    const fieldDefinition=definitions.find(r=>r.domain==='fform-fields');
    const fieldData=fieldDefinition?recordContent(fieldDefinition):{};
    const logic=definitions.find(r=>r.domain==='fform-logic'),pages=definitions.find(r=>r.domain==='fform-pages');
    const definitionDigest=Array.isArray(fieldData.fields)?digest({fields:fieldData.fields,rules:logic?recordContent(logic).rules??[]:fieldData.rules??[],pages:pages?recordContent(pages).pages??[]:fieldData.pages??[]}):null;
    const matched=bindingComplete&&definitionDigest!==null&&definitionDigest===output.definitionDigest;
    if (action.endsWith('.seal') && !matched) reject('CREATION_FORM_VALIDATION_BINDING_REQUIRED');
    return build(
      'definition',
      {
        versionType: 'form-definition',
        definitions: definitions.map(pin),
        validation: pin(record),
        definitionValidationBinding: matched ? 'fixed-references-and-definition-match' : 'not-proven',
        definitionDigest,
        coverage: output.coverage ?? null,
        exampleCount: outcomes.length,
        examplesPassed: output.passed === true,
        allInputsProven: false,
        publicEndpoint: false,
      },
      action.endsWith('.seal'),
    );
  }
  if (packId === 'notification-template-studio' && action === 'releases.assemble') {
    const { record, output } = localResult(records, 'ntpl-renders', packId);
    const rendered = rows(output.results, 5000);
    if (!rendered.length) reject('CREATION_NOTIFICATION_RENDER_REQUIRED');
    return build(
      'definition',
      {
        versionType: 'notification-template',
        rendering: pin(record),
        renderCount: rendered.length,
        failed: rendered.filter((r) => r.state !== 'rendered').length,
        fallbackCount: rendered.filter((r) => r.fallback === true).length,
        externalDelivery: false,
        formatterVersion: output.formatterVersion ?? null,
        referenceTime: input.referenceTime ?? null,
      },
      false,
    );
  }
  if (packId === 'notification-template-studio' && action === 'releases.seal') {
    if (!accepted(input, records)) reject('CREATION_ACCEPTED_REVIEW_REQUIRED');
    const render = localResult(records, 'ntpl-renders', packId);
    const outputs = rows(render.output.results, 5000);
    const failed = outputs.filter((r) => r.state !== 'rendered').length;
    const exceptions = rows(input.exceptions ?? [], 100);
    if (
      failed &&
      (!exceptions.length || exceptions.some((exception) => !text(exception.reason ?? '', 10000).trim()))
    )
      reject('CREATION_NOTIFICATION_FAILURE_EXCEPTIONS_REQUIRED');
    return build(
      'definition',
      {
        versionType: 'notification-template-release',
        rendering: pin(render.record),
        decision: 'accept',
        failedRenders: failed,
        exceptions,
        readiness: failed ? 'accepted-with-known-failures' : 'accepted',
        externalDelivery: false,
      },
      true,
    );
  }
  if (packId === 'design-system-studio' && action === 'reviews.seal') {
    if (!accepted(input, records)) reject('CREATION_ACCEPTED_REVIEW_REQUIRED');
    const { record, output } = localResult(records, 'dsys-builds', packId);
    const files = rows(output.files, 1000);
    if (!files.length) reject('CREATION_DESIGN_OUTPUT_REQUIRED');
    return build(
      'review',
      {
        decision: 'accept',
        build: pin(record),
        outputs: files.map((f) => ({ path: text(f.path), digest: digest(text(f.text)) })),
        scope: 'fixed compiled CSS and component declarations',
        layoutMeasured: false,
        note: text(input.note ?? '', 10000),
      },
      true,
    );
  }
  if (packId === 'constraint-solver-studio' && action.startsWith('decisions.')) {
    const { record, output } = localResult(records, 'csolve-runs', packId);
    const review = decision(input, action.endsWith('.decide') || action.endsWith('.seal'));
    if (review.decision === 'accept' && (!output.assignment || output.verified !== true))
      reject('CREATION_VERIFIED_SOLUTION_REQUIRED');
    return build(
      'review',
      {
        ...review,
        solution: pin(record),
        solverState: output.state ?? 'unknown',
        optimality: output.state === 'optimal' ? 'solver-stated-with-recorded-tool' : 'not-proven',
        realWorldExecution: false,
      },
      action.endsWith('.seal') || action.endsWith('.decide'),
    );
  }
  const domain = action.split('.')[0];
  const isReview = ['reviews', 'reports', 'releases'].includes(domain);
  if (isReview) {
    const review = decision(input, action.endsWith('.decide'));
    return build(
      'review',
      {
        ...review,
        originalFailuresPreserved: true,
        exceptions: rows(input.exceptions ?? [], 100),
        scope: text(input.scope ?? 'only fixed referenced evidence', 10000),
      },
      action.endsWith('.decide'),
    );
  }
  reject('CREATION_LIFECYCLE_ACTION');
}
