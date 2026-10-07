/**
 * 模块职责：启动应用并观察启动失败，将异常报告到控制台且设置进程失败退出码。
 * Module purpose: Starts the application, observes startup rejection and sets a failing process exit code with a console diagnostic.
 */
import { startApplication } from './application.ts';

void startApplication().catch((error) => {
  console.error('Sakura 启动失败：', error);
  process.exitCode = 1;
});
