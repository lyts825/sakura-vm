import { useEffect, useState } from 'react';
import type { NativeSettings, NativeView } from '../shared/native-integration';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';

export function NativeIntegrationSettings({ request }: { request: Request }) {
  const remote = useRemote<NativeView>(request, '/native-integration', true, 0);
  const action = useAction();
  const [draft, setDraft] = useState<NativeSettings>({
    contextMenu: false,
    editor: 'notepad',
    associations: [],
  });
  const [version, setVersion] = useState(0);
  const [extension, setExtension] = useState('.txt'),
    [mapping, setMapping] = useState('');
  useEffect(() => {
    if (remote.data && remote.data.version !== version) {
      setDraft(remote.data.settings);
      setVersion(remote.data.version);
    }
  }, [remote.data, version]);
  const save = (settings: NativeSettings) =>
    void action.run(async (signal) => {
      try {
        const saved = await request<NativeView>(
          '/native-integration',
          'POST',
          { action: 'configure', version, settings },
          signal,
        );
        setDraft(saved.settings);
        setVersion(saved.version);
      } finally {
        remote.reload();
      }
    }, 'Windows 集成设置已保存');
  const disabled = action.busy || !remote.data?.supported || remote.data.pending;
  return (
    <section className="system-card native-settings" aria-label="Windows 工作区集成">
      <h3>Windows 工作区集成</h3>
      <p>使用项目的 Windows 目录同步映射，从资源管理器打开对应项目，或在文件面板打开本机副本。</p>
      <Feedback error={action.error || remote.error} message={action.message} />
      {remote.data && !remote.data.supported && <p>当前宿主机不支持 Windows 原生集成。</p>}
      {remote.data?.pending && (
        <div>
          <p role="alert">上次注册未完成。修复会继续应用已保存的操作，并保留其他程序的注册项。</p>
          <button
            className="secondary compact"
            disabled={action.busy}
            onClick={() =>
              void action.run(async (signal) => {
                try {
                  await request('/native-integration', 'POST', { action: 'repair', version }, signal);
                } finally {
                  remote.reload();
                }
              }, 'Windows 注册已修复')
            }
          >
            修复 Windows 注册
          </button>
        </div>
      )}
      <fieldset disabled={disabled}>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={draft.contextMenu}
            onChange={(event) => setDraft({ ...draft, contextMenu: event.target.checked })}
          />
          添加“在 Sakura 工作区中打开”右键菜单
        </label>
        <label>
          宿主编辑器
          <select
            value={draft.editor}
            onChange={(event) =>
              setDraft({ ...draft, editor: event.target.value as NativeSettings['editor'] })
            }
          >
            <option value="notepad">Windows 记事本</option>
            <option value="vscode">Visual Studio Code</option>
          </select>
        </label>
        <p>
          Windows 11 可在“显示更多选项”中找到菜单。文件关联添加到“打开方式”；可在 Windows 中将 Sakura
          设为默认应用。
        </p>
        <label>
          文件扩展名
          <input
            value={extension}
            onChange={(event) => setExtension(event.target.value)}
            placeholder=".txt"
            maxLength={25}
          />
        </label>
        <label>
          关联工作区
          <select value={mapping} onChange={(event) => setMapping(event.target.value)}>
            <option value="">选择已配置同步的项目</option>
            {remote.data?.mappings.map((item) => (
              <option key={`${item.vmId}:${item.projectId}`} value={`${item.vmId}:${item.projectId}`}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary compact"
          disabled={
            !mapping || !/^\.[a-z0-9][a-z0-9_-]{0,23}$/.test(extension) || draft.associations.length >= 32
          }
          onClick={() => {
            const [vmId, projectId] = mapping.split(':');
            setDraft({
              ...draft,
              associations: [
                ...draft.associations.filter((a) => a.extension !== extension),
                { extension, vmId, projectId },
              ],
            });
          }}
        >
          添加扩展名关联
        </button>
        <ul className="native-associations">
          {draft.associations.map((item) => (
            <li key={item.extension}>
              <span>
                <code>{item.extension}</code> →{' '}
                {remote.data?.mappings.find((m) => m.vmId === item.vmId && m.projectId === item.projectId)
                  ?.name || '项目不可用'}
              </span>
              <button
                className="text-button"
                aria-label={`移除 ${item.extension} 关联`}
                onClick={() =>
                  setDraft({
                    ...draft,
                    associations: draft.associations.filter((a) => a.extension !== item.extension),
                  })
                }
              >
                移除
              </button>
            </li>
          ))}
        </ul>
        <div className="button-row">
          <button className="primary compact" disabled={!version} onClick={() => save(draft)}>
            保存 Windows 集成
          </button>
          <button
            className="secondary compact"
            disabled={!version}
            onClick={() => save({ ...draft, contextMenu: false, associations: [] })}
          >
            移除菜单与文件关联
          </button>
        </div>
      </fieldset>
      <details>
        <summary>可打开的同步目录（{remote.data?.mappings.length || 0}）</summary>
        <p>
          需启用项目、文件和目录同步插件，并保存同步目录。打开操作使用已有副本；请先同步，再编辑需要的文件。
        </p>
        {remote.data?.mappings.map((item) => (
          <div key={`${item.vmId}:${item.projectId}`}>
            <b>{item.name}</b>
            <p className="wrap-code">
              {item.host} ↔ {item.guest}
            </p>
          </div>
        ))}
      </details>
    </section>
  );
}

export function NativeOpenButtons({
  request,
  vmId,
  projectId = 'default',
  path,
}: {
  request: Request;
  vmId: string;
  projectId?: string;
  path: string;
}) {
  const action = useAction();
  return (
    <div className="native-open">
      <div className="feature-actions">
        {(['explorer', 'editor'] as const).map((target) => (
          <button
            key={target}
            className="secondary compact"
            disabled={action.busy}
            onClick={() =>
              void action.run(async (signal) => {
                await request(
                  '/native-integration',
                  'POST',
                  { action: 'open', vmId, projectId, path, target },
                  signal,
                );
              }, '已请求打开 Windows 副本；更改后请同步回 Linux')
            }
          >
            {target === 'explorer' ? '在资源管理器中打开' : '用宿主编辑器打开'}
          </button>
        ))}
      </div>
      <Feedback error={action.error} message={action.message} />
    </div>
  );
}
