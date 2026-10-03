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
