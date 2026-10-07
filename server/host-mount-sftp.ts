/**
 * 模块职责：通过受控 SFTP 服务共享宿主目录，核对路径并使用临时 SSH 身份。
 * Module purpose: Shares controlled host directories over SFTP, validating paths and using temporary SSH identities.
 */
import { timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  open,
  readdir,
  mkdir,
  rmdir,
  unlink,
  rename,
  truncate,
  chmod,
  utimes,
} from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import ssh2, { type Attributes, type SFTPWrapper, type Connection } from 'ssh2';
import { AppError } from '../shared/errors.ts';
import { networkFor } from './network/index.ts';
const hostMountNetwork = networkFor('core:host-mount', 'sftp');
import { regularDirectory, within } from './local-store.ts';

const { Server, utils } = ssh2;
const { OPEN_MODE, STATUS_CODE } = utils.sftp;
const MAX_HANDLES = 128;
const MAX_READ = 256 * 1024;
type Handle = { type: 'file'; file: FileHandle } | { type: 'directory'; entries: string[];
  path: string; offset: number };

/**
 * 入口 / Entry: ephemeralSshKeys.
 * 功能：在通过受控 SFTP 服务共享宿主目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `keys` 供上层消费（`host-mount-sftp.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-mount-sftp.ts`; this entry produces `keys` for its caller. Module context: Shares controlled host directories over SFTP, validating paths and using temporary SSH identities.
 * 处理：通过 `utils.generateKeyPairSync`, `utils.parseKey` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `utils.generateKeyPairSync`, `utils.parseKey`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!(utils.parseKey(keys.private) instanceof Error) && !(utils.parseKey(keys.public) instanceof Error)`.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `keys`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 异常 / errors `new AppError('无法生成宿主目录共享的临时 SSH 密钥', 500)`.
 */
function ephemeralSshKeys() {
  // ssh2's OpenSSH writer can rarely emit a key its parser rejects.
  for (let attempt = 0; attempt < 8; attempt++) {
    const keys = utils.generateKeyPairSync('ed25519');
    if (!(utils.parseKey(keys.private) instanceof Error) &&
        !(utils.parseKey(keys.public) instanceof Error)) return keys;
  }
  throw new AppError('无法生成宿主目录共享的临时 SSH 密钥', 500);
}

/**
 * 入口 / Entry: safePart.
 * 功能：从当前输入或状态计算 `part !== '.' && part !== '..' && part.length <= 255 && !/[\\:\x00-\x1f<>"|?*]/.test(part) && !/[. ]$/.test(part)`，供调用方后续验证或使用。
 * Purpose: Computes `part !== '.' && part !== '..' && part.length <= 255 && !/[\\:\x00-\x1f<>"|?*]/.test(part) && !/[. ]$/.test(part)` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: part: string
 * 输出 / Returns: `part !== '.' && part !== '..' && part.length <= 255 && !/[\\:\x00-\x1f<>"|?*]/.test(part) && !/[. ]$/.test(part)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function safePart(part: string) {
  return part !== '.' && part !== '..' && part.length <= 255 &&
    !/[\\:\x00-\x1f<>"|?*]/.test(part) && !/[. ]$/.test(part);
}

/**
 * 入口 / Entry: hostMountPath.
 * 功能：在通过受控 SFTP 服务共享宿主目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `target` 供上层消费（`host-mount-sftp.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-mount-sftp.ts`; this entry produces `target` for its caller. Module context: Shares controlled host directories over SFTP, validating paths and using temporary SSH identities.
 * 处理：通过 `remote.startsWith`, `remote.split().filter`, `remote.split`, `parts.every` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `remote.startsWith`, `remote.split().filter`, `remote.split`, `parts.every`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: root: string; remote: string
 * 输出 / Returns: `target`.
 * 副作用 / Effects: `remote.startsWith`.
 * 拒绝 / Refusals: 条件 / conditions `remote.length > 4096 || !(remote === '.' || remote.startsWith('/'))`; `!parts.every(safePart)`; `!within(root, target)`; 异常 / errors `new AppError('共享目录路径无效', 403)`; `new AppError('共享目录路径越界或包含特殊字符', 403)`.
 */
export function hostMountPath(root: string, remote: string) {
  if (remote.length > 4096 || !(remote === '.' || remote.startsWith('/')))
    throw new AppError('共享目录路径无效', 403);
  const parts = remote === '.' ? [] : remote.split('/').filter(Boolean);
  if (!parts.every(safePart)) throw new AppError('共享目录路径越界或包含特殊字符', 403);
  const target = resolve(root, ...parts);
  if (!within(root, target)) throw new AppError('共享目录路径越界', 403);
  return target;
}

/**
 * 入口 / Entry: checked.
 * 功能：在通过受控 SFTP 服务共享宿主目录中，核对调用资格、输入或资源归属；本入口产生 `root` / `target` 供上层消费（`host-mount-sftp.ts`）。
 * Purpose: Checks admission, input or resource ownership in `host-mount-sftp.ts`; this entry produces `root` / `target` for its caller. Module context: Shares controlled host directories over SFTP, validating paths and using temporary SSH identities.
 * 处理：通过 `regularDirectory`, `hostMountPath`, `target.slice().split`, `target.slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `regularDirectory`, `hostMountPath`, `target.slice().split`, `target.slice`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `target === root`.
 * 输入 / Inputs: root: string; remote: string; missingLeaf: default=false
 * 输出 / Returns: `root`; `target`.
 * 副作用 / Effects: 更新 / updates `current`.
 * 拒绝 / Refusals: 条件 / conditions `info?.isSymbolicLink() || (info && index < parts.length - 1 && !info.isDirectory())`; 异常 / errors `new AppError('共享目录不允许符号链接或目录联接', 403)`.
 */
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

/**
 * 入口 / Entry: checkedMutable.
 * 功能：在通过受控 SFTP 服务共享宿主目录中，核对调用资格、输入或资源归属；本入口产生 `target` 供上层消费（`host-mount-sftp.ts`）。
 * Purpose: Checks admission, input or resource ownership in `host-mount-sftp.ts`; this entry produces `target` for its caller. Module context: Shares controlled host directories over SFTP, validating paths and using temporary SSH identities.
 * 处理：通过 `checked` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `checked`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: root: string; remote: string; missingLeaf: default=false
 * 输出 / Returns: `target`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `target === root`; 异常 / errors `new AppError('不能修改共享目录根节点', 403)`.
 */
async function checkedMutable(root: string, remote: string, missingLeaf = false) {
  const target = await checked(root, remote, missingLeaf);
  if (target === root) throw new AppError('不能修改共享目录根节点', 403);
  return target;
}

/**
 * 入口 / Entry: attributes.
 * 功能：从当前输入或状态计算 `{ mode: Number(info.mode), uid: Number(info.uid) || 0, gid: Number(info.gid) || 0, size: Number(info.size), atime: Math.floor…`，供调用方后续验证或使用。
 * Purpose: Computes `{ mode: Number(info.mode), uid: Number(info.uid) || 0, gid: Number(info.gid) || 0, size: Number(info.size), atime: Math.floor…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: info: Awaited<ReturnType<typeof lstat>>
 * 输出 / Returns: Attributes；结果来自 / values from `{ mode: Number(info.mode), uid: Number(info.uid) || 0, gid: Number(info.gid) || 0, size: Number(info.size), atime: Math.floor…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function attributes(info: Awaited<ReturnType<typeof lstat>>): Attributes {
  return { mode: Number(info.mode), uid: Number(info.uid) || 0, gid: Number(info.gid) || 0,
    size: Number(info.size), atime: Math.floor(Number(info.atimeMs) / 1000),
    mtime: Math.floor(Number(info.mtimeMs) / 1000) };
}

/**
 * 入口 / Entry: code.
 * 功能：在通过受控 SFTP 服务共享宿主目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `STATUS_CODE.PERMISSION_DENIED` / `STATUS_CODE.NO_SUCH_FILE` 供上层消费（`host-mount-sftp.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-mount-sftp.ts`; this entry produces `STATUS_CODE.PERMISSION_DENIED` / `STATUS_CODE.NO_SUCH_FILE` for its caller. Module context: Shares controlled host directories over SFTP, validating paths and using temporary SSH identities.
 * 分支 / Branches: `error instanceof AppError && error.status === 403`.
 * 输入 / Inputs: error: unknown
 * 输出 / Returns: `STATUS_CODE.PERMISSION_DENIED`; `STATUS_CODE.NO_SUCH_FILE`; `STATUS_CODE.FAILURE`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function code(error: unknown) {
  if (error instanceof AppError && error.status === 403) return STATUS_CODE.PERMISSION_DENIED;
  switch ((error as NodeJS.ErrnoException)?.code) {
    case 'ENOENT': return STATUS_CODE.NO_SUCH_FILE;
    case 'EACCES': case 'EPERM': return STATUS_CODE.PERMISSION_DENIED;
    default: return STATUS_CODE.FAILURE;
  }
}

/**
 * 入口 / Entry: attachHostSftp.
 * 功能：把受限宿主目录文件操作映射到 SFTP 会话，限制成员路径、句柄和写入。
 * Purpose: Maps bounded host-directory file operations into SFTP sessions with path/handle/write restrictions.
 * 设计：目录解析不能越出原共享根；打开的句柄随连接关闭，拒绝不受支持类型和链接路径。
 * Design: Resolution cannot escape the original share root; connection close owns open handles and unsupported types/links are refused.
 * 输入 / Inputs: channel: SFTPWrapper; root: string; readOnly: boolean
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function attachHostSftp(channel: SFTPWrapper, root: string, readOnly: boolean) {
  const handles = new Map<number, Handle>();
  let nextHandle = 1;
  let queue = Promise.resolve();
  /**
   * 入口 / Entry: attachHostSftp.reply.
   * 功能：在通过受控 SFTP 服务共享宿主目录中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`host-mount-sftp.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-mount-sftp.ts`; the calls and state transitions below complete the operation. Module context: Shares controlled host directories over SFTP, validating paths and using temporary SSH identities.
   * 处理：通过 `queue.then().catch`, `queue.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `queue.then().catch`, `queue.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: number; work: () => Promise<void>
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `queue`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const reply = (id: number, work:
  /**
   * 中文功能：将 attachHostSftp.reply.work 所属工作交给原调用上下文，按声明返回业务结果或异步拒绝。
   * English: Supplies work to the original context owned by attachHostSftp.reply.work, returning the declared business result or asynchronous rejection.
   * 所属 / Owner: attachHostSftp.reply.work.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `Promise<void>`.
   */
  () => Promise<void>) => {
    queue = queue.then(work).catch((error) => {
      channel.status(id, code(error));
    });
  };
  /**
   * 入口 / Entry: attachHostSftp.take.
   * 功能：在通过受控 SFTP 服务共享宿主目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ id, handle }` 供上层消费（`host-mount-sftp.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-mount-sftp.ts`; this entry produces `{ id, handle }` for its caller. Module context: Shares controlled host directories over SFTP, validating paths and using temporary SSH identities.
   * 处理：通过 `raw.readUInt32BE`, `handles.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `raw.readUInt32BE`, `handles.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: raw: Buffer
   * 输出 / Returns: `{ id, handle }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `raw.length !== 4`; `!handle`; 异常 / errors `new AppError('共享目录句柄无效', 403)`.
   */
  const take = (raw: Buffer) => {
    if (raw.length !== 4) throw new AppError('共享目录句柄无效', 403);
    const id = raw.readUInt32BE(0);
    const handle = handles.get(id);
    if (!handle) throw new AppError('共享目录句柄无效', 403);
    return { id, handle };
  };
  /**
   * 入口 / Entry: attachHostSftp.grant.
   * 功能：在通过受控 SFTP 服务共享宿主目录中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`host-mount-sftp.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-mount-sftp.ts`; the calls and state transitions below complete the operation. Module context: Shares controlled host directories over SFTP, validating paths and using temporary SSH identities.
   * 处理：通过 `handles.set`, `buffer.writeUInt32BE`, `channel.handle` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `handles.set`, `buffer.writeUInt32BE`, `channel.handle`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: number; handle: Handle
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `handles.set`; `buffer.writeUInt32BE`.
   * 拒绝 / Refusals: 条件 / conditions `handles.size >= MAX_HANDLES`; 异常 / errors `new AppError('共享目录打开文件过多', 403)`.
   */
  const grant = (id: number, handle: Handle) => {
    if (handles.size >= MAX_HANDLES) throw new AppError('共享目录打开文件过多', 403);
    const number = nextHandle++;
    handles.set(number, handle);
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(number);
    channel.handle(id, buffer);
  };
  /**
   * 入口 / Entry: attachHostSftp.mutable.
   * 功能：在通过受控 SFTP 服务共享宿主目录中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`host-mount-sftp.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-mount-sftp.ts`; the calls and state transitions below complete the operation. Module context: Shares controlled host directories over SFTP, validating paths and using temporary SSH identities.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `readOnly`; 异常 / errors `new AppError('共享目录为只读', 403)`.
   */
  const mutable = () => {
    if (readOnly) throw new AppError('共享目录为只读', 403);
  };
  /**
   * 入口 / Entry: attachHostSftp.callback@124.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（reply）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (reply).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `file.close`; 更新 / updates `native`.
   * 拒绝 / Refusals: 条件 / conditions `!(flags & (OPEN_MODE.READ | OPEN_MODE.WRITE | OPEN_MODE.APPEND))`; `handles.size >= MAX_HANDLES`; `!info.isFile()`; 异常 / errors `new AppError('共享目录打开模式无效', 403)`; `new AppError('共享目录打开文件过多', 403)`.
   * 失败处理：catch 分支执行 `await file.close();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await file.close();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  channel.on('OPEN', (id, path, flags) => reply(id,
  /**
   * 中文功能：校验 SFTP 打开模式、可写授权、句柄容量及受控路径，打开普通文件后授予句柄；校验失败关闭 native fd。
   * English: Checks SFTP flags, write permission, handle capacity and controlled path, granting a handle only for a regular file and closing the native fd on failed validation.
   * 所属 / Owner: attachHostSftp.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   */
  async () => {
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
  /**
   * 入口 / Entry: attachHostSftp.callback@145.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（reply）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (reply).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `handle.type !== 'file' || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || lengt…`; 异常 / errors `new AppError('共享目录读取参数无效', 403)`.
   */
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
  /**
   * 入口 / Entry: attachHostSftp.callback@155.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（reply）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (reply).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `handle.file.write`.
   * 拒绝 / Refusals: 条件 / conditions `handle.type !== 'file' || !Number.isSafeInteger(offset) || offset < 0 || data.length > MAX_READ`; `result.bytesWritten !== data.length`; 异常 / errors `new AppError('共享目录写入参数无效', 403)`; `new Error('共享目录写入不完整')`.
   */
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
  /**
   * 入口 / Entry: attachHostSftp.callback@169.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（reply）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (reply).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `handle.type !== 'file'`; 异常 / errors `new AppError('共享目录句柄无效', 403)`.
   */
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
  /**
   * 入口 / Entry: attachHostSftp.callback@181.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（reply）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (reply).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `handles.delete`; `handle.file.close`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  channel.on('CLOSE', (id, raw) => reply(id, async () => {
    const { id: number, handle } = take(raw);
    handles.delete(number);
    if (handle.type === 'file') await handle.file.close();
    channel.status(id, STATUS_CODE.OK);
  }));
  /**
   * 入口 / Entry: attachHostSftp.callback@187.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（reply）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (reply).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!info.isDirectory()`; `handles.size >= MAX_HANDLES`; 异常 / errors `new AppError('需要目录', 403)`; `new AppError('共享目录打开文件过多', 403)`.
   */
  channel.on('OPENDIR', (id, path) => reply(id, async () => {
    const target = await checked(root, path);
    const info = await lstat(target);
    if (!info.isDirectory()) throw new AppError('需要目录', 403);
    if (handles.size >= MAX_HANDLES) throw new AppError('共享目录打开文件过多', 403);
    grant(id, { type: 'directory', path, entries: await readdir(target), offset: 0 });
  }));
  /**
   * 入口 / Entry: attachHostSftp.callback@194.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（reply）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (reply).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `names.push`.
   * 拒绝 / Refusals: 条件 / conditions `handle.type !== 'directory'`; 异常 / errors `new AppError('共享目录句柄无效', 403)`.
   * 失败处理：catch 分支执行 ，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute ; these statements determine whether a failure is absorbed or rejected again.
   */
  channel.on('READDIR', (id, raw) => reply(id,
  /**
   * 中文功能：从目录句柄继续读取最多 32 个安全条目，隐藏已删除或改为链接的项，返回名称列表或 EOF。
   * English: Continues a directory handle with up to 32 safe entries, hiding deleted/link-replaced items and returning names or EOF.
   * 所属 / Owner: attachHostSftp.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   */
  async () => {
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
  /**
   * 入口 / Entry: attachHostSftp.statPath.
   * 功能：把本层请求转交 `reply`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `reply` and propagates the provider result or rejection.
   * 输入 / Inputs: id: number; path: string
   * 输出 / Returns: `reply(id, async () => channel.attrs(id, attributes(await lstat(await checked(root, path)))))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const statPath = (id: number, path: string) => reply(id, async () =>
    channel.attrs(id, attributes(await lstat(await checked(root, path)))));
  channel.on('STAT', statPath).on('LSTAT', statPath);
  channel.on('REALPATH', (id, path) => reply(id, async () => {
    const target = await checked(root, path);
    const normalized = target === root ? '/' : '/' + target.slice(root.length + 1).split(sep).join('/');
    channel.name(id, [{ filename: normalized, longname: normalized,
      attrs: attributes(await lstat(target)) }]);
  }));
  /**
   * 入口 / Entry: attachHostSftp.callback@219.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（reply）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (reply).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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

/**
 * 入口 / Entry: serveHostMount.
 * 功能：在通过受控 SFTP 服务共享宿主目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ port: address.port, hostPublic: hostKeys.public, clientPrivate: clientKeys.private, clientPublic: clientKeys.public, close:…` 供上层消费（`host-mount-sftp.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-mount-sftp.ts`; this entry produces `{ port: address.port, hostPublic: hostKeys.public, clientPrivate: clientKeys.private, clientPublic: clientKeys.public, close:…` for its caller. Module context: Shares controlled host directories over SFTP, validating paths and using temporary SSH identities.
 * 处理：通过 `regularDirectory`, `inline.isDirectory`, `lstat().catch`, `lstat` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `regularDirectory`, `inline.isDirectory`, `lstat().catch`, `lstat`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: root: string; readOnly: boolean
 * 输出 / Returns: `{ port: address.port, hostPublic: hostKeys.public, clientPrivate: clientKeys.private, clientPublic: clientKeys.public, close:…`.
 * 副作用 / Effects: `hostMountNetwork.createServer`; `server.address`; 更新 / updates `root`.
 * 拒绝 / Refusals: 条件 / conditions `!(await lstat(root).catch(() => null))?.isDirectory()`; `parsed instanceof Error`; `!address || typeof address === 'string'`; 异常 / errors `new AppError('宿主共享目录不存在', 400)`; `parsed`.
 */
export async function serveHostMount(root: string, readOnly: boolean) {
  root = await regularDirectory(root);
  if (!(await lstat(root).catch(() => null))?.isDirectory())
    throw new AppError('宿主共享目录不存在', 400);
  const hostKeys = ephemeralSshKeys();
  const clientKeys = ephemeralSshKeys();
  const parsed = utils.parseKey(clientKeys.public);
  if (parsed instanceof Error) throw parsed;
  const connections = new Set<Connection>();
  /**
   * 入口 / Entry: serveHostMount.callback@269.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
   * 输入 / Inputs: client
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `connections.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const sshServer = new Server({ hostKeys: [hostKeys.private] }, (client) => {
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
  const server = hostMountNetwork.createServer((socket) => sshServer.injectSocket(socket));
  sshServer.on('error', () => {});
  server.on('error', () => {});
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); done(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('宿主共享服务端口无效');
  return { port: address.port, hostPublic: hostKeys.public,
    clientPrivate: clientKeys.private, clientPublic: clientKeys.public,
    /**
     * 入口 / Entry: serveHostMount.close.
     * 功能：在通过受控 SFTP 服务共享宿主目录中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`host-mount-sftp.ts`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `host-mount-sftp.ts`; the calls and state transitions below complete the operation. Module context: Shares controlled host directories over SFTP, validating paths and using temporary SSH identities.
     * 处理：通过 `connection.end` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `connection.end`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `connection.end`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    close: async () => {
      for (const connection of connections) connection.end();
      await new Promise<void>((done) => server.close(() => done()));
    } };
}
