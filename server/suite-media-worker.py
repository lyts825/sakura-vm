"""Fixed offline FFmpeg profiles. All filenames, options and filters are generated here."""
import base64
import datetime
import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time

LIMIT = 4 * 1024 * 1024
deadline = time.time() + 600


def require(condition, message):
    if not condition:
        raise ValueError(message)


def command(args):
    remaining = min(90, deadline - time.time())
    require(remaining > 0, 'deadline exceeded')
    result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=remaining, check=False,
                            env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'})
    require(result.returncode == 0, 'tool failed: ' + result.stderr.decode('utf-8', 'replace')[-350:])
    require(len(result.stdout) <= 1024 * 1024, 'tool control output too large')
    return result.stdout


def header(data, fmt):
    match = {'png': data.startswith(b'\x89PNG\r\n\x1a\n'),
             'jpeg': data.startswith(b'\xff\xd8\xff'),
             'webp': data[:4] == b'RIFF' and data[8:12] == b'WEBP',
             'wav': data[:4] == b'RIFF' and data[8:12] == b'WAVE',
             'mp4': data[4:8] == b'ftyp'}
    require(match.get(fmt, False), 'declared format and bytes differ')
    require(b'ICC_PROFILE\x00' not in data and b'iCCP' not in data and b'ICCP' not in data,
            'embedded ICC profiles require an unsupported color workflow')


def orientation(data):
    if data[:2] != b'\xff\xd8':
        return 1
    p = 2
    while p + 4 <= len(data) and data[p] == 255:
        marker = data[p + 1]
        if marker in (0xda, 0xd9):
            break
        length = int.from_bytes(data[p + 2:p + 4], 'big')
        require(length >= 2 and p + 2 + length <= len(data), 'invalid JPEG segment')
        value = data[p + 4:p + 2 + length]
        if marker == 0xe1 and value.startswith(b'Exif\x00\x00'):
            tiff = value[6:]
            require(tiff[:2] in (b'II', b'MM') and len(tiff) >= 8, 'invalid EXIF')
            order = '<' if tiff[:2] == b'II' else '>'
            require(struct.unpack_from(order + 'H', tiff, 2)[0] == 42, 'invalid TIFF')
            off = struct.unpack_from(order + 'I', tiff, 4)[0]
            require(off + 2 <= len(tiff), 'invalid EXIF offset')
            count = struct.unpack_from(order + 'H', tiff, off)[0]
            require(count <= 256 and off + 2 + count * 12 <= len(tiff), 'invalid EXIF table')
            for i in range(count):
                entry = off + 2 + i * 12
                tag, kind, n = struct.unpack_from(order + 'HHI', tiff, entry)
                if tag == 274:
                    require(kind == 3 and n == 1, 'unsupported EXIF orientation')
                    angle = struct.unpack_from(order + 'H', tiff, entry + 8)[0]
                    require(1 <= angle <= 8, 'invalid EXIF orientation')
                    return angle
        p += length + 2
    return 1


def ffargs(path):
    return ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror',
            '-protocol_whitelist', 'file,pipe', '-noautorotate', '-i', path]


def probe(path, fmt):
    with open(path, 'rb') as f:
        data = f.read(LIMIT + 1)
    require(0 < len(data) <= LIMIT, 'media byte budget exceeded')
    header(data, fmt)
    raw = json.loads(command(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe',
                              '-show_format', '-show_streams', '-of', 'json', path]))
    streams = raw.get('streams', [])
    video = [s for s in streams if s.get('codec_type') == 'video']
    audio = [s for s in streams if s.get('codec_type') == 'audio']
    require(len(streams) == len(video) + len(audio) and len(video) <= 1 and len(audio) <= 1,
            'unsupported auxiliary tracks')
    require(len(streams) > 0, 'no supported stream')
    v = video[0] if video else {}
    a = audio[0] if audio else {}
    allowed = {'png': ['png'], 'jpeg': ['mjpeg'], 'webp': ['webp'],
               'mp4': ['h264'], 'wav': ['pcm_s16le', 'pcm_s24le', 'pcm_f32le']}
    codec = (a if fmt == 'wav' else v).get('codec_name', '')
    require(codec in allowed[fmt], 'unsupported codec')
    require(not audio or fmt in ('mp4', 'wav'), 'unexpected audio')
    require(not video or fmt != 'wav', 'unexpected video')
    require(not a or a.get('codec_name') in ('aac', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le'), 'unsupported audio codec')
    width, height = int(v.get('width', 0)), int(v.get('height', 0))
    require(width * height <= 4000000 and width <= 4096 and height <= 4096, 'decoded pixel budget exceeded')
    rate = v.get('avg_frame_rate', '0/1')
    numerator, denominator = (float(x) for x in rate.split('/'))
    fps = numerator / denominator if denominator else 0
    duration = float(raw.get('format', {}).get('duration', v.get('duration', a.get('duration', 0))) or 0)
    require(math.isfinite(duration) and duration >= 0 and math.isfinite(fps), 'invalid media timing')
    if fmt == 'mp4':
        require(0 < duration <= 30.1 and width <= 1280 and height <= 720 and 0 < fps <= 30.01, 'video budget exceeded')
    elif fmt == 'wav':
        require(0 < duration <= 60.1, 'audio duration budget exceeded')
    else:
        duration = 0
    channels, sample = int(a.get('channels', 0)), int(a.get('sample_rate', 0))
    require(channels <= 2 and sample <= 48000, 'audio channel or sampling budget exceeded')
    rotation = 0
    for item in v.get('side_data_list', []):
        if 'rotation' in item:
            rotation = int(item['rotation']) % 360
            require(rotation in (0, 90, 180, 270), 'unsupported display rotation')
    tags = raw.get('format', {}).get('tags', {})
    keys = sorted(set(list(tags) + [key for s in streams for key in s.get('tags', {})]))
    require(len(keys) <= 100 and all(len(x) <= 80 for x in keys), 'metadata key budget exceeded')
    color = v.get('color_space', 'unknown')
    require(color in ('unknown', 'unspecified', 'bt709', 'gbr', 'bt470bg', 'smpte170m'), 'unsupported color space')
    decode = ffargs(path) + ['-map', '0:v?', '-map', '0:a?', '-f', 'null', '-']
    command(decode)
    frames = 0
    if video:
        counted = json.loads(command(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe',
                                     '-select_streams', 'v:0', '-count_frames', '-show_entries',
                                     'stream=nb_read_frames', '-of', 'json', path]))
        frames = int(counted['streams'][0]['nb_read_frames'])
        require(frames == 1 if fmt != 'mp4' else 0 < frames <= 900,
                'animated image or decoded frame budget unsupported')
    return {'format': fmt, 'codec': codec, 'audioCodec': a.get('codec_name') if fmt == 'mp4' else None,
            'width': width, 'height': height, 'durationMs': round(duration * 1000),
            'frames': frames,
            'fps': fps if fmt == 'mp4' else 0, 'sampleRate': sample, 'channels': channels,
            'rotation': rotation, 'orientation': orientation(data),
            'alpha': any(x in v.get('pix_fmt', '') for x in ('rgba', 'yuva', 'argb', 'bgra', 'abgr', 'gbrap', 'pal8')),
            'color': 'bt709' if color == 'bt709' else 'srgb-untagged' if fmt in ('png', 'jpeg', 'webp') else 'unspecified',
            'metadataKeys': keys, 'decoded': True}


def transforms(facts):
    rotate = {0: [], 90: ['transpose=2'], 180: ['hflip', 'vflip'], 270: ['transpose=1']}[facts['rotation']]
    exif = {1: [], 2: ['hflip'], 3: ['hflip', 'vflip'], 4: ['vflip'],
            5: ['transpose=1', 'hflip'], 6: ['transpose=1'], 7: ['transpose=2', 'hflip'], 8: ['transpose=2']}
    return rotate + exif[facts['orientation']]


def produce(source, facts, recipe, directory):
    kind = recipe['kind']
    base = ffargs(source)
    strips = ['-map_metadata', '-1', '-map_chapters', '-1', '-metadata:s:v:0', 'rotate=0']
    files = []
    if kind == 'image':
        require(facts['format'] in ('png', 'jpeg', 'webp'), 'image recipe requires a still image')
        for i, size in enumerate(recipe['sizes']):
            w, h = size['width'], size['height']
            fit = recipe['fit']
            vf = transforms(facts) + ['format=rgba', 'scale=%d:%d:force_original_aspect_ratio=%s' % (w, h, 'decrease' if fit == 'contain' else 'increase')]
            vf += ['pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=0x00000000' % (w, h) if fit == 'contain' else 'crop=%d:%d' % (w, h), 'setsar=1']
            name = 'image-%d-%dx%d.png' % (i + 1, w, h)
            path = os.path.join(directory, name)
            command(base + ['-map', '0:v:0', '-vf', ','.join(vf), '-frames:v', '1', '-c:v', 'png', '-threads', '1'] + strips + ['-y', path])
            files.append((name, 'png', path, w, h))
    else:
        start, duration = recipe['startMs'], recipe['durationMs']
        require(start + duration <= facts['durationMs'], 'clip extends beyond the decoded source')
        clip = ['-ss', '%.3f' % (start / 1000), '-t', '%.3f' % (duration / 1000)]
        if kind == 'video':
            require(facts['format'] == 'mp4', 'video recipe requires MP4')
            w, h = recipe['width'], recipe['height']
            vf = transforms(facts) + ['scale=%d:%d:force_original_aspect_ratio=decrease' % (w, h), 'pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=black' % (w, h), 'setsar=1', 'fps=12', 'format=yuv420p']
            path = os.path.join(directory, 'clip.mp4')
            command(base + clip + ['-map', '0:v:0', '-map', '0:a?', '-vf', ','.join(vf), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-threads', '1', '-c:a', 'aac', '-b:a', '64k', '-ac', '2', '-ar', '48000', '-movflags', '+faststart'] + strips + ['-y', path])
            files.append(('clip.mp4', 'mp4', path, w, h))
            if recipe['thumbnail']:
                thumb = os.path.join(directory, 'thumbnail.png')
                command(ffargs(path) + ['-map', '0:v:0', '-frames:v', '1', '-c:v', 'png', '-threads', '1'] + strips + ['-y', thumb])
                files.append(('thumbnail.png', 'png', thumb, w, h))
        else:
            require(facts['format'] in ('wav', 'mp4') and facts['channels'] > 0, 'audio recipe requires audio')
            path = os.path.join(directory, 'audio.wav')
            command(base + clip + ['-map', '0:a:0', '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le'] + strips + ['-y', path])
            files.append(('audio.wav', 'wav', path, 0, 0))
    output = []
    for name, fmt, path, w, h in files:
        actual = probe(path, fmt)
        require(actual['width'] == w and actual['height'] == h, 'derived dimensions differ')
        require(actual['orientation'] == 1 and actual['rotation'] == 0, 'derived orientation not normalized')
        if fmt in ('wav', 'mp4'):
            require(abs(actual['durationMs'] - recipe['durationMs']) <= (90 if fmt == 'mp4' else 2), 'derived clip duration differs')
        with open(path, 'rb') as f:
            data = f.read(LIMIT + 1)
        require(len(data) <= LIMIT, 'output byte budget exceeded')
        output.append({'name': name, 'format': fmt, 'facts': actual, 'bytes': {'bytes': len(data), 'digest': hashlib.sha256(data).hexdigest(), 'chunks': [base64.b64encode(data[i:i + 524288]).decode('ascii') for i in range(0, len(data), 524288)]}})
    return output


def main():
    global deadline
    require(os.getuid() == 65534 and os.getgid() == 65534, 'worker requires the dedicated non-root identity')
    raw = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
    require(len(raw) <= 8 * 1024 * 1024, 'input exceeds limit')
    envelope = json.loads(raw)
    deadline = datetime.datetime.fromisoformat(envelope['deadline'].replace('Z', '+00:00')).timestamp()
    value = envelope['input']
    canonical = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
    require(hashlib.sha256(canonical).hexdigest() == envelope['inputDigest'], 'input digest differs')
    require(value['format'] == 'sakura-media-worker/1' and 1 <= len(value['items']) <= 3, 'invalid worker input')
    require(command(['ffmpeg', '-version']).startswith(b'ffmpeg version 8.0.1 '), 'FFmpeg version mismatch')
    results, total = [], 0
    directory = tempfile.mkdtemp(prefix='media-fixed-')
    os.chmod(directory, 0o700)
    try:
        for index, item in enumerate(value['items']):
            result = {'key': item['key'], 'state': 'failed', 'inputDigest': item['source']['digest'], 'facts': None, 'outputs': [], 'error': None}
            try:
                data = b''.join(base64.b64decode(c, validate=True) for c in item['source']['chunks'])
                require(len(data) == item['source']['bytes'] and hashlib.sha256(data).hexdigest() == item['source']['digest'], 'source bytes differ')
                total += len(data)
                require(total <= LIMIT, 'batch input byte budget exceeded')
                work = os.path.join(directory, str(index))
                os.mkdir(work, 0o700)
                path = os.path.join(work, 'input.' + item['format'])
                with open(path, 'xb') as f:
                    f.write(data)
                facts = probe(path, item['format'])
                result['facts'] = facts
                if value['mode'] == 'transform':
                    result['outputs'] = produce(path, facts, item['recipe'], work)
                require(sum(o['bytes']['bytes'] for r in results + [result] for o in r['outputs']) <= LIMIT, 'batch output byte budget exceeded')
                result['state'] = 'verified'
            except Exception as error:
                result['outputs'] = []
                result['error'] = str(error)[:500]
            results.append(result)
    finally:
        shutil.rmtree(directory)
    output = {'format': 'sakura-media-result/1', 'outcome': 'passed' if all(r['state'] == 'verified' for r in results) else 'failed', 'tool': 'ffmpeg-8.0.1', 'items': results, 'rules': 'media-fixed-profiles-v1'}
    encoded = json.dumps(output, ensure_ascii=False, separators=(',', ':')).encode()
    require(len(encoded) <= 8 * 1024 * 1024, 'result exceeds transport budget')
    sys.stdout.buffer.write(encoded)


try:
    main()
except Exception as error:
    sys.stderr.write(str(error)[:500])
    sys.exit(1)
