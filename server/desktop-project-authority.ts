/* Shared verbatim with both source-bound Linux clipboard controllers. */
export const desktopAuthoritySource = String.raw`# Shared verbatim by the fixed Desktop adapter and both Linux clipboard controllers.
# This file is a draft generator input, not a guest-installed authority record.
def desktop_native(build):
    require(isinstance(build, str) and re.fullmatch('[a-f0-9]{64}', build), 'Desktop native build 无效')
    folder = Path('/usr/local/lib/sakura-project-identity') / build
    secure_directory(folder)
    def protected(path, maximum=262144):
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o600
                    and info.st_nlink == 1 and 0 < info.st_size <= maximum, 'Desktop native source 权限不符')
            raw = os.read(fd, maximum + 1)
            require(len(raw) == info.st_size, 'Desktop native source 正在变化')
            return raw
        finally:
            os.close(fd)
    manifest = json.loads(protected(folder / 'manifest.json'))
    require(isinstance(manifest, dict) and set(manifest) == {'version', 'build', 'files'}
            and manifest['version'] == 1 and manifest['build'] == build and isinstance(manifest['files'], list)
            and len(manifest['files']) == 3, 'Desktop native manifest 不符')
    aggregate, controller = hashlib.sha256(), None
    for name, entry in zip(['protocol.h', 'launcher.c', 'controller.py'], manifest['files']):
        require(isinstance(entry, dict) and set(entry) == {'name', 'size', 'sha256'} and entry['name'] == name,
                'Desktop native manifest 不符')
        raw = protected(folder / name)
        require(len(raw) == entry['size'] and hashlib.sha256(raw).hexdigest() == entry['sha256'],
                'Desktop native source 摘要不符')
        aggregate.update(name.encode()); aggregate.update(raw)
        if name == 'controller.py': controller = raw
    require(aggregate.hexdigest() == build, 'Desktop native build 摘要不符')
    namespace = {'__file__': str(folder / 'controller.py'), '__name__': 'sakura_desktop_native'}
    # Only these root-owned, manifest-bound bytes are evaluated. No project path
    # or environment participates in Python import resolution.
    exec(compile(controller, str(folder / 'controller.py'), 'exec'), namespace)
    require(namespace['sources']() == build, 'Desktop native launcher 不符')
    return namespace

def desktop_process(pid, identity, run):
    require(type(pid) is int and pid > 1, 'Desktop PID 无效')
    root = Path('/proc') / str(pid)
    fields = (root / 'stat').read_text().rsplit(') ', 1)[1].split()
    uid = next(line.split()[1:] for line in (root / 'status').read_text().splitlines() if line.startswith('Uid:'))
    require(fields[0] not in ('Z', 'X') and len(uid) == 4 and all(int(item) == identity['uid'] for item in uid),
            'Desktop 执行 UID 不符')
    membership = (root / 'cgroup').read_text()
    require(membership == '0::/' + run['cgroupName'] + '\n', 'Desktop 进程离开原完整运行域')
    network = (root / 'ns/net').stat()
    require((str(network.st_dev), str(network.st_ino)) == (run['networkDevice'], run['networkInode']),
            'Desktop 进程网络身份不符')
    return {'pid': pid, 'created': fields[19], 'image': os.readlink(root / 'exe')}

def desktop_authority(proof):
    require(isinstance(proof, dict) and set(proof) == {'version', 'identity', 'run', 'record', 'sha256', 'runtime', 'endpoint'}
            and type(proof['version']) is int and proof['version'] == 1, '需要 Desktop 完整会话票据；旧共享账户不能接管')
    identity, run, record = proof['identity'], proof['run'], proof['record']
    require(isinstance(identity, dict) and isinstance(run, dict) and isinstance(record, dict)
            and identity.get('phase') == 'active' and run.get('phase') == 'active' and run.get('mode') == 'inherit-current'
            and record.get('phase') == 'running' and record.get('name') == 'desktop'
            and record.get('session') == 'sakura-desktop-' + identity.get('projectId', '')
            and record.get('scopeName') == 'sakura-service-' + run.get('runId', '')
            and record.get('runId') == run.get('runId') and record.get('bootId') == run.get('bootId')
            and record.get('projectId') == run.get('projectId') == identity.get('projectId')
            and record.get('inode') == run.get('cgroupInode')
            and run.get('cgroupName') == record.get('scopeName')
            and isinstance(proof['sha256'], str) and re.fullmatch('[a-f0-9]{64}', proof['sha256'])
            and proof['runtime'] == '/run/sakura-desktop-uid/' + str(identity.get('uid')) + '/' + run.get('runId', ''),
            'Desktop 项目、UID 与完整运行域不符')
    core = desktop_native(run['build'])
    lock = core['initialize_readonly']()
    directory_fd = -1
    try:
        value = core['active'](identity['projectId'], {'expected': {key: identity[key] for key in ('registryId', 'identityId', 'revision')}},
                               core['registry'](True))
        require(value == identity, 'Desktop 项目账户完整绑定已改变')
        actual = core['run_read'](run['runId'])
        boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        core['check_run'](value, actual, boot)
        require(actual == run, 'Desktop 原 native ticket 已改变')
        group = core['cgroup_fd'](run)
        require(group is not None, 'Desktop 原 cgroup 已结束')
        os.close(group)
        net, info, name = core['network_fd'](value, boot, True)
        os.close(net)
        require(name == run['namespace'] and core['same'](info, run, 'network'), 'Desktop 原网络票据已改变')
        folder = Path('/run/sakura-project-desktop') / identity['projectId']
        require(core['json_read'](str(folder / 'owner.json')) == record, 'Desktop 原 service receipt 已改变')
        service_lock = os.open(folder / 'lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            core['trusted'](os.fstat(service_lock), mode=0o600)
            fcntl.flock(service_lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
            require(core['json_read'](str(folder / 'owner.json')) == record, 'Desktop 原 service receipt 正在变化')
            raw = core['read'](str(folder / ('input-' + run['runId'] + '.bin')), 135168)
            header_raw, frame = raw.split(b'\n', 1)
            header = json.loads(header_raw)
            require(set(header) == {'version', 'bootId', 'runId', 'scopeName', 'inode', 'binding', 'fileDevice', 'fileInode', 'sha256', 'bytes'}
                    and header['version'] == 1 and 1 <= header['bytes'] <= 131072 and len(frame) == header['bytes']
                    and header['sha256'] == proof['sha256'] == hashlib.sha256(frame).hexdigest()
                    and all(header[key] == record[key] for key in ('bootId', 'runId', 'scopeName', 'inode', 'binding')),
                    'Desktop 原受保护正文已改变')
            pinned = os.lstat(folder / ('input-' + run['runId'] + '.bin'))
            require((str(pinned.st_dev), str(pinned.st_ino)) == (header['fileDevice'], header['fileInode']),
                    'Desktop 原正文 inode 已改变')
        finally:
            os.close(service_lock)
        directory_fd = core['directory_fd'](identity['directory'], False)
        require(core['same'](os.fstat(directory_fd), identity, 'directory'), 'Desktop 原项目目录 inode 已改变')
        require(type(record.get('panePid')) is int and record['panePid'] > 1
                and isinstance(record.get('paneStartTicks'), str) and re.fullmatch('[1-9][0-9]*', record['paneStartTicks'])
                and isinstance(record.get('sessionId'), str) and re.fullmatch(r'\$[0-9]+', record['sessionId'])
                and isinstance(record.get('paneId'), str) and re.fullmatch('%[0-9]+', record['paneId']), 'Desktop 原 pane 票据不完整')
        pane = Path('/proc') / str(record['panePid'])
        fields = (pane / 'stat').read_text().rsplit(') ', 1)[1].split()
        require(fields[0] not in ('Z', 'X') and fields[19] == record['paneStartTicks']
                and (pane / 'cgroup').read_text() == '0::/' + run['cgroupName'] + '\n', 'Desktop 原 pane PID 已退出或复用')
        tmux = subprocess.run([core['tool']('tmux'), 'list-panes', '-t', record['session'], '-F',
                               '#{session_id}\t#{pane_id}\t#{pane_pid}\t#{pane_dead}'],
                              env=core['CLEAN_ENV'], capture_output=True, timeout=5)
        require(tmux.returncode == 0 and len(tmux.stdout) <= 4096 and len(tmux.stderr) <= 4096
                and tmux.stdout.decode().splitlines() == ['\t'.join([record['sessionId'], record['paneId'], str(record['panePid']), '0'])],
                'Desktop 原 tmux session/pane 已改变')
    except BaseException:
        if directory_fd >= 0: os.close(directory_fd)
        raise
    finally:
        os.close(lock)
    try:
        runtime = Path(proof['runtime'])
        secure_directory(runtime.parent)
        info = runtime.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == identity['uid'] and info.st_gid == identity['gid']
                and stat.S_IMODE(info.st_mode) == 0o700, 'Desktop 私有运行目录已变化')
        guard = core['json_read']('/run/sakura-project-desktop-guards/' + run['runId'] + '.json')
        require(guard.get('phase') == 'active' and guard.get('identity') == identity and guard.get('runId') == run['runId']
                and guard.get('bootId') == run['bootId'] and guard.get('scopeName') == run['cgroupName']
                and guard.get('binding') == record['binding'] and guard.get('sha256') == proof['sha256']
                and guard.get('build') == run['build'] and (guard.get('runtimeDevice'), guard.get('runtimeInode')) == (str(info.st_dev), str(info.st_ino))
                and (guard.get('networkDevice'), guard.get('networkInode')) == (run['networkDevice'], run['networkInode']),
                'Desktop 固定 adapter 原 runtime/网络证明已变化')
        def credential(name, limit):
            fd = os.open(runtime / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
            try:
                info = os.fstat(fd)
                require(stat.S_ISREG(info.st_mode) and info.st_uid == identity['uid'] and info.st_nlink == 1
                        and not info.st_mode & 0o077 and info.st_size <= limit, 'Desktop 凭据权限或大小不符')
                raw = os.read(fd, limit + 1)
                require(len(raw) == info.st_size, 'Desktop 凭据正在变化')
                return info, raw
            finally: os.close(fd)
        auth_info, auth = credential('Xauthority', 8192)
        require(auth, 'Desktop X11 cookie 不存在')
        ready_info, _ = credential('ready', 128)
        candidates, servers = [], []
        for item in Path('/proc').iterdir():
            if not item.name.isdigit(): continue
            try:
                image = os.readlink(item / 'exe')
                if image not in ('/usr/bin/plasmashell', '/usr/bin/Xvnc', '/usr/bin/Xtigervnc'): continue
                if (item / 'cgroup').read_text() != '0::/' + run['cgroupName'] + '\n': continue
                row = desktop_process(int(item.name), identity, run)
                if image == '/usr/bin/plasmashell': candidates.append(row)
                else:
                    arguments = (item / 'cmdline').read_bytes().split(b'\0')
                    if b':1' in arguments and b'-rfbport' in arguments and arguments[arguments.index(b'-rfbport') + 1] == b'5901':
                        require(b'-auth' in arguments and arguments[arguments.index(b'-auth') + 1] == os.fsencode(runtime / 'Xauthority'),
                                'Desktop Xvnc cookie 路径不符')
                        servers.append(row)
            except (FileNotFoundError, ProcessLookupError, PermissionError): pass
        require(len(candidates) == 1 and len(servers) == 1, '需要原完整域中唯一就绪的 Plasma/Xvnc')
        plasma, vnc = candidates[0], servers[0]
        raw = (Path('/proc') / str(plasma['pid']) / 'environ').read_bytes()
        require(len(raw) <= 1048576, 'Desktop 环境过大')
        source = dict(entry.decode().split('=', 1) for entry in raw.split(b'\0') if b'=' in entry)
        require(source.get('HOME') == identity['home'] and source.get('USER') == identity['account']
                and source.get('DISPLAY') == ':1' and source.get('XDG_RUNTIME_DIR') == str(runtime)
                and source.get('XAUTHORITY') == str(runtime / 'Xauthority'), 'Desktop 原 UID/environment authority 不符')
        fd_sockets = set()
        for item in (Path('/proc') / str(vnc['pid']) / 'fd').iterdir():
            try: fd_sockets.add(os.readlink(item))
            except FileNotFoundError: pass
        listeners = [line.split() for line in (Path('/proc') / str(vnc['pid']) / 'net/tcp').read_text().splitlines()[1:]]
        require(any(len(row) > 9 and row[1] == '0100007F:170D' and row[3] == '0A'
                    and 'socket:[' + row[9] + ']' in fd_sockets for row in listeners), 'Desktop VNC 原监听进程不符')
        endpoint = {'plasmaPid': plasma['pid'], 'plasmaCreated': plasma['created'], 'vncPid': vnc['pid'], 'vncCreated': vnc['created'],
                    'runtimeDevice': str(runtime.stat().st_dev), 'runtimeInode': str(runtime.stat().st_ino),
                    'xauthDevice': str(auth_info.st_dev), 'xauthInode': str(auth_info.st_ino), 'xauthSha256': hashlib.sha256(auth).hexdigest(),
                    'readyDevice': str(ready_info.st_dev), 'readyInode': str(ready_info.st_ino)}
        require(proof['endpoint'] is None or proof['endpoint'] == endpoint, 'Desktop 原 Plasma/VNC/cookie 已被替换')
        require(desktop_process(plasma['pid'], identity, run) == plasma and desktop_process(vnc['pid'], identity, run) == vnc,
                'Desktop 原进程正在变化')
        return {'identity': identity, 'run': run, 'runtime': runtime, 'source': source, 'plasma': plasma, 'vnc': vnc,
                'endpoint': endpoint, 'directoryFd': directory_fd, 'user': pwd.getpwnam(identity['account'])}
    except BaseException:
        if directory_fd >= 0: os.close(directory_fd)
        raise
`;
