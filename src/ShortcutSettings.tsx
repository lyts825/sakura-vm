/**
 * 模块职责（中文）：编辑和校验工作区快捷键，展示冲突并保存用户偏好。
 * Module responsibility (English): Editing and saving shortcuts after conflict validation.
 * 详细范围（中文）：公开入口包括 ShortcutSettings；职责覆盖编辑并保存通过冲突校验的快捷键，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ShortcutSettings. The scope covers Editing and saving shortcuts after conflict validation. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useLayoutEffect, useRef, useState } from 'react';
import './preference-editors.css';
import {
  effectiveShortcuts,
  saveShortcuts,
  shortcutCommands,
  type ShortcutMap,
  type ShortcutPreferences,
} from './shortcuts';

/**
 * 中文：呈现编辑并保存通过冲突校验的快捷键中的 ShortcutSettings 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ShortcutSettings surface for Editing and saving shortcuts after conflict validation. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  preferences,
  context,
  projectName,
} 提供 preferences（偏好草稿）、context（当前调用所属的应用或工作区上下文）、projectName（projectName 状态） 上下文字段
 * English: Inputs: {
  preferences,
  context,
  projectName,
} provides context fields preferences (preference draft), context (application/workspace context for the call), projectName (projectName state)
 */
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
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const matches = shortcutCommands.filter(command => command.name.includes(query.trim()));
  useLayoutEffect(/** 中文：当依赖 [preferences, project, context] 变化时编辑草稿，错误反馈；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [preferences, project, context] change, editing draft, error feedback. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    setDraft({ ...(project ? preferences.projects[context!] || {} : effectiveShortcuts(preferences)) });
    setError('');
  }, [preferences, project, context]);
  useLayoutEffect(() => setMessage(''), [project, context]);
  const inherited = effectiveShortcuts(preferences);
  /**
   * 中文：在编辑并保存通过冲突校验的快捷键流程中错误反馈，完成提示；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Editing and saving shortcuts after conflict validation, error feedback, completion message. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：map：签名所示 ShortcutMap 业务值
   * English: Inputs: map: the ShortcutMap domain value in the signature
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
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
      <div className="shortcut-search">
        <label>查找快捷键操作<input ref={search} type="search" value={query} placeholder="输入操作名称…" onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); setQuery(''); }
        }} /></label>
        <p role="status">显示 {matches.length} / {shortcutCommands.length} 项操作</p>
        {query && <button className="text-button" onClick={() => { setQuery(''); search.current?.focus(); }}>清空快捷键搜索</button>}
      </div>
      {!matches.length && <p className="subtle-note">没有匹配的操作，试试更短的名称。</p>}
      <div className="shortcut-fields">
        {matches.map(/**
         * 中文功能：渲染每条快捷键的全局或项目覆盖值；项目未覆盖时显示继承值且禁用编辑，切换覆盖时复制继承值或删除覆盖键。
         * English: Render each global/project-override shortcut; show inherited values with editing disabled when unoverridden, and copy inheritance or delete the override when toggled.
         * 输入 / Inputs: command.
         * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
         * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
         */
        (command) => {
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
                  onChange={(event) => { setDraft({ ...draft, [command.id]: event.target.value }); setMessage(''); setError(''); }}
                />
                <small>{project && !override ? '继承全局设置' : (draft[command.id] || '') ? project ? '项目自定义' : '全局设置' : '已停用'}</small>
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
                      setMessage('');
                      setError('');
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
