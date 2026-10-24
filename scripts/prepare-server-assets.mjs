/** 组装服务器运行资源、动态入口和原生辅助清单，协调各 prepare 步骤以形成完整安装布局。
 * Coordinate native/guest/static asset preparation and describe packaged resources for installed service startup. */
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
// Both Sans subsets share one license; preserve all three upstream font licenses in the runtime.
const fontLicenses = join(root, 'dist', 'licenses', 'fonts');
await mkdir(fontLicenses, { recursive: true });
for (const file of ['sakura-sans-ui-OFL.txt', 'sakura-serif-ui-OFL.txt', 'sakura-mono-OFL.txt'])
  await cp(join(root, 'src', 'assets', 'fonts', file), join(fontLicenses, file));
await cp(join(root, 'server/compute-worker.mjs'), join(target, 'compute-worker.mjs'));
// 数据任务通过 import.meta.url 定位客户机工作器，发行包须与服务器入口同目录。
await cp(join(root, 'server/data-worker.py'), join(root, '.sakura-server/data-worker.py'));
// 固定工具与解析器按相邻 URL 加载；源码和已编译入口必须一起交付。
for (const file of ['integration-http-worker.py', 'drill-guest.py', 'drill-watchdog.cs', 'core-drill-validation-controller.mjs'])
  await cp(join(root, 'server', file), join(root, '.sakura-server', file));
// 动态插件计算模块位于 assets/，其 import.meta.url 必须解析到同目录的固定解析器。
await cp(join(root, 'server', 'knowledge-worker.mjs'), join(target, 'knowledge-worker.mjs'));
if (process.platform === 'win32') {
  await import('./resilience-build-watchdog.mjs');
  await cp(join(root, '.tools', 'resilience'), join(target, 'resilience'), { recursive: true });
  await cp(join(root, 'server', 'drill-watchdog.cs'), join(target, 'resilience', 'drill-watchdog.cs'));
}
await cp(join(root, 'server/network/worker.mjs'), join(target, 'network-worker.mjs'));
await cp(join(root, 'server/network/bounded-qmp-policy.mjs'), join(target, 'bounded-qmp-policy.mjs'));
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
  'server/network/bounded-qmp-policy.mjs',
  'server/network/parent-exec.py',
];
/** 读取指定资源并返回相对文件名、字节长度和 SHA-256，供打包来源清单校验。
 * Read the resource and return relative name/byte length/SHA-256 for packaged-source manifests. */
const describe = async (base, file) => {
  const bytes = await readFile(join(base, file));
  return { file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
};
await writeFile(join(target, 'compute-runtime.json'), JSON.stringify({ version: 1,
  files: await Promise.all(['compute-task.js', 'assets/compute-worker.mjs'].map((file) => describe(join(root, '.sakura-server'), file))),
  sources: await Promise.all(['server/compute-task.ts', 'server/compute-worker.mjs', 'server/file-preview.ts',
    'server/file-preview-runtime.ts', 'server/compute-runtime.ts', 'server/suite-supply-analysis.ts', 'server/suite-locale-analysis.ts',
    'shared/contracts/supply-audit.ts', 'shared/contracts/locale-studio.ts', 'shared/contracts/suite-common.ts', 'shared/suite-json.ts',
    'shared/errors.ts'].map((file) => describe(root, file))),
}, null, 2) + '\n');
await writeFile(
  join(target, 'network-runtime.json'),
  JSON.stringify(
    {
      version: 1,
      files: await Promise.all(
        ['network-entry.js', 'assets/network-worker.mjs', 'assets/bounded-qmp-policy.mjs', 'assets/network-parent-exec.py'].map((file) =>
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
