import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import './prepare-monitor.mjs';

const root = process.cwd();
const target = join(root, '.sakura-server', 'assets');
await mkdir(target, { recursive: true });
await cp(join(root, 'server', 'engineering-runner.py'), join(target, 'engineering-runner.py'));
await cp(join(root, 'server', 'secure-erase.py'), join(target, 'secure-erase.py'));
await cp(
  join(root, '.vendor', 'posixloom', 'dist', 'src', 'core', 'assets', 'state-report.sh'),
  join(target, 'state-report.sh'),
);
