/** 启动临时认证控制器供烟雾验收使用，管理独立数据目录、API 请求和关闭清理生命周期。
 * Launch an isolated temporary authenticated controller for smoke checks, managing its data directory/API/guest shutdown and cleanup. */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** A real compiled controller with test-owned state; never uses the user's VMs. */
/** 建立独立临时数据目录和回环端口，启动编译后的真实认证控制器；返回请求、日志、重启和关闭句柄，启动与清理双重失败用 AggregateError 保留。
 * Create isolated temporary state/loopback port and start the compiled authenticated controller; return request/log/restart/close handles, preserving simultaneous startup/cleanup failures in AggregateError. */
export async function startTestController() {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-browser-integration-'));
  await writeFile(
    join(directory, 'plugins.json'),
    JSON.stringify({ schemaVersion: 3, plugins: ['sandbox', 'files', 'snapshots', 'projects'], packs: [] }),
  );
  const listener = createServer();
  await new Promise<void>((done, fail) => listener.listen(0, '127.0.0.1', done).once('error', fail));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((done) => listener.close(() => done()));
  const origin = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined,
    exited: Promise<unknown> | undefined,
    spawnError: Error | undefined,
    token = '',
    output = '';
  /** 对该临时控制器发送带令牌、期限与可选 JSON 的 API 请求，解析成功结果；HTTP 和网络错误附方法/路径帮助定位。
   * Send token-bearing API requests with a deadline/optional JSON to this controller and parse results; HTTP/network failures include method/path diagnostics. */
  const request = async <T = any>(
    path: string,
    method = 'GET',
    body?: unknown,
    timeoutMs = 30000,
  ): Promise<T> => {
    const response = await fetch(origin + '/api' + path, {
      method,
      headers: { 'x-sakura-token': token, 'content-type': 'application/json', connection: 'close' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((error: Error & { cause?: { code?: string } }) => {
      throw new Error(
        `${method} ${path}: ${error.message}${error.cause?.code ? ' (' + error.cause.code + ')' : ''}`,
        { cause: error },
      );
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
    return value;
  };
  /** 清空旧输出并启动独立服务，保留最后 16000 字符诊断；在 30 秒内等待 bootstrap 令牌，提前退出或超时均失败。
   * Reset output and spawn the isolated service, retaining the last 16000 diagnostic characters; wait thirty seconds for the bootstrap token and fail on early exit or timeout. */
  const start = async () => {
    output = '';
    spawnError = undefined;
    child = spawn(process.execPath, ['.sakura-server/index.js'], {
      env: {
        ...process.env,
        SAKURA_DATA_DIR: directory,
        SAKURA_PORT: String(port),
        SAKURA_IMAGE_PATH: resolve('.data/images/alpine-3.23.qcow2'),
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    exited = new Promise((done) => {
      child!.once('exit', (code, signal) => {
        output += `\nController exited: ${JSON.stringify({ code, signal })}\n`;
        done({ code, signal });
      });
      child!.once('error', (error) => {
        spawnError = error;
        done(error);
      });
    });
    child.stdout!.on('data', (data) => {
      output = (output + data).slice(-16000);
    });
    child.stderr!.on('data', (data) => {
      output = (output + data).slice(-16000);
    });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error('Controller exited: ' + output);
      try {
        const response = await fetch(origin + '/api/bootstrap', { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          token = (await response.json()).token;
          return;
        }
      } catch {}
      await delay(150);
    }
    throw new Error('Controller startup timed out: ' + output);
  };
  /** 先通过真实 API 停止本夹具所有运行实例，再终止控制器；等待十秒后仍未退出则升级 SIGKILL，并等待实际退出。
   * Stop all fixture VMs through real APIs before terminating the controller; escalate to SIGKILL after ten seconds and await physical exit. */
  const stop = async () => {
    if (!child || spawnError || child.exitCode !== null || child.signalCode !== null) return;
    // Windows process termination cannot rely on SIGTERM handlers. Stop every
    // test-owned guest through the real API before terminating the controller.
    try {
      const vms = await request<{ id: string; poweredOn: boolean }[]>('/vms');
      for (const vm of vms) if (vm.poweredOn) await request(`/vms/${vm.id}/stop`, 'POST', { force: true });
    } finally {
      child.kill('SIGTERM');
      await Promise.race([exited, delay(10000, undefined, { ref: false })]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
  };
  /** 停止服务后核实目录确在系统临时目录且具有专用前缀，再递归删除；目录边界不符时拒绝清理。
   * Stop the service, verify the directory sits in system temp with the dedicated prefix, then remove it recursively; reject cleanup on boundary mismatch. */
  const close = async () => {
    await stop();
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith('sakura-browser-integration-')
    )
      throw new Error('Test directory boundary violation');
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  try {
    await start();
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'Controller startup and cleanup failed');
    }
    throw error;
  }
  return {
    origin,
    request,
    /** 返回当前保留的服务诊断尾部，供断言失败报告，不读取用户日志。
     * Return the retained service diagnostic tail for failed assertions without reading user logs. */
    logs: () => output,
    /** 按 stop → start 顺序重启同一临时数据目录，刷新 bootstrap 令牌并验证持久状态恢复。
     * Restart the same temporary state via stop then start, refreshing the bootstrap token and exercising persistent recovery. */
    restart: async () => {
      await stop();
      await start();
    },
    close,
  };
}
