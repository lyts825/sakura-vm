import { lazy, type ComponentType } from 'react';
import type { FeatureProps, Request } from './feature-shared';
import type { VMView } from '../server/model';
import { PLUGINS } from '../shared/plugins';

export type PluginPageProps = {
  request: Request;
  vms: VMView[];
  selected: string;
  refresh: () => Promise<unknown>;
};
type ClientModule = {
  tabs?: Record<string, ComponentType<FeatureProps>>;
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

export function PluginTab({ owner, id, ...props }: FeatureProps & { owner: string; id: string }) {
  const Component = component(owner, 'tabs', id);
  return <Component {...props} />;
}
export function PluginPage({ owner, id, ...props }: PluginPageProps & { owner: string; id: string }) {
  const Component = component(owner, 'pages', id);
  return <Component {...props} />;
}
export function PluginDevelopmentSection({ id, ...props }: FeatureProps & { id: string }) {
  const owner = PLUGINS.find((plugin) => plugin.contributes.developmentSections.includes(id))?.id;
  if (!owner) return null;
  const Component = component(owner, 'developmentSections', id);
  return <Component {...props} />;
}
