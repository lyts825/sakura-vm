import { startApplication } from './application.ts';

void startApplication().catch((error) => {
  console.error('Sakura 启动失败：', error);
  process.exitCode = 1;
});
