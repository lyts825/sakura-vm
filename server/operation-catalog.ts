import type { z } from 'zod';
import contracts from '../docs/schemas/operations.json' with { type: 'json' };
import type { OperationDeclaration, OperationRole } from '../shared/contracts/operations.ts';
import { coreOperations, coreRequestSchema } from './core-operations.ts';
import { pluginHttpRoutes } from './plugins/registry.ts';

export type OperationEntry = {
  declaration: OperationDeclaration;
  title: string;
  requestSchema?: z.ZodType;
  body?: Record<string, unknown>;
  response?: Record<string, unknown>;
  status: number;
  media?: string;
  inspect?: boolean;
};
const allRoles: OperationRole[] = ['owner', 'member', 'viewer'];
const roles: Record<string, OperationRole[]> = {
  'access.ssoView': allRoles, 'access.ssoUnlink': allRoles,
  'access.logout': allRoles, 'access.handoffCreate': allRoles, 'access.handoffCancel': allRoles,
  'access.passkeys': allRoles, 'access.passkeyRegisterOptions': allRoles,
  'access.passkeyRegisterVerify': allRoles, 'access.passkeyRemove': allRoles,
  'access.view': ['owner', 'viewer'], 'access.projects': ['member'],
  'access.terminalShares': ['owner', 'viewer'],
  'access.jitList': ['owner', 'viewer'], 'access.jitCreate': ['viewer'], 'access.jitExecute': ['viewer'],
  'access.changes': ['owner', 'member'], 'access.createChange': ['owner', 'member'],
  'access.decideChange': ['owner', 'member'], 'access.applyChange': ['owner', 'member'],
};
// These are the existing explicitly granted project routes, independent of HTTP method safety.
export const projectRoutePermissions: Record<string, Partial<Record<string, OperationDeclaration['projectPermission']>>> = {
  project: { GET: 'read', PUT: 'write', POST: 'execute' }, 'project-runtime': { GET: 'read' },
  'project-files': { GET: 'read' }, git: { GET: 'read', POST: 'execute' }, health: { GET: 'read' },
};
const normalize = (path: string) => path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
const lifecycle = (path: string) => /\/(?:start|stop|suspend|resume|restore|advanced|next-features|projects)$/.test(path);
const binary = (path: string, method: string) => ['/api/import', '/api/image-import'].includes(path) ||
  (path.endsWith('/transfer') && ['GET', 'PUT'].includes(method)) ||
  (path.endsWith('/uploads') && method === 'PUT');
function descriptor(id: string, owner: string, method: string, path: string, projectScoped: boolean,
  declared: boolean, publicEndpoint = false): OperationDeclaration {
  const permission = owner !== 'core' && projectScoped ? projectRoutePermissions[path.split('/').at(-1)!]?.[method] : undefined;
  const access = id === 'core.download' ? 'download-ticket' : id.startsWith('core.extension.') ? 'extension' :
    id === 'core.guest.interop' ? 'guest' : publicEndpoint ? 'public' : 'controller';
  return {
    id, owner, method: method as OperationDeclaration['method'], path: normalize(path), access,
    roles: access !== 'controller' ? [] : permission ? ['owner', 'member'] :
      owner === 'core' ? roles[id.slice(5)] || ['owner'] : ['owner'],
    ...(permission ? { projectPermission: permission } : {}), projectScoped,
    identity: !path.includes('vmId') ? 'host' : lifecycle(path) || !projectScoped ? 'lifecycle' : 'fixed-vm',
    maintenance: method === 'GET' && !/(?:notebook-link|browser-ide-link|export)$/.test(path) ||
      path === '/api/migration' || method === 'OPTIONS' || id === 'core.jobs.cancel' ||
      ['core.session.status', 'core.session.unlock', 'core.session.passkeyOptions', 'core.session.passkeyVerify',
        'core.access.status', 'core.access.login', 'core.access.handoffRedeem', 'core.access.passkeyLoginOptions',
        'core.access.ssoOidcCallback', 'core.access.ssoSamlCallback'].includes(id) ||
      ['core.session.lock', 'core.session.activity', 'core.access.logout'].includes(id) ? 'allow' : 'block',
    transport: id === 'core.access.ssoSamlCallback' ? 'form' : access === 'download-ticket' || binary(path, method) ? 'binary' : 'json',
    contract: declared ? 'declared' : 'partial', enabled: owner === 'core',
  };
}

export const operationEntries: readonly OperationEntry[] = [
  ...coreOperations.map((item): OperationEntry => ({
    declaration: descriptor('core.' + item.id, 'core', item.method, item.path, !!item.projectScoped, !!item.response, !!item.public),
    title: item.title, requestSchema: coreRequestSchema(item.body) || undefined,
    body: item.body, response: item.response, status: item.status || 200, media: item.media, inspect: item.inspect,
  })),
  ...pluginHttpRoutes().flatMap((route) => route.methods.map((method): OperationEntry => {
    const typed = Object.entries(contracts).find(([id, item]) => id.startsWith(route.owner + '.') &&
      normalize(item.path) === normalize(route.path) && item.method === method);
    const id = typed?.[0] || `${route.owner}.legacy.${method.toLowerCase()}.${normalize(route.path).replace(/^\/api\//, '').replace(/[{}]/g, '').replaceAll('/', '.')}`;
    return { declaration: descriptor(id, route.owner, method, route.path, route.projectScoped, !!typed),
      title: typed ? route.owner + ' · ' + typed[1].id : route.owner + ' · ' + method + ' ' + route.path,
      ...(typed?.[1].request ? { body: typed[1].request } : {}), response: typed?.[1].response,
      status: typed?.[1].status || 200, inspect: id === 'metrics.sample' };
  })),
  ...['events', '{vmId}/terminal', '{vmId}/terminal-view', '{vmId}/logs', '{vmId}/desktop', '{vmId}/desktop-view'].map((path): OperationEntry => ({
    declaration: { id: 'core.socket.' + path.split('/').at(-1), owner: 'core', method: 'UPGRADE', path: '/ws/' + path,
      access: 'socket', roles: path.endsWith('-view') ? ['owner', 'viewer'] : ['owner'],
      projectScoped: /terminal|desktop/.test(path), identity: path === 'events' ? 'host' : 'fixed-vm',
      maintenance: path === 'events' || path.endsWith('/logs') ? 'allow' : 'block',
      transport: 'websocket', contract: 'partial', enabled: true }, title: 'WebSocket ' + path, status: 101,
  })),
];

const keys = new Set<string>(), ids = new Set<string>();
for (const { declaration } of operationEntries) {
  const key = declaration.method + ' ' + declaration.path;
  if (keys.has(key) || ids.has(declaration.id)) throw new Error('重复操作声明：' + key);
  keys.add(key); ids.add(declaration.id);
}

export function operationDirectory(active: Iterable<string>) {
  const enabled = new Set(active);
  return operationEntries.map(({ declaration }) => ({ ...declaration,
    enabled: declaration.owner === 'core' || enabled.has(declaration.owner) }));
}
