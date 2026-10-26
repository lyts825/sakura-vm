/** 地理数据工作室工作台按需加载。 */
import type {PluginPageProps} from '../../src/plugin-client.tsx';
import {SeventhWorkbench} from '../../src/SeventhWorkbench.tsx';
const Page=(props:PluginPageProps)=><SeventhWorkbench {...props} packId='geospatial-studio'/>;
export const pages={'geospatial-studio':Page};
