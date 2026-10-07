/**
 * 模块职责：过滤只读 RFB 客户端消息，允许协议握手及画面请求，阻止输入事件到达桌面。
 */
import { Transform, type TransformCallback } from 'node:stream';
import { readOnlyRfbPolicy as policy } from '../shared/contracts/websocket.ts';
const [setPixelFormat, setEncodings, framebufferRequest, continuousUpdates, fence] = policy.clientMessageTypes;

/** Forward only RFB setup and framebuffer requests from a read-only client. */
export class ReadOnlyRfb extends Transform {
  private pending = Buffer.alloc(0);
  private stage: 'version' | 'security' | 'init' | 'messages' = 'version';

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    try {
      if (this.pending.length + chunk.length > policy.maxPendingBytes)
        throw new Error('RFB read-only request is too large');
      this.pending = Buffer.concat([this.pending, chunk]);
      while (this.pending.length) {
        let length = 0;
        if (this.stage === 'version') {
          length = 12;
          if (this.pending.length < length) break;
          const banner = this.pending.subarray(0, length).toString('ascii');
          if (!policy.versions.some(version => banner === 'RFB ' + version + '\n'))
            throw new Error('Unsupported RFB version');
        } else if (this.stage === 'security') {
          length = 1;
          if (this.pending[0] !== policy.securityType) throw new Error('Read-only RFB requires no-auth security');
        } else if (this.stage === 'init') {
          length = 1;
          if (this.pending[0] !== 0 && this.pending[0] !== 1)
            throw new Error('Invalid RFB client initialization');
        } else {
          const type = this.pending[0];
          // Input, clipboard, power, resize and unknown extensions fail closed.
          if (type === setPixelFormat) length = 20;
          else if (type === setEncodings) {
            if (this.pending.length < 4) break;
            const count = this.pending.readUInt16BE(2);
            if (count > policy.maxEncodings) throw new Error('Too many RFB encodings');
            length = 4 + 4 * count;
          } else if (type === framebufferRequest || type === continuousUpdates) length = 10;
          else if (type === fence) { // Synchronization fence, never a server request
            if (this.pending.length < 9) break;
            if (this.pending.readUInt32BE(4) & ~policy.fenceFlagsMask || this.pending[8] > policy.maxFencePayloadBytes)
              throw new Error('Invalid read-only RFB fence');
            length = 9 + this.pending[8];
          }
          else throw new Error('RFB client input is forbidden in a shared view');
        }
        if (this.pending.length < length) break;
        let packet = this.pending.subarray(0, length);
        if (this.stage === 'messages' && packet[0] === setEncodings) {
          const values: number[] = [];
          for (let offset = 4; offset < packet.length; offset += 4) {
            const encoding = packet.readUInt32BE(offset);
            // noVNC advertises clipboard support even with viewOnly enabled.
            // Withhold that capability so the guest never starts clipboard exchange.
            if (encoding !== policy.strippedEncoding) values.push(encoding);
          }
          if (values.length !== packet.readUInt16BE(2)) {
            const safe = Buffer.alloc(4 + 4 * values.length);
            safe[0] = setEncodings;
            safe.writeUInt16BE(values.length, 2);
            values.forEach((encoding, index) => safe.writeUInt32BE(encoding, 4 + 4 * index));
            packet = safe;
          }
        }
        this.push(packet);
        this.pending = this.pending.subarray(length);
        if (this.stage === 'version') this.stage = 'security';
        else if (this.stage === 'security') this.stage = 'init';
        else if (this.stage === 'init') this.stage = 'messages';
      }
      callback();
    } catch (error) { callback(error as Error); }
  }
}
