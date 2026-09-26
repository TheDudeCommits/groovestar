// Builds public/models/nova-pt.glb from the Meshy exports of Nova: one skinned
// mesh plus every clip under the names the game plays (Idle, Dance, Dance2,
// Dance3, Guard, Celebrate, Run). Clips are made to loop in place, then the
// file is meshopt-compressed with a WebP texture.
//
//   GROOVESTAR_NOVA_SRC=~/Claude-Pro/groovestar-primetime/meshy node tools/primetime/build-nova.mjs
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, resample, meshopt, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { join } from "node:path";
import { homedir } from "node:os";

const src = (process.env.GROOVESTAR_NOVA_SRC ?? join(homedir(), "Claude-Pro/groovestar-primetime/meshy")).replace(/^~/, homedir());
const CLIPS = [
  ["Idle", "anim/idle.glb"],
  ["Dance", "anim/dance-allnight.glb"],
  ["Dance2", "anim/dance-boom.glb"],
  ["Dance3", "anim/dance-yougroove.glb"],
  ["Guard", "anim/guard.glb"],
  ["Celebrate", "anim/cheer.glb"],
  ["Run", "nova-run.glb"],
];
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const base = await io.read(join(src, CLIPS[0][1]));
const root = base.getRoot();
for (const a of root.listAnimations()) a.dispose();
const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
const buffer = root.listBuffers()[0];

for (const [name, file] of CLIPS) {
  const doc = await io.read(join(src, file));
  const clip = doc.getRoot().listAnimations()[0];
  const anim = base.createAnimation(name);
  for (const ch of clip.listChannels()) {
    const target = nodes.get(ch.getTargetNode().getName());
    if (!target) continue;
    const s = ch.getSampler();
    const input = s.getInput(), output = s.getOutput();
    const times = input.getArray().slice();
    const values = output.getArray().slice();
    // Root motion: loop in place. Run is pinned to its first frame; other clips
    // lose only their net drift so the loop point does not jump.
    if (target.getName() === "Hips" && ch.getTargetPath() === "translation") {
      const n = times.length, t0 = times[0], span = Math.max(1e-6, times[n - 1] - t0);
      const dx = values[(n - 1) * 3] - values[0], dz = values[(n - 1) * 3 + 2] - values[2];
      for (let i = 0; i < n; i++) {
        const k = (times[i] - t0) / span;
        if (name === "Run") {
          values[i * 3] = values[0];
          values[i * 3 + 2] = values[2];
        } else {
          values[i * 3] -= dx * k;
          values[i * 3 + 2] -= dz * k;
        }
      }
    }
    const inAcc = base.createAccessor().setType("SCALAR").setArray(times).setBuffer(buffer);
    const outAcc = base.createAccessor().setType(output.getType()).setArray(values).setBuffer(buffer);
    const sampler = base.createAnimationSampler().setInput(inAcc).setOutput(outAcc).setInterpolation(s.getInterpolation());
    anim.addSampler(sampler);
    anim.addChannel(base.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(sampler));
  }
  console.log(name, anim.listChannels().length, "channels");
}
for (const m of root.listMaterials()) {
  m.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]).setName("nova");
}
for (const e of root.listExtensionsUsed())
  if (["KHR_materials_specular", "KHR_materials_ior"].includes(e.extensionName)) e.dispose();
await base.transform(
  resample(),
  dedup(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: "webp", quality: 84, resize: [2048, 2048] }),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);
await io.write("public/models/nova-pt.glb", base);
console.log("wrote public/models/nova-pt.glb");
