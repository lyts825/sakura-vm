/** 设计系统工作室工作台按需加载。 */
import type {PluginPageProps} from '../../src/plugin-client.tsx';
import {SeventhWorkbench} from '../../src/SeventhWorkbench.tsx';
const Page=(props:PluginPageProps)=><SeventhWorkbench {...props} packId='design-system-studio'/>;
export const pages={'design-system-studio':Page};
