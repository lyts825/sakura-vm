import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import '../../src/development.css';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';

export function SecretsPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{ items: { name: string; updatedAt: string }[] }>(
      request,
      `/vms/${vm.id}/secrets`,
    ),
    action = useAction();
  const [name, setName] = useState(''),
    [value, setValue] = useState('');
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
                  });
              }}
            >
              删除
            </button>
          </div>
        </div>
      ))}
    </>
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
