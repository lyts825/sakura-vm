/**
 * 模块职责（中文）：配置本地模型并预览脱敏上下文，执行问答/解释/修复建议和命令计划请求。
 * Module responsibility (English): Previewing redacted model context and requesting suggestions and command plans.
 * 详细范围（中文）：公开入口包括 LocalAssistant；职责覆盖预览脱敏模型上下文并请求建议和命令计划，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include LocalAssistant. The scope covers Previewing redacted model context and requesting suggestions and command plans. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
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
/**
 * 中文：呈现预览脱敏模型上下文并请求建议和命令计划中的 LocalAssistant 界面，订阅 /assistant，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the LocalAssistant surface for Previewing redacted model context and requesting suggestions and command plans, subscribing to /assistant. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 */
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
  useEffect(/** 中文：当依赖 [] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    alive.current = true;
    /**
     * 中文：在预览脱敏模型上下文并请求建议和命令计划流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Previewing redacted model context and requesting suggestions and command plans, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      alive.current = false;
      active.current?.abort();
    };
  }, []);
  const loadedVersion = useRef(0);
  useEffect(/** 中文：当依赖 [remote.data] 变化时settings 状态，preview 状态，操作结果，models 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [remote.data] change, settings state, preview state, operation result, models state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (remote.data && remote.data.version !== loadedVersion.current) {
      loadedVersion.current = remote.data.version;
      setSettings(remote.data.settings);
      setPreview(undefined);
      setResult(undefined);
      setModels([]);
    }
  }, [remote.data]);
  /**
   * 中文：在预览脱敏模型上下文并请求建议和命令计划流程中preview 状态，操作结果，错误反馈，完成提示；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Previewing redacted model context and requesting suggestions and command plans, preview state, operation result, error feedback, completion message. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const resetPreview = () => {
    setPreview(undefined);
    setResult(undefined);
    setError('');
    setMessage('');
  };
  /**
   * 中文：在预览脱敏模型上下文并请求建议和命令计划流程中settings 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Previewing redacted model context and requesting suggestions and command plans, settings state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：value：待校验、转换或保存的输入值
   * English: Inputs: value: input value to validate/transform/save
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const change = (value: Partial<AssistantSettings>) => {
    setSettings({ ...settings, ...value });
    resetPreview();
  };
  /**
   * 中文：在预览脱敏模型上下文并请求建议和命令计划流程中忙碌标记，错误反馈，完成提示；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Previewing redacted model context and requesting suggestions and command plans, busy flag, error feedback, completion message. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：work：签名所示 (signal: AbortSignal) => Promise<void> 业务值
   * English: Inputs: work: the (signal: AbortSignal) => Promise<void> domain value in the signature
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   * 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态
   * English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state
   */
  const run = async (work: /** 中文：在动作取消信号内执行助手请求，并把结果交回反馈流程；这是 LocalAssistant.run 的调用契约 | English: Execute assistant work within the action cancellation signal and deliver results to feedback; this is the callable contract of LocalAssistant.run | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：Promise<void>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<void>; callers depend on this type contract, with promise rejection representing asynchronous failure */ (signal: AbortSignal) => Promise<void>) => {
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
  /**
   * 中文：在预览脱敏模型上下文并请求建议和命令计划流程中timeout 状态，创建二进制内容临时 URL；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Previewing redacted model context and requesting suggestions and command plans, timeout state, create temporary binary-content URLs. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
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
        onSubmit={/**
         * 中文功能：拦截配置提交，保存本地助手设置；未取消时清除旧预览与模型列表，显示成功反馈并刷新。
         * English: Intercept configuration submission and save local-assistant settings; if not cancelled, clear old previews/model lists, show success feedback and refresh.
         * 输入 / Inputs: event.
         * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
         * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
         */
        (event) => {
          event.preventDefault();
          void run(/** 中文：提交 POST /assistant，完成预览脱敏模型上下文并请求建议和命令计划的数据交互并更新models 状态、完成提示；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /assistant for Previewing redacted model context and requesting suggestions and command plans and update models state, completion message. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
                void run(/** 中文：提交 POST /assistant，完成预览脱敏模型上下文并请求建议和命令计划的数据交互并更新models 状态、完成提示；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /assistant for Previewing redacted model context and requesting suggestions and command plans and update models state, completion message. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
              void run(/** 中文：提交 POST /assistant，完成预览脱敏模型上下文并请求建议和命令计划的数据交互并更新preview 状态、操作结果；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /assistant for Previewing redacted model context and requesting suggestions and command plans and update preview state, operation result. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
              void run(/** 中文：提交 POST /assistant，完成预览脱敏模型上下文并请求建议和命令计划的数据交互并更新preview 状态、操作结果；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /assistant for Previewing redacted model context and requesting suggestions and command plans and update preview state, operation result. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
          <button className="secondary compact" onClick={/** 中文：在预览脱敏模型上下文并请求建议和命令计划流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Previewing redacted model context and requesting suggestions and command plans, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation */ () => active.current?.abort()}>
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
