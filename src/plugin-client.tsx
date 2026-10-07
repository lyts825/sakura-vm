/**
 * 模块职责：按插件声明懒加载页面、标签与开发分区，并按插件生命周期缓存 React 组件。
 */
import { lazy, Suspense, type ComponentType } from 'react';
import type { VMView } from '../shared/contracts/vm.ts';
import { PLUGINS } from '../shared/plugins';
import type { FeatureProps, Request } from './feature-shared';
import { PluginBoundary } from './plugin-boundary';

export type PluginPageProps = {
  request: Request;
  vms: VMView[];
  selected: string;
  refresh: () => Promise<unknown>;
  token: string;
  onSelected: (id: string) => void;
  onCreate: () => void;
  projectId?: string;
};
export type PluginTabProps = FeatureProps & {
  start: () => unknown;
  busy: boolean;
  configure: () => unknown;
  openFile?: { path: string; revision: number; directory?: boolean };
};
type ClientProps = {
  tabs: PluginTabProps;
  pages: PluginPageProps;
  developmentSections: FeatureProps;
};
type ClientModule = { [Kind in keyof ClientProps]?: Record<string, ComponentType<ClientProps[Kind]>> };
const entries = import.meta.glob<ClientModule>('../plugins/*/client.tsx');
const components = new Map<string, { lifetime: string; value: ComponentType<any> }>();

// 缓存既看界面贡献标识也看寿命；同一寿命保持组件引用稳定，换代/重试才新建 lazy 对象。
function cachedComponent<Props extends object>(key: string, lifetime: string,
  load: () => Promise<{ default: ComponentType<Props> }>): ComponentType<Props> {
  const cached = components.get(key);
  let value = cached?.lifetime === lifetime ? cached.value : undefined;
  if (!value) {
    value = lazy(load);
    components.set(key, { lifetime, value });
  }
  return value;
}

/** React.lazy caches rejected imports; a boundary retry needs a fresh lazy object. */
export function embeddedPluginComponent<Props extends object>(owner: string, id: string, lifetime: string,
  load: () => Promise<{ default: ComponentType<Props> }>): ComponentType<Props> {
  return cachedComponent(`${owner}:embedded:${id}`, lifetime, load);
}

function component<Kind extends keyof ClientProps>(owner: string, kind: Kind, id: string, lifetime: string) {
  return cachedComponent<ClientProps[Kind]>(`${owner}:${kind}:${id}`, lifetime, async () => {
    const load = entries[`../plugins/${owner}/client.tsx`];
    if (!load) throw new Error(`插件 ${owner} 缺少界面入口`);
    const entry = await load();
    const Component = entry[kind]?.[id];
    if (!Component) throw new Error(`插件 ${owner} 缺少界面组件：${id}`);
    return { default: Component };
  });
}

export function PluginTab({ owner, id, ...props }: PluginTabProps & { owner: string; id: string }) {
  return <PluginBoundary identity={`official:${owner}`} request={props.request}>
    {(request, lifetime) => {
      const Component = component(owner, 'tabs', id, lifetime);
      return <Suspense fallback={<p role="status">正在加载功能…</p>}>
        <Component {...props} request={request} />
      </Suspense>;
    }}
  </PluginBoundary>;
}
export function PluginPage({ owner, id, ...props }: PluginPageProps & { owner: string; id: string }) {
  return <PluginBoundary identity={`official:${owner}`} request={props.request}>
    {(request, lifetime) => {
      const Component = component(owner, 'pages', id, lifetime);
      return <Suspense fallback={<p role="status">正在加载功能…</p>}>
        <Component {...props} request={request} />
      </Suspense>;
    }}
  </PluginBoundary>;
}
export function PluginDevelopmentSection({ id, ...props }: FeatureProps & { id: string }) {
  const owner = PLUGINS.find((plugin) => plugin.contributes.developmentSections.includes(id))?.id;
  if (!owner) return null;
  return <PluginBoundary identity={`official:${owner}`} request={props.request}>
    {(request, lifetime) => {
      const Component = component(owner, 'developmentSections', id, lifetime);
      return <Suspense fallback={<p role="status">正在加载功能…</p>}>
        <Component {...props} request={request} />
      </Suspense>;
    }}
  </PluginBoundary>;
}
