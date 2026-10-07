/**
 * 模块职责：启动 HTTP 监听并管理监听阶段的错误与取消，避免未就绪服务遗留监听句柄。
 */
import type { Server } from 'node:http';

/** Make binding failures part of application startup and its cleanup path. */
export function listenHttpServer(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off('error', failed);
      server.off('listening', ready);
    };
    const failed = (error: Error) => {
      cleanup();
      reject(error);
    };
    const ready = () => {
      cleanup();
      resolve();
    };
    server.once('error', failed);
    server.once('listening', ready);
    try {
      server.listen(port, host);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
