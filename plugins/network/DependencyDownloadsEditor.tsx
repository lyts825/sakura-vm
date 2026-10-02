import type { DependencyAuthentication } from '../../server/dependency-downloads';
import type { NetworkProfile } from '../../server/network-profiles';

export function DependencyDownloadsEditor({
  value,
  disabled,
  change,
}: {
  value: NetworkProfile;
  disabled: boolean;
  change: (value: NetworkProfile['dependencyDownloads']) => void;
}) {
  const patch = (manager: 'npm' | 'pip' | 'git', authentication?: DependencyAuthentication) => {
    const next = { ...value.dependencyDownloads, [manager]: authentication };
    change(next.npm || next.pip || next.git ? next : undefined);
  };
  return (
    <details className="feature-card">
      <summary>项目依赖与 Git 认证预取</summary>
      <p className="subtle-note">
        应用此档案后，项目依赖预取和首次 Git 检出使用这里指定的仓库与私密配置。凭证仅用于该端点的域名、端口和目录，
        不进入项目环境或离线缓存。先在“开发设置 → 私密配置”保存只读下载凭证，再填写其名称。
      </p>
      {(['npm', 'pip', 'git'] as const).map((manager) => {
        const authentication = value.dependencyDownloads?.[manager];
        return (
          <div className="feature-card" key={manager}>
            <label>
              <input
                type="checkbox"
                checked={!!authentication}
                disabled={disabled}
                onChange={(event) =>
                  patch(
                    manager,
                    event.target.checked
                      ? manager === 'npm'
                        ? {
                            kind: 'bearer',
                            endpoint: value.npmRegistry || 'https://registry.npmjs.org/',
                            tokenSecret: '',
                          }
                        : {
                            kind: 'basic',
                            endpoint: manager === 'git' ? 'https://github.com/' : value.pipIndex || 'https://pypi.org/simple/',
                            username: '',
                            passwordSecret: '',
                          }
                      : undefined,
                  )
                }
              />{' '}
              {manager} 认证预取
            </label>
            {authentication && (
              <div className="feature-grid">
                <label>
                  {manager} 下载端点
                  <input
                    value={authentication.endpoint}
                    disabled={disabled}
                    maxLength={2048}
                    placeholder="https://packages.example.com/"
                    onChange={(event) => patch(manager, { ...authentication, endpoint: event.target.value })}
                  />
                </label>
                <label>
                  {manager} 下载认证方式
                  <select
                    value={authentication.kind}
                    disabled={disabled}
                    onChange={(event) =>
                      patch(
                        manager,
                        event.target.value === 'bearer'
                          ? { kind: 'bearer', endpoint: authentication.endpoint, tokenSecret: '' }
                          : {
                              kind: 'basic',
                              endpoint: authentication.endpoint,
                              username: '',
                              passwordSecret: '',
                            },
                      )
                    }
                  >
                    <option value="bearer">Bearer 令牌</option>
                    <option value="basic">用户名与密码</option>
                  </select>
                </label>
                {authentication.kind === 'basic' && (
                  <label>
                    {manager} 下载用户名
                    <input
                      value={authentication.username}
                      disabled={disabled}
                      maxLength={256}
                      onChange={(event) =>
                        patch(manager, { ...authentication, username: event.target.value })
                      }
                    />
                  </label>
                )}
                <label>
                  {manager} 下载凭证名称
                  <input
                    value={
                      authentication.kind === 'bearer'
                        ? authentication.tokenSecret
                        : authentication.passwordSecret
                    }
                    disabled={disabled}
                    maxLength={60}
                    placeholder="package-download-token"
                    onChange={(event) =>
                      patch(
                        manager,
                        authentication.kind === 'bearer'
                          ? { ...authentication, tokenSecret: event.target.value }
                          : { ...authentication, passwordSecret: event.target.value },
                      )
                    }
                  />
                </label>
              </div>
            )}
          </div>
        );
      })}
      <p className="subtle-note">
        认证下载使用系统 Python 3；npm 需要第 2 或第 3 版锁文件，Python 需要固定版本及二进制 wheel。
        Git 使用固定 smart-HTTP 仓库地址，首次检出需要空目录，下载后由项目账号执行检出；已有仓库不自动更新。
        下载端点使用 HTTPS，客户机回环测试地址可使用 HTTP。离线安装仍在项目网络中执行。
      </p>
    </details>
  );
}
