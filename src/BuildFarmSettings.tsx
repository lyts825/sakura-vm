/**
 * 模块职责（中文）：配置构建节点和标签，选择项目任务并查看构建分派及执行状态。
 * Module responsibility (English): Managing build nodes, labels and assignment of project tasks.
 * 详细范围（中文）：公开入口包括 BuildFarmSettings；职责覆盖构建节点、标签与项目任务分派的管理界面，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include BuildFarmSettings. The scope covers Managing build nodes, labels and assignment of project tasks. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useState } from 'react';
import { Feedback, JobLog, useAction, useRemote, type Request } from './feature-shared';
import type { JobView } from '../shared/contracts/jobs.ts';

type Node = { vmId: string; vmName: string | null; status: string;
  slots: number; busy: number; labels: string[]; enabled: boolean; projectId?: string };
type Task = { id: string; name: string; status: string; vmId?: string;
  labels: string[]; createdAt: string; error?: string; errorCode?: string; job: JobView | null;
  projectId?: string; directory?: string; networkIsolation?: 'host' | 'private' };
type View = { nodes: Node[]; tasks: Task[]; persistenceError?: string };
type ProjectIndex = { vmId: string; active: string; projects: Array<{ id: string; name: string }> };
type VM = { id: string; name: string; status: string };
/**
 * 中文：把节点标签文本按逗号分隔并去除空项，保留有效标签顺序。
 * English: Split node-label text by commas, discard empty entries and retain valid-label order.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 */
const labels = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);
/**
 * 中文：校验每个构建节点标签的长度和允许字符，使提交字段符合节点匹配协议。
 * English: Validate each build-node label's length/allowed characters against the node-matching contract.
 * 中文：输入：items：签名所示 string[] 业务值
 * English: Inputs: items: the string[] domain value in the signature
 */
const validLabels = (items: string[]) => items.length <= 8 &&
  new Set(items).size === items.length && items.every((item) => /^[a-z][a-z0-9-]{0,31}$/.test(item));

/**
 * 中文：呈现构建节点、标签与项目任务分派的管理界面中的 BuildFarmSettings 界面，订阅 /build-farm、/vms、/build-farm?vmId={encodeURIComponent(target)}，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the BuildFarmSettings surface for Managing build nodes, labels and assignment of project tasks, subscribing to /build-farm, /vms, /build-farm?vmId={encodeURIComponent(target)}. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function BuildFarmSettings({ request }: { request: Request }) {
  const remote = useRemote<View>(request, '/build-farm', true, 3000);
  const vms = useRemote<VM[]>(request, '/vms', true, 5000);
  const action = useAction();
  const [vmId, setVmId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [slots, setSlots] = useState(1);
  const [nodeLabels, setNodeLabels] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [cwd, setCwd] = useState('');
  const [taskLabels, setTaskLabels] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState(300);
  const target = vmId || vms.data?.[0]?.id || '';
  const projects = useRemote<ProjectIndex>(request,
    `/build-farm?vmId=${encodeURIComponent(target)}`, !!target, 5000);
  const availableProjects = projects.data?.vmId === target ? projects.data.projects : [];
  const selectedProject = projectId || (projects.data?.vmId === target ? projects.data.active : '');
  const required = labels(taskLabels);
  const candidates = remote.data?.nodes.filter((node) =>
    required.every((label) => node.labels.includes(label))) || [];
  /**
   * 中文：提交 POST /build-farm，完成构建节点、标签与项目任务分派的管理界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /build-farm for Managing build nodes, labels and assignment of project tasks. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const saveNode = () => void action.run(/** 中文：提交 POST /build-farm，完成构建节点、标签与项目任务分派的管理界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /build-farm for Managing build nodes, labels and assignment of project tasks. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    await request('/build-farm', 'POST', { operation: 'save-node', node: {
      vmId: target, projectId: selectedProject, slots, labels: labels(nodeLabels), enabled } }, signal);
    remote.reload();
  }, '构建节点已保存');
  /**
   * 中文：提交 POST /build-farm，完成构建节点、标签与项目任务分派的管理界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /build-farm for Managing build nodes, labels and assignment of project tasks. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：node：需要遍历或更新的 DOM 节点
   * English: Inputs: node: DOM node to traverse/update
   */
  const removeNode = (node: Node) => void action.run(/** 中文：提交 POST /build-farm，完成构建节点、标签与项目任务分派的管理界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /build-farm for Managing build nodes, labels and assignment of project tasks. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    await request('/build-farm', 'POST', { operation: 'remove-node', vmId: node.vmId }, signal);
    remote.reload();
  }, '构建节点已移除');
  /**
   * 中文：提交 POST /build-farm，完成构建节点、标签与项目任务分派的管理界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /build-farm for Managing build nodes, labels and assignment of project tasks. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const submit = () => void action.run(/** 中文：提交 POST /build-farm，完成构建节点、标签与项目任务分派的管理界面的数据交互并更新名称输入、command 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /build-farm for Managing build nodes, labels and assignment of project tasks and update name input, command state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    await request('/build-farm', 'POST', { operation: 'submit', build: {
      name, command, ...(cwd ? { cwd } : {}), labels: required, timeoutSeconds } }, signal);
    setName(''); setCommand(''); remote.reload();
  }, '构建已排队，匹配节点空闲时自动执行');
  /**
   * 中文：提交 POST /build-farm，完成构建节点、标签与项目任务分派的管理界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /build-farm for Managing build nodes, labels and assignment of project tasks. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：task：签名所示 Task 业务值；operation：签名所示 'retry' | 'cancel' 业务值
   * English: Inputs: task: the Task domain value in the signature; operation: the 'retry' | 'cancel' domain value in the signature
   */
  const taskAction = (task: Task, operation: 'retry' | 'cancel') => void action.run(/** 中文：提交 POST /build-farm，完成构建节点、标签与项目任务分派的管理界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /build-farm for Managing build nodes, labels and assignment of project tasks. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    await request('/build-farm', 'POST', { operation, id: task.id }, signal);
    remote.reload();
  }, operation === 'cancel' ? '取消请求已提交' : '新构建已排队');
  return <section className="system-card" aria-label="构建农场">
    <h3>构建农场</h3>
    <p>将已安装构建工具的 Linux 实例和项目登记为节点，按标签和并发槽位调度命令。每次构建准备时固定项目配置，以项目账号使用该环境与网络设置；停止的节点会保留待执行任务。</p>
    <Feedback error={action.error || remote.error || vms.error || projects.error || remote.data?.persistenceError}
      message={action.message} />
    <div className="feature-card">
      <h4>登记节点</h4>
      <div className="shortcut-fields">
        <label>Linux 实例<select aria-label="构建节点实例" value={target}
          onChange={(event) => { setVmId(event.target.value); setProjectId(''); }}>
          {vms.data?.map((vm) => <option key={vm.id} value={vm.id}>{vm.name} · {vm.status}</option>)}
        </select></label>
        <label>项目<select aria-label="构建节点项目" value={selectedProject}
          onChange={(event) => setProjectId(event.target.value)}>
          {availableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>
        <label>并发槽位<input aria-label="构建并发槽位" type="number" min={1} max={4}
          value={slots} onChange={(event) => setSlots(Number(event.target.value))} /></label>
        <label>节点标签（逗号分隔）<input aria-label="构建节点标签" value={nodeLabels}
          onChange={(event) => setNodeLabels(event.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)} />启用调度</label>
      </div>
      <button className="primary compact" disabled={action.busy || !target ||
        !availableProjects.some((project) => project.id === selectedProject) ||
        !Number.isInteger(slots) || slots < 1 || slots > 4 || !validLabels(labels(nodeLabels))}
        onClick={saveNode}>保存构建节点</button>
      {remote.data?.nodes.map((node) => <div key={node.vmId} className="host-peer-row">
        <span><strong>{node.vmName || node.vmId}</strong> · {node.status} ·
          {node.busy}/{node.slots} 运行 · {node.labels.join(', ') || '无标签'} ·
          {node.enabled ? '已启用' : '已停用'} · 项目 {node.projectId === 'default' ? '默认项目' : node.projectId}</span>
        <button className="secondary compact" disabled={action.busy}
          onClick={() => { setVmId(node.vmId); setProjectId(node.projectId || ''); setSlots(node.slots);
            setNodeLabels(node.labels.join(', ')); setEnabled(node.enabled); }}>编辑</button>
        <button className="secondary compact" disabled={action.busy}
          onClick={() => removeNode(node)}>移除</button>
      </div>)}
    </div>
    <div className="feature-card">
      <h4>提交构建</h4>
      <div className="shortcut-fields">
        <label>构建名称<input aria-label="构建名称" value={name} maxLength={80}
          onChange={(event) => setName(event.target.value)} /></label>
        <label>工作目录（可选）<input aria-label="构建工作目录" value={cwd} placeholder="留空使用节点项目目录"
          onChange={(event) => setCwd(event.target.value)} /></label>
        <label>所需标签（逗号分隔）<input aria-label="构建所需标签" value={taskLabels}
          onChange={(event) => setTaskLabels(event.target.value)} /></label>
        <label>超时秒数<input aria-label="构建超时秒数" type="number" min={5} max={1800}
          value={timeoutSeconds} onChange={/** 中文：在构建节点、标签与项目任务分派的管理界面流程中timeoutSeconds 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Managing build nodes, labels and assignment of project tasks, timeoutSeconds state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data */ (event) => setTimeoutSeconds(Number(event.target.value))} /></label>
      </div>
      <label>客户机命令<textarea aria-label="构建客户机命令" value={command}
        maxLength={4096} onChange={(event) => setCommand(event.target.value)} /></label>
      <p className="subtle-note">工作目录须在节点绑定的项目内。匹配节点：{candidates.map((node) =>
        `${node.vmName || node.vmId} (${node.status})`).join('、') || '无'}。任务会保留到匹配节点启动并有空闲槽位。</p>
      <button className="primary compact" disabled={action.busy || !name.trim() || !command.trim() ||
        !candidates.length || !validLabels(required) ||
        (cwd !== '' && !/^(?:\/workspace|\/opt\/projects|\/srv\/projects)(?:\/(?!\.{1,2}(?:\/|$))[a-zA-Z0-9._-]+)*$/.test(cwd)) ||
        !Number.isInteger(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 1800}
        onClick={submit}>提交构建</button>
    </div>
    <div className="feature-card">
      <h4>构建队列与结果</h4>
      {!remote.data?.tasks.length && <p className="subtle-note">暂无构建。</p>}
      {remote.data?.tasks.map((task) => <div key={task.id} className="feature-card">
        <strong>{task.name}</strong> · {task.status} ·
        {task.vmId ? remote.data?.nodes.find((node) => node.vmId === task.vmId)?.vmName || task.vmId : '等待节点'}
        {task.projectId && <p className="subtle-note">项目 {task.projectId === 'default' ? '默认项目' : task.projectId}
          {task.directory && ` · ${task.directory}`} {task.networkIsolation === 'private' ? '· 私有网络' : ''}</p>}
        {task.error && <p role="alert">{task.error}{task.errorCode && ` (${task.errorCode})`}</p>}
        {task.job && <JobLog job={task.job} />}
        {['queued', 'running'].includes(task.status) && <button className="secondary compact"
          disabled={action.busy} onClick={() => taskAction(task, 'cancel')}>取消构建</button>}
        {['error', 'cancelled', 'interrupted'].includes(task.status) &&
          <button className="secondary compact" disabled={action.busy}
            onClick={() => taskAction(task, 'retry')}>重新排队</button>}
      </div>)}
    </div>
  </section>;
}
