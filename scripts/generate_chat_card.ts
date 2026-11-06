// Generate the chat-bubble profile card from live GitHub data.
// usage: bun scripts/generate_chat_card.ts [user] [out_dir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const USER = process.argv[2] ?? "dirgaydtm";
const OUT_DIR = process.argv[3] ?? "drafts";

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const GREENS = ["#2c2c2e", "#0e4429", "#006d32", "#26a641", "#39d353"]; // contribution levels 0-4
const [BUBBLE, WHITE, GRAY, BLUE] = ["#3a3a3c", "#f0f6fc", "#a1a1a6", "#4493f8"];
const HIDE_LANGS = new Set(["PHP", "Python", "Kotlin"]);
const LANG_COLORS: Record<string, string> = {
  Dart: "#00B4AB",
  TypeScript: "#3178c6",
  Rust: "#dea584",
  Go: "#00ADD8",
}; // linguist colors
const [X, W, FS, LH, PADX, PADY, GAP, R] = [28, 506, 17, 24, 16, 10, 8, 18];
const [CELL, STEP, IP] = [6, 8, 12]; // heatmap cell, cell+gap, image padding

type Day = { date: string; count: number; level: number };
type Lang = [name: string, percent: number];
type Msg = [kind: "text" | "langs" | "heatmap" | "link", text: string, link?: string];
type State = {
  days: Day[];
  total: number;
  longest: number;
  langs: Lang[] | null;
  time: string;
  weekday: string;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const f1 = (n: number) => n.toFixed(1);

async function getJson(url: string) {
  const headers: Record<string, string> = { "User-Agent": "profile-card" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`; // avoids the 60 req/hour anonymous API limit
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/** Top languages by bytes across public non-fork repos as [name, percent], or null if the API fails. */
async function getLangs(user: string, top = 4): Promise<Lang[] | null> {
  const totals = new Map<string, number>();
  try {
    // shortcut: first 100 repos only, paginate if the account ever passes that
    for (const repo of await getJson(`https://api.github.com/users/${user}/repos?per_page=100&type=owner`)) {
      if (repo.fork) continue;
      for (const [lang, size] of Object.entries<number>(await getJson(repo.languages_url)))
        totals.set(lang, (totals.get(lang) ?? 0) + size);
    }
  } catch (e) {
    console.error("languages fetch failed, skipping bubble:", e);
    return null;
  }
  const best = [...totals]
    .sort((a, b) => b[1] - a[1])
    .filter(([lang]) => !HIDE_LANGS.has(lang))
    .slice(0, top);
  const total = best.reduce((sum, [, size]) => sum + size, 0);
  return best.map(([lang, size]) => [lang, (size * 100) / total]);
}

function longestStreak(days: { count: number }[]) {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.count ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

// shortcut: rough per-glyph widths for a sans font, switch to real font metrics if bubbles look off
function textW(text: string, fs: number) {
  let w = 0;
  for (const ch of text) {
    const upper = ch !== ch.toLowerCase();
    w += "iljt.,:;'!|fr I".includes(ch) ? 0.3 : upper || "mw".includes(ch) ? 0.68 : (ch.codePointAt(0) ?? 0) > 0x2000 ? 1.2 : 0.54;
  }
  return w * fs;
}

function wrap(text: string, maxW: number) {
  const lines = [""];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines.length - 1;
    if (lines[last] && textW(`${lines[last]} ${word}`, FS) > maxW) lines.push(word);
    else lines[last] = `${lines[last]} ${word}`.trim();
  }
  return lines;
}

/** One <tspan> per line, first baseline at y. */
const tspans = (lines: string[], x: number, y: number) =>
  lines.map((l, i) => `<tspan x="${x}" y="${y + i * LH}">${esc(l)}</tspan>`).join("");

/** Width of the heatmap bubble, also the max width of every text bubble. */
const heatmapWidth = (days: Day[]) => Math.floor((days.length + 6) / 7) * STEP - 2 + 2 * IP;

/** WhatsApp media bubble: heatmap edge to edge with rounded top, caption below, time bottom-right. */
function heatmapBubble(s: State, text: string, y: number, delay: number): [number, string] {
  const [CP, TS] = [12, 11]; // caption padding, time size
  const weeks = Math.floor((s.days.length + 6) / 7);
  const [bw, imgH, last] = [heatmapWidth(s.days), 7 * STEP - 2 + 2 * IP, weeks - 1 + 6 * 0.55];
  const cells = s.days // left-to-right wave over 1.2s; green cells flash
    .map((d, i) => {
      const [wk, row] = [Math.floor(i / 7), i % 7];
      return (
        `<rect class="${d.level ? "c g" : "c"}" style="animation-delay:${(delay + ((wk + row * 0.55) / last) * 1.2).toFixed(2)}s" ` +
        `x="${X + IP + wk * STEP}" y="${y + IP + row * STEP}" width="${CELL}" height="${CELL}" rx="1.5" fill="${GREENS[d.level]}"/>`
      );
    })
    .join("");
  const lines = wrap(text, bw - CP * 2);
  const lastFits = textW(lines[lines.length - 1], FS) + textW(s.time, TS) + 8 <= bw - CP * 2;
  const bh = imgH + 8 + lines.length * LH + (lastFits ? 4 : TS + 8) + 2;
  return [
    bh,
    `<clipPath id="img${y}"><rect width="${bw}" height="${bh}" x="${X}" y="${y}" rx="${R}"/></clipPath>` +
    `<rect width="${bw}" height="${bh}" x="${X}" y="${y}" rx="${R}" fill="${BUBBLE}"/>` +
    `<g clip-path="url(#img${y})"><rect width="${bw}" height="${imgH}" x="${X}" y="${y}" fill="#1c1c1e"/>${cells}</g>` +
    `<text fill="${WHITE}">${tspans(lines, X + CP, y + imgH + 8 + LH - 6)}</text>` +
    `<text x="${X + bw - CP}" y="${y + bh - 8}" fill="${GRAY}" text-anchor="end" style="font-size:${TS}px">${s.time}</text>`,
  ];
}

/** Top-langs card as a bubble: stacked bar that grows in, then a 2-column legend. */
function langsBubble(langs: Lang[], y: number, delay: number): [number, string] {
  const [P, BAR, ROW, LFS, BG, bw] = [14, 8, 22, 14, 14, 380]; // padding, bar, legend row, font, bar-legend gap, width
  const bh = P + BAR + BG + Math.floor((langs.length + 1) / 2) * ROW + P - 8;
  let [segs, legend, x] = ["", "", X + P];
  langs.forEach(([lang, pct], i) => {
    const [color, w] = [LANG_COLORS[lang] ?? "#8b949e", ((bw - 2 * P) * pct) / 100];
    const [lx, ly] = [X + P + ((i % 2) * (bw - 2 * P)) / 2, y + P + BAR + BG + Math.floor(i / 2) * ROW + 10];
    segs += `<rect x="${f1(x)}" y="${y + P}" width="${f1(w)}" height="${BAR}" fill="${color}"/>`;
    legend +=
      `<circle cx="${f1(lx + 6)}" cy="${ly - 5}" r="5" fill="${color}"/>` +
      `<text x="${f1(lx + 16)}" y="${ly}" style="font-size:${LFS}px"><tspan fill="${WHITE}">${esc(lang)}</tspan>` +
      `<tspan fill="${GRAY}"> ${pct.toFixed(2)}%</tspan></text>`;
    x += w;
  });
  return [
    bh,
    `<rect width="${bw}" height="${bh}" x="${X}" y="${y}" rx="${R}" fill="${BUBBLE}"/>` +
    `<clipPath id="bar${y}"><rect x="${X + P}" y="${y + P}" width="${bw - 2 * P}" height="${BAR}" rx="${BAR / 2}"/></clipPath>` +
    `<g clip-path="url(#bar${y})"><g class="bar" style="animation-delay:${(delay + 0.2).toFixed(2)}s">${segs}</g></g>${legend}`,
  ];
}

function textBubble(text: string, y: number, link: string | undefined, maxBw: number): [number, string] {
  const lines = wrap(text, maxBw - PADX * 2);
  const [bw, bh] = [Math.max(...lines.map((l) => textW(l, FS))) + PADX * 2, lines.length * LH + PADY * 2];
  let body = tspans(lines, X + PADX, y + PADY + LH - 6);
  if (link) body = body.replace(esc(link), `<tspan fill="${BLUE}">${esc(link)}</tspan>`); // only the link part is blue
  return [
    bh,
    `<rect width="${bw.toFixed(0)}" height="${bh}" x="${X}" y="${y}" rx="${R}" fill="${BUBBLE}"/><text fill="${WHITE}">${body}</text>`,
  ];
}

/** One entry per bubble; everything from the "link" bubble on goes in the dirga.dev-linked image. */
function chatMsgs(s: State): Msg[] {
  // the intro points at the languages bubble, so it falls back to plain text when the API fetch failed
  const intro: Msg[] = s.langs
    ? [
      ["text", "I'm a software engineer, mostly coding in these"],
      ["langs", ""],
    ]
    : [["text", "I'm a software engineer. Mostly write TypeScript and Dart, with some Go lately"]];
  return [
    ["text", "Hellooo, I'm Dirga"],
    ...intro,
    ["text", "I live in Indonesia. My currency is cooked, so you can pay me cheap in USD \u{1F602}"],
    ["heatmap", `My past year on GitHub. ${s.total.toLocaleString("en-US")} contributions, and I once went ${s.longest} days straight`],
    ["link", "More about me at dirga.dev", "dirga.dev"],
    ["text", "Oh, and I use Arch btw \u{1F60F}"],
    ["text", `Have a great ${s.weekday}!`],
  ];
}

function chatSvg(s: State, msgs: Msg[], top: number, bottom: number, delay: number) {
  const parts: string[] = [];
  let y = top;
  for (const [kind, text, link] of msgs) {
    const [bh, body] =
      kind === "heatmap"
        ? heatmapBubble(s, text, y, delay)
        : kind === "langs" && s.langs
          ? langsBubble(s.langs, y, delay)
          : textBubble(text, y, link, heatmapWidth(s.days));
    parts.push(`<g class="msg" style="animation-delay:${delay.toFixed(2)}s;transform-origin:${X}px ${y + bh}px">${body}</g>`);
    [y, delay] = [y + bh + GAP, delay + 0.45];
  }
  const H = y - GAP + bottom;
  const label = esc(
    msgs
      .map(([, text]) => text)
      .filter(Boolean)
      .join(" "),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
<style>
text { font: ${FS}px ${SANS}; }
.msg { opacity: 0; animation: pop .35s cubic-bezier(.2,.9,.3,1.3) forwards; }
@keyframes pop { from { opacity: 0; transform: scale(.85) translateY(8px); } to { opacity: 1; transform: none; } }
.bar { transform-box: fill-box; transform-origin: left; transform: scaleX(0); animation: grow .8s cubic-bezier(.3,.8,.3,1) forwards; }
@keyframes grow { to { transform: scaleX(1); } }
.c { transform-box: fill-box; transform-origin: center; opacity: 0; animation: cell .5s ease-out both; }
.g { animation: cell .5s ease-out both, flash .65s ease-out both; }
@keyframes cell { 0% { opacity: 0; transform: scale(.2); } 60% { opacity: 1; transform: scale(1.15); } 100% { opacity: 1; transform: scale(1); } }
@keyframes flash { 0%, 45% { filter: brightness(2.4); } 100% { filter: brightness(1); } }
@media (prefers-reduced-motion: reduce) { .msg, .c { animation: none; opacity: 1; } .bar { animation: none; transform: none; } }
</style>
${parts.join("")}
</svg>`;
}

async function main() {
  const data = await getJson(`https://github-contributions-api.jogruber.de/v4/${USER}?y=last`);
  const jakarta = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Jakarta",
      ...opts,
    }).format(new Date());
  const s: State = {
    days: data.contributions,
    total: data.total.lastYear,
    longest: longestStreak(data.contributions),
    langs: await getLangs(USER),
    time: jakarta({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    weekday: jakarta({ weekday: "long" }),
  };
  const msgs = chatMsgs(s);
  const cut = msgs.findIndex(([kind]) => kind === "link");
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, svg] of [
    ["chat.svg", chatSvg(s, msgs.slice(0, cut), 20, 0, 0.3)],
    // GitHub renders the two <img> inline, which adds ~6px below the first one; top=GAP-6 keeps the usual 8px gap
    ["chat-link.svg", chatSvg(s, msgs.slice(cut), GAP - 6, 12, 0.3 + 0.45 * cut)],
  ]) {
    writeFileSync(join(OUT_DIR, name), svg);
    console.log("wrote", join(OUT_DIR, name));
  }
}

if (import.meta.main) {
  console.assert(longestStreak([{ count: 1 }, { count: 0 }, { count: 2 }, { count: 3 }, { count: 0 }]) === 2, "longestStreak");
  console.assert(JSON.stringify(wrap("aa bb cc", textW("aa bb", FS))) === '["aa bb","cc"]', "wrap");
  await main();
}

export { chatMsgs, chatSvg, GAP, longestStreak };
