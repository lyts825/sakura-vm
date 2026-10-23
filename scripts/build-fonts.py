# 从固定且许可明确的字体源生成应用 WOFF2 子集，校验 Git blob 并维护字体清单。
# Generate application WOFF2 subsets from pinned licensed sources, verify Git blob identities and maintain the font manifest.
"""Rebuild the checked-in, local web fonts. Not required by npm build/start.

python -m pip install --target .tools/font-python -r scripts/font-requirements.txt
python scripts/build-fonts.py
"""

import hashlib
import html
import json
from pathlib import Path
import subprocess
import sys
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / ".tools" / "font-python"))

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

CACHE = ROOT / ".tools" / "font-sources"
OUTPUT = ROOT / "src" / "assets" / "fonts"
GOOGLE = "e44c4b011a820c2cbe2fd2cfa8052037d7edb571"
JETBRAINS = "19371302b95d218af43299bce79ddbddd0bc364d"
SOURCES = [
    {
        "family": "Sakura Sans",
        "upstream": "Noto Sans SC",
        "file": "sakura-sans-ui.woff2",
        "base": f"https://raw.githubusercontent.com/google/fonts/{GOOGLE}/ofl/notosanssc/",
        "font": "NotoSansSC%5Bwght%5D.ttf",
        "blob": "fb0637bafbcd804fe32152370a1225990745b4bc",
        "license_blob": "1c9f43281b8f216c5461fe9ac729afbade7724e4",
    },
    {
        "family": "Sakura Serif",
        "upstream": "Noto Serif SC",
        "file": "sakura-serif-ui.woff2",
        "base": f"https://raw.githubusercontent.com/google/fonts/{GOOGLE}/ofl/notoserifsc/",
        "font": "NotoSerifSC%5Bwght%5D.ttf",
        "blob": "eab063faf229160a52d3760f5555150e4eb9e5bf",
        "license_blob": "94d1bf7b52481343e2983fb7751e8b7abe1ea07b",
    },
    {
        "family": "Sakura Mono",
        "upstream": "JetBrains Mono",
        "file": "sakura-mono.woff2",
        "base": f"https://raw.githubusercontent.com/JetBrains/JetBrainsMono/{JETBRAINS}/",
        "font": "fonts/variable/JetBrainsMono%5Bwght%5D.ttf",
        "blob": "5b7a5266cbdcf79261e02b380dba890c5f38faf2",
        "license_blob": "5ceee0025da23d2cd5fd14b28569708a8db4db2b",
    },
]

# 使用现有 TypeScript 解析器收集运行时文本；注释与类型标识不进入字形清单。
# Collect runtime text with the installed TypeScript parser; exclude comments and type identifiers.
TEXT_COLLECTOR = r"""
import ts from 'typescript';
import { readFileSync } from 'node:fs';
const texts = [];
for (const path of JSON.parse(readFileSync(0, 'utf8'))) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest,
    true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (source.parseDiagnostics.length) throw new Error(`Invalid font corpus source: ${path}`);
  function visit(node) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) || ts.isJsxText(node)) texts.push(node.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
}
process.stdout.write(JSON.stringify(texts));
"""


# 按 family 的显式源码范围提取文案，返回原覆盖基线与文案码点的并集；不写资源。
# Extract text from the explicit family source scope and return its union with baseline codepoints, without writing assets.
def ui_codepoints(family, coverage):
    points = set(coverage["baseline"]["codepoints"])
    paths = set()
    for pattern in coverage["sources"][family]:
        matched = [path for path in ROOT.glob(pattern) if path.is_file()]
        if not matched:
            raise ValueError(f"Font corpus pattern matched no source: {pattern}")
        paths.update(path.relative_to(ROOT).as_posix() for path in matched)
    if paths:
        result = subprocess.run(
            ["node", "--input-type=module", "-e", TEXT_COLLECTOR],
            input=json.dumps(sorted(paths)), text=True, encoding="utf-8",
            cwd=ROOT, check=True, capture_output=True,
        )
        for text in json.loads(result.stdout):
            points.update(ord(char) for char in html.unescape(text) if ord(char) >= 0x20)
    return points


# 复用或下载固定字体源，按 Git blob SHA-1 核对原始字节后才写入缓存。
# Reuse/download pinned font sources and validate original bytes by Git blob SHA-1 before caching.
def checked_source(url, blob):
    path = CACHE / blob
    data = path.read_bytes() if path.exists() else urlopen(
        Request(url, headers={"User-Agent": "Sakura-Font-Builder"}), timeout=60
    ).read()
    actual = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
    if actual != blob:
        raise ValueError(f"Font source checksum mismatch: {url}")
    if not path.exists():
        path.write_bytes(data)
    return path


# 将子集家庭与 PostScript 命名改为应用专用名称，保持许可要求与字体选择一致。
# Rename subset family/PostScript records to application-specific names for consistent selection/license handling.
def rename(font, family):
    names = font["name"]
    values = {
        1: family, 2: "Regular", 3: family + " UI subset",
        4: family, 6: family.replace(" ", "") + "-Regular",
        16: family, 17: "Regular",
    }
    for name_id, value in values.items():
        names.removeNames(nameID=name_id)
        names.setName(value, name_id, 3, 1, 0x409)
    # Copyright, license, designer, and upstream version metadata remain intact.


# 按固定字集与许可源生成可变 WOFF2 字体，保留字重轴并写出资源摘要清单。
# Generate variable WOFF2 from fixed corpora/licensed sources, preserve weight axes and write asset-hash records.
def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    coverage = json.loads((OUTPUT / "ui-coverage.json").read_text(encoding="utf-8"))
    if coverage["schemaVersion"] != 1:
        raise ValueError("Unsupported font coverage schema")
    records = []
    for source in SOURCES:
        print(f"Preparing {source['upstream']}…", flush=True)
        original = checked_source(source["base"] + source["font"], source["blob"])
        license_path = checked_source(source["base"] + "OFL.txt", source["license_blob"])
        (OUTPUT / (source["file"].replace(".woff2", "-OFL.txt"))).write_bytes(license_path.read_bytes())
        font = TTFont(original, recalcTimestamp=False)
        cmap = font.getBestCmap()
        # Keep the mono family's full language/symbol coverage for arbitrary shell output.
        points = (set(cmap) if source["family"] == "Sakura Mono"
                  else ui_codepoints(source["family"], coverage) & set(cmap))
        options = subset.Options()
        options.name_IDs = ["*"]
        options.name_languages = ["*"]
        options.name_legacy = True
        options.notdef_glyph = True
        options.notdef_outline = True
        options.recalc_timestamp = False
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=points)
        subsetter.subset(font)
        instantiateVariableFont(font, {"wght": (400, 700)}, inplace=True)
        rename(font, source["family"])
        font.flavor = "woff2"
        destination = OUTPUT / source["file"]
        font.save(destination)
        check = TTFont(destination)
        assert points <= set(check.getBestCmap()), "Subsetting removed required glyphs"
        assert check["fvar"].axes[0].minValue == 400
        assert check["fvar"].axes[0].maxValue == 700
        records.append({
            "family": source["family"], "upstream": source["upstream"],
            "source": source["base"] + source["font"], "sourceGitBlob": source["blob"],
            "file": source["file"], "bytes": destination.stat().st_size,
            "glyphs": len(points), "weights": [400, 700],
            "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
        })
        print(f"  {len(points)} characters · {destination.stat().st_size / 1024:.1f} KiB", flush=True)
    (OUTPUT / "manifest.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")
    print(f"Total: {sum(record['bytes'] for record in records) / 1024:.1f} KiB", flush=True)


if __name__ == "__main__":
    main()
