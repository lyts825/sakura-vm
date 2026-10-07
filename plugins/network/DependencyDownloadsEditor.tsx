/**
 * 模块职责（中文）：编辑项目依赖下载认证配置，按依赖管理器维护凭证引用与下载参数。
 * Module responsibility (English): UI interaction and state presentation for ports, network profiles, ingress and certificates.
 * 详细范围（中文）：公开入口包括 DependencyDownloadsEditor；职责覆盖端口、网络档案、入口与证书的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include DependencyDownloadsEditor. The scope covers UI interaction and state presentation for ports, network profiles, ingress and certificates. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { DependencyAuthentication, NetworkProfile } from './contracts.ts';

/**
 * 中文：呈现端口、网络档案、入口与证书的界面交互与状态呈现中的 DependencyDownloadsEditor 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the DependencyDownloadsEditor surface for UI interaction and state presentation for ports, network profiles, ingress and certificates. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  value,
  disabled,
  change,
} 提供 value（待校验、转换或保存的输入值）、disabled（disabled 状态）、change（change 状态） 上下文字段
 * English: Inputs: {
  value,
  disabled,
  change,
} provides context fields value (input value to validate/transform/save), disabled (disabled state), change (change state)
 */
export function DependencyDownloadsEditor({
  value,
  disabled,
  change,
}: {
  value: NetworkProfile;
  disabled: boolean;
  change: /** 中文：把修改后的字段或文档交给父级状态所有者；这是 DependencyDownloadsEditor 的调用契约 | English: Deliver modified fields/documents to the parent state owner; this is the callable contract of DependencyDownloadsEditor | 中文：输入：value：待校验、转换或保存的输入值 | English: Inputs: value: input value to validate/transform/save | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (value: NetworkProfile['dependencyDownloads']) => void;
}) {
  /**
   * 中文：只修改指定包管理器的认证配置，保留其他管理器；三者全空时返回 undefined 删除整体配置。
   * English: Update only the selected manager's authentication while preserving others; return undefined to remove the whole configuration when all three are empty.
   * 中文：输入：manager：签名所示 'npm' | 'pip' | 'git' 业务值；authentication：签名所示 DependencyAuthentication 业务值
   * English: Inputs: manager: the 'npm' | 'pip' | 'git' domain value in the signature; authentication: the DependencyAuthentication domain value in the signature
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
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
      {(['npm', 'pip', 'git'] as const).map(/**
       * 中文功能：为 npm、pip、git 渲染授权配置行，按是否启用及 bearer/basic 类型显示字段，并把变更交给对应 manager 的 patch。
       * English: Render authorization rows for npm/pip/git, select fields from enablement and bearer/basic kind, and send changes to the corresponding manager patch.
       * 输入 / Inputs: manager.
       * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
       * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
       */
      (manager) => {
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
