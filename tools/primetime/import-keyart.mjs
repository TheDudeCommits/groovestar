// Imports the Blender key art (groovestar-primetime/keyart/keyart.py renders)
// into public/kinetic/pt: 2:3 game cards, 16:9 game-page heroes, the crew
// avatar and the home still used on low graphics settings.
//
//   GROOVESTAR_KEYART=~/Claude-Pro/groovestar-primetime/art3/keyart node tools/primetime/import-keyart.mjs
import sharp from "sharp";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

const src = (process.env.GROOVESTAR_KEYART ?? join(homedir(), "Claude-Pro/groovestar-primetime/art3/keyart")).replace(/^~/, homedir());
const out = "public/kinetic/pt";
const games = ["dance", "blade", "box", "rush", "fruit", "tennis", "bowl"];
for (const g of games) {
  const card = join(src, `${g}-card.png`),
    wide = join(src, `${g}-wide.png`);
  if (existsSync(card)) {
    const i = await sharp(card).resize(800, 1200, { fit: "cover" }).webp({ quality: 84 }).toFile(join(out, `card-${g}.webp`));
    console.log("card", g, i.size);
  }
  if (existsSync(wide)) {
    const i = await sharp(wide).resize(1920, 1080, { fit: "cover" }).webp({ quality: 80 }).toFile(join(out, `hero-${g}.webp`));
    console.log("hero", g, i.size);
  }
}
// Crew avatar: Nova's face from the Dance card; home still: the Dance hero.
const dance = join(src, "dance-card.png");
if (existsSync(dance)) {
  const meta = await sharp(dance).metadata();
  const s = Math.round(meta.width * 0.32);
  await sharp(dance)
    .extract({ left: Math.round(meta.width * 0.5 - s / 2), top: Math.round(meta.height * 0.27), width: s, height: s })
    .resize(256, 256)
    .webp({ quality: 86 })
    .toFile(join(out, "nova-avatar.webp"));
  console.log("avatar");
}
if (existsSync(join(src, "dance-wide.png"))) {
  await sharp(join(src, "dance-wide.png")).resize(1920, 1080).webp({ quality: 78 }).toFile(join(out, "plate-home.webp"));
  console.log("home still");
}
