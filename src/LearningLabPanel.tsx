/** 所有者自学：固定课内动作、逐步批准、实际快照和可核验的自评。 */
import { useEffect, useRef, useState } from 'react';
import type { Request } from './feature-shared';
import type * as S from '../shared/contracts/suite-common';
import type { ImageAsset } from '../shared/contracts/image-assets';
import type { SuiteHostCapacity } from '../shared/contracts/suite-capacity';
import * as L from '../shared/contracts/learning-lab';
import * as T from '../shared/contracts/suite-execution-learning';
import {
  learningHttpSchemas,
  learningTemplate,
  learningView,
  learningExample,
} from '../shared/contracts/learning-http';
import { useSuiteClient, suiteReference as ref, suiteReferenceKey as key } from './suite-client';
import { SuiteRecordSelect } from './SuiteRecordSelect';
import { SuitePlanDialog } from './SuitePlanDialog';
import { SuiteExchangePanel } from './SuiteExchangePanel';
import { SuitePublicationRecoveryPanel } from './SuitePublicationRecoveryPanel';
import { SuiteHostCapacityStatus } from './SuiteHostCapacityStatus';
import './suite-workbench.css';
const titles: Record<string, string> = {
  courses: '课程',
  assets: '课内材料',
  lessons: '课节',
  environments: '环境与检查点',
  steps: '固定步骤',
  checks: '检查规则',
  sessions: '学习会话',
  progress: '进度',
  assessments: '自评',
  exchange: '交接',
};
type Step = (typeof L.learningStepDefinition)['_output'];
type Rule = (typeof T.learningCheck)['_output'];
export function LearningLabPanel({
  request,
  accessEpoch,
  authorized = true,
}: {
  request: Request;
  accessEpoch?: unknown;
  authorized?: boolean;
}) {
  if (!authorized) return <p>请解锁会话后查看学习材料。</p>;
  return <LearningSession key={String(accessEpoch ?? 'local')} request={request} />;
}
function LearningSession({ request }: { request: Request }) {
  const call = useSuiteClient(request, 'learning', learningHttpSchemas),
    mounted = useRef(true),
    epoch = useRef(0),
    operation = useRef(false);
  const [spaces, setSpaces] = useState<S.SuiteWorkspace[]>([]),
    [workspaceId, setWorkspace] = useState(''),
    [rows, setRows] = useState<Record<string, S.SuiteRecord[]>>({}),
    [selection, setSelection] = useState<Record<string, string>>({}),
    [images, setImages] = useState<ImageAsset[]>([]),
    [imageId, setImage] = useState(''),
    [templates, setTemplates] = useState<(typeof learningTemplate)['_output'][]>([]),
    [templateId, setTemplate] = useState(''),
    [tab, setTab] = useState(0),
    [name, setName] = useState('我的练习'),
    [description, setDescription] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [capacity, setCapacity] = useState<SuiteHostCapacity>(),
    [transfers, setTransfers] = useState<S.SuiteUpload[]>([]),
    [plan, setPlan] = useState<{ value: S.SuitePlan; domain: string; apply: string } | null>(null);
  const [filePath, setFilePath] = useState('lesson.txt'),
    [fileText, setFileText] = useState(''),
    [files, setFiles] = useState<(typeof T.learningFile)['_output'][]>([]),
    [lessonKey, setLessonKey] = useState('lesson-1'),
    [lessonBody, setLessonBody] = useState(''),
    [prerequisites, setPrerequisites] = useState('');
  const [stepId, setStepId] = useState('step-1'),
    [instruction, setInstruction] = useState(''),
    [kind, setKind] = useState<(typeof T.learningAction)['_output']['kind']>('write'),
    [actionPath, setActionPath] = useState('lesson.txt'),
    [actionText, setActionText] = useState(''),
    [method, setMethod] = useState<'GET' | 'POST'>('GET'),
    [route, setRoute] = useState<'/state' | '/echo'>('/state'),
    [body, setBody] = useState('{}'),
    [editable, setEditable] = useState(false),
    [steps, setSteps] = useState<Step[]>([]);
  const [checkId, setCheckId] = useState('check-1'),
    [checkKind, setCheckKind] = useState<Rule['kind']>('exists'),
    [checkPath, setCheckPath] = useState('lesson.txt'),
    [expected, setExpected] = useState(''),
    [exists, setExists] = useState(true),
    [match, setMatch] = useState<'equals' | 'contains'>('equals'),
    [status, setStatus] = useState<200 | 503>(200),
    [rules, setRules] = useState<Rule[]>([]),
    [included, setIncluded] = useState<Record<string, string[]>>({}),
    [selectedStep, setSelectedStep] = useState(''),
    [overrideText, setOverrideText] = useState(''),
    [overrideBody, setOverrideBody] = useState('{}'),
    [override, setOverride] = useState(false),
    [review, setReview] = useState(''),
    [reviewed, setReviewed] = useState(false),
    [history, setHistory] = useState('sessions');
  const scope = { workspaceId };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current++;
    };
  }, []);
  const invoke = async <R,>(domain: string, action: string, input: unknown = {}): Promise<R> => {
    const original = epoch.current,
      result = await call<R>(domain, action, input);
    if (!mounted.current || original !== epoch.current) throw new DOMException('工作区已切换', 'AbortError');
    return result;
  };
  const selected = (domain: string) => rows[domain]?.find((row) => key(row) === selection[domain]);
  const fixed = (domain: string, format?: string) => {
    const row = selected(domain);
    if (
      !row ||
      row.state !== 'sealed' ||
      row.origin !== 'local' ||
      (format && (row.content as any)?.format !== format)
    )
      throw new Error('请选择本地' + titles[domain] + '固定修订');
    return ref(row);
  };
  const add = (row: S.SuiteRecord) => {
    const domain = row.domain.replace('learning-', '');
    setRows((old) => ({
      ...old,
      [domain]: [row, ...(old[domain] ?? []).filter((r) => key(r) !== key(row))],
    }));
    setSelection((old) => ({ ...old, [domain]: key(row) }));
  };
  const refresh = async () => {
    const view = await invoke<(typeof learningView)['_output']>(
      'workbench',
      'view',
      workspaceId ? { ...scope, cursor: 0, limit: 20 } : {},
    );
    setSpaces(view.workspaces);
    if (workspaceId) {
      setRows(
        Object.fromEntries(
          view.domains.map((domain) => [domain.id.replace('learning-', ''), domain.records]),
        ),
      );
      setTransfers(await invoke('exchange', 'transfers', scope));
      setCapacity(await invoke('courses', 'hostCapacity', scope));
    }
  };
  const run = async (work: () => Promise<unknown>, message = '已保存固定记录') => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const version = epoch.current;
    try {
      await work();
      if (mounted.current && version === epoch.current) setNotice(message);
    } catch (issue) {
      if (mounted.current && version === epoch.current)
        setError(issue instanceof Error ? issue.message : String(issue));
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    let current = true;
    void (async () => {
      await refresh();
      setImages(await invoke('assets', 'images'));
      setTemplates(await invoke('workbench', 'templates'));
    })().catch((issue) => {
      if (current && mounted.current && issue?.name !== 'AbortError')
        setError(String(issue.message ?? issue));
    });
    return () => {
      current = false;
    };
  }, [workspaceId]);
  const preview = async (domain: string, action: string, input: unknown, apply: string) =>
    setPlan({ value: await invoke<S.SuitePlan>(domain, action, input), domain, apply });
  const choose = (domain: string, format?: string, label = titles[domain]) => (
    <SuiteRecordSelect
      title={label}
      rows={(rows[domain] ?? []).filter((row) => !format || (row.content as any)?.format === format)}
      value={selection[domain] ?? ''}
      onChange={(value) => {
        setSelection((old) => ({ ...old, [domain]: value }));
        if (domain === 'lessons') {
          setSelectedStep('');
          setOverride(false);
        }
      }}
    />
  );
  const button = (label: string, work: () => Promise<unknown>, disabled = false) => (
    <button key={label} disabled={busy || disabled} onClick={() => void run(work)}>
      {label}
    </button>
  );
  const image = () => {
    const value = images.find((image) => image.id === imageId);
    if (!value) throw new Error('请选择已准备 Python 的镜像');
    return { assetId: value.id, digest: value.digest };
  };
  const multiple = (domain: string, format: string) => (
    <fieldset>
      <legend>纳入本次{titles[domain]}</legend>
      {(rows[domain] ?? [])
        .filter(
          (row) =>
            row.state === 'sealed' && row.origin === 'local' && (row.content as any)?.format === format,
        )
        .map((row) => (
          <label className="suite-check" key={key(row)}>
            <input
              type="checkbox"
              checked={(included[domain] ?? []).includes(key(row))}
              onChange={(event) =>
                setIncluded((old) => ({
                  ...old,
                  [domain]: event.target.checked
                    ? [...(old[domain] ?? []), key(row)]
                    : (old[domain] ?? []).filter((value) => value !== key(row)),
                }))
              }
            />
            {row.name} · {row.revision.slice(0, 8)}
          </label>
        ))}
    </fieldset>
  );
  const references = (domain: string) =>
    (included[domain] ?? []).map((value) => {
      const row = rows[domain]?.find((row) => key(row) === value);
      if (!row) throw new Error('所选修订已变化，请重新选择');
      return ref(row);
    });
  const action = () =>
    T.learningAction.parse(
      kind === 'write'
        ? { kind, path: actionPath, content: actionText }
        : kind === 'read'
          ? { kind, path: actionPath }
          : kind === 'request'
            ? { kind, method, path: route, ...(method === 'POST' ? { body: JSON.parse(body) } : {}) }
            : { kind },
    );
  const rule = () =>
    T.learningCheck.parse(
      checkKind === 'exists'
        ? { id: checkId, kind: checkKind, path: checkPath, expected: exists }
        : checkKind === 'text'
          ? { id: checkId, kind: checkKind, path: checkPath, expected, mode: match }
          : checkKind === 'json'
            ? { id: checkId, kind: checkKind, path: checkPath, expected: JSON.parse(expected) }
            : { id: checkId, kind: checkKind, expected: status },
    );
  const progress = L.learningProgress.safeParse(selected('progress')?.content),
    assessment = L.learningAssessment.safeParse(selected('assessments')?.content);
  const session = L.learningSession.safeParse(selected('sessions')?.content),
    lesson = L.learningLesson.safeParse(selected('lessons')?.content),
    lessonRef = selected('lessons') ? ref(selected('lessons')!) : null;
  const lessonSteps = (rows.steps ?? []).flatMap((row) => {
      const parsed = L.learningSteps.safeParse(row.content);
      return parsed.success && lessonRef && key(parsed.data.lesson) === key(lessonRef)
        ? parsed.data.steps
        : [];
    }),
    step = lessonSteps.find((value) => value.id === selectedStep);
  const missing = lesson.success
    ? lesson.data.prerequisites.filter(
        (required) =>
          !(rows.lessons ?? []).some((row) => {
            const value = L.learningLesson.safeParse(row.content);
            return (
              value.success &&
              value.data.key === required &&
              session.success &&
              session.data.completedLessons.some((done) => key(done) === key(row))
            );
          }),
      )
    : [];
  const selectWorkspace = (value: string) => {
    epoch.current++;
    setWorkspace(value);
    setRows({});
    setSelection({});
    setIncluded({});
    setPlan(null);
    setCapacity(undefined);
    setTransfers([]);
    setError('');
    setNotice('');
    setSelectedStep('');
  };
  return (
    <section className="suite-workbench">
      <header>
        <h1>动手学习工作台</h1>
        <p>所有者自学与实际课内检查。每步在新隔离虚拟机执行，快照承接下一步；自评记录不代表考试或认证。</p>
      </header>
      <div className="suite-toolbar">
        <label>
          学习空间
          <select
            aria-label="学习空间"
            value={workspaceId}
            disabled={busy}
            onChange={(e) => selectWorkspace(e.target.value)}
          >
            <option value="">新建或选择空间</option>
            {spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
                {space.quarantined ? ' · 隔离参考' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          名称
          <input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
        </label>
        {button('刷新固定记录', refresh)}
        <label>
          运行镜像
          <select aria-label="运行镜像" value={imageId} onChange={(e) => setImage(e.target.value)}>
            <option value="">请选择已准备的镜像</option>
            {images.map((image) => (
              <option key={image.id} value={image.id}>
                {image.distro} · {image.architecture} · {image.digest.slice(0, 12)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>
        需 Python 3 标准库与可重新初始化的 x86_64 镜像。每步至少预留 8 GiB 虚拟磁盘，加上镜像和材料。默认 8
        GiB 套件额度不足，请先准备镜像并明确配置总预算。
      </p>
      {capacity && <SuiteHostCapacityStatus value={capacity} />}
      <nav className="suite-tabs" aria-label="学习工作台页面">
        {['课程与材料', '课节与固定动作', '会话与检查点', '进度与自评', '交换材料', '历史与恢复'].map(
          (label, i) => (
            <button
              key={label}
              className={tab === i ? 'active' : undefined}
              aria-pressed={tab === i}
              onClick={() => setTab(i)}
            >
              {label}
            </button>
          ),
        )}
      </nav>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {tab === 0 && (
        <div className="suite-grid">
          <article>
            <h2>选择模板或建立课程</h2>
            <label>
              初始模板
              <select aria-label="初始模板" value={templateId} onChange={(e) => setTemplate(e.target.value)}>
                <option value="">不使用模板</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <p>
              {templates.find((template) => template.id === templateId)?.description ??
                '课程内容与镜像由你选择，模板不会自动运行。'}
            </p>
            {button(
              '建立模板课程',
              async () => {
                const value = await invoke<(typeof learningExample)['_output']>(
                  'workbench',
                  'createExample',
                  {
                    name,
                    template: templateId,
                    image: image(),
                  },
                );
                selectWorkspace(value.workspace.id);
                for (const row of [
                  value.course,
                  value.source,
                  value.asset,
                  value.lesson,
                  value.steps,
                  value.checks,
                  value.environment,
                ])
                  add(row);
              },
              !templateId || !imageId,
            )}
            <label>
              课程说明
              <textarea
                value={description}
                maxLength={16000}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            {button('创建空白课程', async () => {
              const value = await invoke<{ workspace: S.SuiteWorkspace; course: S.SuiteRecord }>(
                'courses',
                'create',
                { ...(workspaceId ? scope : {}), name, title: name, description },
              );
              if (value.workspace.id !== workspaceId) selectWorkspace(value.workspace.id);
              add(value.course);
            })}
            {choose('courses', 'sakura-learning-course/1')}
            {multiple('lessons', 'sakura-learning-lesson/1')}
            {button(
              '固定课程课节',
              async () =>
                add(
                  await invoke('courses', 'sealCourse', {
                    ...scope,
                    course: fixed('courses'),
                    lessons: references('lessons'),
                  }),
                ),
              !workspaceId,
            )}
          </article>
          <article>
            <h2>课内文件材料</h2>
            <p>每个文件最多 64 KiB，最多 100 个文件，共 2 MiB。只接受课内相对路径和文本。</p>
            <label>
              材料相对路径
              <input value={filePath} onChange={(e) => setFilePath(e.target.value)} maxLength={180} />
            </label>
            <label>
              材料文本
              <textarea value={fileText} onChange={(e) => setFileText(e.target.value)} />
            </label>
            {button('加入材料文件', async () => {
              const file = T.learningFile.parse({ path: filePath, content: fileText });
              setFiles(T.learningSnapshot.parse([...files.filter((old) => old.path !== file.path), file]));
            })}
            <ul>
              {files.map((file) => (
                <li key={file.path}>
                  {file.path} · {new TextEncoder().encode(file.content).length} 字节{' '}
                  <button onClick={() => setFiles(files.filter((old) => old.path !== file.path))}>
                    移除 {file.path}
                  </button>
                </li>
              ))}
            </ul>
            {button(
              '保存课内文件材料',
              async () =>
                add(await invoke('assets', 'upload', { ...scope, name, files, allowExport: false })),
              !workspaceId || !files.length,
            )}
            <SuiteRecordSelect
              title="原始文件材料"
              rows={(rows.assets ?? []).filter((row) => row.kind === 'source')}
              value={selection.source ?? ''}
              onChange={(value) => setSelection((old) => ({ ...old, source: value }))}
            />
            {button(
              '固定材料与镜像',
              async () => {
                const source = rows.assets?.find((row) => key(row) === selection.source);
                if (!source) throw new Error('请选择原始文件材料');
                add(await invoke('assets', 'pin', { ...scope, name, source: ref(source), image: image() }));
              },
              !workspaceId || !imageId,
            )}
            {choose('assets', 'sakura-learning-asset/1')}
            {button(
              '保存环境定义',
              async () =>
                add(
                  await invoke('environments', 'prepare', {
                    ...scope,
                    name,
                    course: fixed('courses'),
                    asset: fixed('assets', 'sakura-learning-asset/1'),
                  }),
                ),
              !workspaceId,
            )}
            <p>环境定义不会启动虚拟机，必须在会话页预览并批准。</p>
          </article>
        </div>
      )}
      {tab === 1 && workspaceId && (
        <>
          <div className="suite-grid">
            <article>
              <h2>课节与先修规则</h2>
              {choose('courses', 'sakura-learning-course/1')}
              {choose('assets', 'sakura-learning-asset/1')}
              <label>
                课节标识
                <input value={lessonKey} onChange={(e) => setLessonKey(e.target.value)} />
              </label>
              <label>
                课节讲义
                <textarea
                  value={lessonBody}
                  maxLength={16000}
                  onChange={(e) => setLessonBody(e.target.value)}
                />
              </label>
              <label>
                先修课节标识，每行一个
                <textarea value={prerequisites} onChange={(e) => setPrerequisites(e.target.value)} />
              </label>
              {button('固定课节', async () =>
                add(
                  await invoke('lessons', 'compile', {
                    ...scope,
                    name,
                    course: fixed('courses'),
                    asset: fixed('assets', 'sakura-learning-asset/1'),
                    key: lessonKey,
                    title: name,
                    body: lessonBody,
                    prerequisites: prerequisites
                      .split(/\r?\n/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }),
                ),
              )}
              {choose('lessons', 'sakura-learning-lesson/1')}
              {lesson.success && (
                <>
                  <p>{lesson.data.body}</p>
                  <p>先修：{lesson.data.prerequisites.join('、') || '无'}</p>
                </>
              )}
            </article>
            <article>
              <h2>固定动作编辑器</h2>
              <label>
                步骤标识
                <input value={stepId} onChange={(e) => setStepId(e.target.value)} />
              </label>
              <label>
                步骤说明
                <textarea
                  value={instruction}
                  maxLength={16000}
                  onChange={(e) => setInstruction(e.target.value)}
                />
              </label>
              <label>
                固定动作
                <select
                  aria-label="固定动作"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as typeof kind);
                    setEditable(false);
                  }}
                >
                  {['list', 'read', 'write', 'demo-start', 'demo-stop', 'request', 'check'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              {['read', 'write'].includes(kind) && (
                <label>
                  动作相对路径
                  <input value={actionPath} onChange={(e) => setActionPath(e.target.value)} />
                </label>
              )}
              {kind === 'write' && (
                <label>
                  固定写入文本
                  <textarea value={actionText} onChange={(e) => setActionText(e.target.value)} />
                </label>
              )}
              {kind === 'request' && (
                <>
                  <label>
                    请求方法
                    <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                      <option>GET</option>
                      <option>POST</option>
                    </select>
                  </label>
                  <label>
                    固定本机路由
                    <select
                      aria-label="固定本机路由"
                      value={route}
                      onChange={(e) => setRoute(e.target.value as typeof route)}
                    >
                      <option>/state</option>
                      <option>/echo</option>
                    </select>
                  </label>
                  {method === 'POST' && (
                    <label>
                      固定请求正文 JSON
                      <textarea value={body} onChange={(e) => setBody(e.target.value)} />
                    </label>
                  )}
                </>
              )}
              {(kind === 'write' || kind === 'request') && (
                <label className="suite-check">
                  <input type="checkbox" checked={editable} onChange={(e) => setEditable(e.target.checked)} />
                  允许学习者在本步修改{kind === 'write' ? '文本' : '请求正文'}
                </label>
              )}
              {button(
                '加入固定步骤',
                async () => {
                  const value = L.learningStepDefinition.parse({
                    id: stepId,
                    title: name,
                    instruction,
                    action: action(),
                    editableContent: kind === 'write' && editable,
                    editableBody: kind === 'request' && editable,
                  });
                  setSteps([...steps.filter((old) => old.id !== value.id), value]);
                },
                steps.length >= 20,
              )}
              <ol>
                {steps.map((value) => (
                  <li key={value.id}>
                    {value.id} · {value.action.kind}{' '}
                    <button onClick={() => setSteps(steps.filter((old) => old.id !== value.id))}>
                      移除步骤 {value.id}
                    </button>
                  </li>
                ))}
              </ol>
              {button(
                '固定课节步骤',
                async () =>
                  add(await invoke('steps', 'compile', { ...scope, name, lesson: fixed('lessons'), steps })),
                !steps.length,
              )}
            </article>
          </div>
          <article>
            <h2>固定检查规则</h2>
            <div className="suite-toolbar">
              <label>
                检查标识
                <input value={checkId} onChange={(e) => setCheckId(e.target.value)} />
              </label>
              <label>
                检查类型
                <select value={checkKind} onChange={(e) => setCheckKind(e.target.value as Rule['kind'])}>
                  {['exists', 'text', 'json', 'status'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              {checkKind !== 'status' && (
                <label>
                  检查相对路径
                  <input value={checkPath} onChange={(e) => setCheckPath(e.target.value)} />
                </label>
              )}
              {checkKind === 'exists' && (
                <label className="suite-check">
                  <input type="checkbox" checked={exists} onChange={(e) => setExists(e.target.checked)} />
                  文件应存在
                </label>
              )}
              {checkKind === 'status' && (
                <label>
                  预期状态
                  <select value={status} onChange={(e) => setStatus(Number(e.target.value) as 200 | 503)}>
                    <option>200</option>
                    <option>503</option>
                  </select>
                </label>
              )}
              {checkKind === 'text' && (
                <label>
                  文本比较
                  <select value={match} onChange={(e) => setMatch(e.target.value as typeof match)}>
                    <option value="equals">完全相等</option>
                    <option value="contains">包含</option>
                  </select>
                </label>
              )}
            </div>
            {['text', 'json'].includes(checkKind) && (
              <label>
                预期内容{checkKind === 'json' ? ' JSON' : ''}
                <textarea value={expected} onChange={(e) => setExpected(e.target.value)} />
              </label>
            )}
            {button(
              '加入检查规则',
              async () => {
                const value = rule();
                setRules([...rules.filter((old) => old.id !== value.id), value]);
              },
              rules.length >= 30,
            )}
            <ul>
              {rules.map((value) => (
                <li key={value.id}>
                  {value.id} · {value.kind}{' '}
                  <button onClick={() => setRules(rules.filter((old) => old.id !== value.id))}>
                    移除检查 {value.id}
                  </button>
                </li>
              ))}
            </ul>
            {button(
              '固定课节检查',
              async () =>
                add(await invoke('checks', 'compile', { ...scope, name, lesson: fixed('lessons'), rules })),
              !rules.length,
            )}
          </article>
        </>
      )}
      {tab === 2 && workspaceId && (
        <>
          <div className="suite-grid">
            <article>
              <h2>预览新学习尝试</h2>
              {choose('courses', 'sakura-learning-course/1')}
              {choose('environments', 'sakura-learning-environment/1')}
              {multiple('steps', 'sakura-learning-steps/1')}
              {multiple('checks', 'sakura-learning-checks/1')}
              {button('预览新学习会话', () =>
                preview(
                  'sessions',
                  'preview',
                  {
                    ...scope,
                    name,
                    course: fixed('courses'),
                    environment: fixed('environments', 'sakura-learning-environment/1'),
                    steps: references('steps'),
                    checks: references('checks'),
                  },
                  'start',
                ),
              )}
              <p>
                初始会话先实际检查课内环境。每个后续步骤重新预览和批准。闲置 15 分钟后暂停，最多 30
                次课内操作。
              </p>
            </article>
            <article>
              <h2>原会话与检查点</h2>
              {choose('sessions', 'sakura-learning-session/1')}
              {['inspect', 'pause', 'resume', 'cancel', 'reconcile'].map((action, i) =>
                button(['读取原会话', '暂停会话', '恢复原会话', '取消原会话', '核销原资源'][i], async () => {
                  add(await invoke('sessions', action, { ...scope, session: fixed('sessions') }));
                }),
              )}
              {session.success && (
                <>
                  <p>
                    状态：{session.data.status} · 资源：{session.data.cleanup} · 结论：{session.data.outcome}
                  </p>
                  <p>
                    完成课节：{session.data.completedLessons.length} · 已执行步骤：
                    {session.data.performed.length} · 闲置截止：
                    {new Date(session.data.idleExpiresAt).toLocaleString()}
                  </p>
                  <p>
                    实际快照：{session.data.snapshot.length} 个文件 ·{' '}
                    {session.data.snapshotDigest.slice(0, 16)}
                  </p>
                </>
              )}
              {button('保存原会话检查点', async () =>
                add(
                  await invoke('environments', 'checkpoint', { ...scope, name, session: fixed('sessions') }),
                ),
              )}
              {choose('environments', 'sakura-learning-checkpoint/1', '检查点')}
              {button('由检查点建立新环境', async () =>
                add(
                  await invoke('environments', 'restore', {
                    ...scope,
                    name,
                    checkpoint: fixed('environments', 'sakura-learning-checkpoint/1'),
                  }),
                ),
              )}
              <p>恢复生成新环境与新尝试，原通过记录不迁移。</p>
            </article>
          </div>
          <article>
            <h2>逐步执行与反馈</h2>
            {choose('lessons', 'sakura-learning-lesson/1')}
            {lesson.success && (
              <>
                <p>{lesson.data.body}</p>
                <p role="status">
                  {missing.length ? '未完成的先修课节：' + missing.join('、') : '所选课节先修条件已满足。'}
                </p>
              </>
            )}
            <label>
              本次固定步骤
              <select
                aria-label="本次固定步骤"
                value={selectedStep}
                onChange={(e) => {
                  setSelectedStep(e.target.value);
                  setOverride(false);
                }}
              >
                <option value="">选择步骤</option>
                {lessonSteps.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.id} · {value.title} · {value.action.kind}
                  </option>
                ))}
              </select>
            </label>
            {step && (
              <>
                <p>{step.instruction}</p>
                <pre>{JSON.stringify(step.action, null, 2)}</pre>
                {(step.editableContent || step.editableBody) && (
                  <label className="suite-check">
                    <input
                      type="checkbox"
                      checked={override}
                      onChange={(e) => setOverride(e.target.checked)}
                    />
                    编辑本步骤允许修改的字段
                  </label>
                )}
                {override && step.editableContent && (
                  <label>
                    本次写入文本
                    <textarea value={overrideText} onChange={(e) => setOverrideText(e.target.value)} />
                  </label>
                )}
                {override && step.editableBody && (
                  <label>
                    本次请求正文 JSON
                    <textarea value={overrideBody} onChange={(e) => setOverrideBody(e.target.value)} />
                  </label>
                )}
              </>
            )}
            {button(
              '预览本次课内操作',
              () =>
                preview(
                  'sessions',
                  'previewStep',
                  {
                    ...scope,
                    session: fixed('sessions'),
                    lesson: fixed('lessons'),
                    stepId: selectedStep,
                    ...(override && step?.editableContent ? { content: overrideText } : {}),
                    ...(override && step?.editableBody ? { body: JSON.parse(overrideBody) } : {}),
                  },
                  'step',
                ),
              !step ||
                missing.length > 0 ||
                !session.success ||
                session.data.status !== 'active' ||
                !!session.data.pending,
            )}
            <p>演示服务每步在本机实际启动、请求并销毁。暂停时没有闲置后台服务，也没有任意终端或外部 URL。</p>
            {session.success &&
              session.data.attempts.map((attempt) => (
                <details key={attempt.coreId}>
                  <summary>
                    尝试 {attempt.sequence} · {attempt.stepId ?? '环境检查'} · {attempt.state} ·{' '}
                    {attempt.outcome} · {attempt.cleanup}
                  </summary>
                  {attempt.error && <p role="alert">{attempt.error}</p>}
                  {attempt.result?.error && (
                    <p role="alert">
                      {attempt.result.error.code}：{attempt.result.error.message}
                    </p>
                  )}
                  <pre>{JSON.stringify(attempt.result?.observation ?? null, null, 2)}</pre>
                  <ul>
                    {attempt.result?.checks.map((check) => (
                      <li key={check.id}>
                        {check.id}：{check.passed ? '通过' : '未通过'} {check.error ?? ''}
                        <pre>{JSON.stringify(check.actual, null, 2)}</pre>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
          </article>
        </>
      )}
      {tab === 3 && workspaceId && (
        <div className="suite-grid">
          <article>
            <h2>实际学习进度</h2>
            {choose('courses', 'sakura-learning-course/1')}
            {button('汇总当前课程进度', async () =>
              add(await invoke('progress', 'summarize', { ...scope, course: fixed('courses') })),
            )}
            {choose('progress')}
            {progress.success && (
              <table>
                <thead>
                  <tr>
                    <th>尝试</th>
                    <th>状态</th>
                    <th>完成课节</th>
                    <th>结论</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.data.attempts.map((attempt, index) => (
                    <tr key={key(attempt.session)}>
                      <td>{index + 1}</td>
                      <td>{attempt.status}</td>
                      <td>
                        {attempt.completed} / {attempt.total}
                      </td>
                      <td>{attempt.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {choose('sessions', 'sakura-learning-session/1')}
            {button('生成原会话自评', async () =>
              add(await invoke('assessments', 'assess', { ...scope, name, session: fixed('sessions') })),
            )}
          </article>
          <article>
            <h2>所有者自评与封存</h2>
            {choose('assessments', 'sakura-learning-assessment/1')}
            <label>
              自评说明
              <textarea value={review} maxLength={16000} onChange={(e) => setReview(e.target.value)} />
            </label>
            <label className="suite-check">
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
              我已完成本次自评
            </label>
            {button(
              '保存所有者自评',
              async () =>
                add(
                  await invoke('assessments', 'selfReview', {
                    ...scope,
                    assessment: fixed('assessments'),
                    note: review,
                    completed: reviewed,
                  }),
                ),
              !review.trim(),
            )}
            {button('封存原自评记录', async () =>
              add(
                await invoke('assessments', 'sealAssessment', { ...scope, assessment: fixed('assessments') }),
              ),
            )}
            {assessment.success && (
              <div>
                <p>
                  完成课节：{assessment.data.completed} / {assessment.data.total} · 结论：
                  {assessment.data.outcome}
                </p>
                <p>
                  原资源：{assessment.data.cleanup} · 自评状态：{assessment.data.status}
                </p>
                {assessment.data.selfReview && (
                  <p>
                    个人说明：{assessment.data.selfReview.note} ·{' '}
                    {assessment.data.selfReview.completed ? '自评已完成' : '自评待完成'}
                  </p>
                )}
              </div>
            )}
            <p>自评只反映本次固定检查与个人说明，不发布证书，也不代表远程考试成绩。</p>
          </article>
        </div>
      )}
      {tab === 4 && workspaceId && (
        <>
          <article>
            <h2>逐材料导出策略</h2>
            <SuiteRecordSelect
              title="原始学习材料"
              rows={(rows.assets ?? []).filter((row) => row.kind === 'source')}
              value={selection.source ?? ''}
              onChange={(value) => setSelection((old) => ({ ...old, source: value }))}
            />
            {[true, false].map((allow) =>
              button(allow ? '预览允许材料导出' : '预览撤销材料导出', async () => {
                const source = rows.assets?.find((row) => key(row) === selection.source);
                if (!source) throw new Error('请选择原始学习材料');
                const policy = await invoke<{ revision: number }>('assets', 'policy', {
                  ...scope,
                  id: source.id,
                  revision: source.revision,
                });
                await preview(
                  'assets',
                  'planPolicy',
                  {
                    ...scope,
                    id: source.id,
                    revision: source.revision,
                    expectedPolicyRevision: policy.revision,
                    allowRead: true,
                    allowExport: allow,
                  },
                  'applyPolicy',
                );
              }),
            )}
          </article>
          <SuiteExchangePanel
            invoke={invoke}
            workspaceId={workspaceId}
            domains={{ assessments: '封存学习自评' }}
            records={rows}
            transfers={transfers}
            busy={busy}
            run={run}
            preview={preview}
            onAccepted={refresh}
            downloadName="learning-lab.sakura"
            description="交接固定课程、材料和自评引用。外来完成情况只作为参考，不转移会话、工具权限或本机通过记录。"
          />
        </>
      )}
      {tab === 5 && workspaceId && (
        <article>
          <h2>原修订与恢复</h2>
          <label>
            历史领域
            <select aria-label="历史领域" value={history} onChange={(e) => setHistory(e.target.value)}>
              {Object.entries(titles).map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          {button('读取历史修订', async () => {
            const page = await invoke<S.SuitePage>(history, 'list', {
              ...scope,
              cursor: 0,
              limit: 50,
              history: true,
              archived: true,
            });
            setRows((old) => ({ ...old, [history]: page.items }));
          })}
          <label>
            历史修订
            <select
              aria-label="历史修订"
              value={selection[history] ?? ''}
              onChange={(e) => setSelection((old) => ({ ...old, [history]: e.target.value }))}
            >
              <option value="">选择原修订</option>
              {(rows[history] ?? []).map((row) => (
                <option key={key(row)} value={key(row)}>
                  {row.name} · {row.revision.slice(0, 8)} · {row.state}
                </option>
              ))}
            </select>
          </label>
          {button('归档所选修订', async () => {
            const row = selected(history);
            if (!row) throw new Error('请选择历史修订');
            add(await invoke(history, 'archive', { ...scope, id: row.id, revision: row.revision }));
          })}
          {button('预览物理清理', async () => {
            const row = selected(history);
            if (!row) throw new Error('请选择历史修订');
            await preview(history, 'previewCleanup', { ...scope, references: [ref(row)] }, 'cleanup');
          })}
          <SuitePublicationRecoveryPanel
            domain={history}
            workspaceId={workspaceId}
            invoke={invoke}
            run={run}
            preview={preview}
          />
        </article>
      )}
      {plan && (
        <SuitePlanDialog
          value={plan.value}
          busy={busy}
          onCancel={() =>
            void run(async () => {
              if (plan.domain === 'sessions' && ['start', 'step'].includes(plan.apply))
                await invoke('sessions', 'discardPreview', {
                  workspaceId: plan.value.workspaceId,
                  planId: plan.value.id,
                  digest: plan.value.digest,
                });
              setPlan(null);
            }, '已释放未执行的预览')
          }
          onApprove={() =>
            void run(async () => {
              const result = await invoke<S.SuiteRecord>(plan.domain, plan.apply, {
                workspaceId: plan.value.workspaceId,
                planId: plan.value.id,
                digest: plan.value.digest,
              });
              setPlan(null);
              await refresh();
              add(result);
            }, '原计划已提交')
          }
        />
      )}
    </section>
  );
}
