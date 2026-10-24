/** 无需 VM 的供应审查工作台。 */
import type { PluginPageProps } from '../../src/plugin-client';
import { SupplyAuditPanel } from '../../src/SupplyAuditPanel';
import '../../src/plugin-fonts.css';
const Page = ({ request, token }: PluginPageProps) => (
  <SupplyAuditPanel request={request} accessEpoch={token} />
);
export const pages = { 'supply-audit': Page };
