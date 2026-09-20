"""Rebuild the checked-in, local web fonts. Not required by npm build/start.

python -m pip install --target .tools/font-python -r scripts/font-requirements.txt
python scripts/build-fonts.py
"""

import hashlib
import json
from pathlib import Path
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


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    ui_text = "".join(
        path.read_text(encoding="utf-8")
        for folder in (ROOT / "src", ROOT / "server")
        for path in sorted(folder.rglob("*.ts*"))
    )
    ui_points = set(range(0x20, 0x100)) | {ord(char) for char in ui_text if ord(char) > 127}
    ui_points |= {ord(char) for char in "、。·：；？！「」『』（）【】《》〈〉—…〜・　"}
    records = []
    for source in SOURCES:
        print(f"Preparing {source['upstream']}…", flush=True)
        original = checked_source(source["base"] + source["font"], source["blob"])
        license_path = checked_source(source["base"] + "OFL.txt", source["license_blob"])
        (OUTPUT / (source["file"].replace(".woff2", "-OFL.txt"))).write_bytes(license_path.read_bytes())
        font = TTFont(original, recalcTimestamp=False)
        cmap = font.getBestCmap()
        # Keep the mono family's full language/symbol coverage for arbitrary shell output.
        points = set(cmap) if source["family"] == "Sakura Mono" else ui_points & set(cmap)
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
