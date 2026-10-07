/**
 * 模块职责（中文）：编辑并发起只读快照救援命令，展示救援任务和输出制品。
 * Module responsibility (English): UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles.
 * 详细范围（中文）：公开入口包括 RescuePanel；职责覆盖快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include RescuePanel. The scope covers UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDecimal } from '../../src/localization';
import { formatDateTime } from '../../src/localization';
import { useState } from 'react';
import { DEFAULT_RESCUE_COMMAND } from '../../shared/rescue';
import type { RescueView } from './view-types';
import type { SandboxArtifact } from '../../shared/sandbox';
import { Feedback, JobLog, useAction, useRemote, type FeatureProps } from '../../src/feature-shared';
import { saveBlob, saveText } from '../../src/export-file';

/**
 * 中文：呈现快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现中的 RescuePanel 界面，订阅 /vms/{vm.id}/rescue，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the RescuePanel surface for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles, subscribing to /vms/{vm.id}/rescue. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vm, request, refresh } 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力）、refresh（refresh 状态） 上下文字段
 * English: Inputs: { vm, request, refresh } provides context fields vm (vm state), request (transport capability bound to identity/authority scope), refresh (refresh state)
 */
export function RescuePanel({ vm, request, refresh }: FeatureProps) {
  const remote = useRemote<RescueView>(request, `/vms/${vm.id}/rescue`, !vm.sandbox, 2000);
  const action = useAction(),
    cancellation = useAction();
  const [command, setCommand] = useState(DEFAULT_RESCUE_COMMAND),
    [mount, setMount] = useState(true),
    [partition, setPartition] = useState(0),
    [timeout, setTimeout] = useState(60),
    [artifacts, setArtifacts] = useState('');
  if (vm.sandbox) return null;
  const running = remote.data?.runs.find((job) => job.status === 'running');
  const busy = action.busy || !!running;
  return (
    <section className="feature-card rescue-panel" aria-label="只读救援">
      <h3>只读救援</h3>
      <p>
        从独立 Alpine
        临时系统检查故障磁盘。源实例需停止，救援期间锁定；网络隔离，源盘只读，结束后自动清理临时系统。
      </p>
      <Feedback
        error={remote.error || action.error || cancellation.error || remote.data?.persistenceError}
        message={action.message}
      />
      <form
        onSubmit={/**
         * 中文功能：拦截救援表单，按挂载选择提交分区、命令、超时与产物路径，通过动作反馈管理取消和失败并刷新任务视图。
         * English: Intercept rescue submission and send partition/command/timeout/artifact paths according to mount choice, using action feedback for cancellation/failure and refreshing job views.
         * 输入 / Inputs: event.
         * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
         * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
         */
        (event) => {
          event.preventDefault();
          void action.run(/** 中文：提交 POST /vms/{vm.id}/rescue，完成快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/rescue for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
            await request(
              `/vms/${vm.id}/rescue`,
              'POST',
              {
                command,
                partition: mount ? partition : null,
                timeoutSeconds: timeout,
                artifacts: artifacts
                  .split('\n')
                  .map((value) => value.trim())
                  .filter(Boolean),
              },
              signal,
            );
            remote.reload();
            await refresh();
          }, '已提交救援任务，可在此查看进度与取消。');
        }}
      >
        <fieldset disabled={busy}>
          <legend>救援命令</legend>
          <label className="checkbox-row">
            <input type="checkbox" checked={mount} onChange={(event) => setMount(event.target.checked)} />
            自动只读挂载源文件系统
          </label>
          {mount && (
            <label>
              源分区编号（0 为整盘文件系统）
              <input
                type="number"
                min={0}
                max={128}
                required
                value={partition}
                onChange={(event) => setPartition(Number(event.target.value))}
              />
            </label>
          )}
          <p className="subtle-note">
            自动挂载 ext2/ext3/ext4 到 /mnt/source，不重放日志。Alpine 默认使用
            0；分区不明时取消自动挂载，先执行 cat /proc/partitions 和 blkid。
          </p>
          <label>
            检查命令
            <textarea
              rows={7}
              maxLength={8192}
              required
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              spellCheck={false}
            />
          </label>
          <label>
            命令与产物总期限（秒）
            <input
              type="number"
              min={1}
              max={1800}
              required
              value={timeout}
              onChange={/** 中文：在快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现流程中timeout 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles, timeout state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data */ (event) => setTimeout(Number(event.target.value))}
            />
          </label>
          <label>
            保存产物（每行一个相对路径）
            <textarea
              rows={2}
              maxLength={4104}
              value={artifacts}
              onChange={(event) => setArtifacts(event.target.value)}
              placeholder="recovered.txt"
            />
          </label>
          <p className="subtle-note">
            命令在 /workspace 执行。将要保留的文件从 /mnt/source 复制到 /workspace 后列为产物；最多 8
            个文件、合计 8 MiB。离开页面后任务继续运行，停止任务请点击取消。
          </p>
          <button type="submit" className="primary compact" disabled={vm.poweredOn || !command.trim()}>
            启动只读救援
          </button>
          {vm.poweredOn && <p className="subtle-note">请先停止源实例。</p>}
        </fieldset>
      </form>
      {running && (
        <div className="feature-actions">
          <span role="status">{running.phase || '救援正在执行'}</span>
          <button
            className="secondary compact"
            disabled={cancellation.busy}
            onClick={() =>
              void cancellation.run(/** 中文：提交 POST /jobs/{running.id}/cancel，完成快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /jobs/{running.id}/cancel for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
                await request(`/jobs/${running.id}/cancel`, 'POST', undefined, signal);
                remote.reload();
                await refresh();
              })
            }
          >
            取消救援
          </button>
        </div>
      )}
      {(remote.data?.runs || []).map((job) => (
        <details key={job.id} open={job === remote.data?.runs[0]}>
          <summary>救援记录 · {formatDateTime(new Date(job.startedAt))}</summary>
          <JobLog job={job} />
          <div className="feature-actions">
            <button
              type="button"
              className="secondary compact"
              onClick={() => saveText(`rescue-${job.id}.json`, job)}
            >
              导出救援记录
            </button>
            {job.execution?.artifacts.map((artifact) => (
              <button
                key={artifact.id}
                type="button"
                className="secondary compact"
                disabled={action.busy}
                onClick={() =>
                  void action.run(/** 中文：读取 GET /vms/{vm.id}/rescue/artifact?run={job.id}&artifact={artifact.id}，完成快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform GET /vms/{vm.id}/rescue/artifact?run={job.id}&artifact={artifact.id} for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
                    const value = await request<SandboxArtifact & { base64: string }>(
                      `/vms/${vm.id}/rescue/artifact?run=${job.id}&artifact=${artifact.id}`,
                      'GET',
                      undefined,
                      signal,
                    );
                    const bytes = Uint8Array.from(atob(value.base64), (character) => character.charCodeAt(0));
                    saveBlob(value.name, new Blob([bytes], { type: 'application/octet-stream' }));
                  })
                }
              >
                下载 {artifact.name} · {formatDecimal((artifact.bytes / 1024), 1)} KiB
              </button>
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}
