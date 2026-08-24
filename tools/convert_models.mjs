import { NodeIO } from '@gltf-transform/core';
import { prune, dedup } from '@gltf-transform/functions';
import { readdirSync } from 'fs';

const io = new NodeIO();
const src = '/tmp/umw_drive/Individual Characters/glTF';
for (const f of readdirSync(src).filter((x) => x.endsWith('.gltf'))) {
  const doc = await io.read(`${src}/${f}`);
  // we retarget bones ourselves — the baked animation clips are dead weight
  for (const anim of doc.getRoot().listAnimations()) anim.dispose();
  await doc.transform(dedup(), prune());
  const name = f.replace('.gltf', '');
  await io.write(`/Users/amir/Claude/groovestar/public/models/W_${name}.glb`, doc);
  console.log(name, 'done');
}
