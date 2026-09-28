import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wireGuardConfigSchema, wireGuardInput, wireGuardPublicKey } from '../server/wireguard-overlay.ts';

const localKey = Buffer.alloc(32, 7).toString('base64');
const peerKey = Buffer.alloc(32, 9).toString('base64');
const config = { address: '10.88.0.1/32', listenPort: 51820,
  privateKeySecret: 'WireGuardPrivate', peers: [{ publicKey: peerKey,
    endpoint: 'vpn.example.com:51820', allowedIPs: ['10.88.0.2/32'], keepaliveSeconds: 25 }] };

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

test('WireGuard public key derives from a private key without exposing the private bytes', () => {
  const publicKey = wireGuardPublicKey(localKey);
  assert.match(publicKey, /^[A-Za-z0-9+/]{43}=$/);
  assert.notEqual(publicKey, localKey);
  assert.equal(wireGuardPublicKey(localKey), publicKey);
  assert.throws(() => wireGuardPublicKey('not-a-key'));
});
