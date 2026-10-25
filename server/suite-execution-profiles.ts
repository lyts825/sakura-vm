/** 独立固定工具档案；消费者不能换工具、依赖探针或输入 schema。 */
import { browserWorkerManifest, browserToolResult } from '../shared/contracts/browser-lab.ts';
import { databaseWorkerInput, databaseWorkerResult } from '../shared/contracts/database-evolution.ts';
import { eventWorkerInput, eventWorkerOutput } from '../shared/contracts/suite-execution-event.ts';
import { learningWorkerInput, learningWorkerOutput } from '../shared/contracts/suite-execution-learning.ts';
import type { SuiteExecutionProfile } from './suite-execution-profile.ts';
import { AppError } from '../shared/errors.ts';
const max = 8 * 1024 ** 2;
function versions(stdout: string) {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length || lines.some((line) => line.length > 256))
    throw new AppError('固定依赖探针未返回有效版本', 409, 'SUITE_EXECUTION_PROBE_FAILED');
  return Object.fromEntries(lines.map((value, i) => ['dependency' + i, value]));
}
export const browserExecutionProfile: SuiteExecutionProfile = Object.freeze({
  id: 'browser',
  consumers: ['official:browser-runners'],
  input: browserWorkerManifest,
  worker: new URL('./suite-browser-worker.py', import.meta.url),
  probe:
    'set -eu\ncommand -v python3 >/dev/null\npython3 -I -S -c "import socket,json,http.server,subprocess,ssl;import sys;print(sys.version.split()[0])"\nif command -v chromium >/dev/null; then chromium --version; else chromium-browser --version; fi\ntest -d /usr/share/fonts\nfind /usr/share/fonts -type f | head -1 | grep . >/dev/null',
  probeResult: versions,
  outcome: (value: unknown) => {
    const output = browserToolResult.parse(value);
    if (
      output.observations.some(
        (step) => step.status === 'failed' || step.assertions.some((rule) => !rule.passed),
      )
    )
      return 'failed';
    return output.completed && !output.error && !output.accessibilityTruncated
      ? output.accessibility.length
        ? 'failed'
        : 'passed'
      : 'inconclusive';
  },
  memoryMiB: 2048,
  cpus: 2,
  maximumSeconds: 900,
  maximumInputBytes: max - 4096,
  maximumOutputBytes: max,
});
export const databaseExecutionProfile: SuiteExecutionProfile = Object.freeze({
  id: 'database',
  consumers: ['official:database-fixtures'],
  input: databaseWorkerInput,
  worker: new URL('./suite-database-worker.py', import.meta.url),
  probe:
    'set -eu\nfor t in python3 postgres initdb pg_ctl psql; do command -v "$t" >/dev/null; done\npython3 -I -S -c "import subprocess,json,hashlib,tempfile,datetime;import sys;print(sys.version.split()[0])"\npostgres --version',
  probeResult: (stdout: string) => {
    if (!/PostgreSQL\) 17\.11(?:\s|$)/.test(stdout))
      throw new AppError(
        '固定档案需要已验证的 PostgreSQL 17.11',
        409,
        'SUITE_EXECUTION_RUNTIME_NOT_PREPARED',
      );
    return versions(stdout);
  },
  outcome: (value: unknown) => {
    const outcome = databaseWorkerResult.parse(value).outcome;
    return outcome === 'passed' || outcome === 'failed' ? outcome : 'inconclusive';
  },
  memoryMiB: 2048,
  cpus: 2,
  maximumSeconds: 900,
  maximumInputBytes: max - 4096,
  maximumOutputBytes: max,
});
export const eventExecutionProfile: SuiteExecutionProfile = Object.freeze({
  id: 'event',
  consumers: ['official:event-brokers'],
  input: eventWorkerInput,
  worker: new URL('./suite-event-worker.py', import.meta.url),
  probe:
    'set -eu\ncommand -v python3 >/dev/null\npython3 -I -S -c "import sqlite3,multiprocessing,json,sys;print(sys.version.split()[0]);print(sqlite3.sqlite_version)"',
  probeResult: versions,
  outcome: (value: unknown) => eventWorkerOutput.parse(value).outcome,
  memoryMiB: 1024,
  cpus: 1,
  maximumSeconds: 900,
  maximumInputBytes: 2 * 1024 ** 2,
  maximumOutputBytes: max,
});
export const learningExecutionProfile: SuiteExecutionProfile = Object.freeze({
  id: 'learning',
  consumers: ['official:learning-sessions'],
  input: learningWorkerInput,
  worker: new URL('./suite-learning-worker.py', import.meta.url),
  probe:
    'set -eu\ncommand -v python3 >/dev/null\npython3 -I -S -c "import pathlib,http.client,http.server,threading,json,hashlib;import sys;print(sys.version.split()[0])"',
  probeResult: versions,
  outcome: (value: unknown) => learningWorkerOutput.parse(value).outcome,
  memoryMiB: 1024,
  cpus: 1,
  maximumSeconds: 900,
  maximumInputBytes: max - 4096,
  maximumOutputBytes: max,
});
