// Scrape a user's public contribution calendar into data/contributions.json (no auth needed).
// usage: GH_PROFILE_USER=dirgaydtm bun scripts/fetch_contributions.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const USERNAME = process.env.GH_PROFILE_USER ?? "dirgaydtm";
const URL = `https://github.com/users/${USERNAME}/contributions`;
const OUT_PATH = join(import.meta.dir, "..", "data", "contributions.json");

type Day = { date: string; count: number };
type Streak = { length: number; start: string | null; end: string | null };

async function fetchDays(): Promise<Day[]> {
	const res = await fetch(URL, {
		headers: { "User-Agent": "profile-readme-bot/1.0" },
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${URL}`);
	// each day is a <td data-date id>, its count lives in a separate <tool-tip for="that id">
	const cells: { date: string; id: string | null }[] = [];
	const tips = new Map<string, string>();
	let tipFor = "";
	await new HTMLRewriter()
		.on("td.ContributionCalendar-day", {
			element: (td) => {
				const date = td.getAttribute("data-date");
				if (date) cells.push({ date, id: td.getAttribute("id") });
			},
		})
		.on("tool-tip", {
			element: (tip) => {
				tipFor = tip.getAttribute("for") ?? "";
				tips.set(tipFor, "");
			},
			text: (chunk) => {
				tips.set(tipFor, (tips.get(tipFor) ?? "") + chunk.text);
			},
		})
		.transform(res)
		.text();
	if (!cells.length) {
		console.error("no calendar cells found -- github markup may have changed");
		process.exit(1);
	}
	return cells
		.map(({ date, id }) => {
			const text = (id && tips.get(id)?.trim()) || "";
			return {
				date,
				count: /no contributions/i.test(text) ? 0 : Number(text.match(/^\d+/)?.[0] ?? 0),
			};
		})
		.sort((a, b) => a.date.localeCompare(b.date));
}

/** Today doesn't break the current streak since it isn't over yet. */
function currentStreak(days: Day[]): Streak {
	let i = days.length - 1;
	if (days[i].count === 0) i--;
	const end = i;
	while (i >= 0 && days[i].count > 0) i--;
	return end - i ? { length: end - i, start: days[i + 1].date, end: days[end].date } : { length: 0, start: null, end: null };
}

function longestStreak(days: Day[]): Streak {
	let best: Streak = { length: 0, start: null, end: null };
	let start = 0;
	days.forEach((d, i) => {
		if (!d.count) start = i + 1;
		else if (i - start + 1 > best.length) best = { length: i - start + 1, start: days[start].date, end: d.date };
	});
	return best;
}

function buildData(days: Day[]) {
	const total = days.reduce((sum, d) => sum + d.count, 0);
	const activeDays = days.filter((d) => d.count > 0).length;
	const best = days.reduce((a, b) => (b.count > a.count ? b : a));
	const monthly = new Map<string, number>();
	for (const d of days) monthly.set(d.date.slice(0, 7), (monthly.get(d.date.slice(0, 7)) ?? 0) + d.count);
	return {
		username: USERNAME,
		generated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
		range: { start: days[0].date, end: days[days.length - 1].date },
		total_contributions: total,
		active_days: activeDays,
		avg_per_active_day: activeDays ? Math.round((total / activeDays) * 10) / 10 : 0,
		current_streak: currentStreak(days),
		longest_streak: longestStreak(days),
		best_day: { date: best.date, count: best.count },
		monthly: [...monthly].sort(([a], [b]) => a.localeCompare(b)).map(([month, total]) => ({ month, total })),
		days,
	};
}

const data = buildData(await fetchDays());
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(data, null, 2));
console.log(`wrote ${OUT_PATH}: ${data.total_contributions} contributions, longest streak ${data.longest_streak.length}`);
