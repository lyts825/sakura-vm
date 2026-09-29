import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error CLI JavaScript modules intentionally have no declaration file.
import { guestArguments, guestExecution } from '../scripts/guest-cli.mjs';

test('CLI scopes commands and shells without interpreting guest arguments as controller options', () => {
  const options = guestArguments('exec', ['--project', '0123456789abcdef', '--timeout', '7', '--',
    'printf', '%s', "a'b $(host)\n--instance"]);
  assert.deepEqual(guestExecution('vm', options), {
    path: '/vms/vm/exec?project=0123456789abcdef',
    body: { command: "'printf' '%s' 'a'\\''b $(host)\n--instance'", timeoutSeconds: 7 },
  });
  assert.deepEqual(guestExecution('vm', guestArguments('exec', ['--instance', '--', 'uname'])), {
    path: '/vms/vm/exec', body: { command: "'uname'", scope: 'instance' },
  });
  assert.deepEqual(guestExecution('vm', guestArguments('exec', ['printf', '--project', 'literal'])), {
    path: '/vms/vm/exec', body: { command: "'printf' '--project' 'literal'" },
  });
  assert.equal(guestArguments('shell', ['--project', 'default']).project, 'default');
  for (const args of [['--instance', '--project', 'default', '--', 'true'], ['--project', '../guest', 'true'],
    ['--timeout', '0', 'true'], ['--timeout', '3601', 'true'], ['--timeout', '1.5', 'true'],
    ['--project', 'default', '--project', 'default', 'true'], ['--instance', '--instance', 'true'], []])
    assert.throws(() => guestArguments('exec', args));
  assert.throws(() => guestArguments('shell', ['--instance']));
  assert.throws(() => guestArguments('shell', ['--project', 'default', 'unexpected']));
});
