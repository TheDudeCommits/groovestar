import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
/** Collapse static set dressing by material. Actors and collision proxies stay separate. */
export function batchStatic(group: T.Group) {
  group.updateWorldMatrix(true, true);
  const inverse = group.matrixWorld.clone().invert();
  const buckets = new Map<T.Material, T.BufferGeometry[]>();
  const remove: T.Mesh[] = [];
  group.traverse((o) => {
    if (
      !(o instanceof T.Mesh) ||
      Array.isArray(o.material) ||
      o instanceof T.SkinnedMesh
    )
      return;
    const geometries = buckets.get(o.material) ?? [];
    geometries.push(
      o.geometry.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld)),
    );
    buckets.set(o.material, geometries);
    remove.push(o);
  });
  for (const o of remove) {
    o.removeFromParent();
    o.geometry.dispose();
  }
  for (const [material, geometries] of buckets) {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((g) => g.dispose());
    if (!merged) continue;
    const m = new T.Mesh(merged, material);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
}
