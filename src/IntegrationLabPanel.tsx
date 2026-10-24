/** 接口工作台：空选择、明确预览、逐领域操作和真实结果。 Explicit selection and domain operations. */
import { useEffect, useState } from 'react';
import type { FeatureProps } from './feature-shared';
import {
  integrationDomains,
  integrationRequestSchemas,
  integrationResponseSchemas,
  type IntegrationDomain,
} from '../shared/contracts/integration-http';
import type {
  IntegrationWorkspace,
  IntegrationRunPlan,
  IntegrationRun,
  IntegrationReport,
} from '../shared/contracts/integration-lab';
import type { ImageAsset } from '../shared/contracts/image-assets';
import type { IntegrationWorkbenchV1 } from '../server/service-contracts/integration-lab';
import { integrationBrowserZip } from '../shared/contracts/integration-browser';
import './integration-lab.css';
import './plugin-fonts.css';
const titles: Record<IntegrationDomain, string> = {
  specs: '工作空间与契约',
  environments: '环境与凭据',
  fixtures: '固定样例',
  mocks: '有限状态模拟',
  scenarios: '场景与变量',
  assertions: '响应断言',
  runners: '隔离运行',
  load: '模拟有限负载',
  reports: '报告与比较',
  exchange: '离线交接',
  workbench: '首次使用',
};
const actions: Record<IntegrationDomain, string[]> = {
  specs: ['create-workspace', 'save', 'get', 'seal', 'archive', 'compare'],
  environments: ['save', 'get', 'seal', 'archive', 'versions', 'revoke', 'application-targets'],
  fixtures: ['import', 'generate', 'save', 'get', 'seal', 'archive'],
  mocks: ['save', 'get', 'seal', 'archive'],
  scenarios: ['save', 'get', 'seal', 'compile', 'archive'],
  assertions: ['save', 'get', 'seal', 'archive'],
  runners: [
    'images',
    'image-uploads',
    'image-begin',
    'image-append',
    'image-finish',
    'image-discard',
    'preview',
    'apply',
    'inspect',
    'cancel',
    'recover',
    'verify-effect',
  ],
  load: ['save', 'get', 'seal', 'preview', 'apply', 'archive'],
  reports: ['seal', 'get', 'compare', 'cleanup-plan', 'cleanup'],
  exchange: [
    'export',
    'quarantine',
    'accept',
    'upload-begin',
    'upload-append',
    'upload-complete',
    'uploads',
    'upload-discard',
  ],
  workbench: ['create'],
};
export function IntegrationLabPanel({
  request,
  section = 'workbench',
}: Pick<FeatureProps, 'request'> & { section?: IntegrationDomain }) {
  const [domain, setDomain] = useState(section),
    [workspaces, setWorkspaces] = useState<IntegrationWorkspace[]>([]),
    [workspace, setWorkspace] = useState(''),
    [action, setAction] = useState(''),
    [draft, setDraft] = useState('{}'),
    [output, setOutput] = useState<unknown>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [template, setTemplate] = useState(''),
    [name, setName] = useState(''),
    [file, setFile] = useState<File | null>(null),
    [distro, setDistro] = useState(''),
    [applicationsAvailable, setApplicationsAvailable] = useState(false),
    [approved, setApproved] = useState(false);
  const [created, setCreated] = useState<Awaited<ReturnType<IntegrationWorkbenchV1['create']>> | null>(null),
    [createdTemplate, setCreatedTemplate] = useState(''),
    [images, setImages] = useState<ImageAsset[]>([]),
    [imageId, setImageId] = useState(''),
    [plan, setPlan] = useState<IntegrationRunPlan | null>(null),
    [run, setRun] = useState<IntegrationRun | null>(null),
    [report, setReport] = useState<IntegrationReport | null>(null),
    [history, setHistory] = useState<IntegrationRun[]>([]);
  const scoped = (target: IntegrationDomain) =>
    '/integration-' + target + '?workspaceId=' + encodeURIComponent(workspace);
  const guided = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const post = async <T,>(target: IntegrationDomain, input: unknown): Promise<T> => {
    const body = integrationRequestSchemas[target].parse(input);
    const raw = await request(scoped(target), 'POST', body);
    return integrationResponseSchemas[target].act.parse(raw).result as T;
  };
  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const readGuided = async () => {
    const raw = await request(scoped('runners'));
    setHistory(integrationResponseSchemas.runners.view.parse(raw).result.runs);
    setImages(await post<ImageAsset[]>('runners', { action: 'images' }));
  };
  useEffect(() => {
    setImages([]);
    setImageId('');
    setPlan(null);
    setRun(null);
    setReport(null);
    setHistory([]);
    setApproved(false);
    if (created && created.workspace.id !== workspace) setCreated(null);
    let active = true;
    if (workspace)
      void Promise.all([request(scoped('runners')), request(scoped('runners'), 'POST', { action: 'images' })])
        .then(([runs, assets]) => {
          if (active) {
            setHistory(integrationResponseSchemas.runners.view.parse(runs).result.runs);
            const parsed = integrationResponseSchemas.runners.act.parse(assets).result;
            if (Array.isArray(parsed)) setImages(parsed as ImageAsset[]);
          }
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
    return () => {
      active = false;
    };
  }, [workspace, request]);
  useEffect(() => {
    if (
      !run ||
      !['queued', 'preparing', 'running', 'evaluating', 'cleanup', 'cancelling'].includes(run.state)
    )
      return;
    let active = true,
      working = false;
    const timer = setInterval(() => {
      if (working) return;
      working = true;
      void post<IntegrationRun>('runners', { action: 'inspect', id: run.id })
        .then((value) => {
          if (active) setRun(value);
        })
        .catch((e) => {
          if (active) setError(String(e));
        })
        .finally(() => {
          working = false;
        });
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [run?.id, run?.state, workspace, request]);
  const refresh = async () => {
    const data = await request<{ result: { workspaces: IntegrationWorkspace[] } }>('/integration-specs');
    setWorkspaces(data.result.workspaces);
  };
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, [request]);
  useEffect(() => {
    setDomain(section);
    setAction('');
  }, [section]);
  useEffect(() => {
    let active = true;
    setApplicationsAvailable(false);
    if (domain === 'environments' && workspace)
      void request<{ result: { available: boolean } }>(
        '/integration-environments?workspaceId=' + encodeURIComponent(workspace),
        'POST',
        { action: 'application-targets' },
      )
        .then((value) => {
          if (active) setApplicationsAvailable(value.result.available);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [domain, workspace, request]);
  const execute = async (view = false) => {
    setBusy(true);
    setError('');
    try {
      let body: unknown;
      const scope = workspace ? '?workspaceId=' + encodeURIComponent(workspace) : '';
      if (!view) {
        body =
          domain === 'workbench' ? { action: 'create', name, template } : { ...JSON.parse(draft), action };
        integrationRequestSchemas[domain].parse(body);
        if (action === 'apply' && !approved)
          throw Error('请先审阅计划摘要、写操作范围和清理责任，并勾选确认。');
      }
      const result = await request<{ result: unknown }>(
        '/integration-' + domain + scope,
        view ? 'GET' : 'POST',
        body,
      );
      setOutput(result.result);
      if (!view && domain === 'workbench') {
        const value = integrationResponseSchemas.workbench.act.parse(result).result;
        setCreated(value);
        setCreatedTemplate(template);
        setWorkspace(value.workspace.id);
        setPlan(null);
        setRun(null);
        setReport(null);
        setApproved(false);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      if (file.size > 256 * 1024 ** 2) throw Error('浏览器上传上限为 256 MiB；更大的准备镜像请使用 CLI。');
      if (domain === 'runners' && (!workspace || !distro)) throw Error('请选择工作空间和镜像发行版。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        digest = [...hash].map((v) => v.toString(16).padStart(2, '0')).join('');
      const path =
        '/integration-' +
        domain +
        (domain === 'runners' ? '?workspaceId=' + encodeURIComponent(workspace) : '');
      const image = domain === 'runners';
      const begun = await request<{ result: { id: string } }>(
        path,
        'POST',
        image
          ? {
              action: 'image-begin',
              digest,
              bytes: bytes.length,
              distro,
              architecture: 'x86_64',
              source: 'local:' + file.name,
            }
          : {
              action: 'upload-begin',
              name: file.name,
              digest,
              bytes: bytes.length,
              contentType: 'application/zip',
            },
      );
      for (let offset = 0; offset < bytes.length; offset += 512 * 1024) {
        const part = bytes.subarray(offset, offset + 512 * 1024);
        let binary = '';
        for (let i = 0; i < part.length; i += 16384)
          binary += String.fromCharCode(...part.subarray(i, i + 16384));
        await request(path, 'POST', {
          action: image ? 'image-append' : 'upload-append',
          id: begun.result.id,
          offset,
          data: btoa(binary),
        });
      }
      const result = await request<{ result: unknown }>(path, 'POST', {
        action: image ? 'image-finish' : 'upload-complete',
        id: begun.result.id,
      });
      setOutput(result.result);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="integration-lab">
      <header>
        <div>
          <h2>接口集成验证</h2>
          <p>固定输入，预览请求，检查断言与原资源收尾。</p>
        </div>
        <span>启用和查看均不会运行 VM</span>
      </header>
      <div className="integration-lab-layout">
        <nav aria-label="集成验证步骤">
          {integrationDomains.map((d) => (
            <button
              key={d}
              disabled={busy}
              className={domain === d ? 'active' : ''}
              onClick={() => {
                setDomain(d);
                setAction('');
                setApproved(false);
                setOutput(null);
              }}
            >
              {titles[d]}
            </button>
          ))}
        </nav>
        <main>
          <label>
            工作空间
            <select
              value={workspace}
              onChange={(e) => {
                setWorkspace(e.target.value);
                setOutput(null);
                setApproved(false);
              }}
            >
              <option value="">请选择工作空间</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {w.state}
                </option>
              ))}
            </select>
          </label>
          <h3>{titles[domain]}</h3>
          {domain === 'workbench' ? (
            <div className="integration-lab-form">
              <p>模板创建本机定义，不发请求。固定镜像由你明确选择；缺少运行依赖时会返回准备错误。</p>
              <label>
                名称
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
              </label>
              <label>
                模板
                <select value={template} onChange={(e) => setTemplate(e.target.value)}>
                  <option value="">请选择模板</option>
                  <option value="order-demo">订单接口演练</option>
                  <option value="pagination">分页与限流</option>
                  <option value="contract-change">契约变更检查</option>
                </select>
              </label>
              <button disabled={busy || !name || !template} onClick={() => execute()}>
                创建定义
              </button>
              {created?.comparison && (
                <p role="status">兼容比较已完成，请在下方查看各项差异；此模板不需要 VM。</p>
              )}
              {workspace && (
                <fieldset className="integration-lab-guided">
                  <legend>引导式演练</legend>
                  {created?.scenario ? (
                    <p>已保留当前模板的固定场景、模拟和断言引用，无需手动复制 ID。</p>
                  ) : (
                    <p>创建订单或分页模板后可预览新运行；已有运行可在下方读取。</p>
                  )}
                  <label>
                    已准备镜像
                    <select
                      value={imageId}
                      disabled={busy || !!run}
                      onChange={(e) => {
                        setImageId(e.target.value);
                        setPlan(null);
                        setApproved(false);
                      }}
                    >
                      <option value="">请选择已导入镜像</option>
                      {images.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.distro} · {asset.architecture} · {asset.digest.slice(0, 16)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="integration-lab-actions">
                    <button disabled={busy} onClick={() => guided(readGuided)}>
                      刷新镜像与运行
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setDomain('runners');
                        setAction('');
                      }}
                    >
                      导入准备镜像
                    </button>
                    <button
                      disabled={busy || !created?.scenario || !imageId || !!run}
                      onClick={() =>
                        guided(async () => {
                          if (!created?.scenario || !created.assertions) return;
                          const image = images.find((a) => a.id === imageId);
                          if (!image) throw Error('请选择当前镜像');
                          const value = await post<IntegrationRunPlan>('runners', {
                            action: 'preview',
                            input: {
                              scenario: created.scenario,
                              mock: created.mock,
                              assertions: created.assertions,
                              image: { assetId: image.id, digest: image.digest },
                              mode: 'functional',
                              requests: createdTemplate === 'pagination' ? 2 : 3,
                              rate: 1,
                              durationSeconds: 60,
                              retainFields: [],
                            },
                          });
                          setPlan(value);
                          setApproved(false);
                          setOutput(value);
                        })
                      }
                    >
                      预览固定计划
                    </button>
                  </div>
                  {plan && (
                    <>
                      <dl className="integration-lab-summary">
                        <dt>目标</dt>
                        <dd>
                          {run?.snapshot.environment.target.kind === 'private'
                            ? JSON.stringify(run.snapshot.environment.target)
                            : '本次专用 VM 内的模拟服务'}
                        </dd>
                        <dt>写入节点</dt>
                        <dd>{plan.writes.join('、') || '无'}</dd>
                        <dt>预算</dt>
                        <dd>
                          1 GiB / 1 vCPU；{plan.requests} 次请求；{plan.durationSeconds} 秒；正文默认丢弃
                        </dd>
                        <dt>凭据版本</dt>
                        <dd>
                          {Object.keys(plan.credentialVersions).length
                            ? JSON.stringify(plan.credentialVersions)
                            : '无秘密凭据'}
                        </dd>
                        <dt>批准有效期</dt>
                        <dd>{new Date(plan.expiresAt).toLocaleString()}</dd>
                        <dt>固定摘要</dt>
                        <dd>{plan.digest}</dd>
                      </dl>
                      <label className="integration-lab-check">
                        <input
                          type="checkbox"
                          disabled={busy || !!run}
                          checked={approved}
                          onChange={(e) => setApproved(e.target.checked)}
                        />
                        批准上述固定计划及写入，并由本包核销所创建的原 VM。
                      </label>
                      <button
                        disabled={busy || !approved || !!run || Date.parse(plan.expiresAt) <= Date.now()}
                        onClick={() =>
                          guided(async () => {
                            const value = await post<IntegrationRun>('runners', {
                              action: 'apply',
                              planId: plan.id,
                              digest: plan.digest,
                              approveWrites: approved,
                            });
                            setRun(value);
                            setOutput(value);
                            setApproved(false);
                          })
                        }
                      >
                        批准并开始演练
                      </button>
                    </>
                  )}
                  {history.length > 0 && (
                    <label>
                      读取已有运行
                      <select
                        value={run?.id || ''}
                        disabled={busy}
                        onChange={(e) => {
                          const value = history.find((r) => r.id === e.target.value);
                          setRun(value || null);
                          setReport(null);
                          setPlan(value?.plan || null);
                          setApproved(false);
                        }}
                      >
                        <option value="">请选择运行</option>
                        {history.map((value) => (
                          <option key={value.id} value={value.id}>
                            {new Date(value.createdAt).toLocaleString()} · {value.state}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {run && (
                    <>
                      <p role="status">
                        运行状态：{run.state}；完整响应 {run.requests.filter((r) => r.complete).length} /{' '}
                        {run.plan.requests}；原 VM 清理：{run.cleanupConfirmed ? '已确认' : '尚未确认'}。
                      </p>
                      {run.error && <p role="alert">{run.error}</p>}
                      <div className="integration-lab-actions">
                        <button
                          disabled={busy}
                          onClick={() =>
                            guided(async () => {
                              const value = await post<IntegrationRun>('runners', {
                                action: 'inspect',
                                id: run.id,
                              });
                              setRun(value);
                              setOutput(value);
                            })
                          }
                        >
                          读取运行详情
                        </button>
                        <button
                          disabled={
                            busy ||
                            !['queued', 'preparing', 'running', 'evaluating', 'cancelling'].includes(
                              run.state,
                            )
                          }
                          onClick={() =>
                            guided(async () =>
                              setRun(await post('runners', { action: 'cancel', id: run.id })),
                            )
                          }
                        >
                          取消并核销
                        </button>
                        <button
                          disabled={
                            busy ||
                            run.cleanupConfirmed ||
                            !['cleanup-pending', 'effect-unknown', 'interrupted'].includes(run.state)
                          }
                          onClick={() =>
                            guided(async () =>
                              setRun(await post('runners', { action: 'recover', id: run.id })),
                            )
                          }
                        >
                          核销原资源
                        </button>
                        <button
                          disabled={busy || !run.finishedAt}
                          onClick={() =>
                            guided(async () => {
                              const value = await post<IntegrationReport>('reports', {
                                action: 'seal',
                                runId: run.id,
                              });
                              setReport(value);
                              setOutput(value);
                            })
                          }
                        >
                          封存并读取报告
                        </button>
                      </div>
                      {run.evaluation && (
                        <ul>
                          {run.evaluation.results.map((value) => (
                            <li key={value.id}>
                              {value.id}：{value.outcome}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                  {report && (
                    <>
                      <p>
                        报告结论：{report.verdict}；证据范围：{report.evidenceCoverage}
                        ；完整正文已丢弃，离线不能重算全部业务断言。
                      </p>
                      <button
                        disabled={busy}
                        onClick={() =>
                          guided(async () => {
                            const bundle = await post('exchange', {
                              action: 'export',
                              scenario: report.run.plan.scenario,
                              mock: report.run.plan.mock,
                              assertions: report.run.plan.assertions,
                              reports: [report.id],
                            });
                            download(
                              await integrationBrowserZip(bundle),
                              'integration-' + report.id + '.zip',
                            );
                            setOutput({ exported: report.id, format: 'sakura-integration-bundle/1' });
                          })
                        }
                      >
                        导出离线核验 ZIP
                      </button>
                    </>
                  )}
                </fieldset>
              )}
            </div>
          ) : (
            <>
              <label>
                操作
                <select
                  value={action}
                  onChange={(e) => {
                    setAction(e.target.value);
                    setApproved(false);
                  }}
                >
                  <option value="">请选择操作</option>
                  {actions[domain]
                    .filter((a) => a !== 'application-targets' || applicationsAvailable)
                    .map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                操作内容（JSON）
                <textarea
                  spellCheck={false}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setApproved(false);
                  }}
                  rows={14}
                />
              </label>
              {domain === 'runners' && (
                <p>
                  preview 固定计划。apply 需要计划
                  ID、摘要和写操作批准。任务已提交表示正在处理；只有报告和清理证明能说明最终结果。
                </p>
              )}
              {domain === 'load' && (
                <p>
                  有限负载仅接受同一专用 VM 的新模拟会话，固定请求不支持动态变量。超限或样本不足会显示不确定。
                </p>
              )}
              {domain === 'exchange' && (
                <p>
                  导入先进入隔离区。接受后需重新绑定本机环境，不能继承旧运行批准。CLI 可生成和核验离线 ZIP。
                </p>
              )}
              {(domain === 'exchange' || domain === 'runners') && (
                <fieldset>
                  <legend>{domain === 'exchange' ? '上传 ZIP 至隔离区' : '导入已准备镜像'}</legend>
                  <input
                    type="file"
                    accept={domain === 'exchange' ? '.zip' : '.qcow2'}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    disabled={busy}
                  />
                  {domain === 'runners' && (
                    <label>
                      镜像发行版
                      <select value={distro} onChange={(e) => setDistro(e.target.value)}>
                        <option value="">请选择发行版</option>
                        <option value="debian">Debian</option>
                        <option value="alpine">Alpine</option>
                        <option value="ubuntu">Ubuntu</option>
                      </select>
                    </label>
                  )}
                  <p>只读取你选定的文件。上传不会启动 VM 或安装工具；浏览器上限为 256 MiB。</p>
                  <button
                    disabled={busy || !file || (domain === 'runners' && (!workspace || !distro))}
                    onClick={upload}
                  >
                    校验并上传
                  </button>
                </fieldset>
              )}
              {action === 'apply' && (
                <label className="integration-lab-check">
                  <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
                  已审阅当前计划、目标、写请求范围和清理责任。
                </label>
              )}
              <div className="integration-lab-actions">
                <button
                  disabled={
                    busy ||
                    !action ||
                    (!workspace && domain !== 'exchange' && action !== 'create-workspace') ||
                    (action === 'apply' && !approved)
                  }
                  onClick={() => execute()}
                >
                  提交操作
                </button>
                <button disabled={busy} onClick={() => execute(true)}>
                  读取当前记录
                </button>
              </div>
            </>
          )}
          {busy && <p role="status">正在处理，尚未取得结果。</p>}
          {error && (
            <p role="alert" className="integration-lab-error">
              {error}
            </p>
          )}
          {output !== null && (
            <div className="integration-lab-output">
              <h3>服务返回</h3>
              <pre>{JSON.stringify(output, null, 2)}</pre>
              <button
                onClick={() => {
                  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }),
                    url = URL.createObjectURL(blob),
                    a = document.createElement('a');
                  a.href = url;
                  a.download = 'integration-result.json';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                保存 JSON
              </button>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}
export default IntegrationLabPanel;
