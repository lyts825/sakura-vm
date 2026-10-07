/**
 * 模块职责：“Linux 图形桌面”插件的有类型服务引用（desktops、jobs、x11Clipboard、waylandClipboard），把服务名称与运行时契约绑定，供依赖插件通过宿主获取。
 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  desktops: serviceRef('desktop', 'desktops', serviceContracts.Desktops),
  jobs: serviceRef('desktop', 'jobs', serviceContracts.Jobs),
  x11Clipboard: serviceRef('desktop', 'x11Clipboard', serviceContracts.X11Clipboard),
  waylandClipboard: serviceRef('desktop', 'waylandClipboard', serviceContracts.WaylandClipboard),
};
