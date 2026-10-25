/** Bridge Node's Web API objects without using its bundled fetch implementation. */
import {
  fetch as patchedFetch,
  Request as FetchRequest,
  FormData as FetchFormData,
  type Agent,
  type RequestInit as FetchInit,
} from 'undici';

const requestBodyError = (detail: string, cause?: unknown) =>
  Object.assign(new TypeError(`${detail}; pass the URL and original body in fetch init instead`, { cause }), {
    code: 'NETWORK_REQUEST_BODY_NOT_REPLAYABLE',
  });

export async function fetchWithDispatcher(
  input: Parameters<typeof globalThis.fetch>[0],
  init: RequestInit,
  agent: Agent,
): Promise<Response> {
  let target: string | URL | FetchRequest = input as string | URL | FetchRequest;
  let options = { ...init } as FetchInit;
  let nativeBody = false;

  if (input instanceof Request && !(input instanceof FetchRequest)) {
    // The public Request API exposes only a stream, not its original replayable source.
    // Transfer ownership using its constructor so used/locked bodies and overrides keep
    // their native checks. Never inspect private slots or buffer an arbitrary upload.
    const request = new Request(input, init);
    nativeBody = request.body !== null;
    if (nativeBody && request.keepalive)
      throw requestBodyError('An encapsulated native Request body cannot use keepalive');
    target = request.url;
    options = {
      method: request.method,
      headers: [...request.headers],
      body: request.body as FetchInit['body'],
      cache: request.cache,
      credentials: request.credentials,
      integrity: request.integrity,
      keepalive: request.keepalive,
      mode: request.mode,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      signal: request.signal,
      ...(nativeBody ? { duplex: 'half' as const } : {}),
    };
  } else {
    if (init.headers !== undefined) options.headers = [...new Headers(init.headers)];
    if (init.body instanceof FormData && !(init.body instanceof FetchFormData)) {
      const body = new FetchFormData();
      for (const [name, value] of init.body) body.append(name, value);
      options.body = body;
    }
  }

  let replayRejected = false;
  const dispatcher =
    nativeBody && options.redirect === 'follow'
      ? agent.compose((dispatch) => (request, handler) => {
          const onResponseStart = handler.onResponseStart;
          if (onResponseStart)
            handler.onResponseStart = function (controller, status, headers, statusText) {
              if (request.body != null && headers.location !== undefined) {
                if ([301, 302].includes(status) && request.method === 'POST') {
                  // Both statuses must discard a POST body just like 303. This avoids
                  // undici rejecting the bridged stream before applying that rule.
                  status = 303;
                } else if ([301, 302, 307, 308].includes(status)) replayRejected = true;
              }
              return onResponseStart.call(this, controller, status, headers, statusText);
            };
          return dispatch(request, handler);
        })
      : agent;
  try {
    // DOM and undici declare separate Web API types; the bridge above handles the
    // incompatible Request/FormData brands while Blob and streams are shared by Node.
    return (await patchedFetch(target, { ...options, dispatcher })) as unknown as Response;
  } catch (error) {
    if (replayRejected && !options.signal?.aborted)
      throw requestBodyError('A redirect cannot replay an encapsulated native Request body', error);
    throw error;
  }
}
