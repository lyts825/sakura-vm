/**
 * 模块职责（中文）：编辑 GPU/vGPU 配置档案，预览设备分配并向实例应用所选配置。
 * Module responsibility (English): Editing GPU profiles and previewing and applying resource allocation.
 * 详细范围（中文）：公开入口包括 GpuProfilesSettings；职责覆盖编辑 GPU 档案并预览和应用资源分配，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include GpuProfilesSettings. The scope covers Editing GPU profiles and previewing and applying resource allocation. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useState } from 'react';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';

type Input = { name: string; graphics: 'virtio-gpu' | 'virgl'; outputs: number;
  width: number; height: number; hostMemoryMiB: number; minVmMemoryMiB: number };
type Profile = Input & { id: string; revision: number };
type Preview = { ready: boolean; reasons: string[]; previewToken: string;
  before: object; after: object; qemuDeviceArguments: string[];
  vmName: string; profileId: string; profileRevision: number };
type View = { profiles: Profile[];
  support: Record<'virtio-gpu' | 'virgl', { available: boolean; reason?: string }>;
  assignments: { vmId: string; vmName: string | null; profileId: string;
    profileName: string; profileRevision: number; drifted: boolean }[] };
type VM = { id: string; name: string; status: string };
/**
 * 中文：返回新 GPU 档案表单默认值，包括 virtio-gpu、单输出、尺寸和最低内存，不保存档案。
 * English: Return new GPU-profile form defaults including virtio-gpu, one output, dimensions and minimum memory without persisting a profile.
 * 中文：结果：Input，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Input carrying the described computation/transport result; throwing branches do not provide success
 */
const empty = (): Input => ({ name: '', graphics: 'virtio-gpu', outputs: 1,
  width: 1280, height: 800, hostMemoryMiB: 256, minVmMemoryMiB: 512 });

/**
 * 中文：呈现编辑 GPU 档案并预览和应用资源分配中的 GpuProfilesSettings 界面，订阅 /gpu-profiles、/vms，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the GpuProfilesSettings surface for Editing GPU profiles and previewing and applying resource allocation, subscribing to /gpu-profiles, /vms. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function GpuProfilesSettings({ request }: { request: Request }) {
  const remote = useRemote<View>(request, '/gpu-profiles', true, 15000);
  const vms = useRemote<VM[]>(request, '/vms', true, 5000);
  const action = useAction();
  const [draft, setDraft] = useState<Input>(empty);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [target, setTarget] = useState('');
  const [review, setReview] = useState<Preview | null>(null);
  const currentTarget = target || vms.data?.[0]?.id || '';
  const selected = remote.data?.profiles.find((profile) => profile.id === review?.profileId);
  /**
   * 中文：提交 POST /gpu-profiles，完成编辑 GPU 档案并预览和应用资源分配的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /gpu-profiles for Editing GPU profiles and previewing and applying resource allocation. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const save = () => void action.run(/** 中文：提交 POST /gpu-profiles，完成编辑 GPU 档案并预览和应用资源分配的数据交互并更新editing 状态、编辑草稿、review 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /gpu-profiles for Editing GPU profiles and previewing and applying resource allocation and update editing state, editing draft, review state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    await request('/gpu-profiles', 'POST', { operation: 'save',
      ...(editing ? { id: editing.id, revision: editing.revision } : {}), profile: draft }, signal);
    setEditing(null); setDraft(empty()); setReview(null); remote.reload();
  }, 'GPU 档案已保存');
  /**
   * 中文：提交 POST /gpu-profiles，完成编辑 GPU 档案并预览和应用资源分配的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /gpu-profiles for Editing GPU profiles and previewing and applying resource allocation. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：profile：签名所示 Profile 业务值
   * English: Inputs: profile: the Profile domain value in the signature
   */
  const preview = (profile: Profile) => void action.run(/** 中文：提交 POST /gpu-profiles，完成编辑 GPU 档案并预览和应用资源分配的数据交互并更新review 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /gpu-profiles for Editing GPU profiles and previewing and applying resource allocation and update review state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    setReview(await request<Preview>('/gpu-profiles', 'POST',
      { operation: 'preview', id: profile.id, vmId: currentTarget }, signal));
  });
  /**
   * 中文：提交 POST /gpu-profiles，完成编辑 GPU 档案并预览和应用资源分配的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /gpu-profiles for Editing GPU profiles and previewing and applying resource allocation. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const apply = () => void action.run(/** 中文：提交 POST /gpu-profiles，完成编辑 GPU 档案并预览和应用资源分配的数据交互并更新review 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /gpu-profiles for Editing GPU profiles and previewing and applying resource allocation and update review state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    await request('/gpu-profiles', 'POST', { operation: 'apply', id: review!.profileId,
      vmId: currentTarget, previewToken: review!.previewToken }, signal);
    setReview(null); remote.reload(); vms.reload();
  }, 'GPU 档案已应用；下次启动实例时生效');
  /**
   * 中文：提交 POST /gpu-profiles，完成编辑 GPU 档案并预览和应用资源分配的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /gpu-profiles for Editing GPU profiles and previewing and applying resource allocation. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：profile：签名所示 Profile 业务值
   * English: Inputs: profile: the Profile domain value in the signature
   */
  const remove = (profile: Profile) => void action.run(/** 中文：提交 POST /gpu-profiles，完成编辑 GPU 档案并预览和应用资源分配的数据交互并更新editing 状态、编辑草稿、review 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /gpu-profiles for Editing GPU profiles and previewing and applying resource allocation and update editing state, editing draft, review state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    await request('/gpu-profiles', 'POST',
      { operation: 'remove', id: profile.id, revision: profile.revision }, signal);
    if (editing?.id === profile.id) { setEditing(null); setDraft(empty()); }
    if (review?.profileId === profile.id) setReview(null);
    remote.reload();
  }, 'GPU 档案已删除，已应用的实例硬件配置保持原样');
  const valid = draft.name.trim() && Number.isInteger(draft.outputs) && draft.outputs >= 1 &&
    draft.outputs <= 4 && Number.isInteger(draft.width) && draft.width >= 640 && draft.width <= 3840 &&
    Number.isInteger(draft.height) && draft.height >= 480 && draft.height <= 2160 &&
    Number.isInteger(draft.hostMemoryMiB) && draft.hostMemoryMiB >= 64 &&
    draft.hostMemoryMiB <= 1024 && Number.isInteger(draft.minVmMemoryMiB) &&
    draft.minVmMemoryMiB >= 256 && draft.minVmMemoryMiB <= 8192;
  return <section className="system-card" aria-label="GPU/vGPU 档案">
    <h3>GPU/vGPU 档案</h3>
    <p>保存虚拟显卡配置，探测当前宿主 QEMU 后端，再对停止的 x86_64 实例预览和应用。应用后需要启动实例，客户机还需对应 Virtio GPU 驱动。</p>
    <Feedback error={action.error || remote.error || vms.error} message={action.message} />
    <p className="subtle-note">2D 后端：{remote.data?.support['virtio-gpu'].available ? '可启动' :
      remote.data?.support['virtio-gpu'].reason || '探测中'}；VirGL 3D 后端：
      {remote.data?.support.virgl.available ? '可启动' :
        remote.data?.support.virgl.reason || '探测中'}</p>
    <div className="shortcut-fields">
      <label>档案名称<input aria-label="GPU 档案名称" value={draft.name} maxLength={64}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>显卡后端<select aria-label="GPU 显卡后端" value={draft.graphics}
        onChange={(event) => setDraft({ ...draft,
          graphics: event.target.value as Input['graphics'] })}>
        <option value="virtio-gpu">Virtio GPU 2D</option><option value="virgl">VirGL 3D</option>
      </select></label>
      <label>输出数量<input aria-label="GPU 输出数量" type="number" min={1} max={4}
        value={draft.outputs} onChange={(event) => setDraft({ ...draft,
          outputs: Number(event.target.value) })} /></label>
      <label>宽度<input aria-label="GPU 宽度" type="number" min={640} max={3840}
        value={draft.width} onChange={(event) => setDraft({ ...draft,
          width: Number(event.target.value) })} /></label>
      <label>高度<input aria-label="GPU 高度" type="number" min={480} max={2160}
        value={draft.height} onChange={(event) => setDraft({ ...draft,
          height: Number(event.target.value) })} /></label>
      <label>宿主显存上限 MiB<input aria-label="GPU 宿主显存" type="number" min={64} max={1024}
        value={draft.hostMemoryMiB} onChange={(event) => setDraft({ ...draft,
          hostMemoryMiB: Number(event.target.value) })} /></label>
      <label>实例最低内存 MiB<input aria-label="GPU 最低实例内存" type="number" min={256} max={8192}
        value={draft.minVmMemoryMiB} onChange={(event) => setDraft({ ...draft,
          minVmMemoryMiB: Number(event.target.value) })} /></label>
    </div>
    <button className="primary compact" disabled={action.busy || !valid} onClick={save}>
      {editing ? '更新 GPU 档案' : '保存 GPU 档案'}</button>{' '}
    {editing && <button className="secondary compact" onClick={() => {
      setEditing(null); setDraft(empty());
    }}>新建档案</button>}
    <div className="feature-card">
      <h4>应用目标</h4>
      <select aria-label="GPU 目标实例" value={currentTarget}
        onChange={(event) => { setTarget(event.target.value); setReview(null); }}>
        {vms.data?.map((vm) => <option key={vm.id} value={vm.id}>{vm.name} · {vm.status}</option>)}
      </select>
      {!vms.data?.length && <p className="subtle-note">请先创建实例。</p>}
    </div>
    <h4>已保存档案</h4>
    {!remote.data?.profiles.length && <p className="subtle-note">尚无档案。</p>}
    {remote.data?.profiles.map((profile) => <div className="host-peer-row" key={profile.id}>
      <span><strong>{profile.name}</strong> · {profile.graphics} · {profile.outputs} 输出 ·
        {profile.width}×{profile.height} · 修订 {profile.revision}</span>
      <button className="secondary compact" disabled={action.busy} onClick={() => {
        setEditing(profile); setDraft({ name: profile.name, graphics: profile.graphics,
          outputs: profile.outputs, width: profile.width, height: profile.height,
          hostMemoryMiB: profile.hostMemoryMiB, minVmMemoryMiB: profile.minVmMemoryMiB });
      }}>编辑</button>
      <button className="secondary compact" disabled={action.busy || !currentTarget}
        onClick={() => preview(profile)}>预览应用</button>
      <button className="secondary compact" disabled={action.busy}
        onClick={() => remove(profile)}>删除档案</button>
    </div>)}
    {review && <div className="feature-card" role="region" aria-label="GPU 档案应用预览">
      <h4>复核 {review.vmName} · 档案修订 {review.profileRevision}</h4>
      {review.reasons.length > 0 && <p>{review.reasons.join('；')}</p>}
      <pre className="feature-log">{JSON.stringify({ before: review.before, after: review.after,
        qemuDeviceArguments: review.qemuDeviceArguments }, null, 2)}</pre>
      <button className="primary compact" disabled={action.busy || !review.ready ||
        selected?.revision !== review.profileRevision || !currentTarget}
        onClick={apply}>应用到停止实例</button>
    </div>}
    {!!remote.data?.assignments.length && <div className="feature-card">
      <h4>最近应用</h4>
      {remote.data.assignments.map((assignment) => <p key={assignment.vmId}>
        {assignment.vmName || assignment.vmId} · {assignment.profileName} 修订
        {assignment.profileRevision} · {assignment.drifted ? '硬件配置已另行改变' : '配置仍匹配'}
      </p>)}
    </div>}
  </section>;
}
