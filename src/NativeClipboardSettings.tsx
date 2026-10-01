import { useEffect, useState } from 'react';
import { defaultClipboardRule, type ClipboardRule } from '../shared/clipboard-policy';
import type {
  NativeClipboardProcess,
  NativeClipboardSettings as Settings,
  NativeClipboardView,
} from '../shared/native-clipboard';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';

export function NativeClipboardSettings({ request }: { request: Request }) {
  const remote = useRemote<NativeClipboardView>(request, '/native-clipboard', true, 4000);
  const action = useAction();
  const [draft, setDraft] = useState<Settings>({ enabled: false, applications: [] });
  const [version, setVersion] = useState(0),
    [process, setProcess] = useState('');
  const [argumentsByImage, setArgumentsByImage] = useState<Record<string, string>>({});
  const saved =
    !!remote.data &&
    version === remote.data.version &&
    JSON.stringify(draft) === JSON.stringify(remote.data.settings);
  useEffect(() => {
    if (remote.data && remote.data.version > version) {
      setDraft(remote.data.settings);
      setVersion(remote.data.version);
    }
  }, [remote.data, version]);
  const save = (settings: Settings) =>
    void action.run(async (signal) => {
      try {
        const value = await request<NativeClipboardView>(
          '/native-clipboard',
          'POST',
          { action: 'configure', version, settings },
          signal,
        );
        setDraft(value.settings);
        setVersion(value.version);
      } finally {
        remote.reload();
      }
    }, 'Windows 剪贴板配置已保存；请查看各进程的应用状态');
  const update = (image: string, rule: ClipboardRule) =>
    setDraft({
      ...draft,
      applications: draft.applications.map((item) => (item.image === image ? { ...item, rule } : item)),
    });
  const launch = (image: string, sha256: string) =>
    void action.run(async (signal) => {
      let args: unknown;
      try {
        args = JSON.parse(argumentsByImage[image] || '[]');
      } catch {
        throw new Error('启动参数需填写 JSON 字符串数组，例如 ["文件路径", "--选项"]');
      }
      if (
        !Array.isArray(args) ||
        args.length > 64 ||
        !args.every((value) => typeof value === 'string' && value.length <= 2048 && !value.includes('\0')) ||
        args.reduce((length, value) => length + value.length, 0) > 8192
      )
        throw new Error('启动参数需为最多 64 项的字符串数组；每项最多 2048、合计最多 8192 个字符');
      try {
        await request<{ process: NativeClipboardProcess; view: NativeClipboardView }>(
          '/native-clipboard',
          'POST',
          { action: 'launch', version, image, sha256, args },
          signal,
        );
      } finally {
        remote.reload();
      }
    }, '已按已保存规则启动应用');
  return (
    <section className="system-card native-settings native-clipboard" aria-label="Windows 应用剪贴板策略">
      <h3>Windows 应用剪贴板策略</h3>
      <p>
        选择正在运行的应用，保存复制、粘贴及内容限制。规则绑定完整程序路径和文件摘要，适用于当前 Windows
        用户的 x64 与 x86 进程。
      </p>
      <Feedback error={action.error || remote.error} message={action.message} />
      {remote.data?.error && <p role="alert">{remote.data.error}</p>}
      <p className="subtle-note">
        代理覆盖 Win32 与 OLE
        剪贴板调用。受控启动会先加载已保存策略再进入应用主函数。自行启动的进程仍需等待扫描附加；DLL/TLS
        初始化、受保护进程及自行调用底层系统接口的程序不在此保证范围内。普通 Linux X11 应用可在 KDE
        桌面中的原生应用剪贴板入口启动。
      </p>
      <fieldset disabled={action.busy}>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={!draft.enabled && !remote.data?.ready}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          />
          启用 Windows 应用策略
        </label>
        <label>
          正在运行的应用
          <select value={process} onChange={(event) => setProcess(event.target.value)}>
            <option value="">选择应用进程</option>
            {remote.data?.available
              .filter((item) => item.bits === 64 || item.bits === 32)
              .map((item) => (
                <option key={`${item.pid}:${item.created}`} value={`${item.pid}:${item.created}`}>
                  {item.image} · {item.bits} 位 · PID {item.pid}
                </option>
              ))}
          </select>
        </label>
        <div className="button-row">
          <button
            className="secondary compact"
            disabled={!process || !remote.data?.ready || draft.applications.length >= 32}
            onClick={() =>
              void action.run(async (signal) => {
                const [pid, created] = process.split(':');
                const selected = await request<{ image: string; sha256: string }>(
                  '/native-clipboard',
                  'POST',
                  { action: 'identify', pid: Number(pid), created },
                  signal,
                );
                setDraft((previous) => ({
                  ...previous,
                  applications: [
                    ...previous.applications.filter(
                      (item) => item.image.toLowerCase() !== selected.image.toLowerCase(),
                    ),
                    {
                      ...selected,
                      rule:
                        previous.applications.find(
                          (item) => item.image.toLowerCase() === selected.image.toLowerCase(),
                        )?.rule || defaultClipboardRule(),
                    },
                  ],
                }));
              }, '已选择程序；修改权限后保存配置')
            }
          >
            添加或重新绑定应用
          </button>
          <button
            className="secondary compact"
            onClick={() =>
              void action.run(async (signal) => {
                try {
                  await request('/native-clipboard', 'POST', { action: 'refresh' }, signal);
                } finally {
                  remote.reload();
                }
              }, '已刷新应用状态')
            }
          >
            刷新应用状态
          </button>
        </div>
        {draft.applications.map((item) => (
          <fieldset key={item.image}>
            <legend className="wrap-code">{item.image}</legend>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={item.rule.copy}
                onChange={(event) => update(item.image, { ...item.rule, copy: event.target.checked })}
              />
              允许复制与剪切
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={item.rule.paste}
                onChange={(event) => update(item.image, { ...item.rule, paste: event.target.checked })}
              />
              允许粘贴
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={item.rule.files}
                onChange={(event) => update(item.image, { ...item.rule, files: event.target.checked })}
              />
              允许文件、图片与其他格式
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={item.rule.sensitive}
                onChange={(event) => update(item.image, { ...item.rule, sensitive: event.target.checked })}
              />
              阻止疑似敏感文本
            </label>
            <label>
              文本上限
              <select
                value={item.rule.maxTextBytes}
                onChange={(event) =>
                  update(item.image, { ...item.rule, maxTextBytes: Number(event.target.value) })
                }
              >
                {[1024, 4096, 16384, 65536, 262144, 1048576].map((value) => (
                  <option key={value} value={value}>
                    {value / 1024} KiB
                  </option>
                ))}
              </select>
            </label>
            <label>
              启动参数（JSON 字符串数组）
              <textarea
                value={argumentsByImage[item.image] || '[]'}
                onChange={(event) =>
                  setArgumentsByImage({ ...argumentsByImage, [item.image]: event.target.value })
                }
                rows={2}
                spellCheck={false}
              />
            </label>
            <p className="subtle-note">
              参数逐项传给应用。受控启动使用已保存并启用的规则；修改规则后请先保存。
            </p>
            <button
              className="secondary compact"
              disabled={!saved || !draft.enabled || !remote.data?.ready}
              onClick={() => launch(item.image, item.sha256)}
            >
              受控启动此应用
            </button>
            <button
              className="text-button"
              onClick={() =>
                setDraft({
                  ...draft,
                  applications: draft.applications.filter((entry) => entry.image !== item.image),
                })
              }
            >
              移除此应用规则
            </button>
          </fieldset>
        ))}
        <p className="subtle-note">
          修改后需保存。关闭其他格式或开启敏感检测时仅允许纯文本，富文本也会被拒绝。检测不识别所有秘密，且不保存剪贴板文本。停用会解除方向和内容限制；代理及已有
          OLE 包装在应用退出后结束。关闭 Sakura 时保留其现有规则。
        </p>
        <div className="button-row">
          <button
            className="primary compact"
            disabled={!version || (draft.enabled && !remote.data?.ready)}
            onClick={() => save(draft)}
          >
            保存 Windows 剪贴板策略
          </button>
          <button
            className="secondary compact"
            disabled={!version}
            onClick={() => save({ ...draft, enabled: false })}
          >
            停用 Windows 应用策略
          </button>
        </div>
      </fieldset>
      <details open>
        <summary>受管进程状态（{remote.data?.processes.length || 0}）</summary>
        {remote.data?.processes.map((item) => (
          <div className="native-clipboard-process" key={`${item.pid}:${item.created}`}>
            <p className="wrap-code">
              {item.image} · PID {item.pid}
            </p>
            <p>
              {{ enforced: '已接入 Win32/OLE', error: '未应用当前规则', disabled: '已停用' }[item.state]} ·
              拒绝复制 {item.blockedCopy} · 拒绝粘贴 {item.blockedPaste}
            </p>
            {item.error && <p role="alert">{item.error}</p>}
          </div>
        ))}
        {!remote.data?.processes.length && <p>暂无受管进程。保存启用规则后会扫描匹配的应用。</p>}
      </details>
    </section>
  );
}
