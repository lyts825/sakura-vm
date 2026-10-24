/** 软件供应审查的固定命令入口。 */
import { createSuiteCli } from './suite-cli.mjs';
const base = createSuiteCli({ prefix: 'supply', label: '软件供应审查', sourceDomain: 'sources', maximumFile: 64 * 1024 ** 2, verify: async file => (await import('./supply-verify.mjs')).verifySupplyFile(file) });
export const supplyCli = base.cli;
export const supplyHelp = base.help;
