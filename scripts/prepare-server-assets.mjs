import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import './prepare-monitor.mjs';
import './prepare-linux-clipboard.mjs';
import './prepare-wayland-clipboard.mjs';
import './prepare-project-identity.mjs';

const root = process.cwd();
const target = join(root, '.sakura-server', 'assets');
await mkdir(target, { recursive: true });
const witnessDocs = join(root, '.sakura-witness', 'docs');
const witnessScripts = join(root, '.sakura-witness', 'scripts');
await mkdir(witnessDocs, { recursive: true });
await mkdir(witnessScripts, { recursive: true });
for (const file of ['ha-failover-check.md', 'ha-external-drill.md', 'ha-witness-config.example.json'])
  await cp(join(root, 'docs', file), join(witnessDocs, file));
await cp(
  join(root, 'scripts', 'ha-witness.service.example'),
  join(witnessScripts, 'ha-witness.service.example'),
);
if (process.platform === 'win32')
  await cp(join(root, '.tools', 'native-clipboard'), join(target, 'native-clipboard'), { recursive: true });
await cp(join(root, 'server', 'engineering-runner.py'), join(target, 'engineering-runner.py'));
await cp(join(root, 'server', 'secure-erase.py'), join(target, 'secure-erase.py'));
await cp(
  join(root, 'server', 'dependency-download-broker.py'),
  join(target, 'dependency-download-broker.py'),
);
await cp(
  join(root, '.vendor', 'posixloom', 'dist', 'src', 'core', 'assets', 'state-report.sh'),
  join(target, 'state-report.sh'),
);
