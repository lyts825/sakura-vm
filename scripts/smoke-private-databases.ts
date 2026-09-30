import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { JobView } from '../server/jobs.ts';

const distro = process.argv[2] || 'debian';
assert.ok(['debian', 'ubuntu'].includes(distro));
const directory = process.argv[3] || (await mkdtemp(join(tmpdir(), 'sakura-private-databases-')));
const owned = await realpath(directory);
assert.equal(dirname(owned), await realpath(tmpdir()));
assert.match(basename(owned), /^sakura-private-(databases|containers)-/);
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve(
  '.data/images',
  distro === 'ubuntu' ? 'ubuntu-24.04.qcow2' : 'debian-12.qcow2',
);
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { Containers } = await import('../server/containers.ts');
const { FeatureSuite } = await import('../server/feature-suite.ts');
const { privateDockerPaths, privateDockerCommand } = await import('../server/private-docker.ts');
const { quote } = await import('../server/files.ts');
const engine = await createRuntime(),
  machines = new Machines(engine);
let vmId = '',
  workspaces: InstanceType<typeof Workspaces> | undefined,
  containers: InstanceType<typeof Containers> | undefined,
  features: InstanceType<typeof FeatureSuite> | undefined;
const password = 'database-' + randomUUID();
const table = 'sakura_check_' + randomUUID().replaceAll('-', '');
async function command(script: string, timeout = 30_000) {
  const result = await machines.exec(vmId, script, timeout);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
const within = <T>(project: string, work: () => Promise<T>) => workspaces!.projects.with(vmId, project, work);
async function containerAction(project: string, input: unknown) {
  await within(project, () => containers!.run(vmId, input));
  await containers!.jobs.wait(vmId);
  const job = containers!.jobs.view(vmId)!;
  assert.equal(job.status, 'done', job.error + '\n' + job.log);
}
async function query(project: string, database: 'postgres' | 'mysql' | 'redis', port: number, text: string) {
  const name = 'private-' + database,
    p = privateDockerPaths(project);
  const args =
    database === 'postgres'
      ? [
          '--env',
          'PGPASSWORD=' + password,
          name,
          'psql',
          '-h',
          '127.0.0.1',
          '-p',
          String(port),
          '-U',
          'sakura',
          '-d',
          'sakura',
          '-v',
          'ON_ERROR_STOP=1',
          '-tAc',
          text,
        ]
      : database === 'mysql'
        ? [
            '--env',
            'MYSQL_PWD=' + password,
            name,
            'mysql',
            '-h',
            '127.0.0.1',
            '-P',
            String(port),
            '-u',
            'sakura',
            'sakura',
            '--batch',
            '--skip-column-names',
            '-e',
            text,
          ]
        : [
            '--env',
            'REDISCLI_AUTH=' + password,
            name,
            'redis-cli',
            '-h',
            '127.0.0.1',
            '-p',
            String(port),
            '--raw',
            ...text.split(' '),
          ];
  return command(p.config + '/docker-client exec ' + args.map(quote).join(' '));
}
try {
  await machines.init();
  const prior = [...machines.records.values()][0];
  if (prior) assert.match(prior.name, /^private-(containers|databases)-/);
  const vm =
    prior ||
    (await machines.create({
      name: 'private-databases-' + distro,
      distro,
      memoryMiB: 3072,
      cpus: 2,
      diskGiB: 12,
      forwards: [],
    }));
  vmId = vm.id;
  await machines.start(vmId);
  const bootDeadline = Date.now() + 300_000;
  while (machines.state(vmId) === 'starting' && Date.now() < bootDeadline) await delay(100);
  assert.equal(machines.state(vmId), 'running', machines.logs.get(vmId));
  workspaces = new Workspaces(machines);
  containers = new Containers(machines, workspaces);
  features = new FeatureSuite(machines, workspaces, {
    privateDatabase: (...args) => containers!.privateDatabase(...args),
  });
  console.log(`${distro}: preparing Docker for real database tests`);
  await containerAction('default', { action: 'install' });
  const projects: string[] = [];
  for (const label of ['db-alpha', 'db-beta']) {
    const existing: { id: string; name: string } | undefined = (
      await workspaces.projects.list(vmId)
    ).projects.find((item) => item.name === label);
    const project: string =
      existing?.id ||
      (
        await workspaces.projects.create(vmId, label, () =>
          workspaces!
            .save(vmId, { directory: '/workspace/' + label, networkIsolation: 'private' })
            .then(() => {}),
        )
      ).active;
    projects.push(project);
    await containerAction(project, { action: 'start-project-runtime' });
  }
  for (const [database, tag, port] of [
    ['postgres', '16-alpine', 15432],
    ['mysql', '8', 13306],
    ['redis', '7-alpine', 16379],
  ] as const) {
    const source = `public.ecr.aws/docker/library/${database}:${tag}`,
      image = `${database}:${tag}`;
    for (const project of projects) {
      const p = privateDockerPaths(project),
        name = 'private-' + database;
      await command(
        `set -eu\nif ${p.config}/docker-client inspect ${quote(name)} >/dev/null 2>&1; then\n` +
          `owner=$(${p.config}/docker-client inspect --format '{{index .Config.Labels "sakura.project"}}' ${quote(name)})\n` +
          `[ "$owner" = ${quote(project)} ]\n${p.config}/docker-client rm -f ${quote(name)}\nfi\n` +
          `if ${p.config}/docker-client volume inspect ${quote(name + '-data')} >/dev/null 2>&1; then ${p.config}/docker-client volume rm ${quote(name + '-data')}; fi`,
      );
    }
    console.log(`${distro}: preparing official ${source}`);
    for (let attempt = 0; ; attempt++) {
      const fetched = await machines.exec(
        vmId,
        `set -eu\ndocker --host unix:///var/run/docker.sock image inspect ${quote(source)} >/dev/null 2>&1 || docker --host unix:///var/run/docker.sock pull ${quote(source)}\n` +
          `docker --host unix:///var/run/docker.sock tag ${quote(source)} ${quote(image)}`,
        600_000,
      );
      if (fetched.code === 0) break;
      if (attempt >= 2) assert.equal(fetched.code, 0, fetched.stderr);
      console.log(`${distro}: image preparation retry after ${15 * (attempt + 1)} seconds`);
      await delay(15_000 * (attempt + 1));
    }
    for (const project of projects) {
      await within(project, async () =>
        features!.dev(vmId, { operation: 'database', database, name: 'private-' + database, port, password }),
      );
      const key = (await within(project, async () => workspaces!.projects.key(vmId))) + ':dev';
      await features.jobs.wait(key);
      const job: JobView = features.jobs.view(key)!;
      assert.equal(job.status, 'done', job.error + '\n' + job.log);
      assert.equal(job.projectId, project);
      assert.ok(!JSON.stringify(job).includes(password));
      const info = await within(project, () => containers!.view(vmId));
      assert.equal(info.runtime?.valid, true);
      const db = info.containers.find((item) => item.Names === 'private-' + database)!;
      assert.ok(db);
      const p = privateDockerPaths(project);
      const pid = await command(`${p.config}/docker-client inspect --format '{{.State.Pid}}' ${db.ID}`);
      const namespaces = (
        await command(`stat -Lc '%d:%i' /proc/${pid}/ns/net /run/netns/sk-${project} /proc/1/ns/net`)
      ).split('\n');
      assert.equal(namespaces[0], namespaces[1]);
      assert.notEqual(namespaces[0], namespaces[2]);
      assert.equal(
        await command(`${p.config}/docker-client image inspect --format '{{.Id}}' ${quote(image)}`),
        await command(
          `docker --host unix:///var/run/docker.sock image inspect --format '{{.Id}}' ${quote(source)}`,
        ),
      );
      if (database === 'redis') {
        assert.equal(await query(project, database, port, 'GET ' + table), '');
        assert.equal(await query(project, database, port, 'SET ' + table + ' ' + project), 'OK');
      } else {
        await query(project, database, port, `CREATE TABLE ${table}(value varchar(64));`);
        assert.equal(await query(project, database, port, `SELECT COUNT(*) FROM ${table};`), '0');
        await query(project, database, port, `INSERT INTO ${table}(value) VALUES ('${project}');`);
      }
    }
    for (const project of projects) {
      const result = await query(
        project,
        database,
        port,
        database === 'redis' ? 'GET ' + table : `SELECT value FROM ${table};`,
      );
      assert.equal(result, project);
      const db = (await within(project, () => containers!.view(vmId))).containers.find(
        (item) => item.Names === 'private-' + database,
      )!;
      await containerAction(project, { action: 'stop', id: db.ID });
      await containerAction(project, { action: 'start', id: db.ID });
      const config = await within(project, () => workspaces!.config(vmId));
      const deadline = Date.now() + 60_000;
      while (true) {
        try {
          assert.equal(
            await query(
              project,
              database,
              port,
              database === 'redis' ? 'GET ' + table : `SELECT value FROM ${table};`,
            ),
            project,
          );
          break;
        } catch (error) {
          if (Date.now() > deadline) throw error;
          await delay(500);
        }
      }
      const untrusted = await machines.exec(
        vmId,
        privateDockerCommand(
          config,
          `python3 -I -S -c ${quote(`import socket; socket.create_connection(('1.1.1.1',443),2)`)}`,
          false,
        ),
        5000,
      );
      assert.notEqual(untrusted.code, 0);
      const logs = await within(project, () => containers!.logs(vmId, db.ID));
      assert.ok(!logs.log.includes(password));
    }
    const shared = await machines.exec(
      vmId,
      `python3 -I -S -c ${quote(`import socket; socket.create_connection(('127.0.0.1',${port}),2)`)}`,
      5000,
    );
    assert.notEqual(shared.code, 0);
    for (const project of projects) {
      const db = (await within(project, () => containers!.view(vmId))).containers.find(
        (item) => item.Names === 'private-' + database,
      )!;
      await containerAction(project, { action: 'stop', id: db.ID });
      await containerAction(project, { action: 'remove', id: db.ID });
    }
    console.log(
      `${distro}: ${database} authenticated SQL/protocol queries, identical ports, separate data, persistence and namespace checks passed`,
    );
  }
  for (const project of projects) await containerAction(project, { action: 'stop-project-runtime' });
} catch (error) {
  if (vmId && machines.state(vmId) === 'running')
    console.error(
      await machines.exec(vmId, 'journalctl -u "sakura-docker-*" -n 10 --no-pager', 15_000).catch(() => null),
    );
  throw error;
} finally {
  await features?.close();
  await containers?.close();
  await workspaces?.close();
  if (vmId && machines.live.has(vmId)) await machines.stop(vmId, true).catch(() => {});
  await machines.close();
  if (process.env.SAKURA_KEEP_DATABASE_SMOKE === '1') console.log('Retained owned fixture:', owned);
  else {
    assert.equal(dirname(await realpath(directory)), await realpath(tmpdir()));
    assert.match(basename(owned), /^sakura-private-(databases|containers)-/);
    await rm(owned, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
