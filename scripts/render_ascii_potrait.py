import sys
import os
import html
from PIL import Image, ImageEnhance

# Input/Output paths
INP = sys.argv[1] if len(sys.argv) > 1 else "data/Avatar.jpeg"
OUT = sys.argv[2] if len(sys.argv) > 2 else "ascii-portrait.svg"

# Settings
COLS = 120
ROWS = 63
CELL_W = 8
CELL_H = 15
RAMP = " .`:-=+*cs#%@"
BG = "transparent"
INK = "#c9d1d9"
CURSOR = "#c9d1d9"
ROW_DUR = 0.11
STAGGER = 0.11

# Process Image
im = Image.open(INP).convert("L")
im = ImageEnhance.Contrast(im).enhance(1.5) # Boost contrast slightly for better ASCII mapping
im = im.resize((COLS, ROWS), Image.LANCZOS)
px = im.load()

rows_txt = []
for y in range(ROWS):
    chars = []
    for x in range(COLS):
        lum = px[x, y] / 255.0
        # White background handling (so white space = empty)
        if lum >= 0.8:
            chars.append(" ")
            continue
        idx = int((1.0 - lum) * (len(RAMP) - 1) + 0.5)
        idx = max(0, min(len(RAMP) - 1, idx))
        chars.append(RAMP[idx])
    rows_txt.append("".join(chars))

# Build SVG
ART_W = COLS * CELL_W
ART_H = ROWS * CELL_H
CANVAS_W = ART_W
CANVAS_H = ART_H

parts = []
parts.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS_W}" height="{CANVAS_H}" viewBox="0 0 {CANVAS_W} {CANVAS_H}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">')
parts.append(f'<rect width="{CANVAS_W}" height="{CANVAS_H}" rx="12" fill="{BG}"/>')

font_size = CELL_H * 0.86
for ry, line in enumerate(rows_txt):
    y = ry * CELL_H + CELL_H * 0.74
    row_y = ry * CELL_H
    delay = ry * STAGGER
    safe = html.escape(line)

    text = f'<text xml:space="preserve" x="0" y="{y:.1f}" fill="{INK}" font-size="{font_size:.1f}" textLength="{ART_W}" lengthAdjust="spacing">{safe}</text>'

    parts.append(f'<clipPath id="r{ry}"><rect x="0" y="{row_y:.1f}" height="{CELL_H}" width="0"><animate attributeName="width" from="0" to="{ART_W}" begin="{delay:.3f}s" dur="{ROW_DUR:.2f}s" fill="freeze"/></rect></clipPath>')
    parts.append(f'<g clip-path="url(#r{ry})">{text}</g>')
    parts.append(f'<rect y="{row_y+1:.1f}" width="{CELL_W}" height="{CELL_H-2}" fill="{CURSOR}" opacity="0"><animate attributeName="x" from="0" to="{ART_W}" begin="{delay:.3f}s" dur="{ROW_DUR:.2f}s" fill="freeze"/><set attributeName="opacity" to="0.85" begin="{delay:.3f}s"/><set attributeName="opacity" to="0" begin="{delay+ROW_DUR:.3f}s"/></rect>')

parts.append("</svg>")
with open(OUT, "w") as f:
    f.write("".join(parts))

print(f"Wrote {OUT} ({CANVAS_W}x{CANVAS_H})")
