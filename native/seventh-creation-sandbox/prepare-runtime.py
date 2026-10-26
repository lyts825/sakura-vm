"""Prepare and fingerprint a dedicated local Windows-x64 Python tool runtime."""
import hashlib
import importlib.metadata
import json
import os
import pathlib
import shutil
import subprocess
import sys

if sys.platform != 'win32' or sys.version_info[:2] != (3, 12):
    raise SystemExit('Requires Windows x64 CPython 3.12 and the fixed installed tool packages')
root = pathlib.Path(__file__).resolve().parents[2]
assets = root / '.tools' / 'seventh-creation'
target = assets / 'runtime'
for parent in (root, root / '.tools', assets, target):
    if parent.exists() and (parent.is_symlink() or parent.is_junction()):
        raise SystemExit('Runtime path must not traverse a link or junction')
target.mkdir(parents=True, exist_ok=True)
source = pathlib.Path(sys.base_prefix)
packages = ['numpy', 'scipy', 'scikit-learn', 'joblib', 'narwhals', 'threadpoolctl', 'Pillow', 'PyMuPDF', 'pytesseract', 'packaging', 'pypdf']
versions = {name: importlib.metadata.version(name) for name in packages}
locked = dict(line.strip().split('==', 1) for line in (pathlib.Path(__file__).parent / 'requirements.txt').read_text(encoding='utf-8').splitlines() if line.strip() and not line.startswith('#'))
if sys.version.split()[0] != '3.12.10' or versions != locked:
    raise SystemExit('Requires exactly CPython 3.12.10 and the locally installed requirements.txt versions; no packages are installed by this script')
for pattern in ('python.exe', 'python3.dll', 'python312.dll', 'vcruntime*.dll'):
    for path in source.glob(pattern):
        shutil.copy2(path, target / path.name)
shutil.copy2(source / 'LICENSE.txt', target / 'LICENSE.txt')
for name in ('DLLs', 'Lib'):
    shutil.copytree(source / name, target / name, dirs_exist_ok=True, ignore=shutil.ignore_patterns('site-packages', '__pycache__', 'test', 'tests', 'idlelib', 'tkinter', 'turtledemo', 'ensurepip'))
site = source / 'Lib' / 'site-packages'
out = target / 'Lib' / 'site-packages'
out.mkdir(exist_ok=True)
for name in ('numpy', 'numpy.libs', 'scipy', 'scipy.libs', 'sklearn', 'sklearn.libs', 'joblib', 'narwhals', 'threadpoolctl.py', 'PIL', 'pillow.libs', 'pymupdf', 'pytesseract', 'packaging', 'pypdf'):
    path = site / name
    if not path.exists():
        continue
    if path.is_dir():
        shutil.copytree(path, out / name, dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__', 'tests', 'test'))
    else:
        shutil.copy2(path, out / name)
for path in site.glob('*.dist-info'):
    if path.name.split('-')[0].lower() in ('numpy', 'scipy', 'scikit_learn', 'joblib', 'narwhals', 'threadpoolctl', 'pillow', 'pymupdf', 'pytesseract', 'packaging', 'pypdf'):
        shutil.copytree(path, out / path.name, dirs_exist_ok=True)
worker = root / 'server' / 'seventh-creation-native-worker.py'
shutil.copy2(worker, target / worker.name)
shutil.copy2(worker, assets / worker.name)
tesseract = pathlib.Path('C:/Program Files/Tesseract-OCR')
tesseract_version = subprocess.run([str(tesseract / 'tesseract.exe'), '--version'], capture_output=True, text=True, check=True, creationflags=subprocess.CREATE_NO_WINDOW).stdout.splitlines()[0].strip()
if tesseract_version != 'tesseract v5.4.0.20240606':
    raise SystemExit('Requires locally installed Tesseract v5.4.0.20240606 at C:/Program Files/Tesseract-OCR')
tessout = target / 'tesseract'
tessout.mkdir(exist_ok=True)
for pattern in ('tesseract.exe', '*.dll'):
    for path in tesseract.glob(pattern):
        shutil.copy2(path, tessout / path.name)
(tessout / 'tessdata').mkdir(exist_ok=True)
for name in ('eng.traineddata', 'osd.traineddata'):
    shutil.copy2(tesseract / 'tessdata' / name, tessout / 'tessdata' / name)
shutil.copytree(tesseract / 'doc', tessout / 'doc', dirs_exist_ok=True)
compiler = pathlib.Path(os.environ['SystemRoot']) / 'Microsoft.NET' / 'Framework64' / 'v4.0.30319' / 'csc.exe'
native_source = root / 'native' / 'seventh-creation-sandbox' / 'Program.cs'
native_digest = hashlib.sha256(native_source.read_bytes()).hexdigest()
previous = {}
try:
    previous = json.loads((assets / 'runtime-manifest.json').read_text(encoding='utf-8'))
except (OSError, ValueError):
    pass
helper = assets / 'sandbox.exe'
reuse_helper = helper.is_file() and previous.get('sourceSha256') == native_digest and previous.get('helperSha256') == hashlib.sha256(helper.read_bytes()).hexdigest()
if not reuse_helper:
    subprocess.run([str(compiler), '/nologo', '/platform:x64', '/optimize+', '/r:System.Web.Extensions.dll', '/out:' + str(helper), str(native_source)], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
files = []
for path in sorted(target.rglob('*')):
    if path.is_file():
        files.append({'path': path.relative_to(target).as_posix(), 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
manifest = {'schemaVersion': 1, 'platform': 'win32', 'architecture': 'x64', 'backend': 'windows-appcontainer-job', 'sessionProtocol': 'guarded-native/1', 'python': sys.version.split()[0], 'packages': versions, 'tesseract': {'version':tesseract_version, 'languages':['eng','osd'], 'license':'tesseract/doc/LICENSE'}, 'sourceSha256': native_digest, 'helperSha256': hashlib.sha256(helper.read_bytes()).hexdigest(), 'workerSha256': hashlib.sha256(worker.read_bytes()).hexdigest(), 'runtimeBytes': sum(item['bytes'] for item in files), 'files': files}
(assets / 'runtime-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps({key: value for key, value in manifest.items() if key != 'files'}))
