import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { createServer, request } from 'node:https';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import { IngressCertificates } from '../server/ingress-certificates.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-ingress-cert-test-'));
after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function get(port: number, ca: string) {
  return new Promise<number>((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port, path: '/', ca, rejectUnauthorized: true, agent: false },
      (res) => {
        res.resume();
        resolve(res.statusCode || 0);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('local certificate is a valid localhost TLS identity, persists and rotates live', async () => {
  const file = join(root, 'certificates.json');
  const certificates = new IngressCertificates(file);
  await certificates.init();
  let server: ReturnType<typeof createServer> | undefined;
  try {
    assert.equal(certificates.view().certificate, null);
    const options = await certificates.ensure();
    const first = certificates.view();
    assert.ok(first.certificate);
    assert.equal(new X509Certificate(first.certificate.pem).checkHost('localhost'), 'localhost');
    assert.equal(new X509Certificate(first.certificate.pem).checkIP('127.0.0.1'), '127.0.0.1');
    assert.ok(!JSON.stringify(first).includes(options.key));
    server = createServer(options, (_req, res) => res.writeHead(200).end('secure'));
    certificates.onChange((certificate) =>
      server!.setSecureContext({ key: certificate.key, cert: certificate.cert }),
    );
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    assert.equal(await get(address.port, first.certificate.pem), 200);
    await certificates.action({ action: 'configure', policy: { autoRotate: false, renewBeforeDays: 10 } });
    const rotated = await certificates.action({ action: 'rotate' });
    assert.ok(rotated.certificate);
    assert.notEqual(rotated.certificate.fingerprint256, first.certificate.fingerprint256);
    assert.equal(await get(address.port, rotated.certificate.pem), 200);
    await assert.rejects(get(address.port, first.certificate.pem));
    await certificates.close();
    const restored = new IngressCertificates(file);
    try {
      await restored.init();
      assert.equal(restored.view().certificate?.fingerprint256, rotated.certificate.fingerprint256);
      assert.equal(restored.view().policy.autoRotate, false);
    } finally {
      await restored.close();
    }
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    await certificates.close();
  }
});

test('certificate nearing expiry rotates automatically on service startup', async () => {
  const file = join(root, 'expiring-certificates.json');
  const old = await generate([{ name: 'commonName', value: 'localhost' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - 3600000),
    notAfterDate: new Date(Date.now() + 86400000),
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  });
  await writeFile(
    file,
    JSON.stringify({
      policy: { autoRotate: true, renewBeforeDays: 30 },
      certificate: { key: old.private, cert: old.cert, generatedAt: new Date().toISOString() },
    }),
  );
  const certificates = new IngressCertificates(file);
  try {
    await certificates.init();
    const view = certificates.view();
    assert.ok(view.certificate);
    assert.notEqual(view.certificate.fingerprint256, new X509Certificate(old.cert).fingerprint256);
    assert.ok(view.nextRotationAt && Date.parse(view.nextRotationAt) > Date.now());
  } finally {
    await certificates.close();
  }
});
