/** 受控 S3 HTTP 夹具，模拟对象、版本和锁定响应供备份验收使用，不作为真实远端存储证据。
 * Model controlled S3 objects/versions/lock responses for backup acceptance; fixture behavior is not evidence of real remote storage. */
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/** 编码 XML 五种保留字符，避免对象键与桶名破坏夹具响应结构。
 * Escape the five XML reserved characters so object keys/bucket names cannot corrupt fixture responses. */
const escapeXml = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
/** 为响应片段增加 UTF-8 XML 声明，保持 S3 客户端可解析的格式。
 * Prefix response fragments with a UTF-8 XML declaration for S3-client parsing. */
const xml = (value: string) => `<?xml version="1.0" encoding="UTF-8"?>${value}`;

/** A small in-process S3 protocol fixture. It validates the SDK's HTTP flow, not SigV4. */
/** 建立自有回环 S3 夹具与内存对象/分段上传表，支持列举、普通与分段读写和删除；要求签名头形状但不承担生产签名验证，返回观测计数和关闭句柄。
 * Create an owned loopback S3 fixture with in-memory objects/multipart state and list/read/write/delete support; require signature-header shape without production signature validation, returning counters and a close handle. */
export async function mockS3(bucket = 'sakura-test') {
  const objects = new Map<string, Buffer>();
  const uploads = new Map<string, { key: string; parts: Map<number, Buffer> }>();
  let partCount = 0;
  /** 按流收集本地夹具请求体并连接为 Buffer，完整读完后才应用上传状态。
   * Collect the local fixture request stream into a Buffer, applying upload state only after the body is fully read. */
  const readBody = async (request: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };
  /** 用指定状态、XML 正文和附加头结束夹具响应，默认声明 application/xml。
   * Finish a fixture response with the supplied status/XML/extra headers, defaulting to application/xml. */
  const respond = (response: ServerResponse, code: number, body = '', headers: Record<string, string> = {}) => {
    response.writeHead(code, { 'Content-Type': 'application/xml', ...headers });
    response.end(body);
  };
  /** 生成指定 S3 错误代码的 404 XML，用于不存在的桶、对象或上传会话。
   * Return 404 XML with the supplied S3 error code for missing buckets/objects/upload sessions. */
  const missing = (response: ServerResponse, name = 'NoSuchKey') =>
    respond(response, 404, xml(`<Error><Code>${name}</Code><Message>Not found</Message></Error>`));
  const server = createServer(/** 实现内存 S3 夹具的桶列表、对象与分片上传/完成/取消，仅检查 SigV4 头形状；按 bucket/key/uploadId 绑定数据，XML 转义和错误状态供正式客户端协议验证。
 * Implement in-memory S3 bucket listing, objects and multipart upload/complete/abort with SigV4-header shape checks only; bind data by bucket/key/uploadId and escape XML/error statuses for formal-client protocol verification. */ async (request, response) => {
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
    /** 读取实际收到的分段上传次数，供调用方确认大对象走过分段路径。
     * Read the number of received multipart parts so callers can confirm large uploads used the multipart path. */
    get partCount() { return partCount; },
    /** 关闭本夹具监听器并等待完成；server.close 错误拒绝 Promise，避免将未关闭资源报告为成功。
     * Close this fixture listener and await completion; reject server.close errors rather than report unclosed resources as success. */
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
