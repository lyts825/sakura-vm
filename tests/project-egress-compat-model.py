"""Portable models extracted from the actual production egress controller.

Owned Debian COWs captured nft 1.0.6 missing table.comment and nested create
leaving only a marked table; models do not replace new kernel/VM evidence.
"""
import ast
import base64
import copy
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from types import SimpleNamespace
import unittest

CONTROLLER = Path(sys.argv[1])
SOURCE = CONTROLLER.read_bytes()
TREE = ast.parse(SOURCE)
NAMES = {'Refusal', 'refuse', 'identifier', 'egress_spec', 'egress_create_text', 'egress_nft', 'egress_json',
         'egress_same_json', 'egress_objects', 'egress_table_text', 'egress_table'}
nodes = [node for node in TREE.body if (isinstance(node, (ast.ClassDef, ast.FunctionDef)) and node.name in NAMES)
         or (isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'UUID' for target in node.targets))]
draft = __import__('types').ModuleType('production_egress_compat')
draft.__dict__.update(ctypes=ctypes, json=json, os=os, re=re)
exec(compile(ast.Module(body=nodes, type_ignores=[]), str(CONTROLLER), 'exec'), draft.__dict__)
assert set(NAMES).issubset(draft.__dict__)
ORIGINAL_NFT = draft.egress_nft
VALUE = {'uid': 20000, 'registryId': '11111111-1111-1111-1111-111111111111',
         'identityId': '22222222-2222-2222-2222-222222222222'}


class KernelFixture:
    def __init__(self, legacy=False):
        self.name, self.expected = draft.egress_spec(VALUE)
        self.objects = copy.deepcopy(self.expected)
        for entry, handle in zip(self.objects, [51, 52, 53]):
            next(iter(entry.values()))['handle'] = handle
        self.legacy = legacy
        if legacy:
            self.objects[0]['table'].pop('comment')
        marker = self.expected[0]['table']['comment']
        self.text = (f'table inet {self.name} {{ # handle 51\n'
                     f'\tcomment "{marker}"\n\n'
                     '\tchain output { # handle 52\n'
                     '\t\ttype filter hook output priority 300; policy accept;\n'
                     f'\t\tmeta skuid 20000 drop comment "{marker}" # handle 53\n'
                     '\t}\n}\n').encode()
        self.calls, self.json_reads, self.post = [], 0, None
        self.tables = [{'table': {'family': 'inet', 'name': self.name, 'handle': 51}}]

    def nft(self, arguments, data=None, *, json_output=True):
        self.calls.append((arguments, data, json_output))
        if arguments == ['list', 'tables']:
            objects = self.tables
        elif arguments == ['list', 'table', 'inet', self.name]:
            self.json_reads += 1
            objects = self.objects if self.json_reads == 1 or self.post is None else self.post
        else:
            assert arguments == ['-a', 'list', 'table', 'inet', self.name] and not json_output and data is None
            return self.text
        return json.dumps({'nftables': [{'metainfo': {'version': '1.0.6' if self.legacy else '1.1.3',
                           'release_name': 'fixture-from-official-printer', 'json_schema_version': 1}}, *objects]}).encode()


class CompatibilityModels(unittest.TestCase):
    def tearDown(self):
        draft.egress_nft = ORIGINAL_NFT

    def query(self, fixture):
        draft.egress_nft = fixture.nft
        return draft.egress_table(VALUE)

    def refused(self, fixture, code='EGRESS_TABLE_CHANGED'):
        with self.assertRaises(draft.Refusal) as caught:
            self.query(fixture)
        self.assertEqual(caught.exception.code, code)

    def test_modern_strict_fast_path_has_no_text_or_second_query(self):
        fixture = KernelFixture()
        self.assertEqual(self.query(fixture), 51)
        self.assertEqual(len(fixture.calls), 2)
        self.assertTrue(all(call[2] for call in fixture.calls))

    def test_official_106_json_shape_requires_real_top_comment_and_unchanged_snapshot(self):
        fixture = KernelFixture(True)
        self.assertNotIn('comment', fixture.objects[0]['table'])
        self.assertEqual(self.query(fixture), 51)
        self.assertEqual(len(fixture.calls), 4)
        self.assertEqual(fixture.calls[2], (['-a', 'list', 'table', 'inet', fixture.name], None, False))
        self.assertEqual(fixture.json_reads, 2)

    def test_captured_debian_106_unmarked_pending_stays_refused(self):
        # Exact stdout bytes from the closed a71 owned COW diagnosis, whose
        # outer handoff SHA is 9905057bd525f69afe5aaa1399874362abae16a60b25e53a81ccd9de0c6cd9ae.
        tables = base64.b64decode('eyJuZnRhYmxlcyI6IFt7Im1ldGFpbmZvIjogeyJ2ZXJzaW9uIjogIjEuMC42IiwgInJlbGVhc2VfbmFtZSI6ICJMZXN0ZXIgR29vY2ggIzUiLCAianNvbl9zY2hlbWFfdmVyc2lvbiI6IDF9fSwgeyJ0YWJsZSI6IHsiZmFtaWx5IjogImluZXQiLCAibmFtZSI6ICJza3BfdWlkXzIwMDAwIiwgImhhbmRsZSI6IDF9fV19Cg==')
        raw = base64.b64decode('eyJuZnRhYmxlcyI6IFt7Im1ldGFpbmZvIjogeyJ2ZXJzaW9uIjogIjEuMC42IiwgInJlbGVhc2VfbmFtZSI6ICJMZXN0ZXIgR29vY2ggIzUiLCAianNvbl9zY2hlbWFfdmVyc2lvbiI6IDF9fSwgeyJ0YWJsZSI6IHsiZmFtaWx5IjogImluZXQiLCAibmFtZSI6ICJza3BfdWlkXzIwMDAwIiwgImhhbmRsZSI6IDF9fSwgeyJjaGFpbiI6IHsiZmFtaWx5IjogImluZXQiLCAidGFibGUiOiAic2twX3VpZF8yMDAwMCIsICJuYW1lIjogIm91dHB1dCIsICJoYW5kbGUiOiAxLCAidHlwZSI6ICJmaWx0ZXIiLCAiaG9vayI6ICJvdXRwdXQiLCAicHJpbyI6IDMwMCwgInBvbGljeSI6ICJhY2NlcHQifX0sIHsicnVsZSI6IHsiZmFtaWx5IjogImluZXQiLCAidGFibGUiOiAic2twX3VpZF8yMDAwMCIsICJjaGFpbiI6ICJvdXRwdXQiLCAiaGFuZGxlIjogMiwgImNvbW1lbnQiOiAic2FrdXJhLXByb2plY3QtZWdyZXNzLXYxOmFmNmQ2NjlhLTFhZWQtNGMxZS1iMzdlLWY2MjQzYTI3NGMyNTo5ZThiMjU3NC1jZDEzLTQwMzctOGEzNi1mYmY3M2VjMDI1NjgiLCAiZXhwciI6IFt7Im1hdGNoIjogeyJvcCI6ICI9PSIsICJsZWZ0IjogeyJtZXRhIjogeyJrZXkiOiAic2t1aWQifX0sICJyaWdodCI6IDIwMDAwfX0sIHsiZHJvcCI6IG51bGx9XX19XX0K')
        text = base64.b64decode('dGFibGUgaW5ldCBza3BfdWlkXzIwMDAwIHsgIyBoYW5kbGUgMQoJY2hhaW4gb3V0cHV0IHsgIyBoYW5kbGUgMQoJCXR5cGUgZmlsdGVyIGhvb2sgb3V0cHV0IHByaW9yaXR5IDMwMDsgcG9saWN5IGFjY2VwdDsKCQltZXRhIHNrdWlkIDIwMDAwIGRyb3AgY29tbWVudCAic2FrdXJhLXByb2plY3QtZWdyZXNzLXYxOmFmNmQ2NjlhLTFhZWQtNGMxZS1iMzdlLWY2MjQzYTI3NGMyNTo5ZThiMjU3NC1jZDEzLTQwMzctOGEzNi1mYmY3M2VjMDI1NjgiICMgaGFuZGxlIDIKCX0KfQo=')
        self.assertEqual(hashlib.sha256(raw).hexdigest(), '1003d9ec5d193fe2a7c0c24f5f628975bdc894c5c17a633ea26a5351344e2401')
        self.assertEqual(hashlib.sha256(text).hexdigest(), 'adbd17c5f43f1bef4d597e41799352ac6cd77254d8610599b041068678276e9a')
        value = dict(uid=20000, registryId='af6d669a-1aed-4c1e-b37e-f6243a274c25',
                     identityId='9e8b2574-cd13-4037-8a36-fbf73ec02568')
        calls = []
        def query(arguments, data=None, *, json_output=True):
            calls.append(arguments)
            self.assertIsNone(data)
            if arguments == ['list', 'tables']: return tables
            if arguments == ['list', 'table', 'inet', 'skp_uid_20000']: return raw
            self.assertEqual(arguments, ['-a', 'list', 'table', 'inet', 'skp_uid_20000'])
            self.assertIs(json_output, False)
            return text
        draft.egress_nft = query
        with self.assertRaises(draft.Refusal) as caught: draft.egress_table(value)
        self.assertEqual(caught.exception.code, 'EGRESS_TABLE_CHANGED')
        self.assertEqual(len(calls), 3)

    def test_no_table_is_still_absent_and_never_queries_or_creates_it(self):
        fixture = KernelFixture(True)
        fixture.tables = []
        self.assertIsNone(self.query(fixture))
        self.assertEqual(len(fixture.calls), 1)

    def test_captured_debian_106_marked_table_only_pending_stays_refused(self):
        # Exact closed b9 COW stdout: the table has a real ownership marker,
        # but CMD_CREATE did not expand its nested chain/rule. A correct marker
        # alone never authorizes repair, adoption or issuing another create.
        raw = base64.b64decode('eyJuZnRhYmxlcyI6IFt7Im1ldGFpbmZvIjogeyJ2ZXJzaW9uIjogIjEuMC42IiwgInJlbGVhc2VfbmFtZSI6ICJMZXN0ZXIgR29vY2ggIzUiLCAianNvbl9zY2hlbWFfdmVyc2lvbiI6IDF9fSwgeyJ0YWJsZSI6IHsiZmFtaWx5IjogImluZXQiLCAibmFtZSI6ICJza3BfdWlkXzIwMDAwIiwgImhhbmRsZSI6IDF9fV19Cg==')
        text = base64.b64decode('dGFibGUgaW5ldCBza3BfdWlkXzIwMDAwIHsgIyBoYW5kbGUgMQoJY29tbWVudCAic2FrdXJhLXByb2plY3QtZWdyZXNzLXYxOjNlNWEyYTU2LTdkMWMtNDJlYy1hOTViLTZmMjRlZjYxNjkzMjo0NGUxZTRiYy0xMDE0LTQwNTAtYWFmYy04YTAwZGJjODJkY2EiCn0K')
        self.assertEqual(hashlib.sha256(raw).hexdigest(), 'db9e3d584c1677889dff248b78c6b8fd50850f1ebda8384bdaa27063105b90fa')
        self.assertEqual(hashlib.sha256(text).hexdigest(), '917a84d0d67688d0e84fe7172e87fc144a3f10029611141aebd187fb981cbf8e')
        fixture = self.core_fixture()
        fixture.value.update(registryId='3e5a2a56-7d1c-42ec-a95b-6f24ef616932',
                             identityId='44e1e4bc-1014-4050-aafc-8a00dbc82dca')
        fixture.current.update(fixture.value)
        name, expected = draft.egress_spec(fixture.value)
        pending = dict(version=1, registryId=fixture.value['registryId'], identityId=fixture.value['identityId'],
                       projectId=fixture.value['projectId'], uid=20000, mode='private', phase='pending',
                       handle=None, deleteIssued=False, **fixture.context)
        fixture.records[fixture.ns['egress_path'](fixture.value)] = pending
        fixture.tables[name] = [dict(table=dict(json.loads(raw)['nftables'][1]['table'],
                                               comment=expected[0]['table']['comment']))]
        before = copy.deepcopy(fixture.records), copy.deepcopy(fixture.tables), copy.deepcopy(fixture.events)
        calls = []
        def query(arguments, data=None, *, json_output=True):
            calls.append(arguments)
            self.assertIsNone(data)
            self.assertIs(json_output, True)
            self.assertIn(arguments, [['list', 'tables'], ['list', 'table', 'inet', name]])
            return raw
        draft.egress_nft = query
        for action in [lambda: draft.egress_table(fixture.value),
                       lambda: fixture.ns['egress_prepare'](fixture.value),
                       lambda: fixture.ns['egress_prepare'](fixture.value, transition=True, restoring=True)]:
            with self.subTest(action=action):
                with self.assertRaises((draft.Refusal, fixture.ns['Refusal'])) as caught: action()
                self.assertEqual(caught.exception.code, 'EGRESS_TABLE_CHANGED')
                self.assertEqual(before, (fixture.records, fixture.tables, fixture.events))
        self.assertEqual(len(calls), 6)
        self.assertIsNone(pending['handle'])
        self.assertFalse(pending['deleteIssued'])

    def test_duplicate_named_table_refuses_without_modifying_objects(self):
        fixture = KernelFixture(True)
        fixture.tables += copy.deepcopy(fixture.tables)
        before = copy.deepcopy(fixture.objects)
        self.refused(fixture)
        self.assertEqual(fixture.objects, before)

    def test_missing_wrong_and_duplicate_top_comment_never_adopt_old_unmarked_pending(self):
        marker = draft.egress_spec(VALUE)[1][0]['table']['comment'].encode()
        for change in ['missing', 'wrong', 'duplicate']:
            fixture = KernelFixture(True)
            line = b'\tcomment "' + marker + b'"\n'
            fixture.text = fixture.text.replace(line, b'' if change == 'missing' else
                line + line if change == 'duplicate' else line.replace(marker, b'foreign-owner'))
            with self.subTest(change=change): self.refused(fixture)
            self.assertEqual(fixture.json_reads, 1)

    def test_nested_or_rule_comment_cannot_prove_table_ownership(self):
        marker = draft.egress_spec(VALUE)[1][0]['table']['comment'].encode()
        for nested in [b'\t\tcomment "' + marker + b'"\n', b'']:
            fixture = KernelFixture(True)
            fixture.text = fixture.text.replace(b'\tcomment "' + marker + b'"\n', b'')
            fixture.text = fixture.text.replace(b'\tchain output { # handle 52\n', b'\tchain output { # handle 52\n' + nested)
            self.refused(fixture)

    def test_quotes_braces_escapes_and_line_breaks_cannot_spoof_depth_or_marker(self):
        marker = draft.egress_spec(VALUE)[1][0]['table']['comment'].encode()
        for injected in [marker + b'{}', marker + b'\\n', marker + b'\n', marker + b'\\"', marker + b'\r',
                         b'}\n\tcomment "' + marker, marker + b'\x00']:
            fixture = KernelFixture(True)
            fixture.text = fixture.text.replace(marker, injected, 1)
            with self.subTest(injected=injected): self.refused(fixture)

    def test_duplicate_or_extra_outer_tables_trailing_data_and_unknown_top_fields_refuse(self):
        for change in ['second-table', 'trailing', 'top-flags', 'third-depth', 'comment-after-chain']:
            fixture = KernelFixture(True)
            if change == 'second-table': fixture.text += fixture.text
            elif change == 'trailing': fixture.text += b'foreign\n'
            elif change == 'top-flags': fixture.text = fixture.text.replace(b'\tcomment', b'\tflags dormant\n\tcomment', 1)
            elif change == 'third-depth': fixture.text = fixture.text.replace(b'\t\tmeta', b'\t\tforeign { }\n\t\tmeta')
            else: fixture.text = fixture.text[:-2] + b'\tcomment "' + fixture.expected[0]['table']['comment'].encode() + b'"\n}\n'
            with self.subTest(change=change): self.refused(fixture)

    def test_header_family_name_and_handle_match_exact_initial_kernel_table(self):
        for old, new in [(b'inet', b'ip'), (b'skp_uid_20000', b'skp_uid_20001'), (b'handle 51', b'handle 52'),
                         (b'handle 51', b'handle 0'), (b'handle 51', b'handle -1'), (b'handle 51', b'handle True'),
                         (b'handle 51', b'handle 051'), (b'handle 51', b'handle 51.0'),
                         (b'handle 51', b'handle 18446744073709551616')]:
            fixture = KernelFixture(True)
            fixture.text = fixture.text.replace(old, new, 1)
            with self.subTest(new=new): self.refused(fixture)

    def test_missing_or_invalid_json_handles_refuse_before_text(self):
        for index in range(3):
            for invalid in [None, True, False, 0, -1, 51.0, '51', 2 ** 64]:
                fixture = KernelFixture(True)
                fields = next(iter(fixture.objects[index].values()))
                if invalid is None: fields.pop('handle')
                else: fields['handle'] = invalid
                with self.subTest(index=index, handle=invalid): self.refused(fixture)
                self.assertEqual(len(fixture.calls), 2)

    def test_unknown_rules_fields_objects_order_uid_hook_priority_and_verdict_refuse(self):
        for damage in ['extra-rule', 'table-flags', 'chain-field', 'rule-field', 'unknown-object', 'object-order',
                       'uid', 'uid-string', 'hook', 'priority', 'float-priority', 'accept', 'in', 'expr-order', 'rule-marker']:
            fixture = KernelFixture(True)
            if damage == 'extra-rule': fixture.objects.append(copy.deepcopy(fixture.objects[-1]))
            elif damage == 'table-flags': fixture.objects[0]['table']['flags'] = []
            elif damage == 'chain-field': fixture.objects[1]['chain']['counter'] = 0
            elif damage == 'rule-field': fixture.objects[2]['rule']['index'] = 0
            elif damage == 'unknown-object': fixture.objects[1] = {'set': {}}
            elif damage == 'object-order': fixture.objects[1:] = fixture.objects[1:][::-1]
            elif damage == 'uid': fixture.objects[2]['rule']['expr'][0]['match']['right'] = 20001
            elif damage == 'uid-string': fixture.objects[2]['rule']['expr'][0]['match']['right'] = '20000'
            elif damage == 'hook': fixture.objects[1]['chain']['hook'] = 'input'
            elif damage == 'priority': fixture.objects[1]['chain']['prio'] = 0
            elif damage == 'float-priority': fixture.objects[1]['chain']['prio'] = 300.0
            elif damage == 'accept': fixture.objects[2]['rule']['expr'][1] = {'accept': None}
            elif damage == 'in': fixture.objects[2]['rule']['expr'][0]['match']['op'] = 'in'
            elif damage == 'expr-order': fixture.objects[2]['rule']['expr'].reverse()
            else: fixture.objects[2]['rule']['comment'] += ':foreign'
            with self.subTest(damage=damage): self.refused(fixture)
            self.assertEqual(len(fixture.calls), 2)

    def test_present_wrong_null_or_non_string_table_marker_never_enters_legacy_branch(self):
        for marker in ['foreign', '', None, 1, True, []]:
            fixture = KernelFixture()
            fixture.objects[0]['table']['comment'] = marker
            with self.subTest(marker=marker): self.refused(fixture)
            self.assertEqual(len(fixture.calls), 2)

    def test_every_json_object_and_handle_is_identical_after_text_read(self):
        for drift in ['table-handle', 'chain-handle', 'rule-handle', 'comment-added', 'rule', 'extra', 'missing', 'unknown-field']:
            fixture = KernelFixture(True)
            fixture.post = copy.deepcopy(fixture.objects)
            if drift.endswith('handle'):
                index = ['table-handle', 'chain-handle', 'rule-handle'].index(drift)
                next(iter(fixture.post[index].values()))['handle'] += 1
            elif drift == 'comment-added': fixture.post[0]['table']['comment'] = fixture.expected[0]['table']['comment']
            elif drift == 'rule': fixture.post[2]['rule']['expr'][0]['match']['right'] += 1
            elif drift == 'extra': fixture.post.append(copy.deepcopy(fixture.post[-1]))
            elif drift == 'missing': fixture.post.pop()
            else: fixture.post[1]['chain']['unknown'] = None
            with self.subTest(drift=drift): self.refused(fixture)
            self.assertEqual(fixture.json_reads, 2)

    def test_legacy_text_exact_64k_boundary_and_one_byte_over(self):
        for length in [65536, 65537]:
            fixture = KernelFixture(True)
            padding = b' ' * (length - len(fixture.text) - 1) + b'\n'
            fixture.text = fixture.text.replace(b'\t}\n}\n', padding + b'\t}\n}\n')
            self.assertEqual(len(fixture.text), length)
            with self.subTest(length=length):
                if length == 65536: self.assertEqual(self.query(fixture), 51)
                else: self.refused(fixture)

    def test_modern_fast_path_rejects_boolean_float_and_coerced_numeric_fields(self):
        for damage in ['table-bool-handle', 'chain-float-handle', 'rule-float-handle', 'float-priority',
                       'bool-priority', 'float-uid', 'bool-uid', 'false-drop']:
            fixture = KernelFixture()
            if damage == 'table-bool-handle': fixture.objects[0]['table']['handle'] = True
            elif damage == 'chain-float-handle': fixture.objects[1]['chain']['handle'] = 52.0
            elif damage == 'rule-float-handle': fixture.objects[2]['rule']['handle'] = 53.0
            elif damage == 'float-priority': fixture.objects[1]['chain']['prio'] = 300.0
            elif damage == 'bool-priority': fixture.objects[1]['chain']['prio'] = True
            elif damage == 'float-uid': fixture.objects[2]['rule']['expr'][0]['match']['right'] = 20000.0
            elif damage == 'bool-uid': fixture.objects[2]['rule']['expr'][0]['match']['right'] = True
            else: fixture.objects[2]['rule']['expr'][1]['drop'] = False
            with self.subTest(damage=damage): self.refused(fixture)
            self.assertEqual(len(fixture.calls), 2)

    def test_fixed_atomic_text_creation_contains_only_validated_uid_and_uuid_markers(self):
        text = draft.egress_create_text(VALUE)
        name, expected = draft.egress_spec(VALUE)
        marker = expected[0]['table']['comment'].encode()
        self.assertEqual(text.splitlines(), [
            ('create table inet ' + name + ' { comment "').encode() + marker + b'"; }',
            ('add chain inet ' + name + ' output { type filter hook output priority 300; policy accept; }').encode(),
            ('add rule inet ' + name + ' output meta skuid 20000 drop comment "').encode() + marker + b'"'])
        self.assertEqual(text.count(marker), 2)
        self.assertEqual(text.count(b'create table'), 1)
        self.assertEqual(text.count(b'add chain'), 1)
        self.assertEqual(text.count(b'add rule'), 1)
        self.assertIn(b'priority 300; policy accept;', text)
        self.assertIn(b'meta skuid 20000 drop comment', text)
        for key, invalid in [('uid', True), ('uid', '20000'), ('uid', -1), ('uid', 60000), ('uid', 0),
                             ('registryId', 'x"; delete table inet other; #'), ('identityId', VALUE['identityId'] + '\n'),
                             ('registryId', VALUE['registryId'].replace('1', 'a').upper()), ('identityId', None)]:
            value = dict(VALUE); value[key] = invalid
            with self.subTest(key=key, value=invalid), self.assertRaises(draft.Refusal): draft.egress_create_text(value)

    def test_pinned_wrapper_text_create_and_query_preserve_namespace_numeric_flags_and_fd_closure(self):
        original = {key: getattr(draft, key, None) for key in ['os', 'ctypes', 'tool', 'directory_fd', 'trusted', 'egress_realm', 'execute']}
        calls, closed, setns = [], [], []
        actual_os = draft.os
        draft.os = SimpleNamespace(path=actual_os.path, O_RDONLY=0, O_NOFOLLOW=1, O_CLOEXEC=2,
                   open=lambda *args, **kwargs: 13, close=closed.append,
                   fstat=lambda fd: SimpleNamespace(st_mode=0o100755))
        draft.ctypes = SimpleNamespace(CDLL=lambda *args, **kwargs: SimpleNamespace(setns=lambda *args: (setns.append(args), 0)[1]))
        draft.tool = lambda name: '/usr/sbin/nft'
        draft.directory_fd = lambda path: 11
        draft.trusted = lambda info: None
        draft.egress_realm = lambda: (12, {})
        def execute(argv, data, **kwargs):
            kwargs['preexec_fn']()
            calls.append((argv, data, kwargs['pass_fds']))
            return b''
        draft.execute = execute
        try:
            ORIGINAL_NFT(['-f', '-'], draft.egress_create_text(VALUE), json_output=False)
            self.assertEqual(calls[-1][0], ['/proc/self/fd/13', '-n', '-f', '-'])
            self.assertNotIn('-j', calls[-1][0]); self.assertNotIn('-u', calls[-1][0])
            ORIGINAL_NFT(['-a', 'list', 'table', 'inet', 'skp_uid_20000'], json_output=False)
            self.assertEqual(calls[-1][0], ['/proc/self/fd/13', '-n', '-a', 'list', 'table', 'inet', 'skp_uid_20000'])
            ORIGINAL_NFT(['list', 'tables'])
            self.assertEqual(calls[-1][0], ['/proc/self/fd/13', '-j', '-n', 'list', 'tables'])
            self.assertEqual([call[2] for call in calls], [(13, 12)] * 3)
            self.assertEqual(setns, [(12, 0x40000000)] * 3)
            self.assertEqual(closed, [11, 13, 12] * 3)
        finally:
            for key, value in original.items():
                if value is None: delattr(draft, key)
                else: setattr(draft, key, value)

    def core_fixture(self):
        source = Path(__file__).with_name('project-egress-model.py')
        nodes = ast.parse(source.read_text(encoding='utf8')).body
        # Import the original transaction fixture without executing its checks.
        previous = sys.argv
        sys.argv = [str(source), str(CONTROLLER)]
        namespace = {}
        try:
            exec(compile(ast.Module(body=nodes[:-2], type_ignores=[]), str(source), 'exec'), namespace)
        finally:
            sys.argv = previous
        fixture = namespace['fixture']()
        kernel = fixture.ns['egress_nft']
        def query(arguments, data=None, *, json_output=True):
            if arguments == ['-f', '-']:
                return kernel(arguments, data, json_output=json_output)
            if json_output:
                raw = kernel(arguments, data)
                if arguments[:3] == ['list', 'table', 'inet']:
                    objects = json.loads(raw)
                    objects['nftables'][0]['table'].pop('comment', None)
                    raw = json.dumps(objects).encode()
                return raw
            name = arguments[-1]
            table, chain, rule = [next(iter(item.values())) for item in fixture.tables[name]]
            marker = table.get('comment')
            declaration = '' if marker is None else '\tcomment "' + marker + '"\n'
            return (f'table inet {name} {{ # handle {table["handle"]}\n' + declaration + '\n' +
                    f'\tchain output {{ # handle {chain["handle"]}\n' +
                    '\t\ttype filter hook output priority 300; policy accept;\n' +
                    f'\t\tmeta skuid 20000 drop comment "{rule["comment"]}" # handle {rule["handle"]}\n' +
                    '\t}\n}\n').encode()
        draft.egress_nft = query
        fixture.ns['egress_nft'] = query
        def table(value):
            try: return draft.egress_table(value)
            except draft.Refusal as error: raise fixture.ns['Refusal'](error.code, error.detail)
        fixture.ns['egress_table'] = table
        fixture.fixed_text_query = query
        return fixture

    def test_transaction_fixture_rejects_arbitrary_text_or_changed_fixed_create_syntax(self):
        fixture = self.core_fixture()
        valid = draft.egress_create_text(fixture.value)
        name, expected = draft.egress_spec(fixture.value)
        marker = expected[0]['table']['comment']
        # Previous production syntax returned success on nft 1.0.6 but only
        # created the table. Never model it as a complete atomic policy.
        nested = (f'create table inet {name} {{\n comment "{marker}";\n chain output {{\n'
                  '  type filter hook output priority 300; policy accept;\n'
                  f'  meta skuid 20000 drop comment "{marker}";\n }}\n}}\n').encode()
        for invalid in [b'add table inet any\n', valid.replace(b'priority 300', b'priority 0'),
                        valid.replace(b'drop comment', b'accept comment'), valid + b'delete table inet foreign\n',
                        valid.replace(b'skp_uid_20000', b'skp_uid_20001'), valid.replace(b'meta skuid 20000', b'meta skuid 20001'),
                        valid.replace(b'add chain inet skp_uid_20000', b'add chain inet skp_uid_20001'),
                        valid.replace(b'add rule inet skp_uid_20000', b'add rule inet skp_uid_20001'),
                        valid.replace(b'create table', b'add table'), valid.splitlines(keepends=True)[0], nested]:
            with self.subTest(invalid=invalid), self.assertRaises(AssertionError):
                fixture.fixed_text_query(['-f', '-'], invalid, json_output=False)
        self.assertFalse(fixture.events)
        self.assertFalse(fixture.tables)

    def test_existing_exact_table_create_rejects_without_appending_chain_or_rule(self):
        fixture = self.core_fixture()
        fixture.ns['egress_prepare'](fixture.value)
        before = copy.deepcopy(fixture.tables), copy.deepcopy(fixture.records), copy.deepcopy(fixture.events)
        with self.assertRaises(AssertionError):
            fixture.fixed_text_query(['-f', '-'], draft.egress_create_text(fixture.value), json_output=False)
        self.assertEqual(before, (fixture.tables, fixture.records, fixture.events))

    def test_error_in_third_fixed_statement_leaves_no_partial_table_or_chain(self):
        fixture = self.core_fixture()
        valid = draft.egress_create_text(fixture.value)
        self.assertEqual(len(valid.splitlines()), 3)
        for broken in [valid.replace(b'output meta skuid', b'missing meta skuid'),
                       valid.replace(b'drop comment', b'unknown_verdict comment')]:
            with self.subTest(broken=broken), self.assertRaises(AssertionError):
                fixture.fixed_text_query(['-f', '-'], broken, json_output=False)
            self.assertFalse(fixture.events)
            self.assertFalse(fixture.tables)

    def test_production_saved_handle_and_absent_owner_checks_remain_authoritative(self):
        fixture = self.core_fixture()
        fixture.ns['egress_prepare'](fixture.value)
        fixture.ns['egress_commit'](fixture.value)
        owner = next(iter(fixture.records.values()))
        owner['handle'] += 100
        before = copy.deepcopy(fixture.tables), copy.deepcopy(fixture.records), copy.deepcopy(fixture.events)
        with self.assertRaises(fixture.ns['Refusal']) as caught: fixture.ns['egress_prepare'](fixture.value)
        self.assertEqual(caught.exception.code, 'EGRESS_TABLE_CHANGED')
        self.assertEqual(before, (fixture.tables, fixture.records, fixture.events))
        fixture.records.clear()
        before = copy.deepcopy(fixture.tables), copy.deepcopy(fixture.events)
        with self.assertRaises(fixture.ns['Refusal']) as caught: fixture.ns['egress_prepare'](fixture.value)
        self.assertEqual(caught.exception.code, 'EGRESS_OWNER_ABSENT')
        self.assertFalse(fixture.records)
        self.assertEqual(before, (fixture.tables, fixture.events))

    def test_production_lost_create_ack_recovery_still_requires_real_table_marker(self):
        fixture = self.core_fixture()
        fixture.flags['lost_create'] = True
        with self.assertRaises(OSError): fixture.ns['egress_prepare'](fixture.value)
        owner = next(iter(fixture.records.values()))
        self.assertEqual(owner['phase'], 'pending'); self.assertIsNone(owner['handle'])
        name = fixture.ns['egress_spec'](fixture.value)[0]
        marker = fixture.tables[name][0]['table'].pop('comment')
        before = copy.deepcopy(fixture.records), copy.deepcopy(fixture.tables), copy.deepcopy(fixture.events)
        with self.assertRaises(fixture.ns['Refusal']) as caught: fixture.ns['egress_prepare'](fixture.value)
        self.assertEqual(caught.exception.code, 'EGRESS_TABLE_CHANGED')
        self.assertEqual(before, (fixture.records, fixture.tables, fixture.events))
        # Simulate the table comment which the fixed atomic text transaction
        # stored, then recover the original pending owner, never a new ticket.
        fixture.tables[name][0]['table']['comment'] = marker
        fixture.ns['egress_prepare'](fixture.value)
        fixture.ns['egress_commit'](fixture.value)
        self.assertEqual(len([event for event in fixture.events if event[0] == 'create']), 1)
        self.assertEqual(next(iter(fixture.records.values()))['phase'], 'applied')


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(CompatibilityModels)
    checks = [test._testMethodName for test in suite]
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(json.dumps({'passed': result.wasSuccessful(), 'kind': 'portable-production-model-only',
                      'sourceSha256': hashlib.sha256(SOURCE).hexdigest(),
                      'transactionModelSha256': hashlib.sha256(Path(__file__).with_name('project-egress-model.py').read_bytes()).hexdigest(),
                      'checks': checks}, separators=(',', ':')))
    raise SystemExit(0 if result.wasSuccessful() else 1)
