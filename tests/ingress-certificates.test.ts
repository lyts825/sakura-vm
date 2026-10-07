/**
 * 模块职责：回归验证模块，围绕 `ingress-certificates` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ingress-certificates`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: local certificate is a valid localhost TLS identity, persists and rotates live; certificate nearing expiry rotates automatically on service startup.
 */
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

/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: port: number; ca: string。
 * 结果：返回分支计算值（`new Promise<number>((resolve, reject) => { const req = request( { hostname: '127…`），以 Promise 交付。
 * Result: Return the branch-computed value (`new Promise<number>((resolve, reject) => { const req = request( { hostname: '127…`) through a Promise.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: local certificate is a valid localhost TLS identity, persists and rotates live
 * 状态影响 / State effects: `server`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `join`, `certificates.init`, `assert.equal`, `certificates.view`.
 * 检查边界 / Checked boundaries: `assert.equal(certificates.view().certificate, null)`; `assert.ok(first.certificate)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
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
    assert.equal(
      new X509Certificate(first.certificate.pem).checkHost('app-example.sakura.localhost'),
      '*.sakura.localhost',
    );
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: certificate nearing expiry rotates automatically on service startup
 * 协作入口 / Collaborators: `join`, `generate`, `Date.now`, `writeFile`.
 * 检查边界 / Checked boundaries: `assert.ok(view.certificate)`; `assert.notEqual(view.certificate.fingerprint256, new X509Certificate(old.cert).fingerprint256)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: requesting a domain alias upgrades an older certificate without alias coverage
 * 协作入口 / Collaborators: `join`, `generate`, `Date.now`, `writeFile`.
 * 检查边界 / Checked boundaries: `assert.equal(certificates.view().certificate?.fingerprint256, new X509Certificate(old.cert).fingerprint256)`; `assert.ok(current)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('requesting a domain alias upgrades an older certificate without alias coverage', async () => {
  const file = join(root, 'legacy-certificates.json');
  const old = await generate([{ name: 'commonName', value: 'localhost' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - 3600000),
    notAfterDate: new Date(Date.now() + 300 * 86400000),
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
  await writeFile(file, JSON.stringify({
    policy: { autoRotate: false, renewBeforeDays: 30 },
    certificate: { key: old.private, cert: old.cert, generatedAt: new Date().toISOString() },
  }));
  const certificates = new IngressCertificates(file);
  try {
    await certificates.init();
    assert.equal(certificates.view().certificate?.fingerprint256, new X509Certificate(old.cert).fingerprint256);
    await certificates.ensure(true);
    const current = certificates.view().certificate;
    assert.ok(current);
    assert.notEqual(current.fingerprint256, new X509Certificate(old.cert).fingerprint256);
    assert.equal(new X509Certificate(current.pem).checkHost('app-example.sakura.localhost'), '*.sakura.localhost');
    assert.equal(certificates.view().policy.autoRotate, false);
  } finally {
    await certificates.close();
  }
});
