import type { PluginPageProps } from '../../src/plugin-client';
import { EventLabPanel } from '../../src/EventLabPanel';
import '../../src/plugin-fonts.css';
const Page = ({ request, token }: PluginPageProps) => (
  <EventLabPanel request={request} accessEpoch={token} authorized={!!token} />
);
export const pages = { 'event-lab': Page };
