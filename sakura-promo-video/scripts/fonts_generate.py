"""Build video-specific Sakura WOFF2 subsets from pinned, licensed sources.

From sakura-promo-video:
  uv pip install --python .venv/Scripts/python.exe -r scripts/fonts_requirements.txt
  .venv/Scripts/python.exe scripts/fonts_generate.py
  .venv/Scripts/python.exe scripts/fonts_generate.py --check

Upstream font files are read from the parent project's .tools/font-sources cache
when available. A clean checkout downloads each pinned Google Fonts source URL
from the parent manifest into this video's .cache/fonts, verifying its Git blob
ID before caching or using it. Existing video OFL files provide the verified
licenses. Only this video directory is written; parent font assets and caches
remain read-only. --check validates coverage without regenerating font outputs.
"""

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
from urllib.request import Request, urlopen

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

VIDEO = Path(__file__).resolve().parent.parent
PARENT = VIDEO.parent
OUTPUT = VIDEO / "public" / "brand" / "fonts"
SOURCE_MANIFEST = PARENT / "src" / "assets" / "fonts" / "manifest.json"
SOURCE_BUILDER = PARENT / "scripts" / "build-fonts.py"
CACHE = PARENT / ".tools" / "font-sources"
VIDEO_CACHE = VIDEO / ".cache" / "fonts"
LICENSES = {
    "Sakura Sans": "1c9f43281b8f216c5461fe9ac729afbade7724e4",
    "Sakura Serif": "94d1bf7b52481343e2983fb7751e8b7abe1ea07b",
}
BLOBS = {
    "Sakura Sans": "fb0637bafbcd804fe32152370a1225990745b4bc",
    "Sakura Serif": "eab063faf229160a52d3760f5555150e4eb9e5bf",
}
PUNCTUATION = "、。·：；？！「」『』（）【】《》〈〉—…〜・　，"
# Covers announced concurrent copy corrections before they reach disk.
COPY_RESERVE = "8 GiB uname -s Linux ~/demo-project 默认未启用 停机保存磁盘状态"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def checked_blob(blob, *, source_url=None, license_path=None):
    """Read existing verified sources, or fetch a pinned font into local cache."""
    parent_path = CACHE / blob
    cached_path = VIDEO_CACHE / blob
    downloaded = False
    if parent_path.exists():
        path = parent_path
        data = path.read_bytes()
    elif license_path is not None:
        path = license_path
        data = path.read_bytes()
    elif cached_path.exists():
        path = cached_path
        data = path.read_bytes()
    elif source_url is not None:
        path = cached_path
        request = Request(source_url, headers={"User-Agent": "Sakura-Video-Font-Builder"})
        with urlopen(request, timeout=60) as response:
            data = response.read()
        downloaded = True
    else:
        raise FileNotFoundError(f"No pinned source or bundled license for {blob}")
    actual = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
    if actual != blob:
        raise ValueError(f"Pinned font/license checksum mismatch: {path}")
    if downloaded:
        VIDEO_CACHE.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return path


def corpus():
    paths = sorted(p for p in (VIDEO / "src").rglob("*")
                   if p.suffix in {".ts", ".tsx"})
    paths.append(VIDEO / "public" / "audio" / "transcript.json")
    texts = [p.read_text(encoding="utf-8") for p in paths]
    text = "\n".join(texts) + PUNCTUATION + COPY_RESERVE
    points = (set(range(0x20, 0x7F)) | set(range(0xA0, 0x100))
              | {ord(c) for c in text if ord(c) > 127})
    files = {p.relative_to(VIDEO).as_posix(): digest(p) for p in paths}
    return points, files


def is_hanzi(point):
    return (0x3400 <= point <= 0x4DBF or 0x4E00 <= point <= 0x9FFF
            or 0xF900 <= point <= 0xFAFF or 0x20000 <= point <= 0x323AF)


def rename(font, family):
    names = font["name"]
    values = {1: family, 2: "Regular", 3: family + " Video subset",
              4: family, 6: family.replace(" ", "") + "-Regular",
              16: family, 17: "Regular"}
    for name_id, value in values.items():
        names.removeNames(nameID=name_id)
        names.setName(value, name_id, 3, 1, 0x409)
    # Upstream copyright, license, designer, and version records are preserved.


def validate(path, family, required):
    with TTFont(path) as font:
        supported = set(font.getBestCmap())
        missing_hanzi = sorted(p for p in required - supported if is_hanzi(p))
        if missing_hanzi:
            raise ValueError(f"{family} missing Hanzi: {''.join(map(chr, missing_hanzi))}")
        for name_id in (1, 4, 16):
            assert font["name"].getDebugName(name_id) == family
        weights = next(axis for axis in font["fvar"].axes if axis.axisTag == "wght")
        assert (weights.minValue, weights.maxValue) == (400, 700)
        assert set(range(0x20, 0x7F)) <= supported
        assert {ord(c) for c in PUNCTUATION} <= supported
        return supported


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate current live copy only")
    args = parser.parse_args()
    required, files = corpus()
    upstream = json.loads(SOURCE_MANIFEST.read_text(encoding="utf-8"))
    existing = json.loads((OUTPUT / "manifest.json").read_text(encoding="utf-8"))
    records = []
    for source in upstream:
        family = source["family"]
        if family not in BLOBS:
            records.append(next(record for record in existing if record["family"] == family))
            continue
        assert source["sourceGitBlob"] == BLOBS[family], "Upstream pin changed"
        destination = OUTPUT / source["file"]
        original_path = checked_blob(BLOBS[family], source_url=source["source"])
        license_path = checked_blob(
            LICENSES[family],
            license_path=OUTPUT / source["file"].replace(".woff2", "-OFL.txt"),
        )
        if args.check:
            supported = validate(destination, family, required)
            record = next(record for record in existing if record["family"] == family)
            assert record["sha256"] == digest(destination)
            with TTFont(original_path) as original:
                assert required & set(original.getBestCmap()) <= supported, "Live copy changed; rebuild fonts"
            print(f"{family}: all {sum(map(is_hanzi, required))} required Hanzi covered; {len(supported)} code points")
            continue

        font = TTFont(original_path, recalcTimestamp=False)
        supported_upstream = set(font.getBestCmap())
        baseline = PARENT / "src" / "assets" / "fonts" / source["file"]
        assert digest(baseline) == source["sha256"], "Upstream subset checksum changed"
        with TTFont(baseline) as prior:
            points = (required | set(prior.getBestCmap())) & supported_upstream
        missing_upstream = sorted(p for p in required - supported_upstream if is_hanzi(p))
        if missing_upstream:
            raise ValueError(f"Pinned upstream lacks required Hanzi: {missing_upstream}")
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
        rename(font, family)
        font.flavor = "woff2"
        font.save(destination)
        font.close()
        actual = validate(destination, family, required)
        assert points <= actual
        # Exact cached OFL is retained next to each derivative font.
        (OUTPUT / source["file"].replace(".woff2", "-OFL.txt")).write_bytes(license_path.read_bytes())
        records.append({**source, "bytes": destination.stat().st_size,
                        "glyphs": len(actual), "sha256": digest(destination),
                        "subsetPurpose": "Sakura promo video: src/**/*.ts(x) + transcript.json",
                        "sourceSha256": digest(original_path),
                        "licenseGitBlob": LICENSES[family],
                        "licenseSha256": digest(license_path),
                        "upstreamManifestSha256": digest(SOURCE_MANIFEST),
                        "upstreamBuilderSha256": digest(SOURCE_BUILDER),
                        "upstreamSubsetSha256": digest(baseline),
                        "recipe": "scripts/fonts_generate.py",
                        "dependencies": {name: importlib.metadata.version(name)
                                         for name in ("fonttools", "brotli", "zopfli")},
                        "corpusFilesSha256": files,
                        "requiredHanzi": sum(map(is_hanzi, required)),
                        "unsupportedNonHanzi": [f"U+{p:04X}" for p in sorted(required - supported_upstream)]})
        print(f"{family}: {len(actual)} code points, {destination.stat().st_size:,} bytes; all required Hanzi covered", flush=True)
    if not args.check:
        (OUTPUT / "manifest.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
