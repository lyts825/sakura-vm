/**
 * 模块职责（中文）：项目服务、环境变量和外部连接的可编辑组件，按可选插件加载健康检查、秘密与 IDE/配方入口。
 * Module responsibility (English): UI interaction and state presentation for project configuration, identities and running services.
 * 详细范围（中文）：公开入口包括 ServiceEditor, EnvironmentEditor, ProjectConnections；职责覆盖项目配置、账号与运行服务的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ServiceEditor, EnvironmentEditor, ProjectConnections. The scope covers UI interaction and state presentation for project configuration, identities and running services. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { embeddedPluginComponent } from '../../src/plugin-client';
import { Plus, Trash2 } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import type { Project } from './view-types';
import type { FeatureProps } from '../../src/feature-shared';
import { PluginGate } from '../../src/plugin-context';
import { PluginBoundary } from '../../src/plugin-boundary';
/**
 * 中文：懒加载 ../service-health/client 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码
 * English: Lazily load ../service-health/client and adapt its selected export as the default React component, deferring this feature's UI code download
 */
const loadHealthEditor = () =>
  import('../service-health/client').then((module) => ({ default: module.HealthEditor }));
/**
 * 中文：懒加载 ../secrets/client 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码
 * English: Lazily load ../secrets/client and adapt its selected export as the default React component, deferring this feature's UI code download
 */
const loadSecretReferences = () =>
  import('../secrets/client').then((module) => ({ default: module.SecretReferences }));
/**
 * 中文：懒加载 ../ide/client 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码
 * English: Lazily load ../ide/client and adapt its selected export as the default React component, deferring this feature's UI code download
 */
const loadIdeConnection = () =>
  import('../ide/client').then((module) => ({ default: module.IdeConnection }));
/**
 * 中文：懒加载 ../recipes/client 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码
 * English: Lazily load ../recipes/client and adapt its selected export as the default React component, deferring this feature's UI code download
 */
const loadRecipeConnection = () =>
  import('../recipes/client').then((module) => ({ default: module.RecipeConnection }));

/**
 * 中文：呈现项目配置、账号与运行服务的界面交互与状态呈现中的 ServiceEditor 界面，组合 Plus，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ServiceEditor surface for UI interaction and state presentation for project configuration, identities and running services and composing Plus. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  project,
  edit,
  request,
} 提供 project（project 状态）、edit（当前文件编辑项）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: {
  project,
  edit,
  request,
} provides context fields project (project state), edit (current file edit), request (transport capability bound to identity/authority scope)
 */
export function ServiceEditor({
  project,
  edit,
  request,
}: {
  project: Project;
  edit: /** 中文：把局部项目配置变更交给受控编辑器合并；这是 ServiceEditor 的调用契约 | English: Deliver partial project-configuration changes to controlled-editor merging; this is the callable contract of ServiceEditor | 中文：输入：patch：只包含修改字段的增量 | English: Inputs: patch: delta containing modified fields only | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (patch: Partial<Project>) => void;
  request: FeatureProps['request'];
}) {
  const services = project.services || [];
  /**
   * 中文：仅给指定索引服务合并局部 patch，以新数组交给受控项目编辑器，保留其他服务字段。
   * English: Merge a partial patch only into the selected service index, delivering a new array to the controlled project editor while retaining other services.
   * 中文：输入：index：签名所示 number 业务值；patch：只包含修改字段的增量
   * English: Inputs: index: the number domain value in the signature; patch: delta containing modified fields only
   */
  const change = (index: number, patch: Partial<(typeof services)[number]>) =>
    edit({ services: services.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  return (
    <details className="feature-card" open={services.length > 0}>
      <summary>多服务项目（{services.length}）</summary>
      <p className="subtle-note">
        配置多个服务后，“启动开发”会按依赖顺序启动它们。就绪命令返回 0 后才会启动依赖它的服务。
      </p>
      {services.map((service, index) => (
        <div className="feature-card" key={index}>
          <div className="feature-grid">
            <label>
              服务名称
              <input
                value={service.name}
                onChange={(e) => change(index, { name: e.target.value })}
                placeholder="api"
              />
            </label>
            <label>
              依赖服务（逗号分隔）
              <input
                value={service.dependsOn.join(', ')}
                onChange={(e) =>
                  change(index, {
                    dependsOn: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
          </div>
          <label>
            启动命令
            <textarea
              value={service.command}
              onChange={(e) => change(index, { command: e.target.value })}
              placeholder="npm run dev -- --host 0.0.0.0"
            />
          </label>
          <div className="feature-grid">
            <label>
              就绪检查命令（可选）
              <input
                value={service.ready}
                onChange={(e) => change(index, { ready: e.target.value })}
                placeholder="curl -fsS http://127.0.0.1:3000/health"
              />
            </label>
            <label>
              最长等待秒数
              <input
                type="number"
                min={5}
                max={300}
                value={service.timeout}
                onChange={(e) => change(index, { timeout: +e.target.value })}
              />
            </label>
          </div>
          <EnvironmentEditor
            value={service.environment}
            change={(environment) => change(index, { environment })}
          />
          <PluginGate id="secrets">
            <PluginBoundary identity="official:secrets" request={request} label="服务凭据引用">
              {(_request, lifetime) => {
                const SecretReferences = embeddedPluginComponent('secrets', `service-secrets-${index}`, lifetime, loadSecretReferences);
                return <Suspense fallback={<p role="status">正在加载凭据配置…</p>}>
                  <SecretReferences value={service.secrets} change={(secrets) => change(index, { secrets })} />
                </Suspense>;
              }}
            </PluginBoundary>
          </PluginGate>
          <PluginGate id="service-health">
            <PluginBoundary identity="official:service-health" request={request} label="服务健康配置">
              {(_request, lifetime) => {
                const HealthEditor = embeddedPluginComponent('service-health', `health-editor-${index}`, lifetime, loadHealthEditor);
                return <Suspense fallback={<p role="status">正在加载健康配置…</p>}>
                  <HealthEditor value={service.health} change={(health) => change(index, { health })} />
                </Suspense>;
              }}
            </PluginBoundary>
          </PluginGate>
          <button
            className="text-button danger-text"
            onClick={() => edit({ services: services.filter((_, i) => i !== index) })}
          >
            <Trash2 size={14} />
            移除服务配置
          </button>
        </div>
      ))}
      <button
        className="secondary compact"
        disabled={services.length >= 12}
        onClick={() =>
          edit({
            services: [
              ...services,
              { name: `service-${services.length + 1}`, command: '', dependsOn: [], ready: '', timeout: 30 },
            ],
          })
        }
      >
        <Plus size={14} />
        添加服务
      </button>
    </details>
  );
}

/**
 * 中文：呈现项目配置、账号与运行服务的界面交互与状态呈现中的 EnvironmentEditor 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the EnvironmentEditor surface for UI interaction and state presentation for project configuration, identities and running services. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  value,
  change,
} 提供 value（待校验、转换或保存的输入值）、change（change 状态） 上下文字段
 * English: Inputs: {
  value,
  change,
} provides context fields value (input value to validate/transform/save), change (change state)
 */
export function EnvironmentEditor({
  value,
  change,
}: {
  value?: Record<string, string>;
  change: /** 中文：把修改后的字段或文档交给父级状态所有者；这是 EnvironmentEditor 的调用契约 | English: Deliver modified fields/documents to the parent state owner; this is the callable contract of EnvironmentEditor | 中文：输入：value：待校验、转换或保存的输入值 | English: Inputs: value: input value to validate/transform/save | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (value: Record<string, string>) => void;
}) {
  const [text, setText] = useState(() =>
    Object.entries(value || {})
      .map(([key, val]) => `${key}=${val}`)
      .join('\n'),
  );
  useEffect(/** 中文：当依赖 [value] 变化时文本输入；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [value] change, text input. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    const parsed = Object.fromEntries(
      text
        .split('\n')
        .filter((s) => s.includes('='))
        .map((s) => [s.slice(0, s.indexOf('=')).trim(), s.slice(s.indexOf('=') + 1)]),
    );
    if (JSON.stringify(parsed) !== JSON.stringify(value || {}))
      setText(
        Object.entries(value || {})
          .map(([key, val]) => `${key}=${val}`)
          .join('\n'),
      );
  }, [value]);
  return (
    <label>
      环境变量（每行 NAME=value）
      <textarea
        rows={2}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          change(
            Object.fromEntries(
              e.target.value
                .split('\n')
                .filter((s) => s.includes('='))
                .map((s) => [s.slice(0, s.indexOf('=')).trim(), s.slice(s.indexOf('=') + 1)]),
            ),
          );
        }}
      />
      <small>环境配置会随导出文件一起分享，请使用非敏感配置值。</small>
    </label>
  );
}

/**
 * 中文：呈现项目配置、账号与运行服务的界面交互与状态呈现中的 ProjectConnections 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ProjectConnections surface for UI interaction and state presentation for project configuration, identities and running services. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：props：签名所示 FeatureProps & { applied: (project: Project) => void } 业务值
 * English: Inputs: props: the FeatureProps & { applied: (project: Project) => void } domain value in the signature
 */
export function ProjectConnections(props: FeatureProps & { applied: /** 中文：在配置应用后通知外层恢复最新视图；这是 ProjectConnections 的调用契约 | English: Notify the outer owner to restore current views after configuration application; this is the callable contract of ProjectConnections | 中文：输入：project：签名所示 Project 业务值 | English: Inputs: project: the Project domain value in the signature | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (project: Project) => void }) {
  return (
    <>
      <PluginGate id="ide">
        <PluginBoundary identity="official:ide" request={props.request} label="IDE 连接">
          {(scopedRequest, lifetime) => {
            const IdeConnection = embeddedPluginComponent('ide', 'ide-connection', lifetime, loadIdeConnection);
            return <Suspense fallback={<p role="status">正在加载 IDE 连接…</p>}>
              <IdeConnection {...props} request={scopedRequest} />
            </Suspense>;
          }}
        </PluginBoundary>
      </PluginGate>
      <PluginGate id="recipes">
        <PluginBoundary identity="official:recipes" request={props.request} label="开发配方">
          {(scopedRequest, lifetime) => {
            const RecipeConnection = embeddedPluginComponent('recipes', 'recipe-connection', lifetime, loadRecipeConnection);
            return <Suspense fallback={<p role="status">正在加载开发配方…</p>}>
              <RecipeConnection {...props} request={scopedRequest} />
            </Suspense>;
          }}
        </PluginBoundary>
      </PluginGate>
    </>
  );
}
