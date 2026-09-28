import { useState } from 'react';
import { Feedback, JobLog, useAction, useRemote, type Request } from './feature-shared';
import type { JobView } from '../server/jobs';

type Node = { vmId: string; vmName: string | null; status: string;
  slots: number; busy: number; labels: string[]; enabled: boolean };
type Task = { id: string; name: string; status: string; vmId?: string;
  labels: string[]; createdAt: string; error?: string; job: JobView | null };
type View = { nodes: Node[]; tasks: Task[]; persistenceError?: string };
type VM = { id: string; name: string; status: string };
const labels = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);
const validLabels = (items: string[]) => items.length <= 8 &&
  new Set(items).size === items.length && items.every((item) => /^[a-z][a-z0-9-]{0,31}$/.test(item));

export function BuildFarmSettings({ request }: { request: Request }) {
  const remote = useRemote<View>(request, '/build-farm', true, 3000);
  const vms = useRemote<VM[]>(request, '/vms', true, 5000);
  const action = useAction();
  const [vmId, setVmId] = useState('');
  const [slots, setSlots] = useState(1);
  const [nodeLabels, setNodeLabels] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [cwd, setCwd] = useState('/workspace');
  const [taskLabels, setTaskLabels] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState(300);
  const target = vmId || vms.data?.[0]?.id || '';
  const required = labels(taskLabels);
  const candidates = remote.data?.nodes.filter((node) =>
    required.every((label) => node.labels.includes(label))) || [];
  const saveNode = () => void action.run(async (signal) => {
    await request('/build-farm', 'POST', { operation: 'save-node', node: {
      vmId: target, slots, labels: labels(nodeLabels), enabled } }, signal);
    remote.reload();
  }, '构建节点已保存');
  const removeNode = (node: Node) => void action.run(async (signal) => {
    await request('/build-farm', 'POST', { operation: 'remove-node', vmId: node.vmId }, signal);
    remote.reload();
  }, '构建节点已移除');
  const submit = () => void action.run(async (signal) => {
    await request('/build-farm', 'POST', { operation: 'submit', build: {
      name, command, cwd, labels: required, timeoutSeconds } }, signal);
    setName(''); setCommand(''); remote.reload();
  }, '构建已排队，匹配节点空闲时自动执行');
  const taskAction = (task: Task, operation: 'retry' | 'cancel') => void action.run(async (signal) => {
    await request('/build-farm', 'POST', { operation, id: task.id }, signal);
    remote.reload();
  }, operation === 'cancel' ? '取消请求已提交' : '新构建已排队');
  return <section className="system-card" aria-label="构建农场">
    <h3>构建农场</h3>
    <p>将已安装构建工具的 Linux 实例登记为节点，按标签和并发槽位调度命令。命令在目标实例的客户机内执行；停止的节点会保留待执行任务。</p>
    <Feedback error={action.error || remote.error || vms.error || remote.data?.persistenceError}
      message={action.message} />
    <div className="feature-card">
      <h4>登记节点</h4>
      <div className="shortcut-fields">
        <label>Linux 实例<select aria-label="构建节点实例" value={target}
          onChange={(event) => setVmId(event.target.value)}>
          {vms.data?.map((vm) => <option key={vm.id} value={vm.id}>{vm.name} · {vm.status}</option>)}
        </select></label>
        <label>并发槽位<input aria-label="构建并发槽位" type="number" min={1} max={4}
          value={slots} onChange={(event) => setSlots(Number(event.target.value))} /></label>
        <label>节点标签（逗号分隔）<input aria-label="构建节点标签" value={nodeLabels}
          onChange={(event) => setNodeLabels(event.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)} />启用调度</label>
      </div>
      <button className="primary compact" disabled={action.busy || !target ||
        !Number.isInteger(slots) || slots < 1 || slots > 4 || !validLabels(labels(nodeLabels))}
        onClick={saveNode}>保存构建节点</button>
      {remote.data?.nodes.map((node) => <div key={node.vmId} className="host-peer-row">
        <span><strong>{node.vmName || node.vmId}</strong> · {node.status} ·
          {node.busy}/{node.slots} 运行 · {node.labels.join(', ') || '无标签'} ·
          {node.enabled ? '已启用' : '已停用'}</span>
        <button className="secondary compact" disabled={action.busy}
          onClick={() => { setVmId(node.vmId); setSlots(node.slots);
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
        <label>工作目录<input aria-label="构建工作目录" value={cwd}
          onChange={(event) => setCwd(event.target.value)} /></label>
        <label>所需标签（逗号分隔）<input aria-label="构建所需标签" value={taskLabels}
          onChange={(event) => setTaskLabels(event.target.value)} /></label>
        <label>超时秒数<input aria-label="构建超时秒数" type="number" min={5} max={1800}
          value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(Number(event.target.value))} /></label>
      </div>
      <label>客户机命令<textarea aria-label="构建客户机命令" value={command}
        maxLength={4096} onChange={(event) => setCommand(event.target.value)} /></label>
      <p className="subtle-note">匹配节点：{candidates.map((node) =>
        `${node.vmName || node.vmId} (${node.status})`).join('、') || '无'}。任务会保留到匹配节点启动并有空闲槽位。</p>
      <button className="primary compact" disabled={action.busy || !name.trim() || !command.trim() ||
        !candidates.length || !validLabels(required) ||
        !/^\/workspace(?:\/(?!\.{1,2}(?:\/|$))[a-zA-Z0-9._-]+)*$/.test(cwd) ||
        !Number.isInteger(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 1800}
        onClick={submit}>提交构建</button>
    </div>
    <div className="feature-card">
      <h4>构建队列与结果</h4>
      {!remote.data?.tasks.length && <p className="subtle-note">暂无构建。</p>}
      {remote.data?.tasks.map((task) => <div key={task.id} className="feature-card">
        <strong>{task.name}</strong> · {task.status} ·
        {task.vmId ? remote.data?.nodes.find((node) => node.vmId === task.vmId)?.vmName || task.vmId : '等待节点'}
        {task.error && <p role="alert">{task.error}</p>}
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
