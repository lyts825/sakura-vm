#!/usr/bin/env node
/** 中文：由发布者使用外部私钥签署发行指纹，私钥不写入包。English: Sign a release fingerprint with an external publisher key; never copy the private key into the package. */
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReleaseManifest, inside } from './release-manifest.mjs';
import { publisherKey, signingPayload } from './trusted-update.mjs';

export async function signRelease(directory, privateKeyFile, source, sequence, expiresAt) {
  directory = await realpath(directory); privateKeyFile = await realpath(privateKeyFile);
  if (inside(directory, privateKeyFile) || directory === privateKeyFile) throw new Error('签名私钥必须位于发行目录之外');
  const manifest = await verifyReleaseManifest(directory);
  const key = createPrivateKey(await readFile(privateKeyFile));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('发布签名需要 Ed25519 私钥');
  if (!Number.isSafeInteger(sequence) || sequence < 1 || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())
    throw new Error('序号须为正整数，有效期须为未来日期');
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
  const envelope = { schemaVersion: 1, keyId: publisherKey(publicKey).id, source: new URL(source).href,
    version: manifest.version, fingerprint: manifest.fingerprint, sequence,
    issuedAt: new Date().toISOString(), expiresAt: new Date(expiresAt).toISOString() };
  const signature = sign(null, Buffer.from(signingPayload(envelope)), key).toString('base64');
  await writeFile(join(directory, 'sakura-release-signature.json'), JSON.stringify({ ...envelope, signature }, null, 2) + '\n', { flag: 'wx' });
  return { keyId: envelope.keyId, version: envelope.version, fingerprint: envelope.fingerprint };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, key, source, sequence, expiresAt] = process.argv.slice(2);
  try { console.log(JSON.stringify(await signRelease(resolve(directory), resolve(key), source, Number(sequence), expiresAt))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
