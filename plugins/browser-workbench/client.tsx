import type {PluginPageProps} from '../../src/plugin-client';
import {BrowserLabPanel} from '../../src/BrowserLabPanel';
import '../../src/plugin-fonts.css';
const Page=({request,token}:PluginPageProps)=><BrowserLabPanel request={request} accessEpoch={token}/>;
export const pages={'browser-lab':Page};
