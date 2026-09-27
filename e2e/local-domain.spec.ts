import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { HttpIngress } from '../server/http-ingress.ts';
import { IngressCertificates } from '../server/ingress-certificates.ts';
import { Machines } from '../server/machines.ts';
import { createSchema } from '../server/model.ts';
import type { Engine } from '../server/runtime.ts';

async function serve(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Listener has no TCP port');
  return address.port;
}

async function freePort() {
  const server = createServer();
  const port = await serve(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test('Chromium opens generated local-domain HTTP and HTTPS service links', async ({ browser }) => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-local-domain-'));
  const upstream = createServer((req, res) =>
    res.writeHead(200, { 'content-type': 'text/plain' }).end(String(req.headers['x-forwarded-host'])),
  );
  const upstreamPort = await serve(upstream);
  const httpPort = await freePort();
  let httpsPort = await freePort();
  while (httpsPort === httpPort || httpsPort === upstreamPort) httpsPort = await freePort();
  const machines = new Machines({} as Engine), vmId = randomUUID();
  machines.records.set(vmId, {
    ...createSchema.parse({ name: 'domain-browser', forwards: [{ host: upstreamPort, guest: 3000 }] }),
    id: vmId, createdAt: new Date().toISOString(), snapshots: [],
  });
  machines.live.set(vmId, { status: 'running' } as any);
  const certificates = new IngressCertificates(join(directory, 'certificates.json'));
  const ingress = new HttpIngress(machines, join(directory, 'ingress.json'), certificates);
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    await certificates.init();
    await ingress.init();
    const save = (protocol: 'http' | 'https', listenPort: number) => ingress.action({
      action: 'save', entry: {
        name: protocol, protocol, domainAlias: true, listenPort, pathPrefix: '/',
        vmId, upstreamPort, healthPath: '/', stripPrefix: false,
      },
    });
    const http = (await save('http', httpPort)).entries[0];
    const https = (await save('https', httpsPort)).entries.find((entry) => entry.name === 'https')!;
    const page = await context.newPage();
    for (const entry of [http, https]) {
      const response = await page.goto(entry.url);
      expect(response?.status()).toBe(200);
      expect(await page.locator('body').textContent()).toBe(new URL(entry.url).host);
    }
  } finally {
    await context.close();
    await ingress.close();
    await certificates.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    expect(dirname(directory)).toBe(resolve(tmpdir()));
    expect(basename(directory)).toMatch(/^sakura-local-domain-/);
    await rm(directory, { recursive: true, force: true });
  }
});
