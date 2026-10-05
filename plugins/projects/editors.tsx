import { embeddedPluginComponent } from '../../src/plugin-client';
import { Plus, Trash2 } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import type { Project } from './view-types';
import type { FeatureProps } from '../../src/feature-shared';
import { PluginGate } from '../../src/plugin-context';
import { PluginBoundary } from '../../src/plugin-boundary';
const loadHealthEditor = () =>
  import('../service-health/client').then((module) => ({ default: module.HealthEditor }));
const loadSecretReferences = () =>
  import('../secrets/client').then((module) => ({ default: module.SecretReferences }));
const loadIdeConnection = () =>
  import('../ide/client').then((module) => ({ default: module.IdeConnection }));
const loadRecipeConnection = () =>
  import('../recipes/client').then((module) => ({ default: module.RecipeConnection }));

export function ServiceEditor({
  project,
  edit,
  request,
}: {
  project: Project;
  edit: (patch: Partial<Project>) => void;
  request: FeatureProps['request'];
}) {
  const services = project.services || [];
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

export function EnvironmentEditor({
  value,
  change,
}: {
  value?: Record<string, string>;
  change: (value: Record<string, string>) => void;
}) {
  const [text, setText] = useState(() =>
    Object.entries(value || {})
      .map(([key, val]) => `${key}=${val}`)
      .join('\n'),
  );
  useEffect(() => {
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

export function ProjectConnections(props: FeatureProps & { applied: (project: Project) => void }) {
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
