/**
 * 模块职责（中文）：管理黄金镜像库，执行构建、导入、检查和实例创建并呈现任务结果。
 * Module responsibility (English): UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles.
 * 详细范围（中文）：公开入口包括 GoldenImageLibrary；职责覆盖快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include GoldenImageLibrary. The scope covers UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDecimal } from '../../src/localization';
import { formatDateTime } from '../../src/localization';
import { useState } from 'react';
import type { VMView } from '../../shared/contracts/vm.ts';
import type { GoldenImagesView } from './view-types';
import type { GoldenAction, GoldenResult } from '../../shared/golden-images';
import { Feedback, JobLog, useAction, useRemote, type Request } from '../../src/feature-shared';

/**
 * 中文：呈现快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现中的 GoldenImageLibrary 界面，订阅 /golden-images，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the GoldenImageLibrary surface for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles, subscribing to /golden-images. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  request,
  refresh,
  vms,
  sourceId = '',
} 提供 request（带身份和权限作用域的传输能力）、refresh（refresh 状态）、vms（vms 状态）、sourceId（sourceId 状态） 上下文字段
 * English: Inputs: {
  request,
  refresh,
  vms,
  sourceId = '',
} provides context fields request (transport capability bound to identity/authority scope), refresh (refresh state), vms (vms state), sourceId (sourceId state)
 */
export function GoldenImageLibrary({
  request,
  refresh,
  vms,
  sourceId = '',
}: {
  request: Request;
  refresh: /** 中文：请求父级重新核对远端视图；完成异步刷新后才兑现返回值；这是 GoldenImageLibrary 的调用契约 | English: Ask the parent to reconcile remote state and fulfill only after asynchronous refresh; this is the callable contract of GoldenImageLibrary | 中文：结果：Promise<unknown>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<unknown>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<unknown>;
  vms: VMView[];
  sourceId?: string;
}) {
  const remote = useRemote<GoldenImagesView>(request, '/golden-images', true, 2500);
  const action = useAction();
  const cancellation = useAction();
  const [vmId, setVmId] = useState(sourceId),
    [name, setName] = useState(''),
    [note, setNote] = useState(''),
    [reviewed, setReviewed] = useState(false),
    [instanceName, setInstanceName] = useState('from-golden');
  const source = vms.find((vm) => vm.id === vmId);
  const busy = action.busy || remote.data?.job?.status === 'running';
  /**
   * 中文：提交 POST /golden-images，完成快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /golden-images for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：input：尚待校验的输入数据；message：签名所示 string 业务值
   * English: Inputs: input: input data requiring validation; message: the string domain value in the signature
   */
  const run = (input: GoldenAction, message: string) =>
    action.run(/** 中文：提交 POST /golden-images，完成快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现的数据交互并更新reviewed 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /golden-images for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles and update reviewed state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
      await request<GoldenResult>('/golden-images', 'POST', input, signal);
      remote.reload();
      await refresh();
      if (input.action === 'create') setReviewed(false);
    }, message);
  return (
    <section className="feature-card golden-images" aria-label="黄金镜像库">
      <h3>黄金镜像库</h3>
      <p>将已准备好的停止实例保存为模板；以后可重复创建独立实例，源实例删除后模板仍可使用。</p>
      <p className="subtle-note">
        保留磁盘内的账户、文件和凭据，请先在源实例中清理不应复制的内容。新实例清空端口转发，首次启动更新
        Sakura 控制密钥；不自动清理其他账户密钥。
      </p>
      <Feedback
        error={action.error || cancellation.error || remote.error || remote.data?.persistenceError}
        message={action.message}
      />
      <fieldset disabled={busy}>
        <legend>制作黄金镜像</legend>
        <label>
          源实例
          <select
            aria-label="黄金镜像源实例"
            value={vmId}
            onChange={(event) => {
              setVmId(event.target.value);
              setReviewed(false);
            }}
          >
            <option value="">选择停止的实例</option>
            {vms
              .filter((vm) => !vm.sandbox)
              .map((vm) => (
                <option key={vm.id} value={vm.id} disabled={vm.poweredOn}>
                  {vm.name}
                  {vm.poweredOn ? '（请先停止）' : ''}
                </option>
              ))}
          </select>
        </label>
        <label>
          模板名称
          <input maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          模板备注
          <textarea maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
          已检查源实例内容，确认可复制为模板
        </label>
        <button
          className="primary compact"
          disabled={!source || source.poweredOn || !name.trim() || !reviewed}
          onClick={() =>
            void run({ action: 'create', vmId, name, note, sourceReviewed: true }, '黄金镜像已保存')
          }
        >
          保存黄金镜像
        </button>
      </fieldset>
      <button className="secondary compact" onClick={remote.reload}>
        刷新黄金镜像库
      </button>
      <p>
        {remote.data?.templates.length || 0} / 16 个模板 ·{' '}
        {formatDecimal(((remote.data?.templates.reduce((sum, row) => sum + row.bytes, 0) || 0) / 1024 ** 3), 2)} /
        128 GiB
      </p>
      <label>
        从模板创建的实例名称
        <input
          maxLength={32}
          pattern="[a-z][a-z0-9-]*"
          value={instanceName}
          disabled={busy}
          onChange={(event) => setInstanceName(event.target.value)}
        />
      </label>
      {remote.data?.templates.length === 0 && <p>尚未保存黄金镜像。</p>}
      <ul className="golden-image-list">
        {remote.data?.templates.map((entry) => (
          <li key={entry.id}>
            <h4>{entry.name}</h4>
            <p>{entry.note}</p>
            <p>
              {entry.distro} · {entry.sourceName} · {formatDateTime(new Date(entry.createdAt))} · 虚拟磁盘{' '}
              {entry.diskGiB} GiB · 模板 {formatDecimal((entry.bytes / 1024 ** 2), 1)} MiB
            </p>
            <p className="subtle-note">
              SHA-256：<code>{entry.sha256}</code>
            </p>
            <div className="feature-actions">
              <button
                className="primary compact"
                disabled={busy || !/^[a-z][a-z0-9-]{0,31}$/.test(instanceName)}
                onClick={() =>
                  void run(
                    { action: 'instantiate', id: entry.id, name: instanceName },
                    `实例 ${instanceName} 已创建，可在工作空间启动`,
                  )
                }
              >
                从 {entry.name} 创建实例
              </button>
              <button
                className="secondary compact"
                disabled={busy}
                onClick={() => void run({ action: 'verify', id: entry.id }, '模板 SHA-256 校验通过')}
              >
                校验 {entry.name}
              </button>
              <button
                className="text-button danger-text"
                disabled={busy}
                onClick={() => {
                  if (confirm(`删除黄金镜像“${entry.name}”？已创建的实例不受影响。`))
                    void run({ action: 'delete', id: entry.id }, '黄金镜像已删除');
                }}
              >
                删除模板 {entry.name}
              </button>
            </div>
          </li>
        ))}
        {remote.data?.issues.map((issue) => (
          <li key={issue.id}>
            <p role="alert">
              {issue.error} <code>{issue.id}</code>
            </p>
            <button
              className="text-button danger-text"
              disabled={busy}
              onClick={() => {
                if (confirm(`移除未完成或损坏的模板 ${issue.id}？请先保留需要检查的本机文件。`))
                  void run({ action: 'delete', id: issue.id }, '模板目录已移除');
              }}
            >
              移除未完成模板 {issue.id}
            </button>
          </li>
        ))}
      </ul>
      <JobLog job={remote.data?.job} />
      {remote.data?.job?.status === 'running' && remote.data.job.id && (
        <button
          className="secondary compact"
          disabled={cancellation.busy}
          onClick={() =>
            void cancellation.run(/** 中文：提交 POST /jobs/{remote.data!.job!.id}/cancel，完成快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /jobs/{remote.data!.job!.id}/cancel for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
              await request(`/jobs/${remote.data!.job!.id}/cancel`, 'POST');
              remote.reload();
            })
          }
        >
          取消镜像操作
        </button>
      )}
      <p className="subtle-note">
        制作需要实例保持停止，并预留两倍虚拟磁盘容量及 64 MiB
        临时空间。断开页面会请求取消；操作中断后请刷新核对结果，不自动重试。模板是完整独立副本，保存在 Sakura
        数据目录。
      </p>
    </section>
  );
}
