import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
const xml = (value: string) => `<?xml version="1.0" encoding="UTF-8"?>${value}`;

/** A small in-process S3 protocol fixture. It validates the SDK's HTTP flow, not SigV4. */
export async function mockS3(bucket = 'sakura-test') {
  const objects = new Map<string, Buffer>();
  const uploads = new Map<string, { key: string; parts: Map<number, Buffer> }>();
  let partCount = 0;
  const readBody = async (request: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };
  const respond = (response: ServerResponse, code: number, body = '', headers: Record<string, string> = {}) => {
    response.writeHead(code, { 'Content-Type': 'application/xml', ...headers });
    response.end(body);
  };
  const missing = (response: ServerResponse, name = 'NoSuchKey') =>
    respond(response, 404, xml(`<Error><Code>${name}</Code><Message>Not found</Message></Error>`));
  const server = createServer(async (request, response) => {
    try {
      if (!request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')) {
        respond(response, 403); return;
      }
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      const [requestedBucket, ...segments] = url.pathname.slice(1).split('/');
      const key = decodeURIComponent(segments.join('/'));
      if (requestedBucket !== bucket) { missing(response, 'NoSuchBucket'); return; }
      if (!key) {
        if (request.method === 'HEAD') { respond(response, 200); return; }
        if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
          const prefix = url.searchParams.get('prefix') || '';
          const keys = [...objects.keys()].filter((item) => item.startsWith(prefix)).sort();
          const entries = keys.map((item) => `<Contents><Key>${escapeXml(item)}</Key>` +
            `<Size>${objects.get(item)!.length}</Size><ETag>"fixture"</ETag></Contents>`).join('');
          respond(response, 200, xml(`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
            `<Name>${bucket}</Name><Prefix>${escapeXml(prefix)}</Prefix><KeyCount>${keys.length}</KeyCount>` +
            `<MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${entries}</ListBucketResult>`));
          return;
        }
      }
      if (request.method === 'POST' && url.searchParams.has('uploads')) {
        const id = randomUUID();
        uploads.set(id, { key, parts: new Map() });
        respond(response, 200, xml(`<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket>` +
          `<Key>${escapeXml(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`));
        return;
      }
      const uploadId = url.searchParams.get('uploadId');
      if (uploadId) {
        const upload = uploads.get(uploadId);
        if (!upload || upload.key !== key) { missing(response, 'NoSuchUpload'); return; }
        if (request.method === 'PUT') {
          const part = Number(url.searchParams.get('partNumber'));
          if (!Number.isInteger(part) || part < 1) { respond(response, 400); return; }
          const data = await readBody(request);
          upload.parts.set(part, data); partCount++;
          respond(response, 200, '', { ETag: `"${createHash('md5').update(data).digest('hex')}"` });
          return;
        }
        if (request.method === 'POST') {
          await readBody(request);
          objects.set(key, Buffer.concat([...upload.parts].sort(([a], [b]) => a - b).map(([, data]) => data)));
          uploads.delete(uploadId);
          respond(response, 200, xml(`<CompleteMultipartUploadResult><Bucket>${bucket}</Bucket>` +
            `<Key>${escapeXml(key)}</Key><ETag>"fixture"</ETag></CompleteMultipartUploadResult>`));
          return;
        }
        if (request.method === 'DELETE') { uploads.delete(uploadId); respond(response, 204); return; }
      }
      if (request.method === 'PUT') {
        objects.set(key, await readBody(request));
        respond(response, 200, '', { ETag: '"fixture"' }); return;
      }
      if (request.method === 'DELETE') { objects.delete(key); respond(response, 204); return; }
      const data = objects.get(key);
      if (!data) { missing(response); return; }
      if (request.method === 'HEAD') {
        respond(response, 200, '', { 'Content-Length': String(data.length) }); return;
      }
      if (request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'application/octet-stream',
          'Content-Length': String(data.length) });
        response.end(data); return;
      }
      respond(response, 405);
    } catch (error) {
      respond(response, 500, xml(`<Error><Code>InternalError</Code><Message>${escapeXml(String(error))}</Message></Error>`));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture address');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    objects,
    get partCount() { return partCount; },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
