/** 插件清单只携带路由元数据，正文校验器随领域页面和服务器按需加载。 */
import { http, type PluginManifest } from './plugin-protocol.ts';
export type SuiteRouteMetadata = Readonly<Record<string, boolean>>;
export const suiteMethodPath = (method: string) =>
  method.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
export function suiteRoutes(
  prefix: string,
  domain: string,
  methods: SuiteRouteMetadata,
): PluginManifest['contributes']['routes'] {
  return Object.entries(methods).map(([id, read]) => ({
    id,
    method: 'POST',
    path: `/api/${prefix}-${domain}/${suiteMethodPath(id)}`,
    handler: 'route',
    status: 200,
    policy: {
      access: 'controller',
      roles: ['owner'],
      projectScoped: false,
      identity: 'host',
      maintenance: read ? 'allow' : 'block',
      transport: 'json',
      mutating: !read,
      session: 'required',
      vmLock: 'allow-locked',
      projectBinding: 'none',
      approval: 'none',
      extensionAuth: 'none',
    },
  }));
}
export const suiteHttp = (prefix: string, domain: string) => [http(`/api/${prefix}-${domain}`, ['POST'])];
