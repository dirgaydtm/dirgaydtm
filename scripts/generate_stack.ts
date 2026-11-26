// Generate the tech-stack heap that gets sprayed in under the chat card.
// usage: bun scripts/generate_stack.ts [out_file] [start_delay_seconds]
// start_delay should match when the chat card's last bubble has popped in (0.3 + 0.45 * (bubbles - 1) + 0.35);
// the default fits the usual 8 bubbles.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import Matter from "matter-js";

const OUT = process.argv[2] ?? "drafts/stack.svg";
const START = Number(process.argv[3] ?? 3.8);

const esc = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const f1 = (n: number) => n.toFixed(1);

/** mulberry32: tiny seeded PRNG, so one seed always drops the same pile. */
function rng(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A heap of tech-stack icons sprayed in from the left edge, one after another, that land scattered across a
 *  floor under the chat. data/stack.json holds 256x256 icons from skillicons.dev (MIT); the ones missing
 *  there are simple-icons emblems or the project's own logo on the same tile. matter-js runs the physics once here
 *  and each icon's path is baked into its own CSS keyframes, so the SVG itself has no script. If the heap ends up taller than H, the image
 *  grows upward to fit it. `start` delays the spray so it begins after the chat bubbles finish. */
function stackSvg(all: { title: string; svg: string }[], W: number, H: number, seed: number, start: number) {
	const { Engine, Bodies, Body, Composite } = Matter;
	const [FPS, SECS, M, EVERY] = [24, 7, 8, 2]; // EVERY: frames between two throws
	const rand = rng(seed);
	const icons = [...all];
	for (let i = icons.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[icons[i], icons[j]] = [icons[j], icons[i]];
	}
	const engine = Engine.create({ gravity: { y: 1.2 }, enableSleeping: true });
	const wall = (x: number, y: number, w: number, h: number) => Bodies.rectangle(x, y, w, h, { isStatic: true });
	const spawnY = H - 110;
	// floor and two walls reaching far up, so nothing gets pushed out of the view as the heap grows
	Composite.add(engine.world, [wall(W / 2, H + 50, W * 3, 100), wall(-50, -H * 3, 100, H * 8), wall(W + 50, -H * 3, 100, H * 8)]);
	// mixed sizes, any angle, a spin and a different throw strength each: they land scattered, not in rows
	const sizes = icons.map(() => 48 + rand() * 10);
	const bodies = icons.map((_, i) => {
		// parked off-screen until its turn, then moved just inside the left wall and thrown
		const b = Bodies.rectangle(-sizes[i] * 1.5, spawnY, sizes[i], sizes[i], {
			angle: rand() * Math.PI * 2,
			chamfer: { radius: (sizes[i] * 60) / 256 }, // skillicons tile corner
			restitution: 0.3,
			friction: 0.6,
		});
		Body.setVelocity(b, { x: 7 + rand() * 19, y: -1 - rand() * 2.5 }); // flat throws keep the image short; the strongest reach the right wall
		Body.setAngularVelocity(b, (rand() - 0.5) * 0.5);
		return b;
	});
	const total = FPS * SECS;
	const raw = bodies.map(() => [] as [number, number, number, number][]);
	for (let f = 0; f <= total; f++) {
		// record before throwing, so every tile's 0% frame is still parked off-screen while the chat plays
		bodies.forEach(({ position: p, angle }, i) => {
			raw[i].push([f, p.x, p.y, angle]);
		});
		const next = f / EVERY;
		if (f % EVERY === 0 && next < bodies.length) {
			Body.setPosition(bodies[next], { x: sizes[next] * 0.75, y: spawnY }); // keeps the throw velocity
			Composite.add(engine.world, bodies[next]);
		}
		for (let k = 0; k < 2; k++) Engine.update(engine, 1000 / FPS / 2); // 2 substeps keep stacked bodies stable
	}
	// view top covers the resting heap and the highest point of any throw, so nothing gets clipped mid-air
	const top = Math.min(M, ...raw.flatMap((fs, i) => fs.map(([, , y]) => y - sizes[i] * 0.75))); // 0.75 ~ half the diagonal
	for (const b of bodies) if (b.position.y > H || b.position.x < 0 || b.position.x > W) console.error("stackSvg: icon outside", b.position);
	const frames = raw.map((fs, i) => {
		const kept: [number, string][] = [];
		let prev: [number, string] | undefined;
		for (const [f, x, y, a] of fs) {
			if (f > 0 && y < top - sizes[i]) continue; // still above the view: the 0% frame covers it, keeps the file small
			const t = `translate(${f1(x)}px,${f1(y)}px) rotate(${f1((a * 180) / Math.PI)}deg)`;
			// unchanged frames are dropped (fill-mode holds the last one), but the frame right before a change stays,
			// so a parked tile jumps in on its throw instead of drifting in from off-screen
			if (kept.at(-1)?.[1] !== t) {
				if (prev && kept.at(-1)?.[0] !== prev[0]) kept.push(prev);
				kept.push([f, t]);
			}
			prev = [f, t];
		}
		return kept;
	});
	const keyframes = frames
		.map((fs, i) => `@keyframes d${i} { ${fs.map(([f, t]) => `${((f / total) * 100).toFixed(2)}% { transform: ${t}; }`).join(" ")} }`)
		.join("\n");
	const logos = icons
		.map(
			({ svg }, i) =>
				// inline transform is the resting spot: animations override it, reduced motion falls back to it
				`<g class="d" style="animation-name:d${i};transform:${frames[i].at(-1)?.[1]}">` +
				`<g transform="translate(${f1(-sizes[i] / 2)} ${f1(-sizes[i] / 2)}) scale(${(sizes[i] / 256).toFixed(5)})">${svg}</g></g>`,
		)
		.join("");
	const label = esc(`Tech stack: ${icons.map((i) => i.title).join(", ")}`);
	// viewBox starts at y=top (negative when the pile is taller than the chat), so physics coordinates stay as-is
	const [y0, h] = [Math.floor(top - M), Math.ceil(H - Math.floor(top - M))];
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 ${y0} ${W} ${h}" role="img" aria-label="${label}">
<style>
.d { animation: ${SECS}s linear ${start.toFixed(2)}s both; }
${keyframes}
@media (prefers-reduced-motion: reduce) { .d { animation: none; } }
</style>
${logos}
</svg>`;
}

if (import.meta.main) {
	const seq = (seed: number) => Array.from({ length: 3 }, rng(seed)).join();
	const first = seq(7);
	console.assert(first === seq(7) && first !== seq(8), "rng is seeded");
	const icons = JSON.parse(readFileSync(join(import.meta.dir, "../data/stack.json"), "utf8"));
	// seeded by the Jakarta date: a fresh heap every day, but reruns on the same day match
	const day = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jakarta", dateStyle: "short" }).format(new Date());
	mkdirSync(dirname(OUT), { recursive: true });
	// README shows it at 100% width
	writeFileSync(OUT, stackSvg(icons, 880, 200, Number(day.replace(/\D/g, "")), START));
	console.log("wrote", OUT);
}
