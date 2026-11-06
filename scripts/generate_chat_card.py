"""Generate the chat-bubble profile card from live GitHub data.

usage: python scripts/generate_chat_card.py [user] [out_dir]
"""
import datetime
import html
import json
import os
import sys
import urllib.request
from collections import Counter
from zoneinfo import ZoneInfo

USER = sys.argv[1] if len(sys.argv) > 1 else "dirgaydtm"
OUT_DIR = sys.argv[2] if len(sys.argv) > 2 else "drafts"

SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
GREENS = ["#2c2c2e", "#0e4429", "#006d32", "#26a641", "#39d353"]  # contribution levels 0-4
BUBBLE, WHITE, GRAY, BLUE = "#3a3a3c", "#f0f6fc", "#a1a1a6", "#4493f8"
HIDE_LANGS = {"PHP", "Python", "Kotlin"}
LANG_COLORS = {"Dart": "#00B4AB", "TypeScript": "#3178c6", "Rust": "#dea584", "Go": "#00ADD8"}  # linguist colors
X, W, FS, LH, PADX, PADY, GAP, R = 28, 506, 17, 24, 16, 10, 8, 18


def get_json(url):
    headers = {"User-Agent": "profile-card"}
    if os.environ.get("GITHUB_TOKEN"):  # avoids the 60 req/hour anonymous API limit
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=25) as r:
        return json.loads(r.read().decode())


def get_langs(user, top=4):
    """Top languages by bytes across public non-fork repos as [(name, percent)], or None if the API fails."""
    totals = Counter()
    try:
        # shortcut: first 100 repos only, paginate if the account ever passes that
        for repo in get_json(f"https://api.github.com/users/{user}/repos?per_page=100&type=owner"):
            if not repo["fork"]:
                totals.update(get_json(repo["languages_url"]))
    except Exception as e:
        print("languages fetch failed, skipping bubble:", e, file=sys.stderr)
        return None
    best = [(lang, size) for lang, size in totals.most_common() if lang not in HIDE_LANGS][:top]
    total = sum(size for _, size in best)
    return [(lang, size * 100 / total) for lang, size in best]


def longest_streak(days):
    longest = run = 0
    for d in days:
        run = run + 1 if d["count"] else 0
        longest = max(longest, run)
    return longest


def text_w(text, fs):
    # shortcut: rough per-glyph widths for a sans font, switch to real font metrics if bubbles look off
    return fs * sum(0.3 if ch in "iljt.,:;'!|fr I" else 0.68 if ch.isupper() or ch in "mw" else 1.2 if ord(ch) > 0x2000 else 0.54
                    for ch in text)


def wrap(text, max_w):
    lines = [""]
    for word in text.split():
        if lines[-1] and text_w(f"{lines[-1]} {word}", FS) > max_w:
            lines.append(word)
        else:
            lines[-1] = f"{lines[-1]} {word}".strip()
    return lines


def tspans(lines, x, y):
    """One <tspan> per line, first baseline at y."""
    return "".join(f'<tspan x="{x}" y="{y + i * LH}">{html.escape(l)}</tspan>' for i, l in enumerate(lines))


CELL, STEP, IP = 6, 8, 12  # heatmap cell, cell+gap, image padding


def heatmap_width(days):
    """Width of the heatmap bubble, also the max width of every text bubble."""
    return (len(days) + 6) // 7 * STEP - 2 + 2 * IP


def heatmap_bubble(s, text, y, delay):
    """WhatsApp media bubble: heatmap edge to edge with rounded top, caption below, time bottom-right."""
    CP, TS = 12, 11  # caption padding, time size
    weeks = (len(s["days"]) + 6) // 7
    bw, img_h, last = heatmap_width(s["days"]), 7 * STEP - 2 + 2 * IP, (weeks - 1) + 6 * 0.55
    cells = "".join(  # left-to-right wave over 1.2s; green cells flash
        f'<rect class="{"c g" if d["level"] else "c"}" style="animation-delay:{delay + (i // 7 + i % 7 * 0.55) / last * 1.2:.2f}s" '
        f'x="{X + IP + i // 7 * STEP}" y="{y + IP + i % 7 * STEP}" width="{CELL}" height="{CELL}" rx="1.5" fill="{GREENS[d["level"]]}"/>'
        for i, d in enumerate(s["days"]))
    lines = wrap(text, bw - CP * 2)
    last_fits = text_w(lines[-1], FS) + text_w(s["time"], TS) + 8 <= bw - CP * 2
    bh = img_h + 8 + len(lines) * LH + (4 if last_fits else TS + 8) + 2
    return bh, (f'<clipPath id="img{y}"><rect width="{bw}" height="{bh}" x="{X}" y="{y}" rx="{R}"/></clipPath>'
                f'<rect width="{bw}" height="{bh}" x="{X}" y="{y}" rx="{R}" fill="{BUBBLE}"/>'
                f'<g clip-path="url(#img{y})"><rect width="{bw}" height="{img_h}" x="{X}" y="{y}" fill="#1c1c1e"/>{cells}</g>'
                f'<text fill="{WHITE}">{tspans(lines, X + CP, y + img_h + 8 + LH - 6)}</text>'
                f'<text x="{X + bw - CP}" y="{y + bh - 8}" fill="{GRAY}" text-anchor="end" style="font-size:{TS}px">{s["time"]}</text>')


def langs_bubble(langs, y, delay):
    """Top-langs card as a bubble: stacked bar that grows in, then a 2-column legend."""
    P, BAR, ROW, LFS, BG, bw = 14, 8, 22, 14, 14, 380  # padding, bar, legend row, font, bar-legend gap, width
    bh = P + BAR + BG + (len(langs) + 1) // 2 * ROW + P - 8
    segs, legend, x = "", "", X + P
    for i, (lang, pct) in enumerate(langs):
        color, w = LANG_COLORS.get(lang, "#8b949e"), (bw - 2 * P) * pct / 100
        lx, ly = X + P + (i % 2) * (bw - 2 * P) / 2, y + P + BAR + BG + (i // 2) * ROW + 10
        segs += f'<rect x="{x:.1f}" y="{y + P}" width="{w:.1f}" height="{BAR}" fill="{color}"/>'
        legend += (f'<circle cx="{lx + 6:.1f}" cy="{ly - 5}" r="5" fill="{color}"/>'
                   f'<text x="{lx + 16:.1f}" y="{ly}" style="font-size:{LFS}px"><tspan fill="{WHITE}">{html.escape(lang)}</tspan>'
                   f'<tspan fill="{GRAY}"> {pct:.2f}%</tspan></text>')
        x += w
    return bh, (f'<rect width="{bw}" height="{bh}" x="{X}" y="{y}" rx="{R}" fill="{BUBBLE}"/>'
                f'<clipPath id="bar{y}"><rect x="{X + P}" y="{y + P}" width="{bw - 2 * P}" height="{BAR}" rx="{BAR / 2}"/></clipPath>'
                f'<g clip-path="url(#bar{y})"><g class="bar" style="animation-delay:{delay + 0.2:.2f}s">{segs}</g></g>{legend}')


def text_bubble(text, y, link, max_bw):
    lines = wrap(text, max_bw - PADX * 2)
    bw, bh = max(text_w(l, FS) for l in lines) + PADX * 2, len(lines) * LH + PADY * 2
    body = tspans(lines, X + PADX, y + PADY + LH - 6)
    if link:  # only the link part is blue
        body = body.replace(html.escape(link), f'<tspan fill="{BLUE}">{html.escape(link)}</tspan>', 1)
    return bh, f'<rect width="{bw:.0f}" height="{bh}" x="{X}" y="{y}" rx="{R}" fill="{BUBBLE}"/><text fill="{WHITE}">{body}</text>'


def chat_msgs(s):
    """(kind, text, link) per bubble; everything from the "link" bubble on goes in the dirga.dev-linked image."""
    # the intro points at the languages bubble, so it falls back to plain text when the API fetch failed
    intro = ([("text", "I'm a software engineer, mostly coding in these", None), ("langs", "", None)] if s["langs"] else
             [("text", "I'm a software engineer. Mostly write TypeScript and Dart, with some Go lately", None)])
    return [
        ("text", "Hellooo, I'm Dirga", None),
        *intro,
        ("text", "I live in Indonesia. My currency is cooked, so you can pay me cheap in USD \U0001F602", None),
        ("heatmap", f"My past year on GitHub. {s['total']:,} contributions, and I once went {s['longest']} days straight", None),
        ("link", "More about me at dirga.dev", "dirga.dev"),
        ("text", "Oh, and I use Arch btw \U0001F60F", None),
        ("text", f"Have a great {s['weekday']}!", None),
    ]


def chat_svg(s, msgs, top, bottom, delay):
    parts, y = [], top
    for kind, text, link in msgs:
        bh, body = (heatmap_bubble(s, text, y, delay) if kind == "heatmap" else
                    langs_bubble(s["langs"], y, delay) if kind == "langs" else text_bubble(text, y, link, heatmap_width(s["days"])))
        parts.append(f'<g class="msg" style="animation-delay:{delay:.2f}s;transform-origin:{X}px {y + bh}px">{body}</g>')
        y, delay = y + bh + GAP, delay + 0.45
    H = y - GAP + bottom
    label = html.escape(" ".join(text for _, text, _ in msgs if text))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="{label}">
<style>
text {{ font: {FS}px {SANS}; }}
.msg {{ opacity: 0; animation: pop .35s cubic-bezier(.2,.9,.3,1.3) forwards; }}
@keyframes pop {{ from {{ opacity: 0; transform: scale(.85) translateY(8px); }} to {{ opacity: 1; transform: none; }} }}
.bar {{ transform-box: fill-box; transform-origin: left; transform: scaleX(0); animation: grow .8s cubic-bezier(.3,.8,.3,1) forwards; }}
@keyframes grow {{ to {{ transform: scaleX(1); }} }}
.c {{ transform-box: fill-box; transform-origin: center; opacity: 0; animation: cell .5s ease-out both; }}
.g {{ animation: cell .5s ease-out both, flash .65s ease-out both; }}
@keyframes cell {{ 0% {{ opacity: 0; transform: scale(.2); }} 60% {{ opacity: 1; transform: scale(1.15); }} 100% {{ opacity: 1; transform: scale(1); }} }}
@keyframes flash {{ 0%, 45% {{ filter: brightness(2.4); }} 100% {{ filter: brightness(1); }} }}
@media (prefers-reduced-motion: reduce) {{ .msg, .c {{ animation: none; opacity: 1; }} .bar {{ animation: none; transform: none; }} }}
</style>
{"".join(parts)}
</svg>'''


def main():
    data = get_json(f"https://github-contributions-api.jogruber.de/v4/{USER}?y=last")
    now = datetime.datetime.now(ZoneInfo("Asia/Jakarta"))
    s = {"days": data["contributions"], "total": data["total"]["lastYear"], "longest": longest_streak(data["contributions"]),
         "langs": get_langs(USER), "time": now.strftime("%H:%M"), "weekday": now.strftime("%A")}
    msgs = chat_msgs(s)
    cut = next(i for i, m in enumerate(msgs) if m[0] == "link")
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, svg in [
        ("chat.svg", chat_svg(s, msgs[:cut], top=20, bottom=0, delay=0.3)),
        # GitHub renders the two <img> inline, which adds ~6px below the first one; top=GAP-6 keeps the usual 8px gap
        ("chat-link.svg", chat_svg(s, msgs[cut:], top=GAP - 6, bottom=12, delay=0.3 + 0.45 * cut)),
    ]:
        with open(os.path.join(OUT_DIR, name), "w", encoding="utf-8") as f:
            f.write(svg)
        print("wrote", os.path.join(OUT_DIR, name))


if __name__ == "__main__":
    assert longest_streak([{"count": 1}, {"count": 0}, {"count": 2}, {"count": 3}, {"count": 0}]) == 2
    assert wrap("aa bb cc", text_w("aa bb", FS)) == ["aa bb", "cc"]
    main()
