#!/usr/bin/env python3
"""Fail if a relative link in a tracked Markdown file points to a missing file.

Usage: python3 scripts/check-md-links.py   (run from anywhere inside the repo)
External links (http, https, mailto), pure anchors and absolute site paths
(VitePress routes such as /library/tracing) are not checked. Anchors after
`#` are not validated, only the file.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
LINK = re.compile(r"(?<!\!)\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
IMAGE = re.compile(r"\!\[[^\]]*\]\(([^)\s]+)")
FENCE = re.compile(r"^\s*(```|~~~)")

files = subprocess.check_output(["git", "ls-files", "*.md"], cwd=ROOT, text=True).split()
broken = []
for rel in files:
    path = ROOT / rel
    if not path.exists() or "node_modules" in path.parts:
        continue
    in_fence = False
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        line = re.sub(r"`[^`]*`", "", line)
        for target in LINK.findall(line) + IMAGE.findall(line):
            if re.match(r"^(https?:|mailto:|#|/|<)", target):
                continue
            file_part = target.split("#", 1)[0]
            if not file_part:
                continue
            dest = (path.parent / file_part).resolve()
            # VitePress links omit the extension (./tracing, ../platform/api)
            if not (dest.exists() or dest.with_name(dest.name + ".md").exists() or (dest / "index.md").exists()):
                broken.append(f"{rel}:{lineno}: {target}")

if broken:
    print("Broken relative links:")
    print("\n".join(broken))
    sys.exit(1)
print(f"OK: {len(files)} Markdown files, no broken relative links")
