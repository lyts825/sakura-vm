/** 页面按需载入；打开工作台不会采集、执行处置或批准交接。 */
import type { PluginPageProps } from '../../src/plugin-client';
import { IncidentDeskPanel } from '../../src/IncidentDeskPanel';
import '../../src/plugin-fonts.css';
const Page = ({ request, token }: PluginPageProps) => (
  <IncidentDeskPanel request={request} accessEpoch={token} />
);
export const pages = { 'incident-desk': Page };
