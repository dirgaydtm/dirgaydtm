// Render the animated contribution heatmap (contrib-heatmap.svg).
// usage: bun scripts/generate_streak_svg.ts [user] [out.svg]
import { writeFileSync } from "node:fs";

const USER = process.argv[2] ?? "dirgaydtm";
const OUT = process.argv[3] ?? "streak.svg";

const res = await fetch(`https://github-contributions-api.jogruber.de/v4/${USER}?y=last`, { signal: AbortSignal.timeout(25_000) });
if (!res.ok) throw new Error(`HTTP ${res.status} from contributions API`);
const { contributions: days, total } = (await res.json()) as {
	contributions: { date: string; level: number }[];
	total: { lastYear: number };
};

const [CELL, GAP, RAD, LEFT, TOP] = [13, 3, 2.5, 34, 24];
const COLORS = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];
const GRAY = "#7d8590";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const [REVEAL, DUR] = [3.6, 0.55]; // seconds for the whole wave, per cell

const NW = Math.floor((days.length + 6) / 7);
const [W, H] = [LEFT + NW * (CELL + GAP) + 6, TOP + 7 * (CELL + GAP) + 4];
const maxOrder = NW - 1 + 6 * 0.55;

const labels: string[] = [];
const start = new Date(`${days[0].date}T00:00:00Z`);
let lastMonth = -1;
for (let wk = 0; wk < NW; wk++) {
	const d = new Date(start.getTime() + wk * 7 * 86_400_000);
	if (d.getUTCMonth() === lastMonth) continue;
	lastMonth = d.getUTCMonth();
	if (d.getUTCDate() <= 7) labels.push(`<text class="lbl" x="${LEFT + wk * (CELL + GAP)}" y="${TOP - 8}">${MONTHS[lastMonth]}</text>`);
}
for (const [name, r] of [
	["Mon", 1],
	["Wed", 3],
	["Fri", 5],
] as const)
	labels.push(`<text class="lbl" x="2" y="${TOP + r * (CELL + GAP) + CELL - 2}">${name}</text>`);

const rects = days.map(({ level }, i) => {
	const [wk, row] = [Math.floor(i / 7), i % 7];
	const delay = Math.round(((wk + row * 0.55) / maxOrder) * REVEAL * 1000) / 1000;
	return (
		`<rect class="${level >= 1 ? "c g" : "c e"}" x="${LEFT + wk * (CELL + GAP)}" y="${TOP + row * (CELL + GAP)}" width="${CELL}" height="${CELL}" rx="${RAD}" ` +
		`fill="${COLORS[level]}" style="animation-delay:${delay}s"/>`
	);
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<style>
  text.lbl { fill:${GRAY}; font-size:13px; font-weight:600; }
  text.total { fill:#e6edf3; font-size:15px; font-weight:700; }
  .c { transform-box:fill-box; transform-origin:center; opacity:0; animation:pop ${DUR}s ease-out both; }
  .g { animation:pop ${DUR}s ease-out both, flash ${DUR + 0.15}s ease-out both; }
  @keyframes pop { 0%{opacity:0;transform:scale(.2)} 60%{opacity:1;transform:scale(1.1)} 100%{opacity:1;transform:scale(1)} }
  @keyframes flash { 0%{filter:brightness(2.4)} 45%{filter:brightness(2.4)} 100%{filter:brightness(1)} }
  @media (prefers-reduced-motion: reduce) { .c { opacity:1 !important; animation:none !important; } }
</style>
<rect width="${W}" height="${H}" fill="none"/>
${labels.join("")}
${rects.join("")}
</svg>`;

writeFileSync(OUT, svg);
console.log(
	`Wrote ${OUT}: ${days.length} days, ${total.lastYear.toLocaleString("en-US")} contributions, ${Math.floor(svg.length / 1024)} KB`,
);
