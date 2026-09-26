import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CapabilityActionView } from '../shared/capability-actions';
import type { JobView } from '../server/jobs';
import { Feedback, JobLog, useAction, useRemote, type Request } from './feature-shared';
import { saveBlob } from './export-file';
import { SchemaFields } from './SchemaFields';

type Props = {
  request: Request;
  path: string;
  scope: CapabilityActionView['scope'];
  definitions?: CapabilityActionView[];
  jobs?: JobView[];
  selected: string;
  onSelected: (id: string) => void;
  running: boolean;
  reload: () => unknown;
};

export function CapabilityActionsPanel({
  request,
  path,
  scope,
  definitions = [],
  jobs = [],
  selected,
  onSelected,
  running,
  reload,
}: Props) {
  const action = useAction();
  const [parameters, setParameters] = useState('{}');
  const [formErrors, setFormErrors] = useState<Record<string, boolean>>({});
  const reportFormError = useCallback(
    (key: string, invalid: boolean) =>
      setFormErrors((current) =>
        Boolean(current[key]) === invalid ? current : { ...current, [key]: invalid },
      ),
    [],
  );
  const definition = definitions.find((item) => item.id === selected);
  useEffect(() => {
    setParameters(JSON.stringify(definition?.example || {}, null, 2));
  }, [selected, path, request]);
  const parsed = useMemo(() => {
    try {
      const value = JSON.parse(parameters);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  }, [parameters]);
  const key = (scope === 'suite' ? 'capability:' : scope === 'extended' ? 'extended:' : 'next:') + selected;
  const job = jobs.find((item) => item.action === key);
  const saved = useRemote<any>(request, `/jobs/${job?.id}/result`, Boolean(job?.result), 0);
  let result: any;
  try {
    result = job?.result
      ? saved.data?.jobId === job.id
        ? saved.data.result
        : null
      : job?.log
        ? JSON.parse(job.log)
        : null;
  } catch {
    result = null;
  }
  if (!definitions.length) return null;
  return (
    <div className="capability-actions-panel">
      <label>
        可执行功能
        <select
          aria-label={scope + ' 功能操作'}
          value={selected}
          onChange={(event) => onSelected(event.target.value)}
        >
          <option value="">选择功能</option>
          {definitions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.writes ? ' · 可写入' : ''}
            </option>
          ))}
        </select>
      </label>
      {definition && (
        <>
          <p className="muted">{definition.note}</p>
          {parsed && (
            <details>
              <summary>填写参数表单</summary>
              <SchemaFields
                schema={definition.schema}
                value={parsed}
                report={reportFormError}
                update={(value) => setParameters(JSON.stringify(value, null, 2))}
              />
            </details>
          )}
          {selected === 'command-forms' && Array.isArray(parsed?.fields) && (
            <div className="feature-grid">
              {parsed.fields
                .filter((field: any) => typeof field?.name === 'string')
                .map((field: any) => {
                  const update = (value: unknown) =>
                    setParameters(
                      JSON.stringify(
                        { ...parsed, values: { ...parsed.values, [field.name]: value } },
                        null,
                        2,
                      ),
                    );
                  const value = parsed.values?.[field.name];
                  return (
                    <label key={field.name}>
                      {field.label || field.name}
                      {field.required ? ' *' : ''}
                      {field.type === 'choice' ? (
                        <select value={value ?? ''} onChange={(event) => update(event.target.value)}>
                          <option value="">请选择</option>
                          {(field.choices || []).map((item: string) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      ) : field.type === 'boolean' ? (
                        <input
                          type="checkbox"
                          checked={value === true}
                          onChange={(event) => update(event.target.checked)}
                        />
                      ) : (
                        <input
                          type={field.type === 'integer' ? 'number' : 'text'}
                          value={value ?? ''}
                          onChange={(event) =>
                            update(
                              field.type === 'integer' && event.target.value !== ''
                                ? Number(event.target.value)
                                : event.target.value,
                            )
                          }
                        />
                      )}
                    </label>
                  );
                })}
            </div>
          )}
          <label>
            操作参数（JSON）
            <textarea
              rows={10}
              aria-label={scope + ' 功能参数'}
              value={parameters}
              onChange={(event) => setParameters(event.target.value)}
            />
          </label>
          {!parsed && <p role="alert">请输入有效的 JSON 对象。</p>}
          <button
            className="secondary compact"
            disabled={
              action.busy ||
              !parsed ||
              Object.values(formErrors).some(Boolean) ||
              (definition.requiresGuest && !running)
            }
            onClick={() =>
              action.run(async () => {
                await request(path, 'POST', {
                  action: scope === 'suite' ? 'feature-run' : 'run',
                  featureId: selected,
                  options: parsed,
                });
                reload();
              }, '任务已提交，执行结果显示在下方')
            }
          >
            提交{definition.name}
          </button>
          <Feedback error={action.error} message={action.message} />
          <JobLog job={job || null} />
          {saved.error && <p role="alert">{saved.error}</p>}
          {result && (
            <button
              className="secondary compact"
              onClick={() =>
                saveBlob(
                  selected + '-result.json',
                  new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
                )
              }
            >
              导出完整结果
            </button>
          )}
          {result?.download && (
            <button
              className="secondary compact"
              onClick={() =>
                saveBlob(
                  result.download.filename,
                  new Blob([result.download.content], { type: result.download.mime }),
                )
              }
            >
              下载 {result.download.filename}
            </button>
          )}
          {Array.isArray(result?.metrics) && selected === 'anomaly-detection' && (
            <table>
              <thead>
                <tr>
                  <th>指标</th>
                  <th>基线</th>
                  <th>当前</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {result.metrics.map((item: any) => (
                  <tr key={item.field}>
                    <td>{item.field}</td>
                    <td>{item.baseline.toFixed(2)}</td>
                    <td>{item.current.toFixed(2)}</td>
                    <td>{item.anomalous ? '异常' : '正常'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result?.basis === 'completed-tasks' && (
            <div className="feature-grid">
              <p>
                成功率：{result.actualPercent === null ? '暂无样本' : result.actualPercent.toFixed(2) + '%'}
              </p>
              <p>
                已完成任务：{result.samples} · 失败：{result.failed}
              </p>
              <p>剩余失败预算：{result.remainingFailures.toFixed(2)}</p>
            </div>
          )}
          {selected === 'disk-analyzer' && result?.types && (
            <div aria-label="磁盘占用分析">
              <p>
                共 {result.files} 个文件 · {(result.totalBytes / 1024 / 1024).toFixed(2)} MiB
              </p>
              {result.types.map((item: { type: string; bytes: number; files: number }) => (
                <div key={item.type}>
                  <span>
                    {item.type} · {item.files} 个文件 · {(item.bytes / 1024).toFixed(1)} KiB
                  </span>
                  <meter
                    aria-label={item.type + ' 占用'}
                    value={item.bytes}
                    min={0}
                    max={Math.max(1, result.totalBytes)}
                    style={{ width: '100%' }}
                  />
                </div>
              ))}
            </div>
          )}
          {selected === 'workspace-search' && Array.isArray(result?.results) && (
            <div className="search-results">
              <p>
                找到 {result.totalMatches} 处匹配{result.truncated ? '，仅显示前一部分' : ''}
              </p>
              {result.results.map((target: any) => (
                <article key={target.vmId + target.projectId}>
                  <h4>
                    {target.vmName || target.vmId} · {target.projectId}
                  </h4>
                  {target.error && <p role="alert">{target.error}</p>}
                  {(target.matches || []).map((match: any, index: number) => (
                    <p key={index}>
                      <code>
                        {match.path}:{match.line}
                      </code>{' '}
                      {match.text}
                    </p>
                  ))}
                </article>
              ))}
            </div>
          )}
          {selected === 'onboarding-checklist' && Array.isArray(result?.steps) && (
            <div>
              <p>
                {result.member}：{result.completed} / {result.total} 已完成
              </p>
              {result.steps.map((step: any) => (
                <p key={step.id}>
                  {step.done ? '✓' : '○'} {step.title}
                  <button
                    onClick={() =>
                      setParameters(
                        JSON.stringify(
                          { mode: step.done ? 'reopen' : 'complete', member: result.member, stepId: step.id },
                          null,
                          2,
                        ),
                      )
                    }
                  >
                    {step.done ? '重新打开' : '标为完成'}
                  </button>
                </p>
              ))}
            </div>
          )}
          {(selected === 'review-comments' || selected === 'review-threads') &&
            Array.isArray(result?.threads) &&
            result.threads.map((thread: any) => (
              <article className="feature-card" key={thread.id}>
                <b>
                  {thread.path}:{thread.line} · {thread.resolved ? '已解决' : '待处理'}
                </b>
                {thread.comments.map((comment: any) => (
                  <p key={comment.id}>
                    {comment.author}：{comment.body}
                  </p>
                ))}
                <button
                  className="secondary compact"
                  onClick={() =>
                    setParameters(
                      JSON.stringify(
                        { mode: thread.resolved ? 'reopen' : 'resolve', threadId: thread.id },
                        null,
                        2,
                      ),
                    )
                  }
                >
                  {thread.resolved ? '重新打开' : '解决线程'}
                </button>
                <button
                  className="secondary compact"
                  onClick={() =>
                    setParameters(
                      JSON.stringify(
                        { mode: 'reply', threadId: thread.id, body: '', author: '本地用户' },
                        null,
                        2,
                      ),
                    )
                  }
                >
                  回复
                </button>
              </article>
            ))}
        </>
      )}
    </div>
  );
}
