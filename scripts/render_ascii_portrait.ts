// Render a photo as an animated ASCII-art SVG, typed out row by row.
// usage: bun scripts/render_ascii_portrait.ts [in.jpg] [out.svg]
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const INP = process.argv[2] ?? "data/Avatar.jpeg";
const OUT = process.argv[3] ?? "ascii-portrait.svg";

const [COLS, ROWS, CELL_W, CELL_H] = [120, 63, 8, 15];
const RAMP = " .`:-=+*cs#%@";
const [INK, CURSOR] = ["#c9d1d9", "#c9d1d9"];
const [ROW_DUR, STAGGER] = [0.11, 0.11];

// grayscale (ITU-R 601 luma, like PIL's "L"), then 1.5x contrast around the mean, then shrink to the character grid
const { data: rgb, info } = await sharp(INP).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const gray = Buffer.alloc(info.width * info.height);
for (let i = 0; i < gray.length; i++) gray[i] = (rgb[i * 3] * 19595 + rgb[i * 3 + 1] * 38470 + rgb[i * 3 + 2] * 7471 + 0x8000) >> 16;
const mean = Math.round(gray.reduce((sum, v) => sum + v, 0) / gray.length);
for (let i = 0; i < gray.length; i++) gray[i] = Math.min(255, Math.max(0, Math.round(mean + (gray[i] - mean) * 1.5)));
const px = await sharp(gray, {
	raw: { width: info.width, height: info.height, channels: 1 },
})
	.resize(COLS, ROWS, { fit: "fill", kernel: "lanczos3" })
	.extractChannel(0) // sharp outputs 3 channels even for 1-channel input
	.raw()
	.toBuffer();

const rows = Array.from({ length: ROWS }, (_, y) =>
	Array.from({ length: COLS }, (_, x) => {
		const lum = px[y * COLS + x] / 255;
		if (lum >= 0.8) return " "; // near-white background stays empty
		return RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.floor((1 - lum) * (RAMP.length - 1) + 0.5)))];
	}).join(""),
);

const esc = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const [ART_W, ART_H] = [COLS * CELL_W, ROWS * CELL_H];
const fontSize = (CELL_H * 0.86).toFixed(1);
const parts = [
	`<svg xmlns="http://www.w3.org/2000/svg" width="${ART_W}" height="${ART_H}" viewBox="0 0 ${ART_W} ${ART_H}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">`,
	`<rect width="${ART_W}" height="${ART_H}" rx="12" fill="transparent"/>`,
];
rows.forEach((line, ry) => {
	const [y, rowY, delay] = [ry * CELL_H + CELL_H * 0.74, ry * CELL_H, ry * STAGGER];
	// each row is revealed by a clip that widens left to right, with a block cursor riding its edge
	parts.push(
		`<clipPath id="r${ry}"><rect x="0" y="${rowY.toFixed(1)}" height="${CELL_H}" width="0"><animate attributeName="width" from="0" to="${ART_W}" begin="${delay.toFixed(3)}s" dur="${ROW_DUR.toFixed(2)}s" fill="freeze"/></rect></clipPath>`,
		`<g clip-path="url(#r${ry})"><text xml:space="preserve" x="0" y="${y.toFixed(1)}" fill="${INK}" font-size="${fontSize}" textLength="${ART_W}" lengthAdjust="spacing">${esc(line)}</text></g>`,
		`<rect y="${(rowY + 1).toFixed(1)}" width="${CELL_W}" height="${CELL_H - 2}" fill="${CURSOR}" opacity="0"><animate attributeName="x" from="0" to="${ART_W}" begin="${delay.toFixed(3)}s" dur="${ROW_DUR.toFixed(2)}s" fill="freeze"/>` +
		`<set attributeName="opacity" to="0.85" begin="${delay.toFixed(3)}s"/><set attributeName="opacity" to="0" begin="${(delay + ROW_DUR).toFixed(3)}s"/></rect>`,
	);
});
parts.push("</svg>");

writeFileSync(OUT, parts.join(""));
console.log(`Wrote ${OUT} (${ART_W}x${ART_H})`);
