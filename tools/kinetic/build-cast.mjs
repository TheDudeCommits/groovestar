import { execFileSync } from "node:child_process";
import { mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
execFileSync(
  process.env.GROOVESTAR_BLENDER ?? "blender",
  ["--background", "--python", "tools/kinetic/build_cast.py"],
  { stdio: "inherit" },
);
const dir = mkdtempSync(join(tmpdir(), "groovestar-cast-"));
try {
  for (const id of [
    "nova",
    "blaze",
    "luna",
    "kiko",
    "rex",
    "velvet",
    "midnight",
    "sol",
  ]) {
    const file = `public/models/${id}.glb`,
      out = join(dir, `${id}.glb`);
    execFileSync(
      "node_modules/.bin/gltf-transform",
      [
        "optimize",
        file,
        out,
        "--compress",
        "meshopt",
        "--texture-compress",
        "webp",
      ],
      { stdio: "inherit" },
    );
    copyFileSync(out, file);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
