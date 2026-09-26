// Converts the generated Primetime art (Higgsfield gpt_image_2_5 PNGs, see
// docs/ASSET_PROVENANCE.md) into web assets under public/kinetic/pt.
//   GROOVESTAR_ART_SRC=~/Claude-Pro/groovestar-primetime/art node tools/primetime/import-art.mjs
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
const src = (process.env.GROOVESTAR_ART_SRC ?? join(homedir(), "Claude-Pro/groovestar-primetime/art")).replace(/^~/, homedir());
const out = "public/kinetic/pt";
await mkdir(out, { recursive: true });
const jobs = [
  ...["dance", "blade", "box", "rush", "fruit", "tennis", "bowl"].map((id) => [`card-${id}.png`, `card-${id}.webp`, { width: 816 }, 80]),
  ["plate-home.png", "plate-home.webp", { width: 2400 }, 80],
  ["plate-box.png", "plate-box.webp", { width: 2688 }, 78],
  ["plate-rush.png", "plate-rush.webp", { width: 2688 }, 78],
  ["plate-tennis.png", "plate-tennis.webp", { width: 2688 }, 78],
  ["plate-bowl.png", "plate-bowl.webp", { width: 2688 }, 78],
  ["plate-fruit.png", "plate-fruit.webp", { width: 2048 }, 80],
  ["crowd.png", "crowd.webp", { width: 2048 }, 82],
];
for (const [from, to, resize, quality] of jobs) {
  const info = await sharp(join(src, from)).resize(resize).webp({ quality, alphaQuality: 90, effort: 5 }).toFile(join(out, to));
  console.log(to, info.width, info.height, Math.round(info.size / 1024) + "KB");
}
const logo = await sharp(join(src, "logo.png")).trim({ threshold: 1 }).resize({ width: 1400 }).webp({ quality: 88, alphaQuality: 95 }).toFile(join(out, "logo.webp"));
console.log("logo.webp", logo.width, logo.height, Math.round(logo.size / 1024) + "KB");
