#!/usr/bin/env python3
"""The token contract, enforced instead of hoped for.

Components read ``var(--*)`` and nothing else: no hex literal, no rgb(), no
font-family, no px radius outside the generated token sheet. Without a machine
checking, the rule decays on the first busy afternoon and nobody notices until a
re-theme half-works.

This strips comments before scanning, because a grep cannot tell a rule from
prose describing the rule — and the prose describing this rule necessarily
contains every pattern it bans.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Components only. The rule is that a COMPONENT may reference var(--*) and
# nothing else; the server's theme generator is the origin of colour values by
# definition, and scanning it would forbid the one file that must emit them.
# Its output is checked instead, by test/theme.test.ts, which asserts the
# generated stylesheet stays inside the Safari floor.
SRC = Path(__file__).resolve().parent.parent / "src" / "client"
SUFFIXES = {".svelte", ".css", ".ts"}

BLOCK = re.compile(r"/\*.*?\*/", re.S)
LINE = re.compile(r"(?<![:/])//[^\n]*")
HTML_COMMENT = re.compile(r"<!--.*?-->", re.S)


def strip_comments(text: str) -> str:
    """Blank comments out, preserving newlines so line numbers stay truthful."""
    def blank(m: re.Match[str]) -> str:
        return re.sub(r"[^\n]", " ", m.group(0))

    return LINE.sub(blank, BLOCK.sub(blank, HTML_COMMENT.sub(blank, text)))


# (label, pattern, allowed) — a hit is a failure unless `allowed` matches the line.
CONTRACT: list[tuple[str, str, str | None]] = [
    ("no hex colour literals", r"#[0-9a-fA-F]{3,8}\b", None),
    ("no rgb()/hsl() literals", r"\b(?:rgba?|hsla?)\(", None),
    ("font-family must be a token", r"font-family\s*:", r"var\(--"),
    ("border-radius must be a token", r"border-radius\s*:", r"var\(--"),
]

# Past the Safari 15.0 floor. Every one of these works in a desktop browser,
# which is exactly why it needs a machine to catch it rather than a reviewer.
FLOOR: list[tuple[str, str, str | None]] = [
    ("no color-mix() — Safari 16.2", r"color-mix\(", None),
    ("no oklch() in output — Safari 15.4", r"oklch\(", None),
    ("no @container — Safari 16.0", r"@container\b", None),
    ("no :has() — Safari 15.4", r":has\(", None),
    ("no dvh/svh/lvh — Safari 15.4", r"\d(?:dvh|svh|lvh)\b", None),
    ("no text-wrap: balance — Safari 17.5", r"text-wrap\s*:\s*balance", None),
]


def run(title: str, rules: list[tuple[str, str, str | None]], files: list[Path]) -> bool:
    print(title)
    clean = 0
    for label, pattern, allowed in rules:
        rx, ok_rx = re.compile(pattern), re.compile(allowed) if allowed else None
        hits = []
        for path in files:
            for n, line in enumerate(strip_comments(path.read_text("utf8")).splitlines(), 1):
                if rx.search(line) and not (ok_rx and ok_rx.search(line)):
                    hits.append(f"      {path.relative_to(SRC.parent)}:{n}: {line.strip()}")
        if hits:
            print(f"FAIL  {label}")
            print("\n".join(hits))
        else:
            print(f"ok    {label}")
            clean += 1
    return clean == len(rules)


def main() -> int:
    files = sorted(p for p in SRC.rglob("*") if p.suffix in SUFFIXES)
    if not files:
        print("FAIL  no source files found — is this the right directory?")
        return 1
    a = run(f"token contract — {len(files)} files may reference var(--*) and nothing else", CONTRACT, files)
    print()
    b = run("safari 15.0 floor", FLOOR, files)
    return 0 if (a and b) else 1


if __name__ == "__main__":
    sys.exit(main())
