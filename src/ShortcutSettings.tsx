import { useLayoutEffect, useState } from 'react';
import {
  effectiveShortcuts,
  saveShortcuts,
  shortcutCommands,
  type ShortcutMap,
  type ShortcutPreferences,
} from './shortcuts';

export function ShortcutSettings({
  preferences,
  context,
  projectName,
}: {
  preferences: ShortcutPreferences;
  context?: string;
  projectName?: string;
}) {
  const [scope, setScope] = useState('global');
  const project = scope === 'project' && !!context;
  const [draft, setDraft] = useState<ShortcutMap>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useLayoutEffect(() => {
    setDraft({ ...(project ? preferences.projects[context!] || {} : effectiveShortcuts(preferences)) });
    setError('');
  }, [preferences, project, context]);
  const inherited = effectiveShortcuts(preferences);
  const persist = (map: ShortcutMap) => {
    try {
      const next = structuredClone(preferences);
      if (project) {
        if (Object.keys(map).length) next.projects[context!] = map;
        else delete next.projects[context!];
      } else next.global = map;
      saveShortcuts(next);
      setError('');
      setMessage('快捷键已保存');
    } catch (error) {
      setError(String((error as Error).message || error));
      setMessage('');
    }
  };
  return (
    <section className="system-card shortcut-settings" aria-label="快捷键编辑器">
      <h3>快捷键编辑器</h3>
      <p className="subtle-note">
        全局指当前浏览器的 Sakura 页面。Mod 在 Windows 为 Ctrl，在 macOS 为
        ⌘；留空停用。输入框、代码编辑器、终端、Linux 桌面及对话框中不触发。Escape 保留用于退出专注模式。
      </p>
      <label>
        配置范围
        <select
          aria-label="快捷键配置范围"
          value={project ? 'project' : 'global'}
          onChange={(event) => setScope(event.target.value)}
        >
          <option value="global">全局</option>
          <option value="project" disabled={!context}>
            当前项目{projectName ? ` · ${projectName}` : ''}
          </option>
        </select>
      </label>
      <div className="shortcut-fields">
        {shortcutCommands.map((command) => {
          const override = Object.hasOwn(draft, command.id);
          return (
            <div className="shortcut-field" key={command.id}>
              <label>
                {command.name}
                <input
                  aria-label={`${command.name}快捷键`}
                  value={project && !override ? inherited[command.id] : draft[command.id] || ''}
                  disabled={project && !override}
                  placeholder="未设置"
                  onChange={(event) => setDraft({ ...draft, [command.id]: event.target.value })}
                />
              </label>
              {project && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    aria-label={`覆盖${command.name}快捷键`}
                    checked={override}
                    onChange={(event) => {
                      const next = { ...draft };
                      if (event.target.checked) next[command.id] = inherited[command.id];
                      else delete next[command.id];
                      setDraft(next);
                    }}
                  />
                  项目覆盖
                </label>
              )}
            </div>
          );
        })}
      </div>
      <div className="button-row">
        <button className="secondary compact" onClick={() => persist(draft)}>
          保存快捷键
        </button>
        <button className="text-button" onClick={() => persist({})}>
          {project ? '恢复全局快捷键' : '恢复默认快捷键'}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
