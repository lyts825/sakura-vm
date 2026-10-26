/** 启动界面只载入所需贡献投影；运行清单与准入规则仍由原宿主拥有。 */
import {PLUGIN_SURFACES} from '../shared/plugin-surfaces.generated.ts';
import {createPluginSurfaceQueries} from '../shared/plugin-surface-queries.ts';
export {PLUGIN_SURFACES as PLUGINS};
export type {PluginRuntimeView} from '../shared/plugin-surface-queries.ts';
export const {pluginSurfaceOwner,pluginSurfaceEnabled,developmentSections}=createPluginSurfaceQueries(PLUGIN_SURFACES);
