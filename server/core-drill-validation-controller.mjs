/** 显式监管校验的固定控制器，只冻结自己的事件循环并在 8 秒后退出。
 * Fixed validation controller: freeze only this event loop, then exit after eight seconds. */
process.stdout.write('ready\n');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 8000);
