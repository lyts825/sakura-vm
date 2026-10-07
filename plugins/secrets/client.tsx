/**
 * 模块职责（中文）：“私密配置”插件的秘密引用、私密配置和轮换策略编辑分区，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for private configuration references and rotation.
 * 详细范围（中文）：公开入口包括 SecretsPanel, SecretReferences, developmentSections；职责覆盖私密配置引用与轮换的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include SecretsPanel, SecretReferences, developmentSections. The scope covers UI interaction and state presentation for private configuration references and rotation. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDateTime } from '../../src/localization';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import '../../src/development.css';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';
import type { SecretRotationItem, SecretRotationView, SecretsView } from './contracts.ts';

/**
 * 中文：呈现私密配置引用与轮换的界面交互与状态呈现中的 SecretsPanel 界面，订阅 /vms/{vm.id}/secrets、/vms/{vm.id}/secret-rotation，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the SecretsPanel surface for UI interaction and state presentation for private configuration references and rotation, subscribing to /vms/{vm.id}/secrets, /vms/{vm.id}/secret-rotation. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vm, request } 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { vm, request } provides context fields vm (vm state), request (transport capability bound to identity/authority scope)
 */
export function SecretsPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<SecretsView>(
      request,
      `/vms/${vm.id}/secrets`,
    ),
    action = useAction();
  const rotation = useRemote<SecretRotationView>(request, `/vms/${vm.id}/secret-rotation`);
  const [name, setName] = useState(''),
    [value, setValue] = useState('');
  useEffect(/** 中文：当依赖 [vm.id] 变化时名称输入，当前值；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [vm.id] change, name input, current value. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    setName('');
    setValue('');
  }, [vm.id]);
  return (
    <>
      <p className="subtle-note">
        由当前 Windows 账户加密保护，保存后只显示名称。在项目和服务中以名称引用，备份密码也可使用这里的配置。
      </p>
      <Feedback error={action.error || remote.error} message={action.message} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(/** 中文：提交 PUT /vms/{vm.id}/secrets，完成私密配置引用与轮换的界面交互与状态呈现的数据交互并更新当前值、名称输入；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform PUT /vms/{vm.id}/secrets for UI interaction and state presentation for private configuration references and rotation and update current value, name input. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
            await request(`/vms/${vm.id}/secrets`, 'PUT', { name, value }, signal);
            setValue('');
            setName('');
            remote.reload();
            rotation.reload();
          }, '私密配置已保存');
        }}
      >
        <div className="feature-grid">
          <label>
            配置名称
            <input
              required
              maxLength={60}
              pattern="[A-Za-z][A-Za-z0-9_-]*"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="api-token"
            />
          </label>
          <label>
            私密值
            <input
              type="password"
              required
              autoComplete="new-password"
              maxLength={8192}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        </div>
        <button className="primary compact" disabled={action.busy}>
          保存私密配置
        </button>
      </form>
      {remote.data?.items.map((item) => (
        <div className="development-row" key={item.name}>
          <div>
            <b>{item.name}</b>
            <p className="subtle-note">更新于 {formatDateTime(new Date(item.updatedAt))}</p>
            {rotation.data?.items.find((entry) => entry.name === item.name) && (
              <RotationEditor
                key={
                  vm.id +
                  item.name +
                  JSON.stringify(rotation.data.items.find((entry) => entry.name === item.name)!.policy)
                }
                item={rotation.data.items.find((entry) => entry.name === item.name)!}
                save={/** 中文：提交 PATCH /vms/{vm.id}/secret-rotation，完成私密配置引用与轮换的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform PATCH /vms/{vm.id}/secret-rotation for UI interaction and state presentation for private configuration references and rotation. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：policy：此处理器的调用值 | English: Inputs: policy: the invocation value for this handler | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (policy) => {
                  await request(`/vms/${vm.id}/secret-rotation`, 'PATCH', { name: item.name, policy });
                  rotation.reload();
                }}
              />
            )}
          </div>
          <div className="feature-actions">
            <button
              className="text-button"
              onClick={() => {
                setName(item.name);
                setValue('');
              }}
            >
              更新值
            </button>
            <button
              className="text-button danger-text"
              disabled={action.busy}
              onClick={() => {
                if (confirm(`删除私密配置 ${item.name}？引用它的任务将无法启动。`))
                  void action.run(/** 中文：提交 DELETE /vms/{vm.id}/secrets，完成私密配置引用与轮换的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform DELETE /vms/{vm.id}/secrets for UI interaction and state presentation for private configuration references and rotation. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
                    await request(`/vms/${vm.id}/secrets`, 'DELETE', { name: item.name }, signal);
                    remote.reload();
                    rotation.reload();
                  });
              }}
            >
              删除
            </button>
          </div>
        </div>
      ))}
      <Feedback error={rotation.error} />
      <p className="subtle-note">
        轮换年龄从 Sakura 中最后一次实际修改值起计算；重复保存相同值不重置。后台提醒需启用自动化调度及告警。
      </p>
    </>
  );
}

/**
 * 中文：呈现私密配置引用与轮换的界面交互与状态呈现中的 RotationEditor 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the RotationEditor surface for UI interaction and state presentation for private configuration references and rotation. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  item,
  save,
} 提供 item（item 状态）、save（save 状态） 上下文字段
 * English: Inputs: {
  item,
  save,
} provides context fields item (item state), save (save state)
 */
function RotationEditor({
  item,
  save,
}: {
  item: SecretRotationItem;
  save: /** 中文：提交当前编辑内容并返回保存结果，失败允许调用者保留草稿；这是 RotationEditor 的调用契约 | English: Submit current edit content and return its save result, allowing callers to retain drafts on failure; this is the callable contract of RotationEditor | 中文：输入：policy：签名所示 SecretRotationItem['policy'] 业务值 | English: Inputs: policy: the SecretRotationItem['policy'] domain value in the signature | 中文：结果：Promise<void>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<void>; callers depend on this type contract, with promise rejection representing asynchronous failure */ (policy: SecretRotationItem['policy']) => Promise<void>;
}) {
  const [policy, setPolicy] = useState(item.policy),
    action = useAction();
  const states = {
    disabled: '提醒未启用',
    unknown: '更新时间未知',
    current: '期限内',
    'due-soon': '即将到期',
    overdue: '需要轮换',
  };
  return (
    <details className="feature-card">
      <summary>
        {states[item.status]}
        {item.ageDays === null ? '' : ` · 已使用 ${item.ageDays} 天`}
      </summary>
      {item.dueAt && item.policy.enabled && (
        <p className="subtle-note">轮换期限：{formatDateTime(new Date(item.dueAt))}</p>
      )}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={policy.enabled}
          onChange={(event) => setPolicy({ ...policy, enabled: event.target.checked })}
        />
        启用 {item.name} 的轮换提醒
      </label>
      <div className="feature-grid">
        <label>
          轮换周期（天）
          <input
            type="number"
            min={1}
            max={3650}
            value={policy.maxAgeDays}
            onChange={(event) => setPolicy({ ...policy, maxAgeDays: Number(event.target.value) })}
          />
        </label>
        <label>
          提前提醒（天）
          <input
            type="number"
            min={0}
            max={365}
            value={policy.remindBeforeDays}
            onChange={(event) => setPolicy({ ...policy, remindBeforeDays: Number(event.target.value) })}
          />
        </label>
      </div>
      <button
        className="secondary compact"
        disabled={action.busy}
        onClick={() => void action.run(() => save(policy), '轮换策略已保存')}
      >
        保存轮换策略
      </button>
      <Feedback error={action.error} message={action.message} />
    </details>
  );
}

/**
 * 中文：呈现私密配置引用与轮换的界面交互与状态呈现中的 SecretReferences 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the SecretReferences surface for UI interaction and state presentation for private configuration references and rotation. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  value,
  change,
} 提供 value（待校验、转换或保存的输入值）、change（change 状态） 上下文字段
 * English: Inputs: {
  value,
  change,
} provides context fields value (input value to validate/transform/save), change (change state)
 */
export function SecretReferences({
  value,
  change,
}: {
  value?: Record<string, string>;
  change: /** 中文：把修改后的字段或文档交给父级状态所有者；这是 SecretReferences 的调用契约 | English: Deliver modified fields/documents to the parent state owner; this is the callable contract of SecretReferences | 中文：输入：value：待校验、转换或保存的输入值 | English: Inputs: value: input value to validate/transform/save | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (value: Record<string, string>) => void;
}) {
  const [rows, setRows] = useState(() => Object.entries(value || {}));
  useEffect(/** 中文：当依赖 [value] 变化时rows 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [value] change, rows state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (
      JSON.stringify(Object.fromEntries(rows.filter(([key, name]) => key && name))) !==
      JSON.stringify(value || {})
    )
      setRows(Object.entries(value || {}));
  }, [value]);
  /**
   * 中文：在私密配置引用与轮换的界面交互与状态呈现流程中rows 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In UI interaction and state presentation for private configuration references and rotation, rows state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：next：待采用的新状态或数据
   * English: Inputs: next: new state/data to adopt
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const update = (next: [string, string][]) => {
    setRows(next);
    change(Object.fromEntries(next.filter(([key, name]) => key && name)));
  };
  return (
    <details className="feature-card">
      <summary>私密配置引用（{Object.keys(value || {}).length}）</summary>
      <p className="subtle-note">例如 TOKEN → api-token。右侧填写“开发设置 → 私密配置”中保存的名称。</p>
      {rows.map(([key, name], index) => (
        <div className="secret-reference" key={index}>
          <input
            aria-label={`环境变量名称 ${index + 1}`}
            value={key}
            placeholder="TOKEN"
            onChange={(e) => update(rows.map((row, i) => (i === index ? [e.target.value, name] : row)))}
          />
          <span>→</span>
          <input
            aria-label={`私密配置名称 ${index + 1}`}
            value={name}
            placeholder="api-token"
            onChange={(e) => update(rows.map((row, i) => (i === index ? [key, e.target.value] : row)))}
          />
          <button
            className="icon-button"
            aria-label={`移除引用 ${index + 1}`}
            onClick={() => update(rows.filter((_, i) => i !== index))}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        className="text-button"
        disabled={rows.length >= 32}
        onClick={() => setRows([...rows, ['', '']])}
      >
        添加引用
      </button>
    </details>
  );
}

export const developmentSections = { secrets: SecretsPanel };
