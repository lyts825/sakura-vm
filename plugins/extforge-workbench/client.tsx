/** 社区扩展开发工坊工作台按需加载。 */
import type {PluginPageProps} from '../../src/plugin-client.tsx';
import {SeventhWorkbench} from '../../src/SeventhWorkbench.tsx';
const Page=(props:PluginPageProps)=><SeventhWorkbench {...props} packId='extension-authoring-studio'/>;
export const pages={'extension-authoring-studio':Page};
