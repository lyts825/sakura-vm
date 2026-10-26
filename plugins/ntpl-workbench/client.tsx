/** 通知模板工作室工作台按需加载。 */
import type {PluginPageProps} from '../../src/plugin-client.tsx';
import {SeventhWorkbench} from '../../src/SeventhWorkbench.tsx';
const Page=(props:PluginPageProps)=><SeventhWorkbench {...props} packId='notification-template-studio'/>;
export const pages={'notification-template-studio':Page};
