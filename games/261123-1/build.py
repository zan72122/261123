#!/usr/bin/env python3
"""Inline src/* into a single index.html (standard library only)."""
import base64
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
OUT = os.path.join(HERE, "index.html")

# (marker name, path relative to src, required)
PARTS = [
    ("three", os.path.join("vendor", "three.min.js"), True),
    ("engine", "engine.js", True),
    ("props_world", "props_world.js", False),
    ("props_items", "props_items.js", False),
    ("audio", "audio.js", False),
    ("game", "game.js", False),
]

LIMIT_MB = 8.0


def warn(msg):
    sys.stderr.write("warning: " + msg + "\n")


def read_text(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def script_block(js):
    js = re.sub(r"</(script)", r"<\\/\1", js, flags=re.IGNORECASE)
    js = js.replace("<!--", "<\\!--")
    return "<script>\n" + js + "\n</script>"


def main():
    tpl_path = os.path.join(SRC, "template.html")
    if not os.path.isfile(tpl_path):
        sys.stderr.write("error: missing " + tpl_path + "\n")
        return 1
    html = read_text(tpl_path)

    fb = os.path.join(SRC, "fallback.jpg")
    if os.path.isfile(fb):
        with open(fb, "rb") as f:
            data = base64.b64encode(f.read()).decode("ascii")
        new, n = re.subn(
            r'<img id="fallback"',
            '<img id="fallback" src="data:image/jpeg;base64,' + data + '"',
            html,
            count=1,
        )
        if n:
            html = new
        else:
            warn('<img id="fallback"> not found in template')

    for name, rel, required in PARTS:
        marker = "<!--INLINE:" + name + "-->"
        if marker not in html:
            warn("marker " + marker + " not found in template")
            continue
        path = os.path.join(SRC, rel)
        if os.path.isfile(path):
            block = script_block(read_text(path))
        else:
            if required:
                sys.stderr.write("error: missing " + path + "\n")
                return 1
            warn("missing src/" + rel.replace(os.sep, "/") + " (skipped)")
            block = ""
        # plain str.replace: backslashes in JS are kept as-is
        html = html.replace(marker, block)

    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)

    size_mb = os.path.getsize(OUT) / (1024.0 * 1024.0)
    print("wrote %s (%.2f MB)" % (OUT, size_mb))
    if size_mb > LIMIT_MB:
        warn("output is larger than %.0f MB" % LIMIT_MB)
    return 0


if __name__ == "__main__":
    sys.exit(main())
