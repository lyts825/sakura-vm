/** 只使用界面与 HTTP 归属的查询；完整清单和轻量投影复用同一逻辑。 */
import type {PluginManifest} from './plugin-protocol.ts';
import type {PluginInstanceView} from './contracts/plugin-runtime.ts';
export type PluginRuntimeView={version:number;instances:PluginInstanceView[]};
export type PluginSurface=Pick<PluginManifest,'id'|'name'>&{contributes:Pick<PluginManifest['contributes'],'pages'|'tabs'|'developmentSections'|'http'>};
export function createPluginSurfaceQueries(plugins:readonly PluginSurface[]){
  function pluginSurfaceOwner(active:readonly string[],kind:'pages'|'tabs',id:string,runtime?:PluginRuntimeView){
    if(runtime)return runtime.instances.find(instance=>instance.source==='official'&&instance.phase==='running'&&instance.contributions?.some(item=>item.kind===(kind==='pages'?'page':'tab')&&item.target===id))?.pluginId;
    return plugins.find(item=>active.includes(item.id)&&item.contributes[kind].includes(id))?.id;
  }
  function pluginSurfaceEnabled(active:readonly string[],kind:'pages'|'tabs',id:string,runtime?:PluginRuntimeView){
    if((kind==='pages'?['workspace','plugins','settings']:['terminal','config']).includes(id))return true;
    if(kind==='pages'&&id==='tasks')return active.length>0;
    return !!pluginSurfaceOwner(active,kind,id,runtime);
  }
  function developmentSections(active:readonly string[]){return [...new Set(plugins.filter(item=>active.includes(item.id)).flatMap(item=>item.contributes.developmentSections))];}
  return {pluginSurfaceOwner,pluginSurfaceEnabled,developmentSections};
}
