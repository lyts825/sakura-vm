import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseAlpinePackages, parseDpkgPackages, queryVulnerabilities, scanGuestVulnerabilities,
  securityEcosystem,
} from '../server/security-vulnerabilities.ts';

test('scanner maps installed binaries to distribution source packages and versions', () => {
  assert.equal(securityEcosystem('alpine', 'ID=alpine\nVERSION_ID=3.23.4\n'), 'Alpine:v3.23');
  assert.equal(securityEcosystem('debian', 'ID=debian\nVERSION_ID="12"\n'), 'Debian:12');
  assert.equal(securityEcosystem('ubuntu', 'ID=ubuntu\nVERSION_ID="24.04"\n'), 'Ubuntu:24.04:LTS');
  assert.deepEqual(parseAlpinePackages('curl\t8.15.0-r0\nlibcurl\t8.15.0-r0\n'), [
    { name: 'curl', version: '8.15.0-r0' },
    { name: 'libcurl', version: '8.15.0-r0' },
  ]);
  assert.deepEqual(parseDpkgPackages([
    'ii \tlibssl3\t3.0.17-1\topenssl\t3.0.17-1',
    'ii \topenssl\t3.0.17-1\topenssl\t3.0.17-1',
    'rc \toldpkg\t1.0\toldpkg\t1.0',
  ].join('\n')), [{ name: 'openssl', version: '3.0.17-1' }]);
});

test('OSV result is matched to each source package and rejects partial responses', async () => {
  const packages = [{ name: 'curl', version: '8.15.0-r0' },
    { name: 'openssl', version: '3.0.17-r0' }];
  const requests: unknown[] = [];
  const fetcher = async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ results: [
      { vulns: [{ id: 'ALPINE-CVE-2026-80231' }] },
      { vulns: [{ id: 'ALPINE-CVE-2026-80231' }, { id: 'ALPINE-CVE-2026-42766' }] },
    ] }), { status: 200 });
  };
  const result = await queryVulnerabilities('Alpine:v3.23', packages, undefined, fetcher);
  assert.equal(result.status, 'complete');
  assert.equal(result.packagesChecked, 2);
  assert.equal(result.affectedPackages, 2);
  assert.equal(result.vulnerabilityCount, 2);
  assert.deepEqual(result.matches[0], { ...packages[0], ids: ['ALPINE-CVE-2026-80231'] });
  assert.deepEqual(requests[0], { queries: packages.map(({ name, version }) => ({
    package: { ecosystem: 'Alpine:v3.23', name }, version,
  })) });
  await assert.rejects(() => queryVulnerabilities('Alpine:v3.23', packages, undefined,
    async () => new Response(JSON.stringify({ results: [{}] }), { status: 200 })),
  /结果数量与查询不一致/);
});

test('OSV pagination queries only packages that have another page', async () => {
  const requests: Array<{ queries: Array<{ page_token?: string }> }> = [];
  const result = await queryVulnerabilities('Debian:12', [
    { name: 'openssl', version: '3.0.17-1' }, { name: 'curl', version: '8.0.1-2' },
  ], undefined, async (_url, init) => {
    requests.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ results: requests.length === 1 ? [
      { vulns: [{ id: 'DEBIAN-CVE-2026-1' }], next_page_token: 'next' },
      { vulns: [] },
    ] : [
      { vulns: [{ id: 'DEBIAN-CVE-2026-2' }] },
    ] }), { status: 200 });
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].queries.length, 1);
  assert.equal(requests[1].queries[0].page_token, 'next');
  assert.deepEqual(result.matches[0].ids, ['DEBIAN-CVE-2026-1', 'DEBIAN-CVE-2026-2']);
  assert.equal(result.vulnerabilityCount, 2);
});

test('failed vulnerability lookup keeps inventory coverage and reports unknown status', async () => {
  const machines = {
    get: () => ({ distro: 'alpine' }),
    exec: async (_id: string, command: string) => ({ code: 0, stderr: '',
      stdout: command.includes('/etc/os-release') ? 'VERSION_ID=3.23.4\n' : 'curl\t8.0-r0\n' }),
  };
  const result = await scanGuestVulnerabilities(machines as never, 'vm', undefined,
    async () => new Response('unavailable', { status: 503 }));
  assert.equal(result.status, 'unavailable');
  assert.equal(result.packagesChecked, 1);
  assert.equal(result.ecosystem, 'Alpine:v3.23');
  assert.match(result.error || '', /503/);
});
