/** 通过真实 WebSocket/RFB 握手验证自有桌面的 VNC 密码接受和拒绝结果，限制协议阶段与超时。
 * Verify VNC password acceptance/refusal through real WebSocket/RFB handshakes with bounded phases and deadlines. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

/** A real RFB 3.8 client: password authentication and a raw framebuffer request. */
/** 打开并登记自有 WebSocket，以真实 RFB 3.8/VNC 密码握手验证接受或拒绝；接受时检查帧格式与桌面尺寸。累计输入限制 8 MiB，最终等待实际关闭并返回协议证据。
 * Open/register an owned WebSocket and perform real RFB 3.8/VNC-password authentication for expected acceptance/rejection; accepted sessions verify pixel format/dimensions. Bound input to eight MiB and await physical close before returning protocol evidence. */
export async function probeOwnedDesktopRfb(url: string, password: string, accept: boolean,
  observe: (socket: WebSocket) => void) {
  const socket = new WebSocket(url); observe(socket);
  let received = Buffer.alloc(0), ended = false, frames = 0, bytes = 0;
  const errors: string[] = [];
  const closed = new Promise<void>((done) => socket.once('close', () => { ended = true; done(); }));
  socket.on('message', (data, binary) => {
    if (!binary) { errors.push('RFB transport produced a text frame'); socket.terminate(); return; }
    const value = Buffer.from(data as Buffer); frames++; bytes += value.length;
    if (received.length + value.length > 8 * 1048576) { errors.push('RFB read budget exceeded'); socket.terminate(); return; }
    received = Buffer.concat([received, value]);
  });
  socket.on('error', (error) => { errors.push(error.message); });
  /** 从累积 RFB 字节流取出指定长度，最多 4 MiB、等待十秒；流关闭、传输错误或超时立即失败，成功消费前缀避免重复读取。
   * Consume the requested prefix from buffered RFB bytes, limited to four MiB/ten seconds; fail on closure/transport errors/timeout and remove consumed bytes. */
  async function read(length: number) {
    assert.ok(length >= 0 && length <= 4 * 1048576);
    const until = Date.now() + 10000;
    while (received.length < length) {
      if (ended || errors.length || Date.now() > until) throw new Error('Owned RFB stream ended or timed out: ' + errors.join('; '));
      await delay(10);
    }
    const value = received.subarray(0, length); received = received.subarray(length); return value;
  }
  const result: any = { authenticationAccepted: false, onlyVncPasswordAuthentication: false, binaryFrames: 0, binaryBytes: 0, physicallyClosed: false };
  try {
    assert.equal((await read(12)).toString(), 'RFB 003.008\n'); socket.send(Buffer.from('RFB 003.008\n'));
    const count = (await read(1))[0]; assert.deepEqual([...await read(count)], [2]);
    result.onlyVncPasswordAuthentication = true; socket.send(Buffer.from([2]));
    const challenge = await read(16);
    const { DESECBCipher } = await import(new URL('../node_modules/@novnc/novnc/core/crypto/des.js', import.meta.url).href);
    const cipher = DESECBCipher.importKey(Buffer.from(password), {}, false, ['encrypt']);
    socket.send(cipher.encrypt({}, challenge));
    const code = (await read(4)).readUInt32BE(); assert.equal(code === 0, accept);
    result.authenticationAccepted = code === 0; result.authenticationResult = code;
    if (accept) {
      socket.send(Buffer.from([1])); const init = await read(24);
      const width = init.readUInt16BE(), height = init.readUInt16BE(2), bpp = init[4];
      assert.equal(width, 1024); assert.equal(height, 768); assert.equal(bpp, 32); assert.equal(init[7], 1);
      const name = await read(init.readUInt32BE(20)); result.serverNameSha256 = createHash('sha256').update(name).digest('hex');
      // Raw encoding only; a one-pixel nonincremental request is enough to
      // prove authenticated binary pixel transport without a screenshot cache.
      socket.send(Buffer.from([2, 0, 0, 1, 0, 0, 0, 0]));
      socket.send(Buffer.from([3, 0, 0, 0, 0, 0, 0, 1, 0, 1]));
      const type = (await read(1))[0]; assert.equal(type, 0);
      const header = await read(3), rectangles = header.readUInt16BE(1);
      assert.ok(rectangles > 0 && rectangles <= 64);
      let pixels = 0;
      for (let index = 0; index < rectangles; index++) {
        const rectangle = await read(12), w = rectangle.readUInt16BE(4), h = rectangle.readUInt16BE(6);
        assert.equal(rectangle.readInt32BE(8), 0); assert.ok(w > 0 && h > 0 && w <= width && h <= height);
        const pixelData = await read(w * h * bpp / 8); pixels += pixelData.length;
      }
      assert.ok(pixels > 0); result.framebuffer = { width, height, bitsPerPixel: bpp, rectangles, actualPixelBytes: pixels };
    }
  } finally {
    if (!ended) socket.terminate();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Owned RFB socket physical close missing')), 10000); })]); }
    finally { if (timer) clearTimeout(timer); }
    result.physicallyClosed = ended; result.binaryFrames = frames; result.binaryBytes = bytes;
  }
  return result;
}
