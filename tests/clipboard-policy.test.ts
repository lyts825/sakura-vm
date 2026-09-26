import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clipboardPolicyReason,
  defaultClipboardPolicies,
  effectiveClipboardRule,
  parseClipboardPolicies,
} from '../shared/clipboard-policy.ts';

test('clipboard rules inherit per application and explicit instance overrides stay isolated', () => {
  const state = defaultClipboardPolicies(),
    id = '11111111-1111-4111-8111-111111111111';
  state.defaults.terminal.paste = false;
  state.instances[id] = { terminal: { ...state.defaults.terminal, paste: true } };
  const parsed = parseClipboardPolicies(state);
  assert.equal(effectiveClipboardRule(parsed, { app: 'terminal' }).paste, false);
  assert.equal(effectiveClipboardRule(parsed, { app: 'terminal', vmId: id }).paste, true);
  assert.equal(
    effectiveClipboardRule(parsed, { app: 'terminal', vmId: '22222222-2222-4222-8222-222222222222' }).paste,
    false,
  );
  assert.equal(effectiveClipboardRule(parsed, { app: 'files', vmId: id }).paste, true);
  state.instances[id].terminal!.copy = false;
  assert.equal(parsed.instances[id].terminal!.copy, true, 'stored snapshots are independent copies');
});

test('clipboard directions, binary items and byte limits enforce independent policies including terminal transport bounds', () => {
  const rule = defaultClipboardPolicies().defaults.files;
  assert.equal(clipboardPolicyReason(rule, 'paste', 1, true, 'files'), null);
  rule.copy = false;
  assert.match(clipboardPolicyReason(rule, 'copy', 1, false, 'files')!, /禁止.*复制/);
  assert.equal(clipboardPolicyReason(rule, 'paste', 1, false, 'files'), null);
  rule.files = false;
  assert.match(clipboardPolicyReason(rule, 'paste', 0, true, 'files')!, /文件与图片/);
  rule.maxTextBytes = 4096;
  assert.equal(clipboardPolicyReason(rule, 'paste', 4096, false, 'files'), null);
  assert.match(clipboardPolicyReason(rule, 'paste', 4097, false, 'files')!, /4 KiB/);
  rule.maxTextBytes = 1048576;
  assert.match(clipboardPolicyReason(rule, 'paste', 16385, false, 'terminal')!, /16 KiB/);
  assert.equal(clipboardPolicyReason(rule, 'paste', 16385, false, 'files'), null);
});

test('invalid or unbounded clipboard policies are rejected instead of weakening constraints', () => {
  const valid = defaultClipboardPolicies();
  for (const input of [
    null,
    [],
    {},
    { ...valid, version: 2 },
    { ...valid, secret: 'not allowed' },
    { ...valid, defaults: { ...valid.defaults, unknown: valid.defaults.files } },
    { ...valid, instances: { global: {} } },
  ])
    assert.throws(() => parseClipboardPolicies(input));
  for (const size of [0, 1023, 1048577, 1024.5, Infinity])
    assert.throws(() =>
      parseClipboardPolicies({
        ...valid,
        defaults: { ...valid.defaults, files: { ...valid.defaults.files, maxTextBytes: size } },
      }),
    );
  assert.throws(() =>
    parseClipboardPolicies({
      ...valid,
      defaults: { ...valid.defaults, files: { ...valid.defaults.files, copy: 'false' } },
    }),
  );
});
