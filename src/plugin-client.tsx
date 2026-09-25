import { lazy, Suspense, type ComponentType } from 'react';
import type { VMView } from '../server/model';
import { PLUGINS } from '../shared/plugins';
import type { FeatureProps, Request } from './feature-shared';

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
  openFile?: { path: string; revision: number };
};
type ClientModule = {
  tabs?: Record<string, ComponentType<PluginTabProps>>;
  pages?: Record<string, ComponentType<PluginPageProps>>;
  developmentSections?: Record<string, ComponentType<FeatureProps>>;
};
const entries = import.meta.glob<ClientModule>('../plugins/*/client.tsx');
const components = new Map<string, ComponentType<any>>();

function component(owner: string, kind: keyof ClientModule, id: string) {
  const key = `${owner}:${kind}:${id}`;
  let value = components.get(key);
  if (!value) {
    value = lazy(async () => {
      const load = entries[`../plugins/${owner}/client.tsx`];
      if (!load) throw new Error(`插件 ${owner} 缺少界面入口`);
      const entry = await load();
      const Component = entry[kind]?.[id];
      if (!Component) throw new Error(`插件 ${owner} 缺少界面组件：${id}`);
      return { default: Component };
    });
    components.set(key, value);
  }
  return value;
}

export function PluginTab({ owner, id, ...props }: PluginTabProps & { owner: string; id: string }) {
  const Component = component(owner, 'tabs', id);
  return (
    <Suspense fallback={<p role="status">正在加载功能…</p>}>
      <Component {...props} />
    </Suspense>
  );
}
export function PluginPage({ owner, id, ...props }: PluginPageProps & { owner: string; id: string }) {
  const Component = component(owner, 'pages', id);
  return (
    <Suspense fallback={<p role="status">正在加载功能…</p>}>
      <Component {...props} />
    </Suspense>
  );
}
export function PluginDevelopmentSection({ id, ...props }: FeatureProps & { id: string }) {
  const owner = PLUGINS.find((plugin) => plugin.contributes.developmentSections.includes(id))?.id;
  if (!owner) return null;
  const Component = component(owner, 'developmentSections', id);
  return (
    <Suspense fallback={<p role="status">正在加载功能…</p>}>
      <Component {...props} />
    </Suspense>
  );
}
