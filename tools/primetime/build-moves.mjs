// Builds public/models/nova-moves.glb: Nova's skeleton with the extra Meshy
// clips (the Dance coach routines and the game actions), no mesh or texture.
// Characters load it on demand and bind the clips to their own skeleton by
// bone name.
//
//   GROOVESTAR_NOVA_SRC=~/Claude-Pro/groovestar-primetime/meshy node tools/primetime/build-moves.mjs
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, resample, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import { join } from "node:path";
import { homedir } from "node:os";

const src = (process.env.GROOVESTAR_NOVA_SRC ?? join(homedir(), "Claude-Pro/groovestar-primetime/meshy")).replace(/^~/, homedir());
// [clip name, Meshy action id, root motion: drift = remove net drift, pin = hold x/z, keep]
export const MOVES = [
  // Dance coach routines
  ["D22", 22, "drift"], ["D23", 23, "drift"], ["D24", 24, "drift"], ["D63", 63, "drift"],
  ["D65", 65, "drift"], ["D67", 67, "drift"], ["D68", 68, "drift"], ["D69", 69, "drift"],
  ["D70", 70, "drift"], ["D71", 71, "drift"], ["D72", 72, "drift"], ["D73", 73, "drift"],
  ["D75", 75, "drift"], ["D76", 76, "drift"], ["D77", 77, "drift"], ["D78", 78, "drift"],
  ["D79", 79, "drift"], ["D80", 80, "drift"], ["D81", 81, "drift"], ["D83", 83, "drift"],
  // Game actions
  ["Slash", 219, "pin"], ["SlashL", 97, "pin"], ["BladeSpin", 91, "pin"],
  ["JabL", 191, "pin"], ["JabR", 192, "pin"], ["HookL", 193, "pin"], ["Uppercut", 194, "pin"],
  ["BoxBounce", 87, "pin"], ["PunchPose", 376, "pin"],
  ["Sprint", 509, "pin"], ["RunFast", 16, "pin"], ["Jump", 463, "pin"], ["Slide", 516, "pin"],
  ["Swing", 323, "pin"], ["Throw", 239, "pin"],
  ["Victory", 412, "drift"], ["VictoryCheer", 59, "drift"], ["FistPump", 403, "pin"],
  ["JumpOpen", 460, "pin"], ["SpinJump", 397, "pin"], ["Wave", 28, "pin"],
];

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const base = await io.read(join(src, "anim/idle.glb"));
const root = base.getRoot();
for (const a of root.listAnimations()) a.dispose();
for (const n of root.listNodes()) {
  n.setMesh(null);
  n.setSkin(null);
}
for (const m of root.listMeshes()) m.dispose();
for (const s of root.listSkins()) s.dispose();
for (const m of root.listMaterials()) m.dispose();
for (const t of root.listTextures()) t.dispose();
const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
const buffer = root.listBuffers()[0];

for (const [name, id, rootMode] of MOVES) {
  const doc = await io.read(join(src, `anim2/a${id}.glb`));
  const clip = doc.getRoot().listAnimations()[0];
  const anim = base.createAnimation(name);
  for (const ch of clip.listChannels()) {
    const target = nodes.get(ch.getTargetNode().getName());
    if (!target) continue;
    // Only the hips carry translation; scale never animates.
    if (ch.getTargetPath() === "scale") continue;
    if (ch.getTargetPath() === "translation" && target.getName() !== "Hips") continue;
    const s = ch.getSampler();
    const input = s.getInput(), output = s.getOutput();
    const times = input.getArray().slice();
    const values = output.getArray().slice();
    const t0 = times[0];
    for (let i = 0; i < times.length; i++) times[i] -= t0;
    if (target.getName() === "Hips" && ch.getTargetPath() === "translation") {
      const n = times.length, span = Math.max(1e-6, times[n - 1]);
      const dx = values[(n - 1) * 3] - values[0], dz = values[(n - 1) * 3 + 2] - values[2];
      for (let i = 0; i < n; i++) {
        if (rootMode === "pin") {
          values[i * 3] = values[0];
          values[i * 3 + 2] = values[2];
        } else if (rootMode === "drift") {
          const k = times[i] / span;
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
}
await base.transform(resample({ tolerance: 0.0004 }), dedup(), prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
await io.write("public/models/nova-moves.glb", base);
console.log("wrote public/models/nova-moves.glb", MOVES.length, "clips");
