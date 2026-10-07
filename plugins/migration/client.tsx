/**
 * 模块职责（中文）：“数据目录迁移”插件的主机数据目录迁移预检、执行和结果面板，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for host data-directory migration.
 * 详细范围（中文）：公开入口包括 MigrationPanel；职责覆盖主机数据目录迁移的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include MigrationPanel. The scope covers UI interaction and state presentation for host data-directory migration. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useState } from 'react';
import type { JobView } from '../../shared/contracts/jobs.ts';
import '../../src/development.css';
import type { Request } from '../../src/feature-shared';
import { Feedback, formatBytes, JobLog, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';

/**
 * 中文：呈现主机数据目录迁移的界面交互与状态呈现中的 MigrationPanel 界面，订阅 /migration，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the MigrationPanel surface for UI interaction and state presentation for host data-directory migration, subscribing to /migration. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 */
export function MigrationPanel({ request }: { request: Request }) {
  const remote = useRemote<{
      source: string;
      target?: string;
      restartRequired: boolean;
      blocked: boolean;
      job: JobView | null;
    }>(request, '/migration', true, 2500),
    action = useAction();
  const [target, setTarget] = useState(''),
    [plan, setPlan] = useState<{
      source: string;
      target: string;
      bytes: number;
      available: number;
      count: number;
      token: string;
    } | null>(null);
  const busy = action.busy || remote.data?.blocked;
  return (
    <div className="content-panel feature-panel migration-panel">
      <h3>数据目录迁移</h3>
      <p className="subtle-note">
        将实例、镜像、快照与本地备份复制到新磁盘并逐项校验。请先停止全部实例并等待任务结束；完成后重启 Sakura
        生效，原目录保留。
      </p>
      <p>
        当前目录：<code className="wrap-path">{remote.data?.source || '读取中…'}</code>
      </p>
      <Feedback error={action.error || remote.error} />
      <label>
        目标新目录
        <input
          value={target}
          disabled={busy}
          onChange={(e) => {
            setTarget(e.target.value);
            setPlan(null);
          }}
          placeholder="E:\SakuraData"
        />
      </label>
      <button
        className="secondary compact"
        disabled={busy || !target.trim()}
        onClick={() =>
          void action.run(/** 中文：提交 POST /migration，完成主机数据目录迁移的界面交互与状态呈现的数据交互并更新plan 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /migration for UI interaction and state presentation for host data-directory migration and update plan state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
            setPlan(await request('/migration', 'POST', { action: 'preview', target }, signal));
          })
        }
      >
        检查空间与预览
      </button>
      {plan && !remote.data?.blocked && (
        <div className="feature-card">
          <p className="wrap-path">
            {plan.source} → {plan.target}
          </p>
          <p>
            {plan.count} 个文件 · 需复制 {formatBytes(plan.bytes)} · 可用 {formatBytes(plan.available)}
          </p>
          <button
            className="primary compact"
            disabled={busy}
            onClick={() =>
              void action.run(/** 中文：提交 POST /migration，完成主机数据目录迁移的界面交互与状态呈现的数据交互并更新plan 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /migration for UI interaction and state presentation for host data-directory migration and update plan state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
                await request(
                  '/migration',
                  'POST',
                  { action: 'start', target: plan.target, token: plan.token },
                  signal,
                );
                setPlan(null);
                remote.reload();
              })
            }
          >
            开始停机迁移
          </button>
        </div>
      )}
      {remote.data?.job?.status === 'running' && (
        <div className="feature-actions">
          <progress max={100} value={remote.data.job.progress || 0} />
          <span>{remote.data.job.phase}</span>
          <button
            className="text-button"
            disabled={action.busy}
            onClick={() => void action.run(() => request(`/jobs/${remote.data!.job!.id}/cancel`, 'POST'))}
          >
            取消迁移
          </button>
        </div>
      )}
      {remote.data?.restartRequired && (
        <div className="feature-card">
          <p className="feature-success">迁移完成。请重新启动 Sakura 服务使用新目录。</p>
          <code className="wrap-path">{remote.data.target}</code>
          <button
            className="text-button"
            disabled={action.busy}
            onClick={() =>
              void action.run(/** 中文：提交 POST /migration，完成主机数据目录迁移的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /migration for UI interaction and state presentation for host data-directory migration. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
                await request('/migration', 'POST', { action: 'cancel-activation' }, signal);
                remote.reload();
              })
            }
          >
            继续使用原目录
          </button>
        </div>
      )}
      <JobLog job={remote.data?.job} />
    </div>
  );
}
