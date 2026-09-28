import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import socket
import threading
import time
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
source = Path(__file__).resolve().parents[1] / 'server/engineering-runner.py'
spec = importlib.util.spec_from_file_location('capability_runner', source)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class Capabilities(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='sakura-capability-test-')
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def write(self, name, value):
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(value, encoding='utf-8')
        return file

    def execute(self, operation, **parameters):
        return runner.capability_execute(self.root, operation, parameters)

    def test_network_diagnostics_probe_real_dns_tcp_tls_failure_and_closed_port(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
            listener.listen(4)
            listener.settimeout(5)

            def refuse_tls():
                for _ in range(2):
                    connection, _ = listener.accept()
                    with connection:
                        connection.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n')

            worker = threading.Thread(target=refuse_tls, daemon=True)
            worker.start()
            result = self.execute('network-diagnostics', target='localhost', port=port,
                                  probes=['dns', 'tcp', 'https'], timeout=3)
            worker.join(6)
            self.assertFalse(worker.is_alive())
            self.assertEqual([row['code'] for row in result['results']], [0, 0, 1], result)
            self.assertEqual(result['code'], 1)
            self.assertIn('127.0.0.1', result['results'][0]['addresses'])
            self.assertNotIn('HTTP/1.1', json.dumps(result))
        closed = self.execute('network-diagnostics', target='127.0.0.1', port=port, probes=['tcp'], timeout=2)
        self.assertEqual(closed['code'], 1)

    def test_network_diagnostics_deadline_terminates_stalled_https(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen(1)
            listener.settimeout(4)
            release = threading.Event()

            def stall():
                connection, _ = listener.accept()
                with connection:
                    release.wait(4)

            worker = threading.Thread(target=stall, daemon=True)
            worker.start()
            started = time.monotonic()
            try:
                result = self.execute('network-diagnostics', target='127.0.0.1', port=listener.getsockname()[1],
                                      probes=['https'], timeout=1)
                self.assertEqual(result['code'], 1)
                self.assertLess(time.monotonic() - started, 3)
            finally:
                release.set()
                worker.join(5)

    @unittest.skipUnless(shutil.which('ip'), 'requires Linux iproute2 or BusyBox ip')
    def test_network_diagnostics_resolves_a_real_local_route(self):
        result = self.execute('network-diagnostics', target='127.0.0.1', probes=['route'], timeout=3)
        self.assertEqual(result['code'], 0, result)
        self.assertIn('127.0.0.1', result['results'][0]['routes'][0]['output'])

    def test_dependency_graph_resolves_nested_and_shared_packages_without_running_scripts(self):
        self.write('package.json', '{"name":"fixture"}')
        lock = dict(name='fixture', lockfileVersion=3, packages={
            '': dict(dependencies={'a': '^1', 'b': '^2'}),
            'node_modules/a': dict(version='1.0.0', dependencies={'b': '^1', 'optional-missing': '^1'}),
            'node_modules/b': dict(version='2.0.0'),
            'node_modules/a/node_modules/b': dict(version='1.2.0')})
        self.write('package-lock.json', json.dumps(lock))
        report = self.execute('dependency-report', manager='auto', updates=False)
        self.assertEqual(len(report['nodes']), 4)
        edge = next(item for item in report['edges'] if item['source'] == 'node_modules/a' and item['name'] == 'b')
        self.assertEqual(edge['target'], 'node_modules/a/node_modules/b')
        self.assertIsNone(next(item for item in report['edges'] if item['name'] == 'optional-missing')['target'])
        self.assertFalse(report['updatesChecked'])

    def test_dependency_bot_scans_applies_and_restores_reviewed_npm_upgrade(self):
        manifest = dict(name='fixture', version='1.0.0', dependencies={'is-number': '^1.0.0'},
                        scripts={'postinstall': 'exit 77'})
        lock = dict(name='fixture', lockfileVersion=3, packages={
            '': dict(name='fixture', version='1.0.0', dependencies={'is-number': '^1.0.0'}),
            'node_modules/is-number': dict(version='1.0.0')})
        original_manifest = json.dumps(manifest)
        original_lock = json.dumps(lock)
        self.write('package.json', original_manifest)
        self.write('package-lock.json', original_lock)
        commands = []

        def npm(args, cwd=None, **_):
            commands.append(args)
            if args[1] == 'outdated':
                return dict(code=1, stdout=json.dumps({'is-number': {'wanted': '1.1.0', 'latest': '2.0.0'}}), stderr='')
            if args[1] == 'view':
                return dict(code=0, stdout='"1.1.0"', stderr='')
            self.assertEqual(args[1], 'install')
            self.assertIn('--ignore-scripts', args)
            self.assertIn('--package-lock-only', args)
            self.assertIn('--save-prod', args)
            staged_manifest = json.loads((cwd / 'package.json').read_text())
            staged_lock = json.loads((cwd / 'package-lock.json').read_text())
            staged_manifest['dependencies']['is-number'] = '1.1.0'
            staged_lock['packages']['']['dependencies']['is-number'] = '1.1.0'
            staged_lock['packages']['node_modules/is-number']['version'] = '1.1.0'
            (cwd / 'package.json').write_text(json.dumps(staged_manifest))
            (cwd / 'package-lock.json').write_text(json.dumps(staged_lock))
            return dict(code=0, stdout='', stderr='')

        with patch.object(runner, 'run', side_effect=npm):
            scan = self.execute('dependency-bot', mode='scan', allowMajor=False)
            self.assertEqual(scan['candidates'][0]['target'], '1.1.0')
            self.assertEqual(scan['candidates'][0]['change'], 'minor')
            self.assertEqual(self.write('package.json', original_manifest).read_text(), original_manifest)
            with self.assertRaises(runner.Failure):
                self.execute('dependency-bot', mode='apply', planId='0' * 64, allowMajor=False)
            result = self.execute('dependency-bot', mode='apply', planId=scan['candidates'][0]['planId'], allowMajor=False)
            self.assertEqual(result['updated']['target'], '1.1.0')
            self.assertEqual(self.execute('dependency-bot', mode='status')['directDependencies'], 1)
            with self.assertRaises(runner.Failure):
                self.execute('dependency-bot', mode='apply', planId=scan['candidates'][0]['planId'], allowMajor=False)
            restored = self.execute('dependency-bot', mode='restore', revisionId=result['revisionId'])
            self.assertEqual(restored['restoredFrom'], result['revisionId'])
            self.assertEqual((self.root / 'package.json').read_text(), original_manifest)
            self.assertEqual((self.root / 'package-lock.json').read_text(), original_lock)
        self.assertEqual(len([args for args in commands if args[1] == 'install']), 1)

    def test_dependency_bot_refuses_changed_source_and_recovers_interrupted_publication(self):
        manifest = dict(name='fixture', dependencies={'sample': '^1.0.0'})
        lock = dict(lockfileVersion=3, packages={'': dict(dependencies={'sample': '^1.0.0'}),
                                                 'node_modules/sample': dict(version='1.0.0')})
        self.write('package.json', json.dumps(manifest))
        self.write('package-lock.json', json.dumps(lock))
        with patch.object(runner, 'run', return_value=dict(code=1, stdout=json.dumps({
                'sample': {'wanted': '1.0.1', 'latest': '1.0.1'}}), stderr='')):
            scan = self.execute('dependency-bot', mode='scan')
            manifest['description'] = 'changed by user'
            self.write('package.json', json.dumps(manifest))
            with self.assertRaisesRegex(runner.Failure, '失效'):
                self.execute('dependency-bot', mode='apply', planId=scan['candidates'][0]['planId'])

        revision_id = 'a' * 32
        backup = self.root / '.sakura/dependency-bot/revisions' / revision_id
        backup.mkdir(parents=True)
        originals = {name: (self.root / name).read_bytes() for name in ('package.json', 'package-lock.json')}
        after_manifest = b'{"name":"partially-updated"}'
        for name, data in originals.items():
            (backup / name).write_bytes(data)
        (self.root / 'package.json').write_bytes(after_manifest)
        pending = dict(revisionId=revision_id,
                       before={name: runner.bot_digest(data) for name, data in originals.items()},
                       after={'package.json': runner.bot_digest(after_manifest),
                              'package-lock.json': runner.bot_digest(originals['package-lock.json'])})
        self.write('.sakura/dependency-bot/pending.json', json.dumps(pending))
        with self.assertRaisesRegex(runner.Failure, 'recover'):
            self.execute('dependency-bot', mode='status')
        self.assertTrue(self.execute('dependency-bot', mode='recover')['recovered'])
        self.assertEqual((self.root / 'package.json').read_bytes(), originals['package.json'])
        self.assertEqual((self.root / 'package-lock.json').read_bytes(), originals['package-lock.json'])

    def test_dependency_bot_does_not_convert_file_dependency_to_registry_package(self):
        self.write('package.json', json.dumps(dict(name='fixture', dependencies={'sample': 'file:vendor/sample'})))
        self.write('package-lock.json', json.dumps(dict(lockfileVersion=3, packages={
            '': dict(dependencies={'sample': 'file:vendor/sample'}),
            'node_modules/sample': dict(version='1.0.0')})))
        with patch.object(runner, 'run', return_value=dict(code=1, stdout=json.dumps({
                'sample': {'wanted': '1.0.0', 'latest': '2.0.0'}}), stderr='')) as command:
            scan = self.execute('dependency-bot', mode='scan', allowMajor=True)
        self.assertEqual(scan['candidates'], [])
        self.assertEqual(scan['skipped'][0]['name'], 'sample')
        self.assertEqual(command.call_count, 1)

    def test_environment_lock_verifies_changes_and_rejects_unsafe_packages_before_install(self):
        sample = dict(version=1, system={'ID': 'alpine', 'VERSION_ID': '3.23', 'architecture': 'x86_64', 'manager': 'apk'},
                      packages={'nodejs': '24.1-r0'}, tools={'node': 'v24.1'}, locks={'package-lock.json': 'a' * 64})
        with patch.object(runner, 'environment_snapshot', return_value=sample):
            self.execute('reproducible-env', mode='capture')
            self.assertEqual(self.execute('reproducible-env', mode='verify')['code'], 0)
            changed = dict(sample, locks={'package-lock.json': 'b' * 64})
            with patch.object(runner, 'environment_snapshot', return_value=changed):
                self.assertEqual(self.execute('reproducible-env', mode='verify')['code'], 1)
                with self.assertRaises(runner.Failure), patch.object(runner, 'run') as command:
                    self.execute('reproducible-env', mode='install', installSystem=True)
                command.assert_not_called()
            tampered = dict(sample, packages={'--allow-untrusted': '1'})
            self.write('.sakura/environment.lock.json', json.dumps(tampered))
            with self.assertRaises(runner.Failure), patch.object(runner, 'run') as command:
                self.execute('reproducible-env', mode='install', installSystem=True)
            command.assert_not_called()

    def test_runtime_install_validates_family_and_explicit_pin_before_executing(self):
        with patch.object(runner.shutil, 'which', return_value='/sbin/apk'), patch.object(runner, 'run') as command:
            with self.assertRaises(runner.Failure):
                self.execute('runtime-matrix', mode='install', runtime='go', package='curl', version='1')
            with self.assertRaises(runner.Failure):
                self.execute('runtime-matrix', mode='install', runtime='go', package='go')
            with self.assertRaises(runner.Failure):
                self.execute('runtime-matrix', mode='install', runtime='go', package='go', version='$(touch escaped)')
            command.assert_not_called()

    @unittest.skipUnless(shutil.which('apk') or shutil.which('dpkg-query'), 'requires a Linux package database')
    def test_actual_environment_lock_and_frozen_dependency_install(self):
        self.write('package.json', json.dumps(dict(name='locked-fixture', version='1.0.0', scripts={'install': 'touch escaped'})))
        runner.run(['npm', 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], self.root)
        captured = self.execute('reproducible-env', mode='capture')
        self.assertGreater(captured['packages'], 0)
        self.assertEqual(self.execute('reproducible-env', mode='verify')['code'], 0)
        installed = self.execute('reproducible-env', mode='install', installSystem=False, timeout=60)
        self.assertEqual(installed['code'], 0, installed)
        self.assertFalse((self.root / 'escaped').exists())
        self.write('package.json', '{"name":"changed"}')
        self.assertEqual(self.execute('reproducible-env', mode='verify')['code'], 1)

    def test_build_cache_uses_input_fingerprint_and_verifies_content(self):
        self.write('lock.json', 'v1')
        self.write('dist/output.txt', 'compiled')
        parameters = dict(path='dist', inputs=['lock.json'], namespace='test')
        saved = self.execute('build-cache', mode='save', **parameters)
        self.assertTrue(saved['saved'])
        self.assertTrue(self.execute('build-cache', mode='inspect', **parameters)['hit'])
        self.execute('build-cache', mode='restore', target='restored', **parameters)
        self.assertEqual((self.root / 'restored/output.txt').read_text(), 'compiled')
        self.write('lock.json', 'v2')
        self.assertFalse(self.execute('build-cache', mode='inspect', **parameters)['hit'])
        with self.assertRaises(runner.Failure):
            self.execute('build-cache', mode='restore', target='missing', **parameters)
        self.write('lock.json', 'v1')
        revision = saved['record']['revision']
        self.write('.sakura/directory-history/' + revision + '/files/output.txt', 'tampered')
        with self.assertRaises(runner.Failure):
            self.execute('build-cache', mode='restore', target='tampered', **parameters)
        self.assertFalse((self.root / 'tampered').exists())

    def test_onboarding_tracks_members_independently_and_persists(self):
        added = self.execute('onboarding-checklist', mode='add', title='运行测试', member='Alice')
        step = added['steps'][0]['id']
        self.execute('onboarding-checklist', mode='complete', stepId=step, member='Alice')
        self.assertEqual(self.execute('onboarding-checklist', mode='list', member='Bob')['completed'], 0)
        self.assertEqual(self.execute('onboarding-checklist', mode='list', member='Alice')['completed'], 1)
        self.execute('onboarding-checklist', mode='reopen', stepId=step, member='Alice')
        self.assertEqual(self.execute('onboarding-checklist', mode='list', member='Alice')['completed'], 0)
        with self.assertRaises(runner.Failure):
            self.execute('onboarding-checklist', mode='complete', stepId='missing', member='Alice')

    def test_branch_preview_has_real_worktree_and_rejects_dirty_removal(self):
        runner.run(['git', 'init'], self.root)
        runner.run(['git', 'config', 'user.email', 'test@example.invalid'], self.root)
        runner.run(['git', 'config', 'user.name', 'Test'], self.root)
        self.write('README.md', 'committed')
        runner.run(['git', 'add', 'README.md'], self.root)
        runner.run(['git', 'commit', '-m', 'initial'], self.root)
        created = self.execute('branch-preview', mode='create', ref='HEAD')['preview']
        preview = self.root / created['path']
        self.assertEqual((preview / 'README.md').read_text(), 'committed')
        self.assertEqual(self.execute('branch-preview', mode='list')['previews'][0]['id'], created['id'])
        (preview / 'untracked.txt').write_text('retain this')
        with self.assertRaises(runner.Failure):
            self.execute('branch-preview', mode='remove', previewId=created['id'])
        self.assertTrue(preview.is_dir())
        (preview / 'untracked.txt').unlink()
        self.execute('branch-preview', mode='remove', previewId=created['id'])
        self.assertFalse(preview.exists())

    def test_worktree_management_creates_branch_opens_and_protects_dirty_content(self):
        runner.run(['git', 'init'], self.root)
        runner.run(['git', 'config', 'user.email', 'test@example.invalid'], self.root)
        runner.run(['git', 'config', 'user.name', 'Test'], self.root)
        self.write('README.md', 'committed')
        runner.run(['git', 'add', 'README.md'], self.root)
        runner.run(['git', 'commit', '-m', 'initial'], self.root)
        created = self.execute('git-worktrees', mode='create', path='.worktrees/topic', ref='HEAD', branch='feature/topic')
        directory = created['directory']
        tree = Path(directory)
        self.assertEqual(runner.run(['git', 'branch', '--show-current'], tree)['stdout'].strip(), 'feature/topic')
        self.assertEqual(len(self.execute('git-worktrees', mode='list')['worktrees']), 2)
        self.assertEqual(self.execute('git-worktrees', mode='open', directory=directory)['directory'], directory)
        (tree / 'README.md').write_text('uncommitted')
        with self.assertRaises(runner.Failure):
            self.execute('git-worktrees', mode='remove', directory=directory)
        self.assertEqual((tree / 'README.md').read_text(), 'uncommitted')
        with self.assertRaises(runner.Failure):
            self.execute('git-worktrees', mode='open', directory=str(self.root.parent))
        with self.assertRaises(runner.Failure):
            self.execute('git-worktrees', mode='remove', directory=str(self.root))
        (tree / 'README.md').write_text('committed')
        self.execute('git-worktrees', mode='remove', directory=directory)
        self.assertFalse(tree.exists())

    def test_directory_snapshot_diff_and_verified_restore(self):
        self.write('src/a.txt', 'before')
        (self.root / 'src/empty').mkdir()
        record = self.execute('directory-history', mode='snapshot', path='src', label='before')
        self.write('src/a.txt', 'after')
        self.write('src/new.txt', 'new')
        diff = self.execute('directory-history', mode='diff', path='src', revision=record['revision'])
        self.assertEqual(diff['changed'], ['a.txt'])
        self.assertEqual(diff['added'], ['new.txt'])
        self.execute('directory-history', mode='restore', path='src', revision=record['revision'], target='restored')
        self.assertEqual((self.root / 'restored/a.txt').read_text(), 'before')
        self.assertTrue((self.root / 'restored/empty').is_dir())
        self.assertEqual((self.root / 'src/a.txt').read_text(), 'after')
        with self.assertRaises(runner.Failure):
            self.execute('directory-history', mode='restore', path='src', revision=record['revision'], target='src')
        backup = self.root / '.sakura/directory-history' / record['revision'] / 'files/a.txt'
        backup.write_text('tampered')
        with self.assertRaises(runner.Failure):
            self.execute('directory-history', mode='restore', path='src', revision=record['revision'], target='bad')
        self.assertFalse((self.root / 'bad').exists())

    def test_shards_are_deterministic_and_all_failures_survive(self):
        files = ['tests/a.py', 'tests/b.py', 'tests/c.py', 'tests/d.py']
        for file in files:
            self.write(file, '# test')
        p = dict(mode='plan', files=files, shards=3, timeout=10)
        plan = self.execute('test-sharding', **p)
        self.assertEqual(plan, self.execute('test-sharding', **dict(p, files=list(reversed(files)))))
        assigned = [name for shard in plan['shards'] for name in shard['files']]
        self.assertEqual(sorted(assigned), sorted(files))
        result = self.execute('test-sharding', **dict(p, mode='run', argv=[sys.executable, '-c', 'import sys; print(sys.argv[1:]); sys.exit(7)', '{files}']))
        self.assertEqual(result['code'], 1)
        self.assertTrue(all(item['code'] == 7 for item in result['shards'] if not item.get('skipped')))
        with self.assertRaises(runner.Failure):
            self.execute('test-sharding', **dict(p, mode='run', argv=[sys.executable, '--version']))

    def test_argv_parameters_do_not_execute_shell_syntax(self):
        injection = '$(touch escaped); & echo wrong'
        p = dict(mode='run', argv=[sys.executable, '-c', 'import sys; print(sys.argv[1])', '${VALUE}'],
                 fields=[dict(name='VALUE', label='Value', type='string', required=True)],
                 values=dict(VALUE=injection), timeout=10)
        result = self.execute('command-forms', **p)
        self.assertEqual(result['stdout'].strip(), injection)
        self.assertFalse((self.root / 'escaped').exists())
        with self.assertRaises(runner.Failure):
            self.execute('command-forms', **dict(p, values={}))
        with self.assertRaises(runner.Failure):
            self.execute('command-forms', **dict(p, values=dict(VALUE='x', UNKNOWN='bad')))

    def test_review_thread_reply_resolve_and_persistence(self):
        self.write('file.txt', 'first\nsecond\n')
        item = self.execute('review-comments', mode='comment', path='file.txt', line=2, body='Review', author='A')['thread']
        self.execute('review-comments', mode='reply', threadId=item['id'], body='Fixed', author='B')
        self.execute('review-comments', mode='resolve', threadId=item['id'])
        saved = self.execute('review-comments', mode='list')['threads'][0]
        self.assertTrue(saved['resolved'])
        self.assertEqual(len(saved['comments']), 2)
        with self.assertRaises(runner.Failure):
            self.execute('review-comments', mode='comment', path='file.txt', line=99, body='outside', author='A')

    def test_code_index_search_stale_and_exclusions(self):
        self.write('src/a.txt', 'Alpha\nneedle\n')
        self.write('node_modules/ignored.txt', 'needle')
        self.execute('code-search-index', mode='build')
        result = self.execute('code-search-index', mode='search', query='NEEDLE', caseSensitive=False, limit=100)
        self.assertEqual(result['totalMatches'], 1)
        self.assertEqual(result['matches'][0]['line'], 2)
        self.write('src/a.txt', 'changed')
        result = self.execute('code-search-index', mode='search', query='needle', caseSensitive=False, limit=100)
        self.assertEqual(result['stale'], ['src/a.txt'])

    def test_disk_analysis_totals_and_types(self):
        self.write('src/a.py', 'abcd')
        self.write('src/b.txt', 'xy')
        result = self.execute('disk-analyzer', path='src', depth=3)
        self.assertEqual(result['totalBytes'], 6)
        self.assertEqual(result['files'], 2)
        self.assertEqual({item['type']: item['bytes'] for item in result['types']}, {'.py': 4, '.txt': 2})

    def test_pii_reports_locations_without_values(self):
        secret = 'person@example.invalid'
        self.write('data.txt', secret + '\npassword=very-secret-token\n')
        result = self.execute('pii-classification', paths=['data.txt'])
        self.assertEqual({item['type'] for item in result['findings']}, {'email', 'credential'})
        self.assertNotIn(secret, json.dumps(result))
        self.assertNotIn('very-secret-token', json.dumps(result))

    def test_public_worker_dispatch_and_exit_code(self):
        result = subprocess.run([sys.executable, str(source)], input=json.dumps(dict(
            directory=str(self.root), operation='capability-command',
            parameters=dict(argv=[sys.executable, '-c', 'raise SystemExit(9)'], timeout=10))),
            text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)['code'], 9)

    @unittest.skipUnless(shutil.which('openssl') and shutil.which('git'), 'Signing requires OpenSSL and Git')
    def test_signed_patch_rejects_wrong_key_and_modified_metadata(self):
        runner.run(['git', 'init', '-b', 'main'], self.root)
        runner.run(['git', 'config', 'user.name', 'Test'], self.root)
        runner.run(['git', 'config', 'user.email', 'test@example.invalid'], self.root)
        self.write('file.txt', 'base')
        runner.run(['git', 'add', 'file.txt'], self.root)
        runner.run(['git', 'commit', '-m', 'base'], self.root)
        self.write('file.txt', 'changed')
        runner.run(['git', 'commit', '-am', 'change'], self.root)
        self.execute('patch-bundle', mode='keygen', target='key.pem', publicKey='key.pub')
        self.execute('patch-bundle', mode='keygen', target='wrong.pem', publicKey='wrong.pub')
        self.execute('patch-bundle', **{'mode': 'create', 'target': 'patch.json', 'from': 'HEAD~1', 'to': 'HEAD', 'privateKey': 'key.pem'})
        self.assertTrue(self.execute('patch-bundle', mode='verify', target='patch.json', publicKey='key.pub')['verified'])
        with self.assertRaises(runner.Failure):
            self.execute('patch-bundle', mode='verify', target='patch.json', publicKey='wrong.pub')
        document = json.loads((self.root / 'patch.json').read_text())
        document['end'] = 'f' * 40
        self.write('patch.json', json.dumps(document))
        with self.assertRaises(runner.Failure):
            self.execute('patch-bundle', mode='verify', target='patch.json', publicKey='key.pub')

    @unittest.skipIf(os.name == 'nt' or not shutil.which('npm'), 'Linux guest runs the actual npm workflow')
    def test_locked_environment_is_recreated_and_lint_failures_propagate(self):
        runner.run(['git', 'init', '-b', 'main'], self.root)
        runner.run(['git', 'config', 'user.name', 'Test'], self.root)
        runner.run(['git', 'config', 'user.email', 'test@example.invalid'], self.root)
        self.write('package.json', json.dumps({'name': 'capability-test', 'version': '1.0.0', 'scripts': {
            'postinstall': 'node -e "require(\'fs\').writeFileSync(\'installed\',\'yes\')"',
            'lint': 'node -e "process.exit(3)"'}}))
        self.write('package-lock.json', json.dumps({'name': 'capability-test', 'version': '1.0.0', 'lockfileVersion': 3,
                                                  'packages': {'': {'name': 'capability-test', 'version': '1.0.0', 'hasInstallScript': True}}}))
        runner.run(['git', 'add', '.'], self.root)
        runner.run(['git', 'commit', '-m', 'locked source'], self.root)
        result = self.execute('environment-recreate', target='rebuilt', timeout=60)
        self.assertEqual(result['code'], 0)
        self.assertEqual((self.root / 'rebuilt/installed').read_text(), 'yes')
        self.assertFalse((self.root / 'installed').exists())
        lint = self.execute('format-lint', mode='lint', tool='auto', timeout=60)
        self.assertNotEqual(lint['code'], 0)
        with self.assertRaises(runner.Failure):
            self.execute('format-lint', mode='format', tool='auto', timeout=60)

    @unittest.skipIf(os.name == 'nt', 'Guest validates POSIX symlinks')
    def test_paths_cannot_read_outside_project(self):
        (self.root / 'escape').symlink_to('/etc/passwd')
        with self.assertRaises(runner.Failure):
            self.execute('pii-classification', paths=['escape'])
        with self.assertRaises(runner.Failure):
            self.execute('pii-classification', paths=['../outside'])


if __name__ == '__main__':
    unittest.main()
