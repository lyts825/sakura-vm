/**
 * 模块职责（中文）：编辑日志保留策略，预览清理范围并展示存储占用与实际清理结果。
 * Module responsibility (English): Configuring log retention and previewing cleanup scope and storage usage.
 * 详细范围（中文）：公开入口包括 LogRetentionSettings；职责覆盖配置日志保留并预览清理范围与占用，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include LogRetentionSettings. The scope covers Configuring log retention and previewing cleanup scope and storage usage. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDecimal } from './localization';
import { formatDateTime } from './localization';
import { useEffect, useState } from 'react';
import type { LogRetentionPolicy, LogRetentionPreview, LogRetentionView } from '../shared/log-retention';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';

/**
 * 中文：把日志占用字节换算成两位区域格式小数的 MiB。
 * English: Convert log-storage bytes to MiB with two locale-formatted fractional digits.
 * 中文：输入：n：签名所示 number 业务值
 * English: Inputs: n: the number domain value in the signature
 */
const bytes = (n: number) => `${formatDecimal((n / 1024 ** 2), 2)} MiB`;
/**
 * 中文：呈现配置日志保留并预览清理范围与占用中的 LogRetentionSettings 界面，订阅 /log-retention，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the LogRetentionSettings surface for Configuring log retention and previewing cleanup scope and storage usage, subscribing to /log-retention. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 */
export function LogRetentionSettings({ request }: { request: Request }) {
  const remote = useRemote<LogRetentionView>(request, '/log-retention', true, 0);
  const action = useAction();
  const [policy, setPolicy] = useState<LogRetentionPolicy>({ enabled: false, days: 30, maxMiB: 64 });
  const [preview, setPreview] = useState<LogRetentionPreview | null>(null);
  const [saved, setSaved] = useState<LogRetentionView | null>(null);
  useEffect(/** 中文：当依赖 [remote.data] 变化时策略草稿，saved 状态，preview 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [remote.data] change, policy draft, saved state, preview state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (remote.data) {
      setPolicy(remote.data.policy);
      setSaved(remote.data);
      setPreview(null);
    }
  }, [remote.data]);
  /**
   * 中文：在配置日志保留并预览清理范围与占用流程中策略草稿，preview 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Configuring log retention and previewing cleanup scope and storage usage, policy draft, preview state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：value：待校验、转换或保存的输入值
   * English: Inputs: value: input value to validate/transform/save
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const change = (value: Partial<LogRetentionPolicy>) => {
    setPolicy({ ...policy, ...value });
    setPreview(null);
    action.clear();
  };
  const valid =
    Number.isInteger(policy.days) &&
    policy.days >= 1 &&
    policy.days <= 3650 &&
    Number.isInteger(policy.maxMiB) &&
    policy.maxMiB >= 1 &&
    policy.maxMiB <= 1024;
  return (
    <section className="system-card log-retention" aria-label="任务日志保留设置">
      <h3>任务日志保留</h3>
      <p className="subtle-note">
        按完成时间清理已启用插件的任务日志正文，先删除到期日志，再按从旧到新满足总容量。启用后每分钟检查一次；清理后无法恢复原日志。
      </p>
      <p className="subtle-note">
        任务状态、错误摘要、结果文件、审计记录和客户机日志各自保留。容量仅计算已结束任务的日志正文，不是整个数据目录的配额。禁用插件的历史在再次启用后处理。
      </p>
      <fieldset disabled={action.busy || !saved}>
        <label className="check">
          <input
            type="checkbox"
            checked={policy.enabled}
            onChange={(e) => change({ enabled: e.target.checked })}
          />
          自动清理任务日志
        </label>
        <div className="shortcut-fields">
          <label>
            日志保留天数
            <input
              type="number"
              min={1}
              max={3650}
              step={1}
              value={policy.days || ''}
              onChange={(e) => change({ days: Number(e.target.value) })}
            />
          </label>
          <label>
            任务日志容量（MiB）
            <input
              type="number"
              min={1}
              max={1024}
              step={1}
              value={policy.maxMiB || ''}
              onChange={(e) => change({ maxMiB: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="button-row">
          <button
            className="secondary compact"
            disabled={!valid}
            onClick={() =>
              void action.run(/** 中文：提交 POST /log-retention，完成配置日志保留并预览清理范围与占用的数据交互并更新preview 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /log-retention for Configuring log retention and previewing cleanup scope and storage usage and update preview state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
                setPreview(null);
                const value = await request<LogRetentionPreview>(
                  '/log-retention',
                  'POST',
                  { action: 'preview', policy },
                  signal,
                );
                if (!signal.aborted) setPreview(value);
              })
            }
          >
            预览日志清理
          </button>
          <button
            className="secondary compact"
            disabled={!preview || !valid}
            onClick={() =>
              void action.run(
                /**
                 * 中文：提交 POST /log-retention；GET /log-retention，完成配置日志保留并预览清理范围与占用的数据交互并更新preview 状态、saved 状态、策略草稿；异步失败传给此处的捕获分支或外层动作反馈
                 * English: Perform POST /log-retention; GET /log-retention for Configuring log retention and previewing cleanup scope and storage usage and update preview state, saved state, policy draft. Propagate asynchronous failure to this catch path or the outer action feedback
                 * 中文：输入：signal：本次调用的取消寿命
                 * English: Inputs: signal: cancellation lifetime for this invocation
                 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
                 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
                 */
                async (signal) => {
                  const token = preview!.token;
                  setPreview(null);
                  try {
                    const value = await request<LogRetentionView>(
                      '/log-retention',
                      'POST',
                      { action: 'save', policy, token },
                      signal,
                    );
                    if (!signal.aborted) {
                      setSaved(value);
                      setPolicy(value.policy);
                    }
                  } catch (error) {
                    // A response can be lost after the policy was saved. Read back without replaying the write.
                    const current = await request<LogRetentionView>(
                      '/log-retention',
                      'GET',
                      undefined,
                      signal,
                    ).catch(() => null);
                    if (!signal.aborted) setSaved(current);
                    throw error;
                  }
                },
                policy.enabled ? '策略已保存并应用' : '自动清理已停用',
              )
            }
          >
            {policy.enabled ? '保存策略并清理' : '保存停用策略'}
          </button>
        </div>
      </fieldset>
      <Feedback error={action.error || remote.error || saved?.warning} message={action.message} />
      {preview && (
        <p role="status">
          预览：将清理 {preview.removeLogs} 份日志（{bytes(preview.removeBytes)}），其中 {preview.expiredLogs}{' '}
          份到期、{preview.capacityLogs} 份超过容量。保留 {bytes(preview.remainingBytes)}；保护{' '}
          {preview.protectedLogs} 份运行中或时间异常的日志。
        </p>
      )}
      {saved && (
        <p className="subtle-note">
          当前覆盖 {saved.summary.stores} 个任务存储，已结束日志 {bytes(saved.summary.completedBytes)}
          ，受保护日志 {bytes(saved.summary.protectedBytes)}。
          {saved.policy.enabled ? '自动清理已启用。' : '自动清理未启用。'}
        </p>
      )}
      {saved?.lastRun && (
        <p className="subtle-note">
          上次清理：{formatDateTime(new Date(saved.lastRun.at))}，清理 {saved.lastRun.removedLogs} 份（
          {bytes(saved.lastRun.removedBytes)}）。
        </p>
      )}
      <button className="text-button" disabled={action.busy} onClick={remote.reload}>
        重新读取已保存策略
      </button>
    </section>
  );
}
