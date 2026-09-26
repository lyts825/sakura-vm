import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import '../../src/development.css';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';
import type { SecretRotationItem } from '../../server/secret-rotation';

export function SecretsPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{ items: { name: string; updatedAt: string }[] }>(
      request,
      `/vms/${vm.id}/secrets`,
    ),
    action = useAction();
  const rotation = useRemote<{ items: SecretRotationItem[] }>(request, `/vms/${vm.id}/secret-rotation`);
  const [name, setName] = useState(''),
    [value, setValue] = useState('');
  useEffect(() => {
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
          void action.run(async (signal) => {
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
            <p className="subtle-note">更新于 {new Date(item.updatedAt).toLocaleString()}</p>
            {rotation.data?.items.find((entry) => entry.name === item.name) && (
              <RotationEditor
                key={
                  vm.id +
                  item.name +
                  JSON.stringify(rotation.data.items.find((entry) => entry.name === item.name)!.policy)
                }
                item={rotation.data.items.find((entry) => entry.name === item.name)!}
                save={async (policy) => {
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
                  void action.run(async (signal) => {
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

function RotationEditor({
  item,
  save,
}: {
  item: SecretRotationItem;
  save: (policy: SecretRotationItem['policy']) => Promise<void>;
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
        <p className="subtle-note">轮换期限：{new Date(item.dueAt).toLocaleString()}</p>
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

export function SecretReferences({
  value,
  change,
}: {
  value?: Record<string, string>;
  change: (value: Record<string, string>) => void;
}) {
  const [rows, setRows] = useState(() => Object.entries(value || {}));
  useEffect(() => {
    if (
      JSON.stringify(Object.fromEntries(rows.filter(([key, name]) => key && name))) !==
      JSON.stringify(value || {})
    )
      setRows(Object.entries(value || {}));
  }, [value]);
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
