/** 可填写的受管表单预览；回答经固定动作持久保存，条件与计算只采用服务回执。 */
import { useEffect, useId, useRef, useState } from 'react';
import type { SuitePlan, SuiteRecord, SuiteRef } from '../shared/contracts/suite-common.ts';
import { SeventhEditor, seventhObject, seventhPretty } from './SeventhEditor.tsx';

type Post = <T>(domain: string, action: string, body: unknown, signal?: AbortSignal) => Promise<T>;
export type SeventhFormPreviewProps = {
  definition: Record<string, unknown>;
  source?: SuiteRef;
  workspaceId: string;
  post: Post;
  onReceipt?: (record: SuiteRecord) => void;
};
type Problem = { field: string | null; code: string };
type Navigation = {
  direction: 'next' | 'previous' | 'goto';
  currentPageId: string | null;
  targetPageId: string | null;
  blocked: boolean;
  errors: Problem[];
  atEnd: boolean;
  canSubmit: boolean;
};
type Result = {
  values: Record<string, unknown>;
  hidden: string[];
  errors: Problem[];
  path: string[];
  passed: boolean;
  definitionDigest: string;
  navigation?: Navigation;
};
const array = (value: unknown) => (Array.isArray(value) ? value : []);
const label = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
const messages: Record<string, string> = {
  REQUIRED: '请填写此项',
  TYPE: '回答类型不符',
  RANGE: '数值超出允许范围',
  RULE_FAILED: '未满足表单规则',
};

export function SeventhFormPreview(props: SeventhFormPreviewProps) {
  return (
    <FormSession
      key={
        props.workspaceId + '\0' + JSON.stringify(props.definition) + '\0' + (props.source?.revision ?? '')
      }
      {...props}
    />
  );
}
function FormSession({ definition, source, workspaceId, post, onReceipt }: SeventhFormPreviewProps) {
  const fields = array(definition.fields)
      .map(seventhObject)
      .filter((v): v is Record<string, unknown> => !!v),
    pages = array(definition.pages)
      .map(seventhObject)
      .filter((v): v is Record<string, unknown> => !!v);
  const invalid =
    fields.length > 200 ||
    pages.length > 20 ||
    fields.some((f) => typeof f.id !== 'string' || reserved.has(f.id));
  const completeAnswers = (input: Record<string, unknown>) => {
    const next = { ...input };
    for (const field of fields)
      if (
        typeof field.id === 'string' &&
        !reserved.has(field.id) &&
        field.compute === undefined &&
        !Object.hasOwn(next, field.id)
      )
        next[field.id] = Object.hasOwn(field, 'default')
          ? field.default
          : field.type === 'boolean'
            ? false
            : field.type === 'repeated'
              ? []
              : '';
    return next;
  };
  const initial = completeAnswers(seventhObject(definition.answers) ?? {});
  const [answers, setAnswers] = useState<Record<string, unknown>>(initial),
    [result, setResult] = useState<Result | null>(null),
    [current, setCurrent] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [receipt, setReceipt] = useState<SuiteRecord | null>(null),
    [dirty, setDirty] = useState(true);
  const latest = useRef(answers),
    version = useRef(0),
    active = useRef<AbortController | null>(null),
    postRef = useRef(post),
    receiptRef = useRef(onReceipt),
    id = useId();
  postRef.current = post;
  receiptRef.current = onReceipt;
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  const update = (field: string, value: unknown) => {
    const next = { ...latest.current, [field]: value };
    latest.current = next;
    version.current++;
    setAnswers(next);
    setDirty(true);
  };
  const save = async (
    method: 'open' | 'answer' | 'navigate' = 'answer',
    direction?: Navigation['direction'],
    targetPageId?: string,
  ) => {
    if (active.current || invalid) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    const captured = version.current,
      snapshot = completeAnswers(latest.current);
    try {
      const input = {
        fields: definition.fields,
        rules: definition.rules ?? [],
        pages: definition.pages ?? [],
        answers: snapshot,
        ...(method === 'navigate'
          ? {
              ...(current ? { currentPageId: current } : {}),
              direction,
              ...(targetPageId ? { targetPageId } : {}),
            }
          : {}),
      };
      const plan = await postRef.current<SuitePlan>(
        'fform-previews',
        'previewAction',
        {
          workspaceId,
          name: method === 'navigate' ? '表单预览导航' : '表单预览回答',
          method,
          input,
          references: source?.domain === 'fform-previews' ? [source] : [],
          bindings: {},
        },
        controller.signal,
      );
      const row = await postRef.current<SuiteRecord>(
        'fform-previews',
        'executeAction',
        { workspaceId, planId: plan.id, digest: plan.digest },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      const content = seventhObject(row.content),
        output = seventhObject(content?.output);
      if (content?.state === 'failed')
        throw new Error(label(seventhObject(content.error)?.message, '表单回答未能完成'));
      if (
        !output ||
        !seventhObject(output.values) ||
        !Array.isArray(output.hidden) ||
        !output.hidden.every((v) => typeof v === 'string') ||
        !Array.isArray(output.errors) ||
        !output.errors.every((v) => {
          const error = seventhObject(v);
          return (
            error &&
            typeof error.code === 'string' &&
            (error.field === null || typeof error.field === 'string')
          );
        }) ||
        !Array.isArray(output.path) ||
        !output.path.every((v) => typeof v === 'string') ||
        typeof output.passed !== 'boolean' ||
        typeof output.definitionDigest !== 'string' ||
        !/^[a-f0-9]{64}$/.test(output.definitionDigest)
      )
        throw new Error('表单服务没有返回完整预览回执');
      const next = output as unknown as Result;
      if (method === 'navigate') {
        const nav = seventhObject(output.navigation);
        if (
          !nav ||
          !['next', 'previous', 'goto'].includes(String(nav.direction)) ||
          typeof nav.blocked !== 'boolean' ||
          !(nav.targetPageId === null || typeof nav.targetPageId === 'string') ||
          !Array.isArray(nav.errors)
        )
          throw new Error('表单服务没有返回导航回执');
      }
      setReceipt(row);
      receiptRef.current?.(row);
      if (captured !== version.current) {
        setError('回答已在保存期间变化，请保存当前回答后继续。');
        return;
      }
      latest.current = { ...next.values };
      setAnswers(latest.current);
      setResult(next);
      setDirty(false);
      setCurrent((previous) =>
        method === 'navigate'
          ? next.navigation!.blocked
            ? previous
            : (next.navigation!.targetPageId ?? '')
          : next.path.includes(previous)
            ? previous
            : (next.path[0] ?? ''),
      );
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    void save('open');
  }, []);
  const path = result?.path ?? [],
    page = pages.find((p) => p.id === current),
    hidden = new Set(result?.hidden ?? []),
    errors = result?.errors ?? [],
    at = path.indexOf(current);
  const assigned = new Set(array(page?.fields));
  const visible = fields.filter(
    (field) =>
      !hidden.has(String(field.id)) &&
      (assigned.size
        ? assigned.has(field.id)
        : (!field.page && !field.pageId) || (field.page ?? field.pageId) === current),
  );
  return (
    <section className="sv-card" aria-label="可填写表单预览">
      <h3>填写表单预览</h3>
      <p className="sv-hint">保存回答会生成本地预览记录。分页按当前回答重算，预览不代表正式提交。</p>
      {source && (
        <p className="sv-hint">
          定义来源：{source.domain} / {source.id} · {source.revision.slice(0, 12)}
        </p>
      )}
      {invalid ? (
        <p role="alert">定义的字段、页数或字段名称超出预览范围。</p>
      ) : (
        <>
          <div className="sv-pagination">
            <strong>{label(page?.label, label(page?.title, current || '当前预览'))}</strong>
            <span>
              {path.length ? `第 ${Math.max(0, at) + 1} / ${path.length} 页` : '尚无可显示的条件页面'}
            </span>
            {busy && <span role="status">正在保存并计算…</span>}
            {dirty && !busy && <span>当前回答尚未保存</span>}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            noValidate
          >
            <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
              {visible.map((field, index) => {
                const key = String(field.id),
                  name = label(field.label, label(field.name, key)),
                  value = answers[key],
                  problems = errors.filter((e) => e.field === key),
                  inputId = id + '-' + index,
                  problemId = inputId + '-errors';
                return (
                  <div className="sv-field" key={key}>
                    <label htmlFor={inputId}>
                      {name}
                      {field.required === true ? '（必填）' : ''}
                    </label>
                    {typeof field.description === 'string' && <p className="sv-hint">{field.description}</p>}
                    {field.compute !== undefined ? (
                      <output id={inputId} aria-label={name}>
                        {value === undefined
                          ? '等待计算'
                          : typeof value === 'string'
                            ? value
                            : seventhPretty(value)}
                      </output>
                    ) : field.type === 'boolean' ? (
                      <input
                        id={inputId}
                        type="checkbox"
                        checked={value === true}
                        onChange={(event) => update(key, event.target.checked)}
                        aria-invalid={problems.length > 0}
                        aria-describedby={problemId}
                      />
                    ) : field.type === 'enum' ? (
                      <select
                        id={inputId}
                        value={array(field.values).findIndex((v) => Object.is(v, value))}
                        onChange={(event) =>
                          update(
                            key,
                            Number(event.target.value) < 0
                              ? ''
                              : array(field.values)[Number(event.target.value)],
                          )
                        }
                        aria-invalid={problems.length > 0}
                        aria-describedby={problemId}
                      >
                        <option value={-1}>请选择</option>
                        {array(field.values).map((v, i) => (
                          <option key={i} value={i}>
                            {typeof v === 'string' ? v : seventhPretty(v)}
                          </option>
                        ))}
                      </select>
                    ) : field.type === 'repeated' ? (
                      <div id={inputId}>
                        {array(value).map((row, i) => (
                          <div
                            key={
                              typeof seventhObject(row)?.id === 'string' ? String(seventhObject(row)!.id) : i
                            }
                          >
                            <SeventhEditor
                              label={`${name}第 ${i + 1} 项`}
                              value={row}
                              onChange={(next) =>
                                update(
                                  key,
                                  array(value).map((old, at) => (at === i ? next : old)),
                                )
                              }
                            />
                            <button
                              type="button"
                              onClick={() =>
                                update(
                                  key,
                                  array(value).filter((_, at) => at !== i),
                                )
                              }
                            >
                              删除此项
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          disabled={array(value).length >= 100}
                          onClick={() => update(key, [...array(value), { id: crypto.randomUUID() }])}
                        >
                          添加明细
                        </button>
                      </div>
                    ) : ['integer', 'number', 'date', 'text'].includes(String(field.type)) ? (
                      <input
                        id={inputId}
                        type={
                          field.type === 'date'
                            ? 'date'
                            : ['integer', 'number'].includes(String(field.type))
                              ? 'number'
                              : 'text'
                        }
                        value={typeof value === 'string' || typeof value === 'number' ? value : ''}
                        maxLength={
                          field.type === 'text' && typeof field.maxLength === 'number'
                            ? field.maxLength
                            : 4096
                        }
                        step={field.type === 'integer' ? 1 : 'any'}
                        min={typeof field.min === 'number' ? field.min : undefined}
                        max={typeof field.max === 'number' ? field.max : undefined}
                        onChange={(event) =>
                          update(
                            key,
                            ['integer', 'number'].includes(String(field.type)) && event.target.value !== ''
                              ? Number(event.target.value)
                              : event.target.value,
                          )
                        }
                        aria-invalid={problems.length > 0}
                        aria-describedby={problemId}
                      />
                    ) : (
                      <p role="alert">此字段类型无法在预览中填写，请修改定义。</p>
                    )}
                    <div id={problemId}>
                      {problems.map((problem, i) => (
                        <p className="sv-error" key={i}>
                          {messages[problem.code] ?? problem.code}
                        </p>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div className="sv-pagination">
                <button type="submit" className="sv-primary">
                  保存回答并更新预览
                </button>
                <button type="button" disabled={at <= 0} onClick={() => void save('navigate', 'previous')}>
                  保存并上一页
                </button>
                <button
                  type="button"
                  disabled={at < 0 || at + 1 >= path.length}
                  onClick={() => void save('navigate', 'next')}
                >
                  保存并下一页
                </button>
                {path.length > 1 && (
                  <select
                    aria-label="跳转预览页"
                    value={current}
                    onChange={(event) => void save('navigate', 'goto', event.target.value)}
                  >
                    {path.map((pageId) => (
                      <option key={pageId} value={pageId}>
                        {label(pages.find((p) => p.id === pageId)?.label, pageId)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </fieldset>
          </form>
          {errors
            .filter((e) => e.field === null)
            .map((e, i) => (
              <p className="sv-error" key={i}>
                {messages[e.code] ?? e.code}
              </p>
            ))}
          {result?.navigation?.blocked && (
            <div role="alert" className="sv-error">
              <span>
                当前页未满足规则，已保留原页。
                {result.navigation.errors
                  .map((e) => `${e.field ?? '表单'}：${messages[e.code] ?? e.code}`)
                  .join('；')}
              </span>
            </div>
          )}
          {result && (
            <p role="status">
              {dirty ? '上次保存的回答' : '当前回答'}
              {result.passed ? '通过本次规则检查。' : `有 ${errors.length} 项检查问题。`}
              {hidden.size ? `已隐藏 ${hidden.size} 个字段。` : ''}
            </p>
          )}
          {receipt && (
            <p className="sv-hint">
              已保存预览：{receipt.id} · {receipt.revision.slice(0, 12)}
              {result ? ` · 定义摘要 ${result.definitionDigest.slice(0, 12)}` : ''}
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="sv-error">
          {error}
        </p>
      )}
    </section>
  );
}
