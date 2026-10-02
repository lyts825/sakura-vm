import { quote } from './files.ts';
import { AppError } from './model.ts';

export const projectLspPrefix = '/opt/sakura-language-services';
export const projectDapPython = '/opt/sakura-debugger/bin/python';
const environment = '/usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C ' +
  'PIP_CONFIG_FILE=/dev/null NPM_CONFIG_USERCONFIG=/dev/null NPM_CONFIG_GLOBALCONFIG=/dev/null';
const versions = { lsp: { typescript: '5.9.3', 'typescript-language-server': '4.3.4', pyright: '1.1.414' }, dap: { debugpy: '1.8.16' } };
function kind(value: 'lsp' | 'dap') { if (value !== 'lsp' && value !== 'dap') throw new AppError('协议工具种类不符', 400); return value; }
const rootGuard = `import json,os,stat
def trusted(path,directory=False):
 info=os.lstat(path)
 if info.st_uid!=0 or info.st_gid!=0 or info.st_mode&0o022 or not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):raise ValueError('shared protocol assets ownership changed')
 if not directory and info.st_nlink!=1:raise ValueError('shared protocol assets links changed')
 return info
def parents(path):
 current='/'
 trusted(current,True)
 for part in path.strip('/').split('/'):
  current=current.rstrip('/')+'/'+part;trusted(current,True)
def asset(path,base):
 parents(os.path.dirname(path));info=os.lstat(path)
 if stat.S_ISLNK(info.st_mode):
  if info.st_uid!=0 or info.st_gid!=0:raise ValueError('shared binary link owner changed')
  resolved=os.path.realpath(path)
  if not (resolved.startswith(base+'/') or os.path.dirname(path)==base+'/bin' and os.path.basename(path).startswith('python') and resolved.startswith('/usr/bin/python3')):raise ValueError('shared binary link target changed')
  parents(os.path.dirname(resolved));info=trusted(resolved)
 else:info=trusted(path)
 return bool(info.st_mode&0o111)
`;
export function projectProtocolInstalledCommand(provider: 'lsp' | 'dap') {
  provider = kind(provider); const base = provider === 'lsp' ? projectLspPrefix : '/opt/sakura-debugger';
  const source = rootGuard + `
base=${JSON.stringify(base)};expected=json.loads(${JSON.stringify(JSON.stringify({ version: 1, kind: provider, versions: versions[provider] }))})
ready=False
try:
 parents(base);path=base+'/.sakura-protocol-assets.json';info=trusted(path)
 if info.st_size>4096:raise ValueError('shared metadata bound')
 descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 with os.fdopen(descriptor,'rb') as stream:value=json.loads(stream.read(4097))
 if value!=expected:raise ValueError('shared metadata versions changed')
 ${provider === 'lsp' ? "ready=asset(base+'/node_modules/.bin/typescript-language-server',base) and asset(base+'/node_modules/.bin/pyright-langserver',base) and asset('/usr/bin/node','/usr') and asset('/usr/bin/python3','/usr')\n parents(base+'/node_modules/typescript/lib');trusted(base+'/node_modules/typescript/lib/tsserver.js')" : "ready=asset(base+'/bin/python',base)"}
except FileNotFoundError:pass
print(json.dumps({'installed':ready}))
`;
  return '# SAKURA_PROTOCOL_ASSETS_' + provider.toUpperCase() + '\n' + environment + ' /usr/bin/python3 -I -S -c ' + quote(source);
}
/** Explicit shared installation accepts no project field, environment or hook. */
export function projectProtocolInstallScript(provider: 'lsp' | 'dap', distro: string) {
  provider = kind(provider); const base = provider === 'lsp' ? projectLspPrefix : '/opt/sakura-debugger';
  const guard = rootGuard + `
base=${JSON.stringify(base)}
parents('/opt')
try:os.mkdir(base,0o755)
except FileExistsError:pass
parents(base)
count=0
for folder,directories,files in os.walk(base,followlinks=False):
 trusted(folder,True)
 for name in directories+files:
  count+=1
  if count>100000:raise ValueError('shared assets inspection bound')
  path=folder+'/'+name;info=os.lstat(path)
  if stat.S_ISLNK(info.st_mode):
   if info.st_uid!=0 or info.st_gid!=0 or not (os.path.realpath(path).startswith(base+'/') or os.path.dirname(path)==base+'/bin' and os.path.basename(path).startswith('python') and os.path.realpath(path).startswith('/usr/bin/python3')):raise ValueError('shared assets link changed')
  else:trusted(path,stat.S_ISDIR(info.st_mode))
`;
  const marker = rootGuard + `
base=${JSON.stringify(base)};parents(base)
path=base+'/.sakura-protocol-assets.json'
if os.path.lexists(path):trusted(path)
descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW|os.O_CLOEXEC,0o644)
os.fchmod(descriptor,0o644)
with os.fdopen(descriptor,'w') as stream:json.dump(json.loads(${JSON.stringify(JSON.stringify({ version: 1, kind: provider, versions: versions[provider] }))}),stream);stream.flush();os.fsync(stream.fileno())
`;
  const tools = distro === 'alpine' ? 'apk add --no-cache --timeout 30 python3 py3-pip ' + (provider === 'lsp' ? 'nodejs npm' : '') :
    'export DEBIAN_FRONTEND=noninteractive\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update\n' +
      'apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y --no-install-recommends python3 python3-pip python3-venv ' + (provider === 'lsp' ? 'nodejs npm' : '');
  const body = 'set -eu\numask 022\ncd /\n' + tools + '\n/usr/bin/python3 -I -S -c ' + quote(guard) + '\n' +
    (provider === 'lsp' ? 'npm install --prefix ' + quote(base) + ' --registry=https://registry.npmjs.org --ignore-scripts --no-audit --no-fund --omit=dev typescript@5.9.3 typescript-language-server@4.3.4 pyright@1.1.414\n' :
      'if ! test -x ' + quote(projectDapPython) + '; then /usr/bin/python3 -I -m venv --without-pip ' + quote(base) + '; fi\n' +
      '/usr/bin/python3 -I -m pip --isolated --python ' + quote(projectDapPython) + ' install --disable-pip-version-check --no-input --no-cache-dir --only-binary=:all: --index-url https://pypi.org/simple debugpy==1.8.16\n') +
    '/usr/bin/python3 -I -S -c ' + quote(marker);
  return 'exec ' + environment + ' /bin/sh -ec ' + quote(body);
}
