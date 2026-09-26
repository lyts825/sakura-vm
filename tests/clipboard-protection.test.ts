import test from 'node:test';
import assert from 'node:assert/strict';
import { sensitiveClipboardReason, assertClipboardSafe } from '../src/clipboard-protection';

test('clipboard detection reports categories without exposing any matching secret', () => {
  const inputs = [
    '-----BEGIN OPENSSH PRIVATE KEY-----\nprivate content',
    'ghp_' + 'a'.repeat(36),
    'sk-proj-' + 'Ab1_'.repeat(30),
    'AKIA' + 'Q'.repeat(16),
    'https://example-user:password1234@example.invalid/',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJleGFtcGxlIn0.' + 'a'.repeat(24),
    'API_KEY="a-long-private-value-1234"',
  ];
  for (const text of inputs) {
    assert.ok(sensitiveClipboardReason(text));
    assert.throws(
      () => assertClipboardSafe(text, true),
      (error: any) => {
        assert.ok(!error.message.includes(text));
        return /已阻止/.test(error.message);
      },
    );
    assert.doesNotThrow(() => assertClipboardSafe(text, false));
  }
});

test('clipboard detection preserves ordinary text and references, and bounds multibyte payloads', () => {
  for (const text of [
    '樱花项目的说明',
    'ssh-ed25519 AAAA public@example',
    'password: ${DATABASE_PASSWORD}',
    'api_key = process.env.SERVICE_KEY',
    'client_secret = <placeholder-value>',
    'password = [REDACTED]',
  ])
    assert.equal(sensitiveClipboardReason(text), null, text);
  assert.match(sensitiveClipboardReason('花'.repeat(400000))!, /上限/);
  for (let index = 0; index < 3; index++) assert.ok(sensitiveClipboardReason('ghp_' + 'a'.repeat(36)));
});
