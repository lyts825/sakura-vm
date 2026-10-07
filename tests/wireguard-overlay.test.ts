/**
 * 模块职责：回归验证模块，围绕 `wireguard-overlay` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `wireguard-overlay`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: WireGuard config rejects route takeover, duplicate peers and injected endpoints; WireGuard public key derives from a private key without exposing the private bytes.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wireGuardConfigSchema, wireGuardInput, wireGuardPublicKey } from '../server/wireguard-overlay.ts';

const localKey = Buffer.alloc(32, 7).toString('base64');
const peerKey = Buffer.alloc(32, 9).toString('base64');
const config = { address: '10.88.0.1/32', listenPort: 51820,
  privateKeySecret: 'WireGuardPrivate', peers: [{ publicKey: peerKey,
    endpoint: 'vpn.example.com:51820', allowedIPs: ['10.88.0.2/32'], keepaliveSeconds: 25 }] };

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: WireGuard config rejects route takeover, duplicate peers and injected endpoints
 * 协作入口 / Collaborators: `assert.equal`, `wireGuardInput.parse`, `wireGuardConfigSchema.safeParse`.
 * 检查边界 / Checked boundaries: `assert.equal(wireGuardInput.parse({ mode: 'save', config }).config?.peers.length, 1)`; `assert.equal(wireGuardConfigSchema.safeParse({ ...config, enabled: false }).success, true)`.
 */
test('WireGuard config rejects route takeover, duplicate peers and injected endpoints', () => {
  assert.equal(wireGuardInput.parse({ mode: 'save', config }).config?.peers.length, 1);
  assert.equal(wireGuardConfigSchema.safeParse({ ...config, enabled: false }).success, true);
  assert.equal(wireGuardConfigSchema.safeParse({ ...config,
    peers: [{ ...config.peers[0], allowedIPs: ['0.0.0.0/0'] }] }).success, false);
  assert.equal(wireGuardConfigSchema.safeParse({ ...config,
    peers: [config.peers[0], config.peers[0]] }).success, false);
  assert.equal(wireGuardConfigSchema.safeParse({ ...config,
    peers: [{ ...config.peers[0], endpoint: 'vpn.example.com:51820; touch /tmp/unsafe' }] }).success,
  false);
  assert.equal(wireGuardConfigSchema.safeParse({ ...config,
    peers: [{ ...config.peers[0], allowedIPs: ['10.88.0.2/32\nPostUp=evil'] }] }).success,
  false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: WireGuard public key derives from a private key without exposing the private bytes
 * 协作入口 / Collaborators: `wireGuardPublicKey`, `assert.match`, `assert.notEqual`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.match(publicKey, /^[A-Za-z0-9+/]{43}=$/)`; `assert.notEqual(publicKey, localKey)`.
 */
test('WireGuard public key derives from a private key without exposing the private bytes', () => {
  const publicKey = wireGuardPublicKey(localKey);
  assert.match(publicKey, /^[A-Za-z0-9+/]{43}=$/);
  assert.notEqual(publicKey, localKey);
  assert.equal(wireGuardPublicKey(localKey), publicKey);
  assert.throws(() => wireGuardPublicKey('not-a-key'));
});
