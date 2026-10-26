/** 对照实验规划工作台按需加载。 */
import type {PluginPageProps} from '../../src/plugin-client.tsx';
import {SeventhWorkbench} from '../../src/SeventhWorkbench.tsx';
const Page=(props:PluginPageProps)=><SeventhWorkbench {...props} packId='experiment-planner'/>;
export const pages={'experiment-planner':Page};
