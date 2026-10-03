"""Source-level authority model; Linux kernel paths are explicitly simulated.

No guest is started. Actual controller functions execute against a protected
virtual filesystem so rejection order, readonly behavior and FD ownership can
be asserted independently of host orchestration mocks.
"""
import ast
import builtins
import copy
import errno
import hashlib
import json
import os as real_os
from pathlib import Path as RealPath, PurePosixPath
import re
import stat
import struct
import sys
from types import SimpleNamespace
import unittest

ROOT = RealPath(__file__).resolve().parents[1]
X11 = ROOT / 'native/linux-clipboard/controller.py'
WAYLAND = ROOT / 'native/wayland-clipboard/controller.py'
ADAPTER = sys.stdin.read()


def definitions(path):
    tree = ast.parse(path.read_text(encoding='utf-8'))
    return ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef)], type_ignores=[])


class Kernel:
    def __init__(self):
        self.nodes, self.fds, self.next_fd, self.writes, self.removed = {}, {}, 20, [], []
        self.now, self.before_open, self.opens = 0, None, []
        self.before_read = None
        self.add('/', mode=stat.S_IFDIR | 0o755)

    def add(self, path, raw=b'', mode=stat.S_IFREG | 0o600, uid=0, gid=0, inode=None, device=12, link=None):
        path = str(path)
        if path != '/' and str(PurePosixPath(path).parent) not in self.nodes:
            self.add(str(PurePosixPath(path).parent), mode=stat.S_IFDIR | 0o755)
        self.nodes[path] = SimpleNamespace(raw=raw, link=link, info=SimpleNamespace(
            st_mode=mode, st_uid=uid, st_gid=gid, st_nlink=1, st_dev=device,
            st_ino=inode if inode is not None else len(self.nodes) + 100, st_size=len(raw)))
        return path

    def path_class(self):
        kernel = self
        class Path(PurePosixPath):
            def lstat(self):
                if str(self) not in kernel.nodes: raise FileNotFoundError(str(self))
                return kernel.nodes[str(self)].info
            stat = lstat
            def read_bytes(self):
                if kernel.before_read: kernel.before_read(str(self))
                return kernel.nodes[str(self)].raw
            def read_text(self): return self.read_bytes().decode()
            def resolve(self, strict=False):
                if strict: self.lstat()
                return self
            def exists(self): return str(self) in kernel.nodes
            def is_symlink(self): return self.exists() and stat.S_ISLNK(self.lstat().st_mode)
            def iterdir(self):
                return iter([Path(key) for key in list(kernel.nodes) if key != str(self) and PurePosixPath(key).parent == self])
            def rmdir(self):
                if str(self) not in kernel.nodes: raise FileNotFoundError(str(self))
                kernel.removed.append(str(self)); del kernel.nodes[str(self)]
        return Path

    def fake_os(self):
        kernel = self
        class OS:
            O_RDONLY, O_WRONLY, O_DIRECTORY, O_NOFOLLOW, O_CLOEXEC = 0, 1, 65536, 131072, 524288
            @staticmethod
            def open(path, flags, *args, dir_fd=None):
                path = str(path) if dir_fd is None else str(PurePosixPath(kernel.fds[dir_fd][0]) / path)
                if kernel.before_open: kernel.before_open(path, flags)
                if path not in kernel.nodes: raise FileNotFoundError(path)
                node = kernel.nodes[path]
                if flags & OS.O_NOFOLLOW and stat.S_ISLNK(node.info.st_mode): raise OSError(errno.ELOOP, path)
                kernel.opens.append((path, flags))
                fd = kernel.next_fd; kernel.next_fd += 1; kernel.fds[fd] = [path, node, 0]; return fd
            @staticmethod
            def close(fd):
                if fd not in kernel.fds: raise OSError(errno.EBADF, str(fd))
                del kernel.fds[fd]
            @staticmethod
            def fstat(fd): return kernel.fds[fd][1].info
            @staticmethod
            def read(fd, size):
                row = kernel.fds[fd]; value = row[1].raw[row[2]:row[2]+size]; row[2] += len(value); return value
            @staticmethod
            def write(fd, value):
                row = kernel.fds[fd]; kernel.writes.append((row[0], value))
                if row[0].endswith('/cgroup.kill'):
                    parent = str(PurePosixPath(row[0]).parent)
                    kernel.nodes[parent + '/cgroup.procs'].raw = b''
                    kernel.nodes[parent + '/cgroup.events'].raw = b'populated 0\nfrozen 0\n'
                return len(value)
            @staticmethod
            def readlink(path):
                if str(path) not in kernel.nodes: raise FileNotFoundError(str(path))
                row = kernel.nodes[str(path)]
                if row.link is None: raise OSError(errno.EINVAL, str(path))
                return row.link
            @staticmethod
            def fsencode(path): return str(path).encode()
            @staticmethod
            def lstat(path): return kernel.nodes[str(path)].info
        return OS

    def module(self, source=X11):
        Path, OS = self.path_class(), self.fake_os()
        namespace = dict(Path=Path, os=OS, stat=stat, json=json, hashlib=hashlib, re=re, errno=errno,
            struct=struct, UUID=re.compile(r'^[a-f0-9-]{36}$'), DIGEST=re.compile(r'^[a-f0-9]{64}$'),
            fcntl=SimpleNamespace(LOCK_SH=1, LOCK_NB=4, flock=lambda *args: None),
            time=SimpleNamespace(monotonic=lambda: self.now, sleep=lambda seconds: setattr(self, 'now', self.now + seconds)))
        exec(compile(definitions(source), str(source), 'exec'), namespace)
        return namespace

    def process(self, pid, uid, group, image, ticks='777', environment=None, args=None):
        root = '/proc/' + str(pid)
        fields = ['S'] + ['0'] * 18 + [ticks] + ['0'] * 5
        self.add(root + '/stat', (str(pid) + ' (kernel model process) ' + ' '.join(fields)).encode())
        self.add(root + '/status', ('Uid:\t' + '\t'.join([str(uid)] * 4) + '\n').encode())
        self.add(root + '/cgroup', ('0::/' + group + '\n').encode())
        self.add(root + '/ns/net', inode=54321, device=4, link='net:[54321]')
        self.add(root + '/exe', link=image)
        self.add(root + '/environ', b'\0'.join((key + '=' + value).encode() for key, value in (environment or {}).items()))
        self.add(root + '/cmdline', b'\0'.join(item.encode() for item in (args or [])) + b'\0')

    def authority(self, source=X11):
        ns = self.module(source); Path, OS = ns['Path'], ns['os']
        identity_id = '11111111-1111-4111-8111-111111111111'
        run_id, boot = '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'
        identity = dict(version=1, phase='active', projectId='abcdefabcdefabcd', registryId=boot, identityId=identity_id,
            revision=3, account='skp' + identity_id.replace('-', '')[:24], uid=20001, gid=20001,
            home='/var/lib/sakura-project-homes/' + identity_id, homeDevice='12', homeInode='701',
            directory='/workspace/project', directoryDevice='12', directoryInode='702', networkIsolation='private')
        group = 'sakura-service-' + run_id
        run = dict(version=1, phase='active', mode='inherit-current', projectId=identity['projectId'], registryId=boot,
            identityId=identity_id, revision=3, runId=run_id, bootId=boot, build='a'*64,
            networkDevice='4', networkInode='54321', cgroupDevice='29', cgroupInode='703', cgroupName=group,
            namespace='sk-' + identity['projectId'])
        record = dict(version=1, projectId=identity['projectId'], name='desktop', session='sakura-desktop-' + identity['projectId'],
            runId=run_id, bootId=boot, scopeName=group, inode='703', binding='b'*64, phase='running',
            sessionId='$1', paneId='%1', panePid=900, paneStartTicks='777')
        runtime = '/run/sakura-desktop-uid/20001/' + run_id
        self.add('/proc/sys/kernel/random/boot_id', boot.encode())
        self.add('/readonly-native-lock')
        self.add('/readonly-network', inode=54321, device=4)
        self.add('/sys/fs/cgroup/' + group, mode=stat.S_IFDIR | 0o755, inode=703, device=29)
        self.add(identity['directory'], mode=stat.S_IFDIR | 0o700, uid=20001, gid=20001, inode=702)
        self.add(runtime, mode=stat.S_IFDIR | 0o700, uid=20001, gid=20001, inode=704)
        self.add(runtime + '/Xauthority', b'private-cookie-body', uid=20001, gid=20001, inode=705)
        self.add(runtime + '/ready', b'yes', uid=20001, gid=20001, inode=706)
        folder = '/run/sakura-project-desktop/' + identity['projectId']
        self.add(folder + '/lock')
        frame = struct.pack('<8s6I', b'SKIDP001', 1, 0, 12, 0, 12, 0) + b'exec /bin/sh'
        sha = hashlib.sha256(frame).hexdigest()
        input_path = folder + '/input-' + run_id + '.bin'
        header = dict(version=1, **{key:record[key] for key in ('bootId','runId','scopeName','inode','binding')},
                      fileDevice='12', fileInode='707', sha256=sha, bytes=len(frame))
        self.add(input_path, json.dumps(header).encode() + b'\n' + frame, inode=707)
        guard = dict(version=1, phase='active', identity=copy.deepcopy(identity), runId=run_id, bootId=boot,
            scopeName=group, binding=record['binding'], sha256=sha, build=run['build'],
            runtimeDevice='12', runtimeInode='704', networkDevice='4', networkInode='54321')
        user = SimpleNamespace(pw_uid=20001, pw_gid=20001, pw_name=identity['account'], pw_dir=identity['home'])
        environment = dict(HOME=identity['home'], USER=identity['account'], DISPLAY=':1', XDG_RUNTIME_DIR=runtime,
            XAUTHORITY=runtime + '/Xauthority', TOKEN='private-environment-body', PATH='/project/bin:/usr/bin')
        self.process(900, 0, group, '/usr/bin/python3')
        self.process(901, 20001, group, '/usr/bin/plasmashell', environment=environment)
        self.process(902, 20001, group, '/usr/bin/Xvnc',
                     args=['/usr/bin/Xvnc', ':1', '-rfbport', '5901', '-auth', runtime + '/Xauthority'])
        self.add('/proc/902/fd/7', link='socket:[999]')
        self.add('/proc/902/net/tcp', b'header\n0: 0100007F:170D 00000000:0000 0A 0 0 0 0 0 999\n')
        # A neighbor with the same programs is unrelated to this exact ticket.
        self.process(903, 20002, 'sakura-service-neighbor', '/usr/bin/plasmashell')
        readonly, failures = [], set()
        def check(condition, message):
            if not condition: raise RuntimeError(message)
        def active(project, request, registry):
            readonly.append(('active', project, request))
            check(not failures & {'account','home','directory','uidmap'}, 'actual native account proof rejected')
            return copy.deepcopy(identity)
        def check_run(value, actual, current_boot):
            check(not failures & {'run','build'} and actual['phase']=='active' and actual['bootId']==current_boot, 'native ticket rejected')
        def cgroup_fd(value):
            row = self.nodes['/sys/fs/cgroup/' + group].info
            check((str(row.st_dev), str(row.st_ino)) == (value['cgroupDevice'],value['cgroupInode']), 'original native cgroup replaced')
            return OS.open('/sys/fs/cgroup/' + group, OS.O_RDONLY)
        def read(path, limit):
            row = self.nodes[path]; ns['secure_directory'](Path(path).parent)
            check(stat.S_ISREG(row.info.st_mode) and row.info.st_uid==0 and stat.S_IMODE(row.info.st_mode)==0o600
                  and row.info.st_nlink==1 and len(row.raw)<=limit, 'protected original frame rejected')
            return row.raw
        core = dict(initialize_readonly=lambda: OS.open('/readonly-native-lock',0),
            registry=lambda readonly: ({'readonly':readonly} if readonly else check(False,'write registry')),
            active=active, run_read=lambda value: copy.deepcopy(run), check_run=check_run, cgroup_fd=cgroup_fd,
            network_fd=lambda value, current_boot, readonly: (OS.open('/readonly-network',0),self.nodes['/readonly-network'].info,run['namespace']),
            same=lambda info, value, prefix: (str(info.st_dev), str(info.st_ino))==(value[prefix+'Device'],value[prefix+'Inode']),
            json_read=lambda path: copy.deepcopy(guard if 'desktop-guards' in path else record),
            trusted=lambda info, mode: check(info.st_uid==0 and stat.S_IMODE(info.st_mode)==mode,'root lock rejected'),
            read=read, directory_fd=lambda path, *args: OS.open(path,OS.O_RDONLY),
            tool=lambda name: '/usr/bin/'+name, CLEAN_ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/'})
        ns['desktop_native'] = lambda build: core if build==run['build'] else check(False,'source build changed')
        ns['pwd'] = SimpleNamespace(getpwnam=lambda name: user if name==identity['account'] else check(False,'wrong account'))
        ns['subprocess'] = SimpleNamespace(run=lambda argv, **kwargs: SimpleNamespace(returncode=0, stderr=b'', stdout=b'$1\t%1\t900\t0\n'))
        proof = dict(version=1, identity=copy.deepcopy(identity), run=copy.deepcopy(run), record=copy.deepcopy(record),
                     sha256=sha, runtime=runtime, endpoint=None)
        return SimpleNamespace(ns=ns, proof=proof, identity=identity, run=run, record=record,
                               guard=guard, runtime=runtime, frame=input_path, failures=failures, core=core)


class AuthorityTests(unittest.TestCase):
    def nested(self, source=X11, mutation=None):
        k = Kernel(); f = k.authority(source)
        environment = dict(HOME=f.identity['home'], USER=f.identity['account'], DISPLAY=':2',
            XDG_RUNTIME_DIR=f.runtime, XAUTHORITY='/tmp/xauth_owned', XDG_SESSION_TYPE='wayland', WAYLAND_DISPLAY='wayland-0')
        k.process(901, 20001, f.run['cgroupName'], '/usr/bin/plasmashell', environment=environment)
        k.process(904, 20001, f.run['cgroupName'], '/usr/bin/kwin_wayland_wrapper', ticks='888')
        k.add('/tmp/.X11-unix', mode=stat.S_IFDIR | 0o1777)
        k.add('/tmp/.X11-unix/X2', mode=stat.S_IFSOCK | 0o777, uid=20001, gid=20001, inode=708)
        parts=[b'owned-host', b'2', b'MIT-MAGIC-COOKIE-1', bytes(range(16))]
        cookie=struct.pack('>H',256)+b''.join(struct.pack('>H',len(item))+item for item in parts)
        k.add('/tmp/xauth_owned', cookie, uid=20001, gid=20001, inode=709)
        k.add('/proc/904/fd/9',link='socket:[987]')
        k.add('/proc/904/net/unix',b'header\n0: 00000002 00000000 00010000 0001 01 987 /tmp/.X11-unix/X2\n')
        closed=[]
        class Peer:
            def settimeout(self,value): pass
            def connect(self,path): self.path=path
            def getsockopt(self,*args): return struct.pack('3i',904,20002 if mutation=='peer-uid' else 20001,20001)
            def close(self): closed.append(True)
        f.ns['socket']=SimpleNamespace(socket=lambda *args:Peer(), AF_UNIX=1,SOCK_STREAM=1,SOCK_CLOEXEC=524288,SOL_SOCKET=1,SO_PEERCRED=17)
        if mutation=='credential-mode': k.nodes['/tmp/xauth_owned'].info.st_mode |= 0o040
        elif mutation=='credential-owner': k.nodes['/tmp/xauth_owned'].info.st_uid=20002
        elif mutation=='cookie-display': k.nodes['/tmp/xauth_owned'].raw=cookie.replace(b'\0\x012',b'\0\x013')
        elif mutation=='cookie-short': k.nodes['/tmp/xauth_owned'].raw=cookie[:-1]; k.nodes['/tmp/xauth_owned'].info.st_size-=1
        elif mutation=='socket-owner': k.nodes['/tmp/.X11-unix/X2'].info.st_uid=20002
        elif mutation=='socket-parent': k.nodes['/tmp/.X11-unix'].info.st_mode=stat.S_IFDIR|0o777
        elif mutation=='listener': k.nodes['/proc/904/fd/9'].link='socket:[988]'
        elif mutation=='peer-group': k.nodes['/proc/904/cgroup'].raw=b'0::/unrelated-domain\n'
        elif mutation=='peer-image': k.nodes['/proc/904/exe'].link='/usr/bin/python3'
        elif mutation=='peer-reuse':
            def reuse(path):
                if path=='/proc/904/net/unix': k.nodes['/proc/904/stat'].raw=k.nodes['/proc/904/stat'].raw.replace(b'888',b'889')
            k.before_read=reuse
        elif mutation=='socket-replace':
            def replace(path):
                if path=='/proc/904/net/unix':
                    k.nodes['/tmp/.X11-unix/X2'].info=copy.copy(k.nodes['/tmp/.X11-unix/X2'].info)
                    k.nodes['/tmp/.X11-unix/X2'].info.st_ino=710
            k.before_read=replace
        return k,f,closed

    def test_nested_wayland_retains_outer_vnc_and_authenticates_actual_inner_display(self):
        for source in (X11,WAYLAND):
            k,f,closed=self.nested(source)
            value=f.ns['desktop_authority'](f.proof)
            endpoint=value['endpoint']; nested=endpoint['nestedX11']
            self.assertEqual(endpoint['vncPid'],902); self.assertEqual(endpoint['xauthInode'],'705')
            self.assertEqual(nested['display'],':2'); self.assertEqual(nested['xauthInode'],'709')
            self.assertEqual(nested['peerPid'],904); self.assertEqual(nested['kernelInode'],'987')
            self.assertNotIn('private-cookie-body',json.dumps(endpoint)); self.assertNotIn('owned-host',json.dumps(endpoint))
            self.assertEqual(value['source']['XAUTHORITY'],'/tmp/xauth_owned')
            f.ns['os'].close(value['directoryFd']); self.assertEqual(closed,[True]); self.assertFalse(k.fds)

    def test_nested_credentials_peer_listener_and_identity_changes_are_rejected(self):
        for source in (X11,WAYLAND):
            for mutation in ('credential-mode','credential-owner','cookie-display','cookie-short','socket-owner',
                             'socket-parent','peer-uid','listener','peer-group','peer-image','peer-reuse','socket-replace'):
                k,f,closed=self.nested(source,mutation)
                with self.subTest(source=source,mutation=mutation),self.assertRaises(Exception):
                    f.ns['desktop_authority'](f.proof)
                self.assertFalse(k.fds)
                self.assertLessEqual(len(closed),1)

    def test_nested_endpoint_is_bound_and_x11_launcher_uses_checked_inner_credentials(self):
        k,f,_=self.nested()
        value=f.ns['desktop_authority'](f.proof); f.ns['os'].close(value['directoryFd'])
        f.proof['endpoint']=copy.deepcopy(value['endpoint'])
        f.ns['os'].readlink=lambda path: 'net:[54321]' if str(path)=='/proc/901/ns/net' else k.nodes[str(path)].link
        user,environment,checked=f.ns['desktop_environment']('net:[54321]',{},f.proof)
        self.assertEqual(user.pw_uid,20001); self.assertEqual(environment['DISPLAY'],':2')
        self.assertEqual(environment['XAUTHORITY'],'/tmp/xauth_owned'); f.ns['os'].close(checked['directoryFd'])
        f.proof['endpoint']['nestedX11']['peerCreated']='889'
        with self.assertRaises(Exception): f.ns['desktop_authority'](f.proof)
        self.assertFalse(k.fds)

    def test_only_uncommitted_initial_endpoint_absence_is_retryable(self):
        for name in ('Xauthority','ready'):
            k=Kernel(); f=k.authority(); del k.nodes[f.runtime+'/'+name]
            with self.assertRaisesRegex(RuntimeError,'^SAKURA_DESKTOP_NOT_READY:credential$'):
                f.ns['desktop_authority'](f.proof)
            f.proof['endpoint']={'committed':True}
            with self.assertRaises(FileNotFoundError): f.ns['desktop_authority'](f.proof)
            self.assertFalse(k.fds)
        k=Kernel(); f=k.authority(); del k.nodes['/proc/901/exe']
        with self.assertRaisesRegex(RuntimeError,'^SAKURA_DESKTOP_NOT_READY:process$'):
            f.ns['desktop_authority'](f.proof)
        self.assertFalse(k.fds)

    def test_full_readonly_authority_closes_every_root_fd_and_ignores_neighbors(self):
        for source in (X11, WAYLAND):
            k = Kernel(); f = k.authority(source); value = f.ns['desktop_authority'](f.proof)
            self.assertEqual(value['plasma']['pid'],901); self.assertEqual(value['vnc']['pid'],902)
            self.assertEqual(value['user'].pw_uid,20001)
            self.assertEqual(list(k.fds),[value['directoryFd']]); f.ns['os'].close(value['directoryFd'])
            self.assertFalse(k.fds); self.assertFalse(k.writes)

    def test_bad_proof_account_build_boot_run_and_exact_cgroup_are_rejected_without_writes(self):
        for mutation in ('extra','old','account','home','uidmap','run','build','boot','cgroup','directory','network'):
            k = Kernel(); f = k.authority()
            if mutation=='extra': f.proof['launcherSha256']='c'*64
            elif mutation=='old': f.proof={'launcherSha256':'c'*64}
            elif mutation in ('account','home','uidmap','run','build'): f.failures.add(mutation)
            elif mutation=='boot': k.nodes['/proc/sys/kernel/random/boot_id'].raw=b'new-boot'
            elif mutation=='cgroup': k.nodes['/sys/fs/cgroup/'+f.run['cgroupName']].info.st_ino+=1
            elif mutation=='directory': k.nodes[f.identity['directory']].info.st_ino+=1
            elif mutation=='network': k.nodes['/readonly-network'].info.st_ino+=1
            with self.subTest(mutation=mutation), self.assertRaises(Exception): f.ns['desktop_authority'](f.proof)
            self.assertFalse(k.fds,mutation); self.assertFalse(k.writes,mutation)

    def test_frame_runtime_cookie_pane_pid_and_actual_uid_replacements_are_rejected(self):
        for mutation in ('frame','frame-owner','frame-link','runtime','cookie','pane','pane-membership','plasma-uid','plasma-net','vnc-auth','listener'):
            k = Kernel(); f = k.authority(); initial=f.ns['desktop_authority'](f.proof)
            f.proof['endpoint']=initial['endpoint']; f.ns['os'].close(initial['directoryFd'])
            if mutation=='frame': k.nodes[f.frame].raw+=b'tampered'
            elif mutation=='frame-owner': k.nodes[f.frame].info.st_uid=20001
            elif mutation=='frame-link': k.nodes[f.frame].info.st_nlink=2
            elif mutation=='runtime': k.nodes[f.runtime].info.st_ino+=1
            elif mutation=='cookie': k.nodes[f.runtime+'/Xauthority'].raw=b'another-cookie'
            elif mutation=='pane': k.nodes['/proc/900/stat'].raw=k.nodes['/proc/900/stat'].raw.replace(b'777',b'888')
            elif mutation=='pane-membership': k.nodes['/proc/900/cgroup'].raw=b'0::/another-domain\n'
            elif mutation=='plasma-uid': k.nodes['/proc/901/status'].raw=b'Uid:\t0\t0\t0\t0\n'
            elif mutation=='plasma-net': k.nodes['/proc/901/ns/net'].info.st_ino+=1
            elif mutation=='vnc-auth': k.nodes['/proc/902/cmdline'].raw=b'Xvnc\0:1\0-rfbport\05901\0-auth\0/tmp/unknown\0'
            elif mutation=='listener': k.nodes['/proc/902/fd/7'].link='socket:[replaced]'
            with self.subTest(mutation=mutation),self.assertRaises(Exception): f.ns['desktop_authority'](f.proof)
            self.assertFalse(k.fds,mutation); self.assertFalse(k.writes,mutation)

    def test_source_manifest_hashes_all_root_bytes_before_evaluating_controller(self):
        for mutation in (None,'digest','source-mode','source-owner','source-symlink','directory-owner','aggregate'):
            k=Kernel(); ns=k.module(); files={'protocol.h':b'fixed abi', 'launcher.c':b'fixed launcher',
                'controller.py':b"import builtins\nbuiltins._desktop_model_executed+=1\ndef sources(): return __file__.split('/')[-2]\n"}
            aggregate=hashlib.sha256()
            for name,raw in files.items(): aggregate.update(name.encode()); aggregate.update(raw)
            build=aggregate.hexdigest(); folder='/usr/local/lib/sakura-project-identity/'+build
            manifest=dict(version=1,build=build,files=[dict(name=name,size=len(raw),sha256=hashlib.sha256(raw).hexdigest()) for name,raw in files.items()])
            for name,raw in files.items(): k.add(folder+'/'+name,raw)
            if mutation=='digest': k.nodes[folder+'/launcher.c'].raw+=b'x'
            elif mutation=='source-mode': k.nodes[folder+'/controller.py'].info.st_mode=stat.S_IFREG|0o644
            elif mutation=='source-owner': k.nodes[folder+'/controller.py'].info.st_uid=20001
            elif mutation=='source-symlink': k.nodes[folder+'/controller.py'].info.st_mode=stat.S_IFLNK|0o777
            elif mutation=='directory-owner': k.nodes[folder].info.st_uid=20001
            elif mutation=='aggregate': manifest['files'][0]['sha256']='a'*64
            k.add(folder+'/manifest.json',json.dumps(manifest).encode()); builtins._desktop_model_executed=0
            if mutation:
                with self.assertRaises(Exception): ns['desktop_native'](build)
                self.assertEqual(builtins._desktop_model_executed,0)
            else:
                self.assertEqual(ns['desktop_native'](build)['sources'](),build); self.assertEqual(builtins._desktop_model_executed,1)
            self.assertFalse(k.fds); self.assertFalse(k.writes)
        del builtins._desktop_model_executed

    def test_x11_environment_comes_only_from_verified_original_plasma(self):
        k=Kernel(); f=k.authority()
        expected={'TOKEN':hashlib.sha256(b'private-environment-body').hexdigest()}
        user,environment,checked=f.ns['desktop_environment']('net:[54321]',expected,f.proof)
        self.assertEqual(user.pw_uid,20001); self.assertEqual(environment['TOKEN'],'private-environment-body')
        self.assertEqual(environment['PATH'],'/usr/local/bin:/usr/bin:/bin')
        self.assertEqual(environment['HOME'],f.identity['home']); f.ns['os'].close(checked['directoryFd'])
        self.assertFalse(k.writes)
        for key in ('HOME','LD_PRELOAD','DISPLAY'):
            with self.assertRaises(Exception): f.ns['desktop_environment']('net:[54321]',{key:'a'*64},f.proof)
            self.assertFalse(k.fds)

    def test_own_sandbox_groups_reject_inode_boot_and_symlink_replacements(self):
        for source in (X11,WAYLAND):
            for mutation in ('inode','boot','symlink','owner','missing-proof'):
                k=Kernel(); ns=k.module(source); path='/sys/fs/cgroup/sakura-clipboard-owned'
                k.add('/proc/sys/kernel/random/boot_id',b'original-boot'); k.add(path,mode=stat.S_IFDIR|0o755,inode=999,device=29)
                value={'bootId':'original-boot','cgroup':{'device':'29','inode':'999'}}
                if mutation=='inode': k.nodes[path].info.st_ino=1000
                elif mutation=='boot': k.nodes['/proc/sys/kernel/random/boot_id'].raw=b'new-boot'
                elif mutation=='symlink': k.nodes[path].info.st_mode=stat.S_IFLNK|0o777
                elif mutation=='owner': k.nodes[path].info.st_uid=20001
                else: value['cgroup']=None
                with self.subTest(source=source,mutation=mutation),self.assertRaises(Exception): ns['application_group'](ns['Path'](path),value)
                self.assertFalse(k.fds); self.assertFalse(k.writes)

    def test_exact_full_sandbox_kill_preserves_neighbor_and_rechecks_before_path_retirement(self):
        for replace_before_kill in (False,True):
            k=Kernel(); ns=k.module(); path='/sys/fs/cgroup/sakura-clipboard-owned'
            k.add('/proc/sys/kernel/random/boot_id',b'original-boot')
            k.add(path,mode=stat.S_IFDIR|0o755,inode=999,device=29)
            k.add(path+'/cgroup.procs',b'1001\n'); k.add(path+'/cgroup.events',b'populated 1\n'); k.add(path+'/cgroup.kill')
            k.process(1001,20001,PurePosixPath(path).name,'/usr/bin/editor')
            k.add('/sys/fs/cgroup/neighbor',mode=stat.S_IFDIR|0o755,inode=1000,device=29)
            ns['process']=lambda pid: dict(pid=pid,uid=20001,network='net:[54321]',created='777')
            value={'bootId':'original-boot','cgroup':{'device':'29','inode':'999'}}
            count=[0]
            def opened(target,flags):
                if target==path:
                    count[0]+=1
                    if replace_before_kill and count[0]==2: k.nodes[path].info=copy.copy(k.nodes[path].info); k.nodes[path].info.st_ino=1002
            k.before_open=opened
            if replace_before_kill:
                with self.assertRaises(Exception): ns['application_retire'](ns['Path'](path),value,20001,'net:[54321]')
                self.assertFalse(k.writes); self.assertFalse(k.removed)
            else:
                ns['application_retire'](ns['Path'](path),value,20001,'net:[54321]')
                self.assertEqual(k.writes,[(path+'/cgroup.kill',b'1')]); self.assertEqual(k.removed,[path])
            self.assertIn('/sys/fs/cgroup/neighbor',k.nodes); self.assertFalse(k.fds)

    def test_wayland_uid_allocation_is_disjoint_and_never_reuses_project_account(self):
        tree=ast.parse(WAYLAND.read_text(encoding='utf-8'))
        account=ast.unparse(next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='create_account'))
        self.assertIn('range(1000, 20000)',account); self.assertIn('user.pw_uid == uid',account)
        self.assertIn('user.pw_gid == uid',account)
        child=ast.unparse(next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='launch_with_directory'))
        self.assertLess(child.index('os.setuid'),child.index('os.fchdir'))
        self.assertIn('cwd=None',child); self.assertNotIn('cwd=request',child)

    def test_desktop_application_retirement_matches_every_original_owner_field_and_refuses_unknown_domains(self):
        for source in (X11, WAYLAND):
            for mutation in (None, 'same-run-wrong-owner', 'orphan'):
                k=Kernel(); f=k.authority(source); ns=f.ns
                owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                own='44444444-4444-4444-8444-444444444444'
                other='55555555-5555-4555-8555-555555555555'
                base=ns['Path']('/run/clipboard-model/'+owner)
                k.add(str(base),mode=stat.S_IFDIR|0o700)
                value=dict(version=2,desktop=copy.deepcopy(f.proof))
                neighbor=copy.deepcopy(value); neighbor['desktop']['run']['runId']=other
                for identifier,row in [(own,value),(other,neighbor)]:
                    k.add(str(base/identifier/'session.json'),json.dumps(row).encode())
                retired=[]; ns['stop']=lambda directory, actual_owner: retired.append((directory.name,actual_owner))
                proof=copy.deepcopy(f.proof); proof['record']['phase']='stopped'
                if mutation=='same-run-wrong-owner': proof['identity']['uid']+=1
                elif mutation=='orphan':
                    k.add(str(ns['cgroup_path'](owner,'66666666-6666-4666-8666-666666666666')),mode=stat.S_IFDIR|0o755)
                if mutation:
                    with self.subTest(source=source,mutation=mutation),self.assertRaises(Exception): ns['retire_desktop'](base,owner,proof)
                    if mutation=='same-run-wrong-owner': self.assertFalse(retired)
                else:
                    reply=ns['retire_desktop'](base,owner,proof)
                    self.assertEqual(reply,{'stopped':True,'sessions':[own]})
                self.assertNotIn((other,owner),retired); self.assertFalse(k.writes); self.assertFalse(k.fds)

    def test_runtime_retirement_rechecks_exact_inode_and_closes_fds_before_receipt_can_retire(self):
        tree=ast.parse(ADAPTER)
        node=next(row for row in tree.body if isinstance(row,ast.FunctionDef) and row.name=='retire_runtime')
        body=ast.unparse(node)
        self.assertLess(body.index('os.setresuid'),body.index('os.fchmod'))
        self.assertIn('depth <= 32',body); self.assertIn('remaining = [4096]',body)
        self.assertIn('time.monotonic() + 10',body)
        for mutation in (None,'inode','before-rmdir','nonempty','fsync'):
            k=Kernel(); ns=k.module(); path='/run/sakura-desktop-uid/20001/original-runtime'
            k.add(path,mode=stat.S_IFDIR|0o700,inode=999)
            if mutation=='nonempty': k.add(path+'/unknown',b'owned-but-unpublished')
            proof={'identity':{'uid':20001,'gid':20001},'runtime':path}
            receipt={'phase':'creating','runtimeDevice':'12','runtimeInode':'999'}
            OS=ns['os']; synced=[]
            OS.listdir=lambda fd: [PurePosixPath(row).name for row in k.nodes if row!=path and PurePosixPath(row).parent==PurePosixPath(k.fds[fd][0])]
            def checked_stat(name,dir_fd=None,follow_symlinks=False):
                target=str(PurePosixPath(k.fds[dir_fd][0])/name)
                if mutation=='before-rmdir': k.nodes[target].info=copy.copy(k.nodes[target].info); k.nodes[target].info.st_ino+=1
                return k.nodes[target].info
            OS.stat=checked_stat
            OS.rmdir=lambda name,dir_fd=None: ns['Path'](str(PurePosixPath(k.fds[dir_fd][0])/name)).rmdir()
            def synced_parent(fd):
                synced.append(k.fds[fd][0])
                if mutation=='fsync': raise OSError('model fsync failed; receipt must remain')
            OS.fsync=synced_parent
            exec(compile(ast.Module(body=[node],type_ignores=[]),'<fixed Desktop runtime cleanup>','exec'),ns)
            if mutation=='inode': k.nodes[path].info.st_ino+=1
            if mutation:
                with self.subTest(mutation=mutation),self.assertRaises(Exception): ns['retire_runtime'](proof,receipt)
                if mutation!='fsync': self.assertFalse(k.removed)
            else:
                ns['retire_runtime'](proof,receipt); self.assertEqual(k.removed,[path]); self.assertEqual(synced,[str(PurePosixPath(path).parent)])
            self.assertFalse(k.fds); self.assertFalse(k.writes)


if __name__=='__main__':
    unittest.main()
