/**
 * 模块职责：回归验证模块，围绕 `access-control` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `access-control`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: opt-in account mode replaces the shared token with expiring scoped identities; account login locks out repeated guessing and does not persist sessions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccessControl } from '../server/access-control.ts';
import { Passkeys } from '../server/passkeys.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: opt-in account mode replaces the shared token with expiring scoped identities
 * 状态影响 / State effects: `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `Date.UTC`.
 * 检查边界 / Checked boundaries: `assert.equal(access.enabled, false)`; `assert.equal(access.enabled, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('opt-in account mode replaces the shared token with expiring scoped identities', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-access-'));
  let now = Date.UTC(2026, 0, 1);
  const access = new AccessControl(join(directory, 'accounts.json'), () => now);
  await access.init();
  try {
    assert.equal(access.enabled, false);
    await access.enable({ password: 'correct horse battery staple' });
    assert.equal(access.enabled, true);
    assert.throws(() => access.authorize('a'.repeat(64)), /访问凭证/);
    await assert.rejects(access.login({ username: 'owner', password: 'incorrect' }), /无效/);
    const owner = await access.login({ username: 'owner', password: 'correct horse battery staple' });
    assert.equal(owner.principal.role, 'owner');
    assert.equal(access.authorize(owner.token).username, 'owner');
    assert.ok(!await readFile(join(directory, 'accounts.json'), 'utf8').then(
      (text) => text.includes('correct horse battery staple')));
    const vmId = '00000000-0000-4000-8000-000000000001';
    const viewer = await access.createViewer({ username: 'reader', password: 'read only password 123',
      vmIds: [vmId], expiresAt: now + 86_400_000 });
    assert.equal(viewer.role, 'viewer');
    assert.ok(!JSON.stringify(access.users()).includes('read only password'));
    const login = await access.login({ username: 'reader', password: 'read only password 123' });
    assert.deepEqual(access.authorize(login.token).vmIds, [vmId]);
    now += 3_600_001;
    assert.throws(() => access.authorize(login.token), /过期/);
    const fresh = await access.login({ username: 'reader', password: 'read only password 123' });
    await access.removeViewer(viewer.id);
    assert.throws(() => access.authorize(fresh.token), /访问凭证/);
    assert.equal(access.authorize(owner.token).role, 'owner');
    await access.changeOwnerPassword({ password: 'correct horse battery staple',
      newPassword: 'second correct horse battery' });
    assert.throws(() => access.authorize(owner.token), /访问凭证/);
    await assert.rejects(access.login({ username: 'owner', password: 'correct horse battery staple' }), /无效/);
    assert.equal((await access.login({ username: 'owner', password: 'second correct horse battery' }))
      .principal.role, 'owner');
  } finally {
    await access.close();
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: account login locks out repeated guessing and does not persist sessions
 * 状态影响 / State effects: `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `Date.UTC`.
 * 检查边界 / Checked boundaries: `assert.rejects(access.login({ username: 'owner', password: 'wrong password' }), /无效/)`; `assert.rejects(access.login({ username: 'owner', password: 'correct horse battery staple' }), /尝试过多/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('account login locks out repeated guessing and does not persist sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-access-'));
  let now = Date.UTC(2026, 0, 1);
  const file = join(directory, 'accounts.json');
  const access = new AccessControl(file, () => now);
  await access.init();
  try {
    await access.enable({ password: 'correct horse battery staple' });
    for (let attempt = 0; attempt < 5; attempt++)
      await assert.rejects(access.login({ username: 'owner', password: 'wrong password' }), /无效/);
    await assert.rejects(access.login({ username: 'owner', password: 'correct horse battery staple' }),
      /尝试过多/);
    now += 60_001;
    const login = await access.login({ username: 'owner', password: 'correct horse battery staple' });
    const restarted = new AccessControl(file, () => now);
    await restarted.init();
    assert.throws(() => restarted.authorize(login.token), /访问凭证/);
    await restarted.close();
  } finally {
    await access.close();
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: passkey challenges are single-use and stored credentials survive restart and revoke their sessions
 * 状态影响 / State effects: `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `Date.UTC`.
 * 检查边界 / Checked boundaries: `assert.rejects(passkeys.beginUnlock(1), /本机平台/)`; `assert.equal(begin.options.rpId, 'localhost')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('passkey challenges are single-use and stored credentials survive restart and revoke their sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-passkeys-'));
  const file = join(directory, 'accounts.json');
  let now = Date.UTC(2026, 0, 1);
  const access = new AccessControl(file, () => now);
  await access.init();
  try {
    await access.enable({ password: 'correct horse battery staple' });
    const owner = await access.login({ username: 'owner', password: 'correct horse battery staple' });
    const passkeys = new Passkeys(access, 7337, () => now);
    await assert.rejects(passkeys.beginUnlock(1), /本机平台/);
    const begin = await passkeys.beginAuthentication();
    assert.equal(begin.options.rpId, 'localhost');
    const invalid = { ceremonyId: begin.ceremonyId, response: { id: 'a'.repeat(32) } };
    await assert.rejects(passkeys.finishAuthentication(invalid), /验证失败/);
    await assert.rejects(passkeys.finishAuthentication(invalid), /已失效/);
    const expired = await passkeys.beginAuthentication();
    now += 5 * 60_000;
    await assert.rejects(passkeys.finishAuthentication({ ...invalid,
      ceremonyId: expired.ceremonyId }), /已失效/);

    const id = 'b'.repeat(32);
    await access.addPasskey(owner.principal.id, { id, publicKey: 'c'.repeat(32),
      counter: 0, transports: ['internal'], name: 'test key',
      createdAt: new Date(now).toISOString() });
    const loginChallenge = await passkeys.beginAuthentication();
    await assert.rejects(passkeys.finishUnlock({ ceremonyId: loginChallenge.ceremonyId,
      response: { id } }), /已失效/);
    const unlockChallenge = await passkeys.beginUnlock(17);
    await assert.rejects(passkeys.finishAuthentication({ ceremonyId: unlockChallenge.ceremonyId,
      response: { id } }), /已失效/);
    const viewer = await access.createViewer({ username: 'reader', password: 'read only password 123',
      vmIds: ['00000000-0000-4000-8000-000000000001'], expiresAt: now + 86_400_000 });
    const viewerKey = 'd'.repeat(32);
    await access.addPasskey(viewer.id, { id: viewerKey, publicKey: 'e'.repeat(32),
      counter: 0, transports: ['internal'], name: 'viewer key',
      createdAt: new Date(now).toISOString() });
    const deniedUnlock = await passkeys.beginUnlock(18);
    await assert.rejects(passkeys.finishUnlock({ ceremonyId: deniedUnlock.ceremonyId,
      response: { id: viewerKey } }), /管理员/);
    assert.equal(access.passkeysFor(owner.principal.id)[0].name, 'test key');
    assert.ok(!JSON.stringify(access.passkeysFor(owner.principal.id)).includes('publicKey'));
    const restarted = new AccessControl(file, () => now);
    await restarted.init();
    assert.equal(restarted.getPasskey(id)?.key.id, id);
    await restarted.close();
    const signedIn = await access.completePasskeyLogin(owner.principal.id, id, 0, 1);
    assert.equal(access.authorize(signedIn.token).role, 'owner');
    await assert.rejects(access.completePasskeyLogin(owner.principal.id, id, 0, 1), /计数器/);
    const handoff = await access.createHandoff(signedIn.token);
    const moved = await access.redeemHandoff({ code: handoff.code });
    assert.throws(() => access.authorize(signedIn.token), /凭证/);
    assert.equal(access.authorize(moved.token).role, 'owner');
    await access.removePasskey(owner.principal.id, id);
    assert.throws(() => access.authorize(moved.token), /凭证/);
    assert.equal(access.authorize(owner.token).role, 'owner');
    passkeys.close();
  } finally {
    await access.close();
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: session handoff moves one live credential without extending its lifetime
 * 状态影响 / State effects: `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `Date.UTC`.
 * 检查边界 / Checked boundaries: `assert.match(cancelled.code, /^[A-Za-z0-9_-]{24}$/)`; `assert.rejects(access.redeemHandoff({ code: cancelled.code }), /无效或已过期/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('session handoff moves one live credential without extending its lifetime', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-handoff-'));
  let now = Date.UTC(2026, 0, 1);
  const access = new AccessControl(join(directory, 'accounts.json'), () => now);
  await access.init();
  try {
    await access.enable({ password: 'correct horse battery staple' });
    const owner = await access.login({ username: 'owner', password: 'correct horse battery staple' });
    const cancelled = await access.createHandoff(owner.token);
    assert.match(cancelled.code, /^[A-Za-z0-9_-]{24}$/);
    access.cancelHandoff(owner.token);
    await assert.rejects(access.redeemHandoff({ code: cancelled.code }), /无效或已过期/);
    const expired = await access.createHandoff(owner.token);
    now += 120_000;
    await assert.rejects(access.redeemHandoff({ code: expired.code }), /无效或已过期/);
    const fresh = await access.createHandoff(owner.token);
    now += 10_000;
    const moved = await access.redeemHandoff({ code: fresh.code });
    assert.equal(moved.sourceToken, owner.token);
    assert.equal(moved.principal.expiresAt, owner.principal.expiresAt);
    assert.equal(access.authorize(moved.token).id, owner.principal.id);
    assert.throws(() => access.authorize(owner.token), /凭证/);
    await assert.rejects(access.redeemHandoff({ code: fresh.code }), /无效或已过期/);
    const pending = await access.createHandoff(moved.token);
    access.logout(moved.token);
    await assert.rejects(access.redeemHandoff({ code: pending.code }), /无效或已过期/);
  } finally {
    await access.close();
    await rm(directory, { recursive: true, force: true });
  }
});
