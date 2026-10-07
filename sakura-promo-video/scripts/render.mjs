/** 最终视频与封面渲染入口，预检音频/Manim 资源并核对场景连续帧时间线，将渲染日志保存在本地缓存。
 * Preflight audio/Manim assets and continuous frame timing before final film/cover renders, retaining local-cache logs. */
import {spawn} from 'node:child_process';
import {access, mkdir, readFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
const coverOnly = process.argv.includes('--cover-only');
const logPath = join(root, '.cache', 'render.log');
await mkdir(join(root, '.cache'), {recursive: true});
await mkdir(join(root, 'deliverables'), {recursive: true});
if (!coverOnly) {
  for (const asset of ['manim/kernel-flow.mp4', 'manim/recovery-flow.mp4', 'manim/project-isolation.mp4', 'audio/narration.wav', 'audio/soundtrack.wav', 'audio/transcript.json']) {
    await access(join(root, 'public', asset));
  }
}
/** 启动 Remotion CLI，把输出追加到同一渲染日志并等待进程关闭；启动失败或非零退出抛错，后者附最后 35 行供诊断。
 * Launch the Remotion CLI, append both output streams to the render log and await process closure; spawn failures and nonzero exits throw, with the latter including the last 35 log lines. */
const run = async (args) => {
  const log = createWriteStream(logPath, {flags: 'a'});
  const child = spawn(process.execPath, [cli, ...args], {cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  log.end();
  if (code !== 0) {
    const tail = (await readFile(logPath, 'utf8')).split(/\r?\n/).slice(-35).join('\n');
    throw new Error(`Remotion exited with code ${code}.\n${tail}`);
  }
};
if (!coverOnly) {
  const transcript = JSON.parse(await readFile(join(root, 'public', 'audio', 'transcript.json'), 'utf8'));
  const storyboard = JSON.parse(await readFile(join(root, 'STORYBOARD.json'), 'utf8'));
  let expectedFrom = 0;
  // 最终导出只接受从零连续拼接的实际旁白帧，预览用的目标时长不能充当交付时间线。
  for (const scene of storyboard.scenes) {
    const timing = transcript.scenes.find(({id}) => id === scene.id);
    if (!timing || timing.from !== expectedFrom || !Number.isInteger(timing.durationInFrames) || timing.durationInFrames <= 0) {
      throw new Error(`Final audio timing is missing or inconsistent for scene ${scene.id}. Regenerate narration before rendering.`);
    }
    expectedFrom += timing.durationInFrames;
  }
  if (transcript.durationInFrames !== expectedFrom) throw new Error('Transcript total duration does not match its scene timeline.');
  console.log(`Rendering SakuraPromo: 1920 × 1080 / 30fps / ${expectedFrom} frames / ${(expectedFrom / 30).toFixed(3)}s. Progress log: .cache/render.log`);
  await run(['render', 'src/index.ts', 'SakuraPromo', 'deliverables/sakura-intro-extended-1080p.mp4', '--codec=h264', '--audio-codec=aac', '--pixel-format=yuv420p', '--color-space=bt709', '--crf=18', '--concurrency=4', '--overwrite']);
  console.log('Saved deliverables/sakura-intro-extended-1080p.mp4');
}
console.log('Rendering the cover.');
await run(['still', 'src/index.ts', 'SakuraCover', 'deliverables/sakura-intro-extended-cover.png', '--image-format=png', '--overwrite']);
console.log('Saved deliverables/sakura-intro-extended-cover.png');
