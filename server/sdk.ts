import type { ApiDocument } from '../shared/api-document.ts';

export function generateSdk(document: ApiDocument) {
  const operations = Object.fromEntries(
    Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, operation]) => [
        operation.operationId,
        { path, method: method.toUpperCase(), public: operation.security?.length === 0 },
      ]),
    ),
  );
  return (
    `// Generated Sakura ES module. Node.js 22+ or a modern browser. No dependencies.\n// import { SakuraClient } from './sakura-client.mjs';\n// const client = new SakuraClient();\n// const machines = await client.call('core.vms.list');\n// JSON responses are parsed; binary responses return a Response for streaming.\nexport const operations = ${JSON.stringify(operations, null, 2)};\n` +
    String.raw`
export class SakuraApiError extends Error {
  constructor(message, status, code) { super(message); this.name = 'SakuraApiError'; this.status = status; this.code = code; }
}
export class SakuraClient {
  #base; #fetch; #token = '';
  constructor({ baseUrl = __ORIGIN__, fetcher = globalThis.fetch } = {}) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Sakura requires a local HTTP origin');
    this.#base = url.origin; this.#fetch = fetcher;
  }
  async authenticate(signal) {
    const response = await this.#fetch(this.#base + '/api/bootstrap', { cache: 'no-store', redirect: 'error', signal });
    const value = await response.json();
    if (!response.ok) { this.#token = ''; throw new SakuraApiError(value.error || 'Authentication failed', response.status, value.code || 'UNAUTHORIZED'); }
    if (typeof value.token !== 'string' || !value.token) throw new Error('Invalid controller credential');
    this.#token = value.token;
  }
  async login(username, password, signal) {
    const value = await this.request('/api/access/login', {
      method: 'POST', body: { username, password }, signal, authenticated: false,
    });
    if (typeof value?.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token) ||
        !['owner', 'viewer', 'member'].includes(value.principal?.role))
      throw new Error('Invalid account login response');
    this.#token = value.token;
    return value.principal;
  }
  async logout(signal) {
    if (!this.#token) return;
    try { await this.request('/api/access/logout', { method: 'POST', signal }); }
    finally { this.#token = ''; }
  }
  async call(operationId, { path: parameters = {}, query = {}, body, signal, response: result = 'auto' } = {}) {
    if (!Object.hasOwn(operations, operationId)) throw new Error('Unknown operation: ' + operationId);
    const operation = operations[operationId];
    const path = operation.path.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
      const value = parameters[key];
      if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\\/\u0000-\u001f]/.test(value)) throw new Error('Invalid path parameter: ' + key);
      return encodeURIComponent(value);
    });
    return this.request(path, { method: operation.method, query, body, signal, response: result, authenticated: !operation.public });
  }
  async request(path, { method = 'GET', query = {}, body, binary = false, contentType = 'application/octet-stream', signal, response: result = 'auto', authenticated = true } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/api/') || /[?#\\\u0000-\u001f]/.test(path)) throw new Error('Use an /api/ path and a separate query object');
    const url = new URL(path, this.#base);
    if (url.origin !== this.#base || !url.pathname.startsWith('/api/') || url.pathname !== path) throw new Error('Invalid API path');
    method = method.toUpperCase();
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('Unsupported HTTP method');
    if ((method === 'GET' || method === 'HEAD') && body !== undefined) throw new Error('Read requests cannot have a body');
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error('Query values must be scalar');
      url.searchParams.set(key, String(value));
    }
    signal?.throwIfAborted();
    if (authenticated && !this.#token) await this.authenticate(signal);
    signal?.throwIfAborted();
    const headers = authenticated ? { 'X-Sakura-Token': this.#token } : {};
    if (body !== undefined) headers['Content-Type'] = binary ? contentType : 'application/json';
    const response = await this.#fetch(url.href, { method, headers, signal, cache: 'no-store', redirect: 'error', body: body === undefined ? undefined : binary ? body : JSON.stringify(body) });
    if (!response.ok) {
      if (response.status === 401 || response.status === 423) this.#token = '';
      let failure = {}; try { failure = await response.json(); } catch {}
      const message = failure.error || (Array.isArray(failure.errors) ? failure.errors.slice(0, 10).map(error => error.message).filter(Boolean).join('; ') : '') || 'Request failed';
      throw new SakuraApiError(message, response.status, failure.code);
    }
    // Never replay requests after an HTTP rejection, a disconnect, or cancellation.
    if (method === 'HEAD' || response.status === 204) return undefined;
    if (result === 'stream') return response;
    if (result === 'buffer') return response.arrayBuffer();
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    return result === 'json' || mime === 'application/json' || mime?.endsWith('+json') ? response.json() : response;
  }
}
`.replace('__ORIGIN__', JSON.stringify(document.servers[0].url))
  );
}
