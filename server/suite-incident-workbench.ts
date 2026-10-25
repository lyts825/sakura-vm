/** 有界工作台投影；领域服务始终保留各自的读取授权与提供者身份。 */
import type { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import * as S from '../shared/contracts/suite-common.ts';
import * as I from '../shared/contracts/incident-desk.ts';
import * as W from '../shared/contracts/incident-workbench.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { SuiteStore, suiteFail, type SuiteAuthorize } from './suite-store.ts';
import type {
  IncidentCasesV1,
  IncidentEvidenceV1,
  IncidentTimelineV1,
  IncidentActionsV1,
} from './service-contracts/incident-desk.ts';
import type { IncidentWorkbenchV1 } from './service-contracts/incident-workbench.ts';

export type IncidentWorkbenchPorts = {
  cases: IncidentCasesV1;
  evidence: IncidentEvidenceV1;
  timeline: IncidentTimelineV1;
  hypotheses: S.SuiteRecordsV1;
  runbooks: S.SuiteRecordsV1;
  actions: IncidentActionsV1;
  reviews: S.SuiteRecordsV1;
  reports: S.SuiteRecordsV1;
  exchange: S.SuiteRecordsV1;
};
const templates: W.IncidentWorkbenchTemplate[] = W.incidentWorkbenchTemplates.parse([
  {
    id: 'application-startup-failure',
    name: '应用启动失败',
    description: '先核对实际影响及启动输出，再整理时间线和人工假设；下列影响描述需要替换为实际情况。',
    open: {
      name: '应用启动失败',
      impact: '待补充：记录实际受影响的应用、用户与首次观察时间。',
      severity: 'moderate',
      affected: [],
    },
    steps: [
      { stage: 'scope', instruction: '核对实际影响、严重程度和受影响对象后创建案例。', requiresHuman: true },
      {
        stage: 'evidence',
        instruction: '上传实际启动输出，或在提供者可用时另行预览并批准只读健康采集；保留原始材料。',
        requiresHuman: true,
      },
      {
        stage: 'timeline',
        instruction: '为拟交接材料生成脱敏副本，全文人工审阅后按选定证据整理时间线。',
        requiresHuman: true,
      },
      {
        stage: 'hypothesis',
        instruction: '将配置、依赖或权限等解释记为人工假设，并链接支持与反对事件。',
        requiresHuman: true,
      },
      {
        stage: 'action',
        instruction: '记录实际人工处置；需要系统处置时另行预览原提供者方案并明确批准。',
        requiresHuman: true,
      },
      {
        stage: 'review',
        instruction: '核对选定窗口、时钟不确定性和未决项，再人工审阅并封存报告。',
        requiresHuman: true,
      },
    ],
    suggestedOnly: true,
    evidenceCreated: false,
    automaticExecution: false,
  },
  {
    id: 'capacity-exhausted',
    name: '容量耗尽',
    description: '先用实际容量记录确认影响，再评估原清理提供者候选；模板不清理文件。',
    open: {
      name: '容量耗尽',
      impact: '待补充：记录实际空间不足的位置、失败操作与受影响范围。',
      severity: 'moderate',
      affected: [],
    },
    steps: [
      {
        stage: 'scope',
        instruction: '核对实际失败操作、存储位置和影响范围后创建案例。',
        requiresHuman: true,
      },
      {
        stage: 'evidence',
        instruction: '保存真实容量或失败日志；可另行预览并批准指标采集，不把容量高直接当作根因。',
        requiresHuman: true,
      },
      {
        stage: 'timeline',
        instruction: '为拟交接材料脱敏并全文审阅，整理空间变化与失败事件，保留跨来源顺序不确定性。',
        requiresHuman: true,
      },
      {
        stage: 'action',
        instruction: '确认备份块或任务日志的候选、保留要求与预估回收量，再另行批准原清理提供者方案。',
        requiresHuman: true,
      },
      {
        stage: 'hypothesis',
        instruction: '核对原提供者回执和实际恢复情况，将尚未证实的解释列入人工假设。',
        requiresHuman: true,
      },
      {
        stage: 'handoff',
        instruction: '说明已回收量、未决项和当前许可，人工审阅封存后预览脱敏交接。',
        requiresHuman: true,
      },
    ],
    suggestedOnly: true,
    evidenceCreated: false,
    automaticExecution: false,
  },
  {
    id: 'drill-interrupted',
    name: '演练中断',
    description: '记录真实演练状态，优先核对原运行的隔离与清理；不把请求返回当作资源核销完成。',
    open: {
      name: '演练中断',
      impact: '待补充：记录实际中断的运行、当前隔离状态与受影响对象。',
      severity: 'moderate',
      affected: [],
    },
    steps: [
      {
        stage: 'scope',
        instruction: '核对真实运行及影响范围，区分计划取消、请求中断与资源仍未清理。',
        requiresHuman: true,
      },
      {
        stage: 'evidence',
        instruction: '保存原运行状态和日志；只使用实际观察到的材料，不补造执行或清理证明。',
        requiresHuman: true,
      },
      {
        stage: 'action',
        instruction: '核对原演练提供者和运行标识，另行预览并批准核销方案；未知时保留待核销状态。',
        requiresHuman: true,
      },
      {
        stage: 'timeline',
        instruction: '将计划、观察和提供者回执分别列入选定窗口；交接材料先脱敏并全文审阅。',
        requiresHuman: true,
      },
      {
        stage: 'review',
        instruction: '人工核对隔离、清理及结果声明，未确认项明确保留，不推断完成。',
        requiresHuman: true,
      },
      {
        stage: 'handoff',
        instruction: '封存报告后预览脱敏交接，接收方只能读取来源声明，须自行重新授权任何执行。',
        requiresHuman: true,
      },
    ],
    suggestedOnly: true,
    evidenceCreated: false,
    automaticExecution: false,
  },
]);
const ref = (row: S.SuiteRecord): S.SuiteRef => ({ domain: row.domain, id: row.id, revision: row.revision });
function recordSummary(row: S.SuiteRecord): W.IncidentWorkbenchRecord {
  const content =
    row.content && typeof row.content === 'object' && !Array.isArray(row.content) ? row.content : null;
  const portable = content?.format === 'sakura-incident-portable/1';
  const value =
    portable && content.claims && typeof content.claims === 'object' && !Array.isArray(content.claims)
      ? content.claims
      : content;
  const details: W.IncidentWorkbenchRecord['details'] = [];
  const add = (label: string, item: S.SuiteJson | undefined) => {
    if (
      (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') &&
      String(item).length <= 400
    )
      details.push({ label, value: String(item) });
  };
  if (row.kind === 'source') {
    add('材料字节', value?.bytes);
    add('格式', value?.format);
  } else
    switch (row.domain) {
      case 'incident-cases':
        add('状态', value?.status);
        add('严重程度', value?.severity);
        break;
      case 'incident-evidence':
        add('采集方式声明', value?.claimedMethod ?? value?.method);
        add('来源时间', value?.sourceAt);
        add('观察时间', value?.observedAt);
        break;
      case 'incident-hypotheses':
        add('人工判断', value?.status);
        break;
      case 'incident-runbooks':
        if (Array.isArray(value?.steps)) add('步骤数', value.steps.length);
        break;
      case 'incident-actions':
        add('类型', value?.kind);
        add('阶段声明', value?.phaseClaim ?? value?.phase);
        add('原提供者状态声明', value?.providerStatusClaim);
        break;
      case 'incident-reviews':
        add('原审阅声明', value?.decision);
        break;
      case 'incident-reports':
        add('报告状态声明', value?.status);
        break;
      case 'incident-exchange':
        add('字节数', value?.bytes);
        break;
    }
  return W.incidentWorkbenchRecord.parse({
    reference: ref(row),
    name: row.name,
    kind: row.kind,
    state: row.state,
    origin: row.origin,
    sequence: row.sequence,
    createdAt: row.createdAt,
    format: typeof content?.format === 'string' ? content.format : null,
    sourceTrust: row.origin === 'imported' || portable ? 'unauthenticated' : 'local',
    sourceClaimOnly: row.origin === 'imported' || portable,
    localApproval: false,
    details,
  });
}
function readError(error: unknown): 'forbidden' | 'unavailable' | 'invalid-data' {
  if (error instanceof AppError && [401, 403].includes(error.status)) return 'forbidden';
  if (error instanceof AppError && error.status === 404) return 'unavailable';
  return 'invalid-data';
}
export class IncidentWorkbench extends SuiteStore implements IncidentWorkbenchV1 {
  constructor(
    metadata: PluginMetadata,
    auth: SuiteAuthorize,
    private ports: IncidentWorkbenchPorts,
  ) {
    super(
      'incident-workbench',
      metadata,
      auth,
      ports.cases,
      Object.fromEntries(Object.entries(ports).map(([id, port]) => ['incident-' + id, port])),
    );
  }
  async templates() {
    await this.access();
    return W.incidentWorkbenchTemplates.parse(templates);
  }
  async view(raw: z.input<typeof W.incidentWorkbenchViewRequest>): Promise<W.IncidentWorkbenchView> {
    const input = W.incidentWorkbenchViewRequest.parse(raw);
    await this.access(input.workspaceId ? { workspaceId: input.workspaceId } : undefined);
    const spaces = await this.ports.cases.listWorkspaces();
    if (input.workspaceCursor > spaces.length)
      suiteFail('INCIDENT_WORKBENCH_CURSOR', '空间列表起点超出当前总数', 400);
    const workspaces = {
      items: spaces.slice(input.workspaceCursor, input.workspaceCursor + input.limit),
      next: input.workspaceCursor + input.limit < spaces.length ? input.workspaceCursor + input.limit : null,
    };
    const providers = W.incidentWorkbenchProviders.parse({
      actions: await this.ports.actions.providers(),
      captures: await this.ports.evidence.captureSources(),
    });
    if (!input.workspaceId)
      return W.incidentWorkbenchView.parse({
        workspaces,
        workspace: null,
        capacity: null,
        currentCase: null,
        domains: [],
        providers,
        approvalsTransferred: false,
        automaticExecution: false,
      });
    const scope = { workspaceId: input.workspaceId },
      workspace = await this.ports.cases.workspace(scope);
    let caseScope: W.IncidentWorkbenchView['currentCase'] = null;
    try {
      const row = await this.ports.cases.scope(scope),
        value = I.incidentCase.parse(row.content);
      if (row.origin !== 'local') suiteFail('INCIDENT_WORKBENCH_CASE');
      caseScope = {
        reference: ref(row),
        name: row.name,
        impact: value.impact,
        severity: value.severity,
        affected: value.affected,
        status: value.status,
        unresolvedCount: value.unresolved.length,
        origin: 'local',
      };
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'INCIDENT_CASE_NOT_INITIALIZED') throw error;
    }
    const domains: W.IncidentWorkbenchView['domains'] = [];
    for (const id of W.incidentWorkbenchDomain.options) {
      try {
        if (id === 'timeline') {
          const page = await this.ports.timeline.headers({
            ...scope,
            cursor: input.cursors.timeline,
            limit: input.limit,
            history: input.history,
            archived: input.archived,
          });
          domains.push({
            id,
            records: [],
            timelines: page.items,
            next: page.next,
            total: page.total,
            error: null,
          });
        } else {
          const port = this.ports[id],
            page = await port.list({
              ...scope,
              cursor: input.cursors[id],
              limit: input.limit,
              history: input.history,
              archived: input.archived,
            });
          const records: W.IncidentWorkbenchRecord[] = [];
          for (const row of page.items)
            records.push(recordSummary(await port.get({ ...scope, id: row.id, revision: row.revision })));
          domains.push({ id, records, timelines: [], next: page.next, total: null, error: null });
        }
      } catch (error) {
        if (error instanceof AppError && [401, 403].includes(error.status)) throw error;
        domains.push({ id, records: [], timelines: [], next: null, total: null, error: readError(error) });
      }
    }
    const capacity = await this.ports.cases.capacity(scope);
    await this.access(scope);
    return W.incidentWorkbenchView.parse({
      workspaces,
      workspace,
      capacity,
      currentCase: caseScope,
      domains,
      providers,
      approvalsTransferred: false,
      automaticExecution: false,
    });
  }
}
