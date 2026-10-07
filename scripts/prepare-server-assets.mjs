/** 组装服务器运行资源、动态入口和原生辅助清单，协调各 prepare 步骤以形成完整安装布局。 */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import './prepare-monitor.mjs';
import './prepare-linux-clipboard.mjs';
import './prepare-wayland-clipboard.mjs';
import './prepare-single-app.mjs';
import './prepare-project-identity.mjs';
import './prepare-ssh-agent.mjs';
import './prepare-gpg-agent.mjs';
import { prepareGpgAgentHostAssets } from './build-gpg-agent-host.mjs';

const root = process.cwd();
const target = join(root, '.sakura-server', 'assets');
await mkdir(target, { recursive: true });
await cp(join(root, 'server/compute-worker.mjs'), join(target, 'compute-worker.mjs'));
await cp(join(root, 'server/network/worker.mjs'), join(target, 'network-worker.mjs'));
await cp(join(root, 'server/network/parent-exec.py'), join(target, 'network-parent-exec.py'));
await mkdir(join(root, '.sakura-server/docs'), { recursive: true });
await cp(join(root, 'docs/network-runtime.md'), join(root, '.sakura-server/docs/network-runtime.md'));
const networkSources = [
  'server/network-entry.ts',
  'server/network/core.ts',
  'server/network/index.ts',
  'server/network/host-pool.ts',
  'server/network/vm-backend.ts',
  'server/network/worker.mjs',
  'server/network/parent-exec.py',
];
const describe = async (base, file) => {
  const bytes = await readFile(join(base, file));
  return { file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
};
await writeFile(join(target, 'compute-runtime.json'), JSON.stringify({ version: 1,
  files: await Promise.all(['compute-task.js', 'assets/compute-worker.mjs'].map((file) => describe(join(root, '.sakura-server'), file))),
  sources: await Promise.all(['server/compute-task.ts', 'server/compute-worker.mjs', 'server/file-preview.ts',
    'server/file-preview-runtime.ts', 'server/compute-runtime.ts'].map((file) => describe(root, file))),
}, null, 2) + '\n');
await writeFile(
  join(target, 'network-runtime.json'),
  JSON.stringify(
    {
      version: 1,
      files: await Promise.all(
        ['network-entry.js', 'assets/network-worker.mjs', 'assets/network-parent-exec.py'].map((file) =>
          describe(join(root, '.sakura-server'), file),
        ),
      ),
      sources: await Promise.all(networkSources.map((file) => describe(root, file))),
    },
    null,
    2,
  ) + '\n',
);
await prepareGpgAgentHostAssets();
await cp(join(root, 'native', 'gpg-agent', 'windows-relay.cpp'), join(target, 'gpg-agent-host-source.cpp'));
const witnessDocs = join(root, '.sakura-witness', 'docs');
const witnessScripts = join(root, '.sakura-witness', 'scripts');
await mkdir(witnessDocs, { recursive: true });
await mkdir(witnessScripts, { recursive: true });
for (const file of [
  'ha-failover-check.md',
  'ha-external-drill.md',
  'ha-witness-maintenance.md',
  'ha-witness-config.example.json',
])
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
await cp(join(root, 'server', 'project-repository-broker.py'), join(target, 'project-repository-broker.py'));
await cp(
  join(root, '.vendor', 'posixloom', 'dist', 'src', 'core', 'assets', 'state-report.sh'),
  join(target, 'state-report.sh'),
);
