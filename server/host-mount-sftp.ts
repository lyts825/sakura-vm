import { timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, mkdir, rmdir, unlink, rename, truncate, chmod, utimes } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import ssh2, { type Attributes, type SFTPWrapper, type Connection } from 'ssh2';
import { AppError } from './model.ts';
import { regularDirectory, within } from './local-store.ts';

const { Server, utils } = ssh2;
const { OPEN_MODE, STATUS_CODE } = utils.sftp;
const MAX_HANDLES = 128;
const MAX_READ = 256 * 1024;
type Handle = { type: 'file'; file: FileHandle } | { type: 'directory'; entries: string[];
  path: string; offset: number };

function safePart(part: string) {
  return part !== '.' && part !== '..' && part.length <= 255 &&
    !/[\\:\x00-\x1f<>"|?*]/.test(part) && !/[. ]$/.test(part);
}

export function hostMountPath(root: string, remote: string) {
  if (remote.length > 4096 || !(remote === '.' || remote.startsWith('/')))
    throw new AppError('共享目录路径无效', 403);
  const parts = remote === '.' ? [] : remote.split('/').filter(Boolean);
  if (!parts.every(safePart)) throw new AppError('共享目录路径越界或包含特殊字符', 403);
  const target = resolve(root, ...parts);
  if (!within(root, target)) throw new AppError('共享目录路径越界', 403);
  return target;
}

async function checked(root: string, remote: string, missingLeaf = false) {
  await regularDirectory(root);
  const target = hostMountPath(root, remote);
  if (target === root) return root;
  const parts = target.slice(root.length + (root.endsWith(sep) ? 0 : 1)).split(sep);
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (missingLeaf && index === parts.length - 1 && error.code === 'ENOENT') return null;
      throw error;
    });
    if (info?.isSymbolicLink() || (info && index < parts.length - 1 && !info.isDirectory()))
      throw new AppError('共享目录不允许符号链接或目录联接', 403);
  }
  return target;
}

async function checkedMutable(root: string, remote: string, missingLeaf = false) {
  const target = await checked(root, remote, missingLeaf);
  if (target === root) throw new AppError('不能修改共享目录根节点', 403);
  return target;
}

function attributes(info: Awaited<ReturnType<typeof lstat>>): Attributes {
  return { mode: Number(info.mode), uid: Number(info.uid) || 0, gid: Number(info.gid) || 0,
    size: Number(info.size), atime: Math.floor(Number(info.atimeMs) / 1000),
    mtime: Math.floor(Number(info.mtimeMs) / 1000) };
}

function code(error: unknown) {
  if (error instanceof AppError && error.status === 403) return STATUS_CODE.PERMISSION_DENIED;
  switch ((error as NodeJS.ErrnoException)?.code) {
    case 'ENOENT': return STATUS_CODE.NO_SUCH_FILE;
    case 'EACCES': case 'EPERM': return STATUS_CODE.PERMISSION_DENIED;
    default: return STATUS_CODE.FAILURE;
  }
}

export function attachHostSftp(channel: SFTPWrapper, root: string, readOnly: boolean) {
  const handles = new Map<number, Handle>();
  let nextHandle = 1;
  let queue = Promise.resolve();
  const reply = (id: number, work: () => Promise<void>) => {
    queue = queue.then(work).catch((error) => {
      channel.status(id, code(error));
    });
  };
  const take = (raw: Buffer) => {
    if (raw.length !== 4) throw new AppError('共享目录句柄无效', 403);
    const id = raw.readUInt32BE(0);
    const handle = handles.get(id);
    if (!handle) throw new AppError('共享目录句柄无效', 403);
    return { id, handle };
  };
  const grant = (id: number, handle: Handle) => {
    if (handles.size >= MAX_HANDLES) throw new AppError('共享目录打开文件过多', 403);
    const number = nextHandle++;
    handles.set(number, handle);
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(number);
    channel.handle(id, buffer);
  };
  const mutable = () => {
    if (readOnly) throw new AppError('共享目录为只读', 403);
  };
  channel.on('OPEN', (id, path, flags) => reply(id, async () => {
    const write = !!(flags & (OPEN_MODE.WRITE | OPEN_MODE.APPEND | OPEN_MODE.CREAT |
      OPEN_MODE.TRUNC | OPEN_MODE.EXCL));
    if (write) mutable();
    if (!(flags & (OPEN_MODE.READ | OPEN_MODE.WRITE | OPEN_MODE.APPEND)))
      throw new AppError('共享目录打开模式无效', 403);
    if (handles.size >= MAX_HANDLES) throw new AppError('共享目录打开文件过多', 403);
    const target = await checkedMutable(root, path, !!(flags & OPEN_MODE.CREAT));
    let native = flags & OPEN_MODE.READ ? constants.O_RDONLY : constants.O_WRONLY;
    if (flags & OPEN_MODE.READ && flags & (OPEN_MODE.WRITE | OPEN_MODE.APPEND)) native = constants.O_RDWR;
    if (flags & OPEN_MODE.CREAT) native |= constants.O_CREAT;
    if (flags & OPEN_MODE.TRUNC) native |= constants.O_TRUNC;
    if (flags & OPEN_MODE.APPEND) native |= constants.O_APPEND;
    if (flags & OPEN_MODE.EXCL) native |= constants.O_EXCL;
    const file = await open(target, native, 0o600);
    try {
      const info = await file.stat();
      if (!info.isFile()) throw new AppError('仅能打开普通文件', 403);
      grant(id, { type: 'file', file });
    } catch (error) { await file.close(); throw error; }
  }));
  channel.on('READ', (id, raw, offset, length) => reply(id, async () => {
    const { handle } = take(raw);
    if (handle.type !== 'file' || !Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(length) || length < 1 || length > MAX_READ)
      throw new AppError('共享目录读取参数无效', 403);
    const buffer = Buffer.alloc(length);
    const result = await handle.file.read(buffer, 0, length, offset);
    if (result.bytesRead) channel.data(id, buffer.subarray(0, result.bytesRead));
    else channel.status(id, STATUS_CODE.EOF);
  }));
  channel.on('WRITE', (id, raw, offset, data) => reply(id, async () => {
    mutable();
    const { handle } = take(raw);
    if (handle.type !== 'file' || !Number.isSafeInteger(offset) || offset < 0 ||
      data.length > MAX_READ) throw new AppError('共享目录写入参数无效', 403);
    const result = await handle.file.write(data, 0, data.length, offset);
    if (result.bytesWritten !== data.length) throw new Error('共享目录写入不完整');
    channel.status(id, STATUS_CODE.OK);
  }));
  channel.on('FSTAT', (id, raw) => reply(id, async () => {
    const { handle } = take(raw);
    if (handle.type !== 'file') throw new AppError('共享目录句柄无效', 403);
    channel.attrs(id, attributes(await handle.file.stat()));
  }));
  channel.on('FSETSTAT', (id, raw, attrs) => reply(id, async () => {
    mutable();
    const { handle } = take(raw);
    if (handle.type !== 'file') throw new AppError('共享目录句柄无效', 403);
    if (attrs.size !== undefined) await handle.file.truncate(attrs.size);
    if (attrs.mode !== undefined) await handle.file.chmod(attrs.mode & 0o777);
    if (attrs.atime !== undefined || attrs.mtime !== undefined) {
      const info = await handle.file.stat();
      await handle.file.utimes(attrs.atime ?? info.atime, attrs.mtime ?? info.mtime);
    }
    channel.status(id, STATUS_CODE.OK);
  }));
  channel.on('CLOSE', (id, raw) => reply(id, async () => {
    const { id: number, handle } = take(raw);
    handles.delete(number);
    if (handle.type === 'file') await handle.file.close();
    channel.status(id, STATUS_CODE.OK);
  }));
  channel.on('OPENDIR', (id, path) => reply(id, async () => {
    const target = await checked(root, path);
    const info = await lstat(target);
    if (!info.isDirectory()) throw new AppError('需要目录', 403);
    if (handles.size >= MAX_HANDLES) throw new AppError('共享目录打开文件过多', 403);
    grant(id, { type: 'directory', path, entries: await readdir(target), offset: 0 });
  }));
  channel.on('READDIR', (id, raw) => reply(id, async () => {
    const { handle } = take(raw);
    if (handle.type !== 'directory') throw new AppError('共享目录句柄无效', 403);
    const names = [];
    while (names.length < 32 && handle.offset < handle.entries.length) {
      const filename = handle.entries[handle.offset++];
      if (!safePart(filename)) continue;
      const path = handle.path === '/' ? `/${filename}` : `${handle.path}/${filename}`;
      try {
        const target = await checked(root, path);
        names.push({ filename, longname: filename, attrs: attributes(await lstat(target)) });
      } catch { /* Entries replaced by links or removed during listing are hidden. */ }
    }
    if (names.length) channel.name(id, names);
    else channel.status(id, STATUS_CODE.EOF);
  }));
  const statPath = (id: number, path: string) => reply(id, async () =>
    channel.attrs(id, attributes(await lstat(await checked(root, path)))));
  channel.on('STAT', statPath).on('LSTAT', statPath);
  channel.on('REALPATH', (id, path) => reply(id, async () => {
    const target = await checked(root, path);
    const normalized = target === root ? '/' : '/' + target.slice(root.length + 1).split(sep).join('/');
    channel.name(id, [{ filename: normalized, longname: normalized,
      attrs: attributes(await lstat(target)) }]);
  }));
  channel.on('SETSTAT', (id, path, attrs) => reply(id, async () => {
    mutable();
    const target = await checkedMutable(root, path);
    if (attrs.size !== undefined) await truncate(target, attrs.size);
    if (attrs.mode !== undefined) await chmod(target, attrs.mode & 0o777);
    if (attrs.atime !== undefined || attrs.mtime !== undefined) {
      const info = await lstat(target);
      await utimes(target, attrs.atime ?? info.atime, attrs.mtime ?? info.mtime);
    }
    channel.status(id, STATUS_CODE.OK);
  }));
  channel.on('MKDIR', (id, path) => reply(id, async () => {
    mutable();
    await mkdir(await checkedMutable(root, path, true));
    channel.status(id, STATUS_CODE.OK);
  }));
  channel.on('RMDIR', (id, path) => reply(id, async () => {
    mutable();
    await rmdir(await checkedMutable(root, path));
    channel.status(id, STATUS_CODE.OK);
  }));
  channel.on('REMOVE', (id, path) => reply(id, async () => {
    mutable();
    await unlink(await checkedMutable(root, path));
    channel.status(id, STATUS_CODE.OK);
  }));
  channel.on('RENAME', (id, from, to) => reply(id, async () => {
    mutable();
    await rename(await checkedMutable(root, from), await checkedMutable(root, to, true));
    channel.status(id, STATUS_CODE.OK);
  }));
  channel.on('READLINK', (id) => channel.status(id, STATUS_CODE.OP_UNSUPPORTED));
  channel.on('SYMLINK', (id) => channel.status(id, STATUS_CODE.OP_UNSUPPORTED));
  channel.on('EXTENDED', (id) => channel.status(id, STATUS_CODE.OP_UNSUPPORTED));
  channel.on('close', () => {
    for (const handle of handles.values())
      if (handle.type === 'file') void handle.file.close().catch(() => {});
    handles.clear();
  });
}

export async function serveHostMount(root: string, readOnly: boolean) {
  root = await regularDirectory(root);
  if (!(await lstat(root).catch(() => null))?.isDirectory())
    throw new AppError('宿主共享目录不存在', 400);
  const hostKeys = utils.generateKeyPairSync('ed25519');
  const clientKeys = utils.generateKeyPairSync('ed25519');
  const parsed = utils.parseKey(clientKeys.public);
  if (parsed instanceof Error) throw parsed;
  const connections = new Set<Connection>();
  const server = new Server({ hostKeys: [hostKeys.private] }, (client) => {
    connections.add(client);
    client.on('authentication', (context) => {
      if (context.method !== 'publickey' || context.username !== 'sakura-host' ||
        context.key.algo !== parsed.type ||
        context.key.data.length !== parsed.getPublicSSH().length ||
        !timingSafeEqual(context.key.data, parsed.getPublicSSH()) ||
        (context.signature && parsed.verify(context.blob!, context.signature, context.hashAlgo) !== true))
        return context.reject();
      context.accept();
    });
    client.on('ready', () => client.on('session', (accept) => {
      const session = accept();
      session.on('sftp', (accept) => attachHostSftp(accept(), root, readOnly));
    }));
    client.on('close', () => connections.delete(client));
    client.on('error', () => {});
  });
  server.on('error', () => {});
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); done(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('宿主共享服务端口无效');
  return { port: address.port, hostPublic: hostKeys.public,
    clientPrivate: clientKeys.private, clientPublic: clientKeys.public,
    close: async () => {
      for (const connection of connections) connection.end();
      await new Promise<void>((done) => server.close(() => done()));
    } };
}
