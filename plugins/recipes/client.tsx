/**
 * 模块职责（中文）：“环境配方”插件的项目环境配方连接、导入和导出界面，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for project environment recipe import/export.
 * 详细范围（中文）：公开入口包括 RecipeConnection, RecipeImporter；职责覆盖项目环境配方的导入导出的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include RecipeConnection, RecipeImporter. The scope covers UI interaction and state presentation for project environment recipe import/export. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RecipePlan } from '../../shared/contracts/recipe-plan.ts';
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';
import { saveText } from '../../src/export-file';
import type { FeatureProps, Request } from '../../src/feature-shared';
import { Feedback, useAction } from '../../src/feature-shared';
import { usePlugin } from '../../src/plugin-context';
import { PluginDevelopmentSection } from '../../src/plugin-client';
import '../../src/features.css';
type RecipeProject = OperationResponse<'recipes.legacy.put.vms.vmId.recipe'>['project'];

/**
 * 中文：呈现项目环境配方的导入导出的界面交互与状态呈现中的 RecipeConnection 界面，组合 Download，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the RecipeConnection surface for UI interaction and state presentation for project environment recipe import/export and composing Download. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  vm,
  request,
  applied,
} 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力）、applied（applied 状态） 上下文字段
 * English: Inputs: {
  vm,
  request,
  applied,
} provides context fields vm (vm state), request (transport capability bound to identity/authority scope), applied (applied state)
 */
export function RecipeConnection({ vm, request, projectId, applied, ...context }: FeatureProps & {
  /** 保存后通知父视图刷新。 Refresh the parent view after saving. */
  applied: (project: RecipeProject) => void;
}) {
  const [recipe, setRecipe] = useState('');
  const [preview, setPreview] = useState<{ plan: RecipePlan; request: Request; source: string }>();
  const [showRuntime, setShowRuntime] = useState(false);
  const hasRuntimes = usePlugin('runtimes');
  const action = useAction();
  const plan = preview?.request === request && preview.source === recipe &&
    preview.plan.vmId === vm.id && (!projectId || preview.plan.projectId === projectId) ? preview.plan : undefined;
  /** 切换实例或项目后丢弃旧预览。 Discard previews after changing VM/project context. */
  useEffect(() => { setPreview(undefined); setShowRuntime(false); }, [vm.id, projectId, request]);
  return (
    <>
      <details className="feature-card">
        <summary>分享与导入项目环境</summary>
        <p className="subtle-note">先预览 sakura.json 的字段差异，再应用项目配置。资源变更需要在对应面板单独完成。</p>
        <div className="feature-actions">
          <button className="secondary compact" disabled={action.busy}
            onClick={() => void action.run(async (signal) => {
              // 导出声明供审阅，不探测安装状态。 Export declarations, without probing installed state.
              const result = await request<OperationResponse<'recipes.legacy.get.vms.vmId.recipe'>>(
                `/vms/${vm.id}/recipe`, 'GET', undefined, signal);
              signal.throwIfAborted();
              setRecipe(JSON.stringify(result, null, 2)); setPreview(undefined); saveText('sakura.json', result);
            })}><Download size={14} />导出配置</button>
          <button className="secondary compact" disabled={action.busy || vm.status !== 'running'}
            onClick={() => void action.run(async (signal) => {
              // 从当前项目读取配方。 Read the recipe from the current project.
              const result = await request<OperationResponse<'recipes.legacy.post.vms.vmId.recipe'>>(
                `/vms/${vm.id}/recipe`, 'POST', { action: 'read' }, signal);
              signal.throwIfAborted(); setRecipe(JSON.stringify(result, null, 2)); setPreview(undefined);
            }, '已读取项目目录中的 sakura.json')}>从项目读取</button>
          <button className="secondary compact" disabled={action.busy || vm.status !== 'running'}
            onClick={() => void action.run((signal) =>
              request(`/vms/${vm.id}/recipe`, 'POST', { action: 'write' }, signal), '已在项目目录新建 sakura.json')}>
            写入项目目录</button>
        </div>
        <label>待应用的环境配置
          <textarea rows={10} value={recipe} disabled={action.busy}
            onChange={(e) => { setRecipe(e.target.value); setPreview(undefined); }} placeholder="粘贴 sakura.json 内容" />
        </label>
        <button className="primary compact" disabled={action.busy || !recipe.trim()}
          onClick={() => void action.run(async (signal) => {
            // 预览响应必须与发出请求的上下文及文本相同。 Bind the preview to its request context and source text.
            setPreview(undefined);
            const result = await request<RecipePlan>(`/vms/${vm.id}/recipe/plan`, 'POST', JSON.parse(recipe), signal);
            signal.throwIfAborted(); setPreview({ plan: result, request, source: recipe });
          })}>预览环境变更</button>
        {plan && <section aria-label="环境变更预览">
          <p>{plan.unchanged ? '配置相同，无需修改。' : `发现 ${plan.changes.length} 项差异。`}</p>
          {plan.changes.length > 0 && <div style={{ overflowX: 'auto' }}><table>
            <thead><tr><th>字段</th><th>当前配置</th><th>目标声明</th><th>处理方式</th></tr></thead>
            <tbody>{plan.changes.map(change => <tr key={change.field}>
              <td>{change.field}</td><td style={{ overflowWrap: 'anywhere' }}>{change.before}</td>
              <td style={{ overflowWrap: 'anywhere' }}>{change.after}</td><td>
                <strong>{{ apply: '可保存', 'stop-required': '需停机', 'rebuild-required': '需重建',
                  'separate-operation': '独立操作', unsupported: '不支持' }[change.disposition]}</strong>
                <p>{change.reason}</p></td>
            </tr>)}</tbody></table></div>}
          {plan.warnings.map(warning => <p className="subtle-note" key={warning}>{warning}</p>)}
          <p className="subtle-note">预览有效期 10 分钟；实例、项目或资源变化后需重新预览。每次应用都会消费预览。</p>
          <details><summary>配置摘要</summary><p style={{ overflowWrap: 'anywhere' }}>输入：{plan.inputSha256}</p>
            <p style={{ overflowWrap: 'anywhere' }}>当前配置：{plan.configurationSha256}</p>
            <p style={{ overflowWrap: 'anywhere' }}>资源声明：{plan.resourceDeclarationSha256}</p></details>
          <button className="primary compact" disabled={action.busy || !plan.canApply}
            onClick={() => void action.run(async (signal) => {
              // 清除令牌后发送一次受控应用请求。 Clear the token before sending one guarded apply request.
              setPreview(undefined);
              const result = await request<OperationResponse<'recipes.legacy.put.vms.vmId.recipe'>>(
                `/vms/${vm.id}/recipe/apply-plan`, 'POST', { token: plan.token }, signal);
              signal.throwIfAborted(); applied(result.project);
            }, plan.unchanged ? '配置相同，未写入任何变更' : '项目配置已保存；请按需准备环境并探测实际版本')}>
            {plan.unchanged ? '确认无需变更' : '应用已预览的项目配置'}</button>
        </section>}
        <details open={showRuntime} onToggle={(event) => setShowRuntime(event.currentTarget.open)}>
          <summary>核对实际 Node/Python 运行时</summary>
          <p className="subtle-note">这里复用运行时插件的独立探测与安装操作。采样结果不属于配置预览。</p>
          {showRuntime && (hasRuntimes ? <PluginDevelopmentSection {...context} vm={vm} request={request}
            projectId={projectId} id="runtimes" /> : <p>请先在插件中心启用“运行时版本”。</p>)}
        </details>
      </details>
      <Feedback error={action.error} message={action.message} />
    </>
  );
}

/**
 * 中文：呈现项目环境配方的导入导出的界面交互与状态呈现中的 RecipeImporter 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the RecipeImporter surface for UI interaction and state presentation for project environment recipe import/export. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request, refresh } 提供 request（带身份和权限作用域的传输能力）、refresh（refresh 状态） 上下文字段
 * English: Inputs: { request, refresh } provides context fields request (transport capability bound to identity/authority scope), refresh (refresh state)
 */
export function RecipeImporter({ request, refresh }: { request: Request; refresh: /** 中文：请求父级重新核对远端视图；完成异步刷新后才兑现返回值；这是 RecipeImporter 的调用契约 | English: Ask the parent to reconcile remote state and fulfill only after asynchronous refresh; this is the callable contract of RecipeImporter | 中文：结果：Promise<unknown>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<unknown>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<unknown> }) {
  const [name, setName] = useState('shared-dev'),
    [recipe, setRecipe] = useState('');
  const action = useAction();
  return (
    <details className="feature-card">
      <summary>从 sakura.json 创建环境</summary>
      <label>
        新实例名称
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        选择配置文件
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void action.run(/** 中文：在项目环境配方的导入导出的界面交互与状态呈现流程中recipe 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In UI interaction and state presentation for project environment recipe import/export, recipe state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：拒绝原因：配置文件不能超过 1 MiB。这些错误交给直接调用者或本函数 catch 处理 | English: Refusal reasons: 配置文件不能超过 1 MiB. These errors reach the direct caller or this function's catch handler | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async (signal) => {
                if (file.size > 1024 ** 2) throw new Error('配置文件不能超过 1 MiB');
                const text = await file.text();
                signal.throwIfAborted();
                setRecipe(text);
              });
          }}
        />
      </label>
      <label>
        配置内容
        <textarea rows={8} value={recipe} onChange={(e) => setRecipe(e.target.value)} />
      </label>
      <button
        className="primary compact"
        disabled={action.busy || !recipe}
        onClick={() =>
          void action.run(/** 中文：提交 POST /recipes，完成项目环境配方的导入导出的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /recipes for UI interaction and state presentation for project environment recipe import/export. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async (signal) => {
            await request('/recipes', 'POST', { name, recipe: JSON.parse(recipe) }, signal);
            signal.throwIfAborted();
            await refresh();
          }, '环境已创建，可在项目面板准备环境并启动')
        }
      >
        创建环境
      </button>
      <Feedback error={action.error} message={action.message} />
    </details>
  );
}
