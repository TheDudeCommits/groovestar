// Converts the generated GrooveStar logo (Higgsfield gpt_image_2_5 PNG, see
// docs/ASSET_PROVENANCE.md) into public/kinetic/pt/logo.webp. Game art is now
// rendered in Blender; see tools/primetime/import-keyart.mjs.
//   GROOVESTAR_ART_SRC=~/Claude-Pro/groovestar-primetime/art node tools/primetime/import-art.mjs
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
const src = (process.env.GROOVESTAR_ART_SRC ?? join(homedir(), "Claude-Pro/groovestar-primetime/art")).replace(/^~/, homedir());
const out = "public/kinetic/pt";
await mkdir(out, { recursive: true });
const logo = await sharp(join(src, "logo.png")).trim({ threshold: 1 }).resize({ width: 1400 }).webp({ quality: 88, alphaQuality: 95 }).toFile(join(out, "logo.webp"));
console.log("logo.webp", logo.width, logo.height, Math.round(logo.size / 1024) + "KB");
