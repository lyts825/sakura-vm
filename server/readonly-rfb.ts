import { Transform, type TransformCallback } from 'node:stream';

/** Forward only RFB setup and framebuffer requests from a read-only client. */
export class ReadOnlyRfb extends Transform {
  private pending = Buffer.alloc(0);
  private stage: 'version' | 'security' | 'init' | 'messages' = 'version';

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    try {
      if (this.pending.length + chunk.length > 64 * 1024)
        throw new Error('RFB read-only request is too large');
      this.pending = Buffer.concat([this.pending, chunk]);
      while (this.pending.length) {
        let length = 0;
        if (this.stage === 'version') {
          length = 12;
          if (this.pending.length < length) break;
          if (!/^RFB 003\.00[78]\n$/.test(this.pending.subarray(0, length).toString('ascii')))
            throw new Error('Unsupported RFB version');
        } else if (this.stage === 'security') {
          length = 1;
          if (this.pending[0] !== 1) throw new Error('Read-only RFB requires no-auth security');
        } else if (this.stage === 'init') {
          length = 1;
          if (this.pending[0] !== 0 && this.pending[0] !== 1)
            throw new Error('Invalid RFB client initialization');
        } else {
          const type = this.pending[0];
          // Input, clipboard, power, resize and unknown extensions fail closed.
          if (type === 0) length = 20; // SetPixelFormat
          else if (type === 2) { // SetEncodings
            if (this.pending.length < 4) break;
            const count = this.pending.readUInt16BE(2);
            if (count > 256) throw new Error('Too many RFB encodings');
            length = 4 + 4 * count;
          } else if (type === 3 || type === 150) length = 10; // Framebuffer requests
          else if (type === 248) { // Synchronization fence, never a server request
            if (this.pending.length < 9) break;
            if (this.pending.readUInt32BE(4) & ~3 || this.pending[8] > 64)
              throw new Error('Invalid read-only RFB fence');
            length = 9 + this.pending[8];
          }
          else throw new Error('RFB client input is forbidden in a shared view');
        }
        if (this.pending.length < length) break;
        let packet = this.pending.subarray(0, length);
        if (this.stage === 'messages' && packet[0] === 2) {
          const values: number[] = [];
          for (let offset = 4; offset < packet.length; offset += 4) {
            const encoding = packet.readUInt32BE(offset);
            // noVNC advertises clipboard support even with viewOnly enabled.
            // Withhold that capability so the guest never starts clipboard exchange.
            if (encoding !== 0xc0a1e5ce) values.push(encoding);
          }
          if (values.length !== packet.readUInt16BE(2)) {
            const safe = Buffer.alloc(4 + 4 * values.length);
            safe[0] = 2;
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
