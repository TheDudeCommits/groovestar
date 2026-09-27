// Builds a cast member's game model from Meshy exports: the rigged mesh plus
// its own run and walk, and Nova's idle (clips bind by bone name, and every
// Meshy rig shares the same 24-bone skeleton). Meshopt + WebP, like Nova.
//
//   node tools/primetime/build-cast.mjs blaze
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, resample, meshopt, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { join } from "node:path";
import { homedir } from "node:os";

const id = process.argv[2] ?? "blaze";
const src = (process.env.GROOVESTAR_NOVA_SRC ?? join(homedir(), "Claude-Pro/groovestar-primetime/meshy")).replace(/^~/, homedir());
const CLIPS = [
  ["Idle", "anim/idle.glb", "drift"],
  ["Run", `${id}/running.glb`, "pin"],
  ["Walk", `${id}/walking.glb`, "pin"],
];
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
const base = await io.read(join(src, `${id}/${id}-rigged.glb`));
const root = base.getRoot();
for (const a of root.listAnimations()) a.dispose();
const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
const buffer = root.listBuffers()[0];
const hipsRest = nodes.get("Hips").getTranslation();
for (const [name, file, mode] of CLIPS) {
  const doc = await io.read(join(src, file));
  const clip = doc.getRoot().listAnimations()[0];
  const srcHips = doc.getRoot().listNodes().find((n) => n.getName() === "Hips")?.getTranslation() ?? hipsRest;
  const anim = base.createAnimation(name);
  for (const ch of clip.listChannels()) {
    const target = nodes.get(ch.getTargetNode().getName());
    if (!target || ch.getTargetPath() === "scale") continue;
    if (ch.getTargetPath() === "translation" && target.getName() !== "Hips") continue;
    const s = ch.getSampler();
    const times = s.getInput().getArray().slice();
    const values = s.getOutput().getArray().slice();
    const t0 = times[0];
    for (let i = 0; i < times.length; i++) times[i] -= t0;
    if (target.getName() === "Hips" && ch.getTargetPath() === "translation") {
      const n = times.length, span = Math.max(1e-6, times[n - 1]);
      const dx = values[(n - 1) * 3] - values[0], dz = values[(n - 1) * 3 + 2] - values[2];
      // another rig's clip: keep this character's own hip height
      const dy = hipsRest[1] - srcHips[1];
      for (let i = 0; i < n; i++) {
        values[i * 3 + 1] += dy;
        if (mode === "pin") {
          values[i * 3] = values[0];
          values[i * 3 + 2] = values[2];
        } else {
          const k = times[i] / span;
          values[i * 3] -= dx * k;
          values[i * 3 + 2] -= dz * k;
        }
      }
    }
    const inAcc = base.createAccessor().setType("SCALAR").setArray(times).setBuffer(buffer);
    const outAcc = base.createAccessor().setType(s.getOutput().getType()).setArray(values).setBuffer(buffer);
    const sampler = base.createAnimationSampler().setInput(inAcc).setOutput(outAcc).setInterpolation(s.getInterpolation());
    anim.addSampler(sampler);
    anim.addChannel(base.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(sampler));
  }
  console.log(name, anim.listChannels().length, "channels");
}
for (const m of root.listMaterials()) m.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]).setName(id);
for (const e of root.listExtensionsUsed()) if (["KHR_materials_specular", "KHR_materials_ior"].includes(e.extensionName)) e.dispose();
await base.transform(
  resample(),
  dedup(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: "webp", quality: 84, resize: [2048, 2048] }),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);
await io.write(`public/models/${id}-pt.glb`, base);
console.log(`wrote public/models/${id}-pt.glb`, "hips rest y", hipsRest[1].toFixed(2));
