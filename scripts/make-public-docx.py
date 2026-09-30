"""Create public copies of the master CVs (docs/*.docx -> cv/*.docx) without private contact lines.

Usage: python3 scripts/make-public-docx.py
"""

import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "docs"
OUT_DIR = ROOT / "cv"
# Paragraphs whose text starts with one of these prefixes are removed
PRIVATE_PREFIXES = ("Teams:", "Location:", "Birthday:", "Gender:")

PARAGRAPH = re.compile(r"<w:p[ >].*?</w:p>", re.S)
TEXT = re.compile(r"<w:t[^>]*>([^<]*)</w:t>")


def strip_private(xml: str) -> tuple[str, int]:
    removed = 0

    def repl(m: re.Match) -> str:
        nonlocal removed
        text = "".join(TEXT.findall(m.group(0))).strip()
        if text.startswith(PRIVATE_PREFIXES):
            removed += 1
            return ""
        return m.group(0)

    return PARAGRAPH.sub(repl, xml), removed


def main() -> None:
    sources = sorted(SRC_DIR.glob("*.docx"))
    if not sources:
        sys.exit(f"No .docx found in {SRC_DIR}")
    OUT_DIR.mkdir(exist_ok=True)
    for src in sources:
        out = OUT_DIR / src.name
        with zipfile.ZipFile(src) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename == "word/document.xml":
                    xml, removed = strip_private(data.decode("utf-8"))
                    data = xml.encode("utf-8")
                    print(f"{src.name}: removed {removed} private line(s)")
                zout.writestr(item, data)


if __name__ == "__main__":
    main()
