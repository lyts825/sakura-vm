/**
 * 模块职责（中文）：编辑功能灰度规则，预览目标匹配结果并查看当前发布策略。
 * Module responsibility (English): Configuring feature rollout rules and previewing matching targets.
 * 详细范围（中文）：公开入口包括 FeatureRolloutSettings；职责覆盖配置功能灰度规则并预览匹配结果，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include FeatureRolloutSettings. The scope covers Configuring feature rollout rules and previewing matching targets. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useId, useState } from 'react';
import type { RolloutPolicy } from '../server/feature-rollouts';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';
import './features.css';
import './feature-rollout-settings.css';

type Draft = Pick<RolloutPolicy, 'pluginId' | 'enabled' | 'percentage' | 'cohortVersion'>;
type Decision = { pluginId: string; allowed: boolean; bucket: number | null;
  policy?: RolloutPolicy };
type RolloutView = {
  hostId: string;
  plugins: Array<Decision & { id: string; name: string }>;
  policies: RolloutPolicy[];
  selected: string[];
  active: string[];
};
/**
 * 中文：为指定插件创建启用、100% 比例与 v1 队列版本的灰度草稿，供尚无服务器规则时编辑。
 * English: Create an enabled, one-hundred-percent, v1-cohort rollout draft for the plugin when no server rule exists.
 * 中文：输入：pluginId：签名所示 string 业务值
 * English: Inputs: pluginId: the string domain value in the signature
 * 中文：结果：Draft，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Draft carrying the described computation/transport result; throwing branches do not provide success
 */
const initial = (pluginId: string): Draft => ({
  pluginId, enabled: true, percentage: 100, cohortVersion: 'v1',
});

/**
 * 中文：呈现配置功能灰度规则并预览匹配结果中的 FeatureRolloutSettings 界面，订阅 /feature-rollouts，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the FeatureRolloutSettings surface for Configuring feature rollout rules and previewing matching targets, subscribing to /feature-rollouts. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function FeatureRolloutSettings({ request }: { request: Request }) {
  const remote = useRemote<RolloutView>(request, '/feature-rollouts', true, 5000);
  const action = useAction();
  const [draft, setDraft] = useState<Draft>(initial(''));
  const [preview, setPreview] = useState<Decision | null>(null);
  const pluginId = draft.pluginId || remote.data?.plugins[0]?.id || '';
  const plugin = remote.data?.plugins.find((item) => item.id === pluginId);
  const saved = remote.data?.policies.find((item) => item.pluginId === pluginId);
  const current = draft.pluginId === pluginId ? draft : saved ? {
    pluginId, enabled: saved.enabled, percentage: saved.percentage,
    cohortVersion: saved.cohortVersion,
  } : initial(pluginId);
  const hintId = useId();
  const percentageValid = Number.isInteger(current.percentage) && current.percentage >= 0 && current.percentage <= 100;
  const valid = !!current.cohortVersion.trim() && percentageValid;
  const baseline = saved || initial(pluginId);
  const dirty = current.enabled !== baseline.enabled || current.percentage !== baseline.percentage || current.cohortVersion !== baseline.cohortVersion;
  const change = (value: Partial<Draft>) => { setDraft({ ...current, ...value }); setPreview(null); action.clear(); };
  /**
   * 中文：在配置功能灰度规则并预览匹配结果流程中编辑草稿，preview 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Configuring feature rollout rules and previewing matching targets, editing draft, preview state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：id：目标资源标识
   * English: Inputs: id: target resource identifier
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const choose = (id: string) => {
    const policy = remote.data?.policies.find((item) => item.pluginId === id);
    setDraft(policy ? { pluginId: id, enabled: policy.enabled,
      percentage: policy.percentage, cohortVersion: policy.cohortVersion } : initial(id));
    setPreview(null);
    action.clear();
  };
  /**
   * 中文：提交 POST /feature-rollouts，完成配置功能灰度规则并预览匹配结果的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /feature-rollouts for Configuring feature rollout rules and previewing matching targets. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const save = () => void action.run(/** 中文：提交 POST /feature-rollouts，完成配置功能灰度规则并预览匹配结果的数据交互并更新preview 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /feature-rollouts for Configuring feature rollout rules and previewing matching targets and update preview state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    await request('/feature-rollouts', 'POST', {
      operation: 'save', ...(saved ? { revision: saved.revision } : {}), policy: current,
    }, signal);
    setPreview(null);
    remote.reload();
  }, '灰度策略已保存，重启 Sakura 服务后应用到插件启动');
  /**
   * 中文：提交 POST /feature-rollouts，完成配置功能灰度规则并预览匹配结果的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /feature-rollouts for Configuring feature rollout rules and previewing matching targets. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const remove = () => void action.run(/** 中文：提交 POST /feature-rollouts，完成配置功能灰度规则并预览匹配结果的数据交互并更新编辑草稿、preview 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /feature-rollouts for Configuring feature rollout rules and previewing matching targets and update editing draft, preview state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    if (!saved) return;
    await request('/feature-rollouts', 'POST', {
      operation: 'remove', pluginId, revision: saved.revision,
    }, signal);
    setDraft(initial(pluginId));
    setPreview(null);
    remote.reload();
  }, '灰度策略已删除，重启 Sakura 服务后恢复默认启动');
  /**
   * 中文：提交 POST /feature-rollouts，完成配置功能灰度规则并预览匹配结果的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /feature-rollouts for Configuring feature rollout rules and previewing matching targets. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const inspect = () => void action.run(/** 中文：提交 POST /feature-rollouts，完成配置功能灰度规则并预览匹配结果的数据交互并更新preview 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /feature-rollouts for Configuring feature rollout rules and previewing matching targets and update preview state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    setPreview(await request<Decision>('/feature-rollouts', 'POST',
      { operation: 'preview', policy: current }, signal));
  });
  return <section className="system-card feature-rollout-settings" aria-label="插件功能灰度">
    <div className="panel-heading">
      <div><h3>插件功能灰度</h3><p>按当前主机的稳定分桶决定插件是否启动；策略在下次服务启动时生效。</p></div>
      <button className="secondary compact" disabled={action.busy} onClick={remote.reload}>刷新</button>
    </div>
    <Feedback error={action.error || remote.error} message={action.message} />
    <div className="feature-card rollout-editor">
      <h4>编辑灰度策略</h4>
      <p className="rollout-draft-state">{dirty ? '草稿有未保存的修改' : saved ? '与已保存策略一致' : '尚未设置独立策略'}{saved ? ` · 已保存版本 ${saved.revision}` : ''}</p>
      <fieldset className="rollout-fields" disabled={action.busy || !remote.data?.plugins.length}>
      <div className="shortcut-fields">
        <div className="feature-rollout-field"><label htmlFor="rollout-plugin">插件</label>
          <select id="rollout-plugin" value={pluginId}
            onChange={(event) => choose(event.target.value)}>
            {remote.data?.plugins.map((item) => <option key={item.id} value={item.id}>
              {item.name} ({item.id})</option>)}
          </select>
        </div>
        <label>灰度版本<input value={current.cohortVersion} maxLength={64} aria-label="灰度版本"
          aria-invalid={!current.cohortVersion.trim() || undefined} aria-describedby={`${hintId}-cohort`}
          onChange={(event) => change({ cohortVersion: event.target.value })} />
          <small id={`${hintId}-cohort`}>必填，最多 64 个字符。修改后会重新计算主机分桶。</small></label>
        <label>放行比例（0–100%）<input type="number" min={0} max={100} step={1}
          aria-label="放行比例（0–100%）" aria-invalid={!percentageValid || undefined} aria-describedby={`${hintId}-percentage`}
          value={current.percentage} onChange={(event) => change({ percentage: Number(event.target.value) })} />
          <small id={`${hintId}-percentage`} className={!percentageValid ? 'rollout-field-error' : undefined}>填写 0～100 的整数，0% 表示下次启动时跳过。</small></label>
      </div>
      <label className="check"><input type="checkbox" checked={current.enabled}
        onChange={(event) => change({ enabled: event.target.checked })} />启用该插件的灰度策略</label>
      <p className="subtle-note">关闭开关或设置 0% 会在下次启动时跳过插件；没有策略时按插件中心的选择启动。</p>
      <p>当前服务：{plugin && remote.data?.active.includes(pluginId) ? '已激活' :
        remote.data?.selected.includes(pluginId) ? '未激活' : '未在插件中心选择'}；
        已保存策略的下次启动分桶：{plugin?.allowed ? '命中' : '未命中'}。
        {plugin?.bucket !== null && plugin?.bucket !== undefined &&
          ` 分桶值 ${plugin.bucket} / 10000。`}</p>
      {preview && <p>当前草稿预览：{preview.allowed ? '将命中' : '将跳过'}；
        分桶值 {preview.bucket} / 10000。</p>}
      <div className="feature-actions">
        <button className="secondary compact" disabled={action.busy || !plugin || !valid}
          onClick={inspect}>预览当前主机</button>
        <button className="primary compact" disabled={action.busy || !plugin || !valid}
          onClick={save}>保存灰度策略</button>
        {saved && <button className="secondary compact" disabled={action.busy}
          onClick={remove}>删除策略</button>}
        {dirty && <button className="text-button" onClick={() => choose(pluginId)}>撤销草稿修改</button>}
      </div>
      </fieldset>
    </div>
  </section>;
}
