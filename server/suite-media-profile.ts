import { AppError } from '../shared/errors.ts';
import { mediaWorkerInput, mediaWorkerResult } from '../shared/contracts/media-studio.ts';
import type { SuiteExecutionProfile } from './suite-execution-profile.ts';
export const mediaExecutionProfile: SuiteExecutionProfile = Object.freeze({
  id: 'media',
  consumers: ['official:media-inspect', 'official:media-workers'],
  input: mediaWorkerInput,
  worker: new URL('./suite-media-worker.py', import.meta.url),
  probe:
    'set -eu\npython3 -I -S -c "import subprocess,json,hashlib,tempfile,struct,sys;print(sys.version.split()[0])"\nffmpeg -version | head -1\nffprobe -version | head -1',
  probeResult: (stdout: string) => {
    const lines = stdout.trim().split(/\r?\n/);
    if (
      lines.length !== 3 ||
      !/^3\.12\./.test(lines[0]) ||
      !/^ffmpeg version 8\.0\.1(?:\s|$)/.test(lines[1]) ||
      !/^ffprobe version 8\.0\.1(?:\s|$)/.test(lines[2])
    )
      throw new AppError('需要固定 FFmpeg / ffprobe 8.0.1 和 Python 3.12', 409, 'MEDIA_RUNTIME_NOT_PREPARED');
    return { python: lines[0], ffmpeg: lines[1], ffprobe: lines[2] };
  },
  outcome: (raw: unknown) => mediaWorkerResult.parse(raw).outcome,
  memoryMiB: 2048,
  cpus: 2,
  maximumSeconds: 600,
  maximumInputBytes: 8 * 1024 ** 2 - 4096,
  maximumOutputBytes: 8 * 1024 ** 2,
});
