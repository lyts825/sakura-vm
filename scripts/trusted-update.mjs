/** 中文：认证发布者与本地更新包，执行前再次验证并持久化防重放记录。English: Authenticate publishers/local releases and revalidate before execution with durable replay protection. */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pointer, versionPath, stageUpdate, activateUpdate, rollbackUpdate, validateInstallationPath } from './self-update.mjs';
import { verifyReleaseManifest } from './release-manifest.mjs';

const signatureName = 'sakura-release-signature.json';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const defaultTrust = () => ({ schemaVersion: 1, revision: 0, publishers: [], accepted: {} });
const trustPath = (installation) => join(installation, '.sakura-update', 'trusted-publishers.json');

export function signingPayload(envelope) {
  const { schemaVersion, keyId, source, version, fingerprint, sequence, issuedAt, expiresAt } = envelope;
  return JSON.stringify({ schemaVersion, keyId, source, version, fingerprint, sequence, issuedAt, expiresAt });
}
export function publisherKey(publicKey) {
  if (typeof publicKey !== 'string' || !publicKey.trim().startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('请提供 Ed25519 公钥，禁止私钥');
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('更新发布者必须使用 Ed25519 公钥');
  return { id: hash(key.export({ type: 'spki', format: 'der' })), publicKey: key.export({ type: 'spki', format: 'pem' }).toString() };
}
async function trust(installation) {
  await validateInstallationPath(installation, trustPath(installation), true);
  let state;
  try { state = JSON.parse(await readFile(trustPath(installation), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return defaultTrust(); throw error; }
  if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 ||
      !Array.isArray(state.publishers) || !state.accepted || typeof state.accepted !== 'object') throw new Error('发布者信任存储无效');
  for (const publisher of state.publishers) {
    if (publisherKey(publisher.publicKey).id !== publisher.id || typeof publisher.source !== 'string' || typeof publisher.label !== 'string') throw new Error('发布者记录无效');
  }
  if (new Set(state.publishers.map((publisher) => publisher.id)).size !== state.publishers.length) throw new Error('发布者记录重复');
  for (const [id, record] of Object.entries(state.accepted)) {
    if (!/^[a-f0-9]{64}$/.test(id) || !record || !Number.isSafeInteger(record.sequence) || record.sequence < 1 ||
        typeof record.version !== 'string' || !/^[a-f0-9]{64}$/.test(record.fingerprint) ||
        (record.versions !== undefined && (!record.versions || typeof record.versions !== 'object' ||
          Object.values(record.versions).some((fingerprint) => typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)))))
      throw new Error('已接受发行记录无效');
  }
  return state;
}
/** 中文：跨进程独占锁防止并发更新丢失信任状态。English: A cross-process exclusive lock prevents lost trust updates. */
async function locked(installation, work) {
  const folder = join(installation, '.sakura-update');
  await validateInstallationPath(installation, folder, true); await mkdir(folder, { recursive: true });
  const lock = join(folder, 'trusted-update.lock');
  let handle;
  try { handle = await open(lock, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('其他可信更新正在运行；若进程已退出，请核对后移除 trusted-update.lock'); throw error; }
  try { return await work(); } finally { await handle.close(); await validateInstallationPath(installation, lock); await rm(lock, { force: true }); }
}
async function saveTrust(installation, state, check = () => {}) {
  const { rename, writeFile } = await import('node:fs/promises');
  const file = trustPath(installation), temp = file + '.tmp';
  await validateInstallationPath(installation, file, true);
  await writeFile(temp, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' });
  try { await check(); await validateInstallationPath(installation, file, true); await rename(temp, file); }
  finally { await validateInstallationPath(installation, temp, true); await rm(temp, { force: true }); }
}
function requireRevision(state, revision) {
  if (state.revision !== revision) throw new Error('发布者信任配置已变化，请刷新后重试');
}
/** 中文：先保存接受上限，再允许启用；崩溃恢复的候选复用也必须补齐记录。English: Persist the acceptance floor before activation; recovered candidate reuse must repair this record too. */
async function rememberAccepted(installation, state, source, check = () => {}) {
  const previous = state.accepted[source.envelope.keyId];
  if (previous?.sequence === source.envelope.sequence && previous?.fingerprint === source.manifest.fingerprint &&
      previous?.versions?.[source.manifest.version] === source.manifest.fingerprint) return;
  state.accepted[source.envelope.keyId] = { sequence: source.envelope.sequence,
    version: source.manifest.version, fingerprint: source.manifest.fingerprint,
    versions: { ...previous?.versions, [source.manifest.version]: source.manifest.fingerprint } };
  state.revision++; await saveTrust(installation, state, check);
}
export async function changePublisher(installation, input, check = () => {}) {
  return locked(installation, async () => {
    const state = await trust(installation); requireRevision(state, input.revision);
    if (input.action === 'add-publisher') {
      const key = publisherKey(input.publicKey);
      if (state.publishers.some((publisher) => publisher.id === key.id)) throw new Error('此公钥已登记；修改来源需先撤销旧记录');
      state.publishers.push({ ...key, label: input.label, source: new URL(input.source).href });
    } else state.publishers = state.publishers.filter((publisher) => publisher.id !== input.id);
    await check(); state.revision++; await saveTrust(installation, state, check);
  });
}
function verifyEnvelope(envelope, manifest, state, now = Date.now(), allowOlder = false) {
  if (!envelope || envelope.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(envelope.keyId) ||
      typeof envelope.source !== 'string' || !Number.isSafeInteger(envelope.sequence) || envelope.sequence < 1 ||
      typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature) ||
      !Number.isFinite(Date.parse(envelope.issuedAt)) || !Number.isFinite(Date.parse(envelope.expiresAt)) ||
      Date.parse(envelope.issuedAt) > now + 300_000 || Date.parse(envelope.expiresAt) <= now ||
      Date.parse(envelope.expiresAt) <= Date.parse(envelope.issuedAt)) throw new Error('发行签名格式或有效期无效');
  const publisher = state.publishers.find((entry) => entry.id === envelope.keyId && entry.source === envelope.source);
  if (!publisher) throw new Error('发布者或来源尚未受信任');
  if (envelope.fingerprint !== manifest.fingerprint || envelope.version !== manifest.version) throw new Error('签名与发行清单不匹配');
  if (!verify(null, Buffer.from(signingPayload(envelope)), publisher.publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('发行发布者签名校验失败');
  const accepted = state.accepted[envelope.keyId];
  if (accepted?.versions?.[envelope.version] && accepted.versions[envelope.version] !== envelope.fingerprint)
    throw new Error('同一发行版本的内容指纹发生变化');
  if (!allowOlder && accepted && (envelope.sequence < accepted.sequence ||
      (envelope.sequence === accepted.sequence && (envelope.fingerprint !== accepted.fingerprint || envelope.version !== accepted.version))))
    throw new Error('发行序号回退或同序号内容发生变化');
  return publisher;
}
async function verified(directory, state, allowOlder = false) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('发行包必须是普通目录');
  const manifest = await verifyReleaseManifest(directory);
  const signatureInfo = await lstat(join(directory, signatureName));
  if (!signatureInfo.isFile() || signatureInfo.isSymbolicLink()) throw new Error('发行签名必须是普通文件');
  const envelope = JSON.parse(await readFile(join(directory, signatureName), 'utf8'));
  const publisher = verifyEnvelope(envelope, manifest, state, Date.now(), allowOlder);
  return { manifest, envelope, publisher };
}
export async function checkTrustedUpdate(installation, source) {
  const state = await trust(installation), path = await realpath(source);
  const result = await verified(path, state);
  return { path, revision: state.revision, ...result };
}
async function describe(installation, path, state) {
  const entry = { path, verified: false };
  try {
    const directory = versionPath(installation, path);
    await validateInstallationPath(installation, directory);
    const result = await verified(directory, state, true);
    await validateInstallationPath(installation, join(directory, '.sakura-verified.json'));
    const marker = JSON.parse(await readFile(join(directory, '.sakura-verified.json'), 'utf8'));
    if (marker.fingerprint !== result.manifest.fingerprint) throw new Error('候选健康记录无效');
    return { ...entry, verified: true, version: result.manifest.version, fingerprint: result.manifest.fingerprint,
      publisher: result.publisher.label, source: result.publisher.source };
  } catch (error) { return { ...entry, error: '未认证或不可用：' + error.message }; }
}
export async function trustedUpdateView(installation) {
  const state = await trust(installation), current = await pointer(installation);
  await validateInstallationPath(installation, join(installation, 'versions'), true);
  const entries = await readdir(join(installation, 'versions'), { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return []; throw error;
  });
  const candidates = [];
  for (const entry of entries) if (/^[a-f0-9]{32}$/.test(entry.name)) candidates.push(await describe(installation, 'versions/' + entry.name, state));
  return { trustRevision: state.revision, publishers: state.publishers, candidates,
    active: await describe(installation, current.active, state), previous: current.previous ? await describe(installation, current.previous, state) : null };
}
export async function stageTrustedUpdate(installation, input, options = {}) {
  return locked(installation, async () => {
    const state = await trust(installation); requireRevision(state, input.revision);
    const selected = await realpath(input.path), source = await verified(selected, state);
    if (source.manifest.fingerprint !== input.fingerprint) throw new Error('候选发行包已变化，请重新检查');
    // 中文：仅精确重复的已暂存内容可以复用。English: Only an exactly matching, verified stage can be reused.
    const current = await trustedUpdateView(installation);
    for (const candidate of current.candidates) if (candidate.verified && candidate.fingerprint === input.fingerprint) {
      const old = await verified(versionPath(installation, candidate.path), state);
      if (signingPayload(old.envelope) === signingPayload(source.envelope)) {
        await rememberAccepted(installation, state, source); return candidate;
      }
    }
    const result = await stageUpdate(selected, installation, { ...options,
      verifyCandidate: async (candidate) => {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(join(candidate, signatureName), JSON.stringify(source.envelope) + '\n', { flag: 'wx' });
        await verified(candidate, state);
      } });
    await rememberAccepted(installation, state, source);
    return result;
  });
}
export async function activateTrustedUpdate(installation, input, check = () => {}) {
  return locked(installation, async () => {
    const state = await trust(installation); requireRevision(state, input.revision);
    const path = versionPath(installation, input.path);
    await validateInstallationPath(installation, path);
    const candidate = await verified(path, state);
    const health = await describe(installation, input.path, state);
    if (!health.verified) throw new Error('候选健康记录无效');
    await rememberAccepted(installation, state, candidate, check);
    await check(); return activateUpdate(input.path, installation, check);
  });
}
export async function rollbackTrustedUpdate(installation, input, check = () => {}) {
  return locked(installation, async () => {
    const state = await trust(installation); requireRevision(state, input.revision);
    const current = await pointer(installation);
    if (!current.previous || current.previous !== input.expectedPrevious) throw new Error('回退目标已变化，请刷新后重试');
    const previous = await describe(installation, current.previous, state);
    if (!previous.verified && !input.acknowledgeUnverified) throw new Error('回退版本未认证，需要明确确认');
    // An unsigned historical root may be restored explicitly; versioned directories must still pass integrity checks.
    await validateInstallationPath(installation, versionPath(installation, current.previous));
    if (current.previous !== '.') await verifyReleaseManifest(versionPath(installation, current.previous));
    await check(); return rollbackUpdate(installation, check);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, installation, serialized] = process.argv.slice(2);
  try {
    if (action !== 'stage' || !installation || !serialized) throw new Error('仅支持受控 stage 操作');
    console.log(JSON.stringify(await stageTrustedUpdate(resolve(installation), JSON.parse(serialized))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
