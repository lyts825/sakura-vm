import { formatDecimal } from './localization';
import { formatDateTime } from './localization';
import { useEffect, useRef, useState } from 'react';
import {
  assistantModes,
  type AssistantSettings,
  type AssistantView,
  type AssistantPreview,
  type AssistantResult,
  type AssistantMode,
} from '../shared/assistant';
import { Feedback, useRemote, type Request } from './feature-shared';

const names: Record<AssistantMode, string> = {
  ask: '编程问答',
  explain: '解释代码',
  tests: '测试建议',
  fix: '修复建议',
  plan: '自然语言命令规划',
};
export function LocalAssistant({ request }: { request: Request }) {
  const remote = useRemote<AssistantView>(request, '/assistant', true, 0);
  const [settings, setSettings] = useState<AssistantSettings>({
    enabled: false,
    endpoint: 'http://127.0.0.1:11434',
    model: '',
    timeoutSeconds: 120,
    maxTokens: 2048,
  });
  const [models, setModels] = useState<Array<{ name: string; size: number }>>([]);
  const [mode, setMode] = useState<AssistantMode>('ask'),
    [instruction, setInstruction] = useState(''),
    [context, setContext] = useState('');
  const [preview, setPreview] = useState<AssistantPreview>(),
    [result, setResult] = useState<AssistantResult>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const active = useRef<AbortController | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      active.current?.abort();
    };
  }, []);
  const loadedVersion = useRef(0);
  useEffect(() => {
    if (remote.data && remote.data.version !== loadedVersion.current) {
      loadedVersion.current = remote.data.version;
      setSettings(remote.data.settings);
      setPreview(undefined);
      setResult(undefined);
      setModels([]);
    }
  }, [remote.data]);
  const resetPreview = () => {
    setPreview(undefined);
    setResult(undefined);
    setError('');
    setMessage('');
  };
  const change = (value: Partial<AssistantSettings>) => {
    setSettings({ ...settings, ...value });
    resetPreview();
  };
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (active.current) return;
    const abort = new AbortController();
    active.current = abort;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work(abort.signal);
    } catch (error) {
      if (alive.current) {
        if (abort.signal.aborted) setMessage('请求已取消');
        else setError(error instanceof Error ? error.message : '操作失败');
      }
    } finally {
      if (active.current === abort) active.current = null;
      if (alive.current) setBusy(false);
    }
  };
  const dirty = !remote.data || JSON.stringify(settings) !== JSON.stringify(remote.data.settings);
  const exportResult = () => {
    if (!result) return;
    const data = result.plan
      ? JSON.stringify({ ...result, executed: false, requiresReview: true }, null, 2)
      : result.content;
    const url = URL.createObjectURL(
      new Blob([data], { type: result.plan ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = result.plan ? 'sakura-command-plan.json' : 'sakura-assistant.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="system-card local-assistant" aria-label="本地 AI 编程助手">
      <h3>本地 AI 编程助手</h3>
      <p className="subtle-note">
        连接已经运行的本机 Ollama，使用已下载的 GGUF 模型提供编程建议。Sakura
        只发送下方显式输入的内容；会检查模型是否声明远程转发，并在发送前提供脱敏预览。
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(async (signal) => {
            await request(
              '/assistant',
              'POST',
              { action: 'configure', version: remote.data!.version, settings },
              signal,
            );
            if (!signal.aborted) {
              resetPreview();
              setModels([]);
              setMessage('模型设置已保存');
              remote.reload();
            }
          });
        }}
      >
        <fieldset disabled={busy || !remote.data}>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => change({ enabled: event.target.checked })}
            />
            启用本地模型连接
          </label>
          <div className="shortcut-fields">
            <label>
              模型服务地址
              <input
                type="url"
                required
                value={settings.endpoint}
                onChange={(event) => change({ endpoint: event.target.value })}
              />
            </label>
            <label>
              模型名称
              <input
                list="local-models"
                value={settings.model}
                maxLength={128}
                onChange={(event) => change({ model: event.target.value })}
              />
              <datalist id="local-models">
                {models.map((model) => (
                  <option key={model.name} value={model.name}>
                    {formatDecimal((model.size / 1024 ** 3), 1)} GiB
                  </option>
                ))}
              </datalist>
            </label>
            <label>
              请求超时（秒）
              <input
                type="number"
                min={10}
                max={300}
                required
                value={settings.timeoutSeconds || ''}
                onChange={(event) => change({ timeoutSeconds: Number(event.target.value) })}
              />
            </label>
            <label>
              最大生成 token
              <input
                type="number"
                min={128}
                max={8192}
                required
                value={settings.maxTokens || ''}
                onChange={(event) => change({ maxTokens: Number(event.target.value) })}
              />
            </label>
          </div>
          <div className="button-row">
            <button className="secondary compact" type="submit">
              保存模型设置
            </button>
            <button
              className="secondary compact"
              type="button"
              disabled={dirty || !settings.enabled}
              onClick={() =>
                void run(async (signal) => {
                  const value = await request<{ models: typeof models }>(
                    '/assistant',
                    'POST',
                    { action: 'models' },
                    signal,
                  );
                  if (!signal.aborted) {
                    setModels(value.models);
                    setMessage(`已发现 ${value.models.length} 个本地模型，可在模型名称中选择后保存。`);
                  }
                })
              }
            >
              读取本地模型
            </button>
          </div>
        </fieldset>
      </form>
      <p className="subtle-note">
        本机模型服务也可能提供云模型；这里拒绝已声明的远程模型。建议将 Ollama
        配置为仅本地模式。模型服务自行管理其日志。识别规则不能覆盖所有敏感信息，请检查预览并手动去除遗漏。
      </p>
      <fieldset disabled={busy}>
        <div className="shortcut-fields">
          <label>
            助手任务
            <select
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as AssistantMode);
                resetPreview();
              }}
            >
              {assistantModes.map((item) => (
                <option key={item} value={item}>
                  {names[item]}
                </option>
              ))}
            </select>
          </label>
          <label>
            问题或目标
            <textarea
              rows={3}
              maxLength={4000}
              value={instruction}
              onChange={(event) => {
                setInstruction(event.target.value);
                resetPreview();
              }}
            />
          </label>
        </div>
        <label>
          代码或上下文（可选）
          <textarea
            rows={8}
            maxLength={20000}
            value={context}
            spellCheck={false}
            onChange={(event) => {
              setContext(event.target.value);
              resetPreview();
            }}
          />
        </label>
        <div className="button-row">
          <button
            className="secondary compact"
            disabled={!instruction.trim() || dirty}
            onClick={() =>
              void run(async (signal) => {
                const value = await request<AssistantPreview>(
                  '/assistant',
                  'POST',
                  { action: 'preview', input: { mode, instruction, context } },
                  signal,
                );
                if (!signal.aborted) {
                  setPreview(value);
                  setResult(undefined);
                }
              })
            }
          >
            预览发送内容
          </button>
          <button
            className="text-button"
            onClick={() => {
              setInstruction('');
              setContext('');
              resetPreview();
            }}
          >
            清除输入和结果
          </button>
        </div>
      </fieldset>
      {preview && (
        <div className="assistant-preview">
          <h4>发送预览</h4>
          <p className="subtle-note">
            {preview.endpoint} · {preview.model || '尚未选择模型'} · 已替换 {preview.redactions}{' '}
            处疑似敏感内容 · 预览有效期 5 分钟
          </p>
          <pre aria-label="脱敏发送内容" className="api-json">
            {preview.content}
          </pre>
          <button
            className="primary compact"
            disabled={busy || dirty || !settings.enabled || !preview.model}
            onClick={() =>
              void run(async (signal) => {
                const id = preview.id;
                setPreview(undefined);
                const value = await request<AssistantResult>(
                  '/assistant',
                  'POST',
                  { action: 'generate', previewId: id },
                  signal,
                );
                if (!signal.aborted) setResult(value);
              })
            }
          >
            发送到本地模型
          </button>
        </div>
      )}
      {busy && (
        <div className="button-row">
          <span role="status">正在处理模型请求…</span>
          <button className="secondary compact" onClick={() => active.current?.abort()}>
            取消模型请求
          </button>
        </div>
      )}
      <Feedback error={error || remote.error} message={message} />
      {result && (
        <div className="assistant-result">
          <h4>{result.plan ? '命令计划 · 等待人工审阅' : '模型建议'}</h4>
          <p className="subtle-note">
            {result.model} · {formatDateTime(new Date(result.generatedAt))} · 建议尚未执行或验证
            {result.truncated ? ' · 输出达到生成长度限制' : ''}
          </p>
          {result.plan ? (
            <>
              <p>{result.plan.goal}</p>
              {!!result.plan.assumptions.length && (
                <ul>
                  {result.plan.assumptions.map((assumption, i) => (
                    <li key={i}>{assumption}</li>
                  ))}
                </ul>
              )}
              <ol>
                {result.plan.steps.map((step, i) => (
                  <li key={i}>
                    <strong>{step.purpose}</strong>
                    <p>
                      模型标注：{{ read: '只读', change: '会写入', destructive: '删除或覆盖' }[step.risk]}
                    </p>
                    <pre className="api-json">{step.command}</pre>
                    <p>验证方式：{step.verify}</p>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <pre aria-label="模型返回内容" className="api-json">
              {result.content}
            </pre>
          )}
          <button className="secondary compact" onClick={exportResult}>
            下载本次结果
          </button>
        </div>
      )}
    </section>
  );
}
