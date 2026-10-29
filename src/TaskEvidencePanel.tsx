/** 汇集任务、请求回执和原资源恢复动作；所有写操作仍交给所属服务。
 * Present jobs, request receipts and original recovery actions; resource owners retain all mutations. */
import { operationResultSchema } from '../shared/contracts/operation-results.ts';
import { recoveryListSchema, recoveryViewSchema } from '../shared/contracts/recovery.ts';
import type { JobView } from '../shared/contracts/jobs.ts';
import { recoveryRelation } from '../shared/task-evidence.ts';
import { useAction, useRemote, Feedback, type Request } from './feature-shared';
import { formatDateTime } from './localization';
import { jobPresentation } from './job-presentation';
import './task-evidence.css';

/** 按任务身份读取证据，分别显示来源失败；恢复后重新读取权威状态，不自动重放任务。
 * Load evidence for a job, report source failures independently and refresh authority after recovery without replaying jobs. */
export function TaskEvidencePanel({ request, job, onClose, onDiagnose }: {
  request: Request; job: JobView; onClose: () => void; onDiagnose?: () => void;
}) {
  const validReceipt = operationResultSchema.shape.correlationId.safeParse(job.correlationId).success;
  const receiptRemote = useRemote<unknown>(request, `/operation-results/${job.correlationId}`, validReceipt, 10000);
  const recoveryRemote = useRemote<unknown>(request, '/recoveries', true, 10000);
  const action = useAction();
  const receipt = operationResultSchema.safeParse(receiptRemote.data);
  const directory = recoveryListSchema.safeParse(recoveryRemote.data);
  const diagnostics = directory.success ? directory.data.diagnostics : undefined;
  const records = directory.success ? directory.data.records
    .map(record => ({ record, relation: recoveryRelation(job, record) })).filter(item => item.relation) : [];
  const direct = records.filter(item => item.relation === 'direct');
  const contextual = records.filter(item => item.relation === 'context' && item.record.state !== 'resolved');
  const labels = { pending: '正在处理请求', succeeded: '请求处理成功', failed: '请求被拒绝或失败', unknown: '请求结果尚未确认' };
  const deliveryLabels = { pending: '等待发送', sent: '已发送', failed: '发送失败', unknown: '尚未确认送达' };
  const matchedReceipt = receipt.success && receipt.data.correlationId === job.correlationId ? receipt.data : undefined;
  return <section className="feature-card task-evidence" aria-label="任务证据与处理">
    <header className="evidence-header">
      <h3>任务证据与处理</h3>
      <span className="evidence-task-state">后台任务：{jobPresentation(job).label}</span>
    </header>
    <p className="evidence-intro">请求回执说明发起请求的处理结果，后台任务是否完成以任务状态为准。</p>
    <section className="evidence-section" aria-label="任务时间线">
      <h4>任务时间线</h4>
      {job.errorCode && <p>任务错误码：<code>{job.errorCode}</code></p>}
      <ol className="evidence-timeline">
        <li><span>任务创建</span><time dateTime={job.startedAt}>{formatDateTime(job.startedAt)}</time></li>
        {job.executionStartedAt && <li><span>开始执行</span><time dateTime={job.executionStartedAt}>{formatDateTime(job.executionStartedAt)}</time></li>}
        {job.finishedAt && <li><span>任务结束记录</span><time dateTime={job.finishedAt}>{formatDateTime(job.finishedAt)}</time></li>}
        {job.cleanupResolvedAt && <li><span>清理已确认</span><time dateTime={job.cleanupResolvedAt}>{formatDateTime(job.cleanupResolvedAt)}</time></li>}
      </ol>
    </section>
    <section className="evidence-section" aria-label="请求回执">
      <h4>请求回执</h4>
      {matchedReceipt ? <>
        <p className="evidence-receipt-outcome"><strong>{labels[matchedReceipt.outcome]}</strong></p>
        <p>{matchedReceipt.executed ? '已进入业务处理；发生错误不代表没有副作用。' : '回执没有记录业务处理已开始。'}</p>
        <dl className="evidence-facts">
          <div><dt>响应交付</dt><dd>{deliveryLabels[matchedReceipt.delivery]}</dd></div>
          <div><dt>响应校验</dt><dd>{matchedReceipt.responseValidated ? '通过' : '未确认'}</dd></div>
          <div><dt>审计</dt><dd>{matchedReceipt.auditRecorded ? '已记录' : '未确认'}</dd></div>
        </dl>
        <dl className="evidence-identifiers">
          <div><dt>操作标识</dt><dd><code>{matchedReceipt.operationId}</code></dd></div>
          <div><dt>回执 ID</dt><dd><code>{matchedReceipt.correlationId}</code></dd></div>
        </dl>
      </> : validReceipt ? <p>{receiptRemote.error || (receiptRemote.data ? '回执格式或身份不匹配，请刷新核对。' : '正在读取请求回执…')}</p>
        : <p>此任务没有请求回执关联，可能来自后台调度或旧版记录；不能据此判断业务未执行。</p>}
    </section>
    <section className="evidence-section" aria-label="恢复记录">
    <h4>恢复记录</h4>
    {directory.success && <p className="evidence-record-count">确切关联 {direct.length} 条 · 同一实例参考 {contextual.length} 条</p>}
    <Feedback error={action.error || recoveryRemote.error}/>
    {directory.success && directory.data.diagnostics?.state === 'degraded' && <p role="alert">
      恢复目录不完整：{directory.data.diagnostics.message || '请到插件中心检查恢复目录。'}
    </p>}
    {!directory.success && recoveryRemote.data != null && <p role="alert">恢复目录格式无效，请刷新后重试。</p>}
    {directory.success && !direct.length && <p>没有找到确切关联的恢复记录。这不证明所有资源已释放。</p>}
    {[...direct, ...contextual].slice(0, 20).map(({ record, relation }) =>
      <article key={record.id} className="evidence-record">
        <div className="evidence-record-heading">
          <h5>{relation === 'direct' ? '确切关联的恢复记录' : '同一实例的参考记录（未证实与本任务关联）'}</h5>
          <span className="evidence-record-state">{record.state === 'resolved' ? '已处理' : '待核对'}</span>
        </div>
        <dl className="evidence-facts">
          <div><dt>所属领域</dt><dd>{record.binding.domain}</dd></div>
          <div><dt>所属服务</dt><dd>{record.binding.owner}</dd></div>
          <div><dt>关联资源</dt><dd>{record.resourceIds.length} 项资源</dd></div>
        </dl>
        {record.error && <p>{record.error}</p>}
        {record.discoveryError && <p role="alert">{record.discoveryError}</p>}
        <div className="evidence-recovery-actions">{record.state !== 'resolved' && record.actions.map(recovery => <button className="secondary compact" key={recovery.id}
          disabled={action.busy || !record.available || diagnostics?.state === 'degraded'}
          onClick={() => void action.run(async signal => {
            const result = await request<unknown>('/recoveries', 'POST', { id: record.id, digest: record.digest, action: recovery.id }, signal);
            signal.throwIfAborted();
            const updated = recoveryViewSchema.parse(result);
            if (updated.id !== record.id) throw new Error('恢复响应身份不匹配，请刷新核对。');
            recoveryRemote.reload(); receiptRemote.reload();
          })}>{recovery.title}</button>)}</div>
        {!record.actions.length && record.state !== 'resolved' && <p>当前没有可执行动作，请保留现场并检查所属服务。</p>}
      </article>)}
    {direct.length + contextual.length > 20 && <p>仅显示前 20 条关联记录，完整目录见插件中心。</p>}
    </section>
    <div className="feature-actions evidence-actions">
      <button className="secondary compact" onClick={() => { receiptRemote.reload(); recoveryRemote.reload(); }}>刷新证据</button>
      {onDiagnose && <button className="secondary compact" onClick={onDiagnose}>打开实例诊断</button>}
      <button className="secondary compact" onClick={onClose}>收起证据</button>
    </div>
  </section>;
}
