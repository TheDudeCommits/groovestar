import * as T from "three";

let ramp: T.DataTexture | null = null;
/** Three-band light ramp: stylized shading without losing texture detail. */
function toonRamp() {
  if (ramp) return ramp;
  ramp = new T.DataTexture(new Uint8Array([96, 176, 236, 255]), 4, 1, T.RedFormat);
  ramp.minFilter = ramp.magFilter = T.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

export interface ToonOptions {
  /** Rim light color for the camera-left and camera-right halves. */
  rimLeft?: T.ColorRepresentation;
  rimRight?: T.ColorRepresentation;
  rim?: number;
  outline?: T.ColorRepresentation | null;
  /** Outline width as a fraction of the mesh height. */
  outlineWidth?: number;
}

/**
 * Toon shading with a two-color fresnel rim (the stage lights) and an
 * inverted-hull outline that shares the skeleton. Returns the created hulls.
 */
export function toonify(root: T.Object3D, o: ToonOptions = {}) {
  const meshes: T.Mesh[] = [];
  root.traverse((m) => {
    if (m instanceof T.Mesh && !m.userData.ptHull) meshes.push(m);
  });
  const hulls: T.Mesh[] = [];
  const rimL = new T.Color(o.rimLeft ?? 0x3fe0ff),
    rimR = new T.Color(o.rimRight ?? 0xff3fb4);
  for (const mesh of meshes) {
    const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as T.MeshStandardMaterial;
    const mat = new T.MeshToonMaterial({
      map: src.map ?? null,
      color: src.map ? 0xffffff : (src.color ?? new T.Color(0xffffff)),
      gradientMap: toonRamp(),
    });
    const uniforms = {
      uRimL: { value: rimL },
      uRimR: { value: rimR },
      uRim: { value: o.rim ?? 1.25 },
    };
    mat.userData.pt = uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform vec3 uRimL; uniform vec3 uRimR; uniform float uRim;",
        )
        .replace(
          "#include <opaque_fragment>",
          `{
            vec3 vd = normalize(vViewPosition);
            float fr = pow(1.0 - clamp(dot(normal, vd), 0.0, 1.0), 2.4);
            vec3 rimC = mix(uRimL, uRimR, smoothstep(-0.2, 0.2, normal.x));
            outgoingLight += rimC * fr * uRim;
          }
          #include <opaque_fragment>`,
        );
    };
    mat.customProgramCacheKey = () => "pt-toon";
    mesh.material = mat;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    if (o.outline === null) continue;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    const thick = (box.max.y - box.min.y) * (o.outlineWidth ?? 0.0042);
    const oMat = new T.MeshBasicMaterial({ color: o.outline ?? 0x0b0418, side: T.BackSide });
    oMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3(position) + normalize(normal) * ${thick.toFixed(6)};`,
      );
    };
    oMat.customProgramCacheKey = () => `pt-hull-${thick.toFixed(6)}`;
    let hull: T.Mesh;
    if (mesh instanceof T.SkinnedMesh) {
      const s = new T.SkinnedMesh(mesh.geometry, oMat);
      s.bind(mesh.skeleton, mesh.bindMatrix);
      hull = s;
    } else hull = new T.Mesh(mesh.geometry, oMat);
    hull.userData.ptHull = true;
    hull.frustumCulled = false;
    mesh.frustumCulled = false;
    hull.position.copy(mesh.position);
    hull.quaternion.copy(mesh.quaternion);
    hull.scale.copy(mesh.scale);
    mesh.parent!.add(hull);
    hulls.push(hull);
  }
  return hulls;
}

/**
 * Hologram look for coaches and ghosts: additive fresnel glow with scanlines.
 * Replaces the materials of every mesh under root (outline hulls are hidden).
 */
export function hologram(root: T.Object3D, color: T.ColorRepresentation = 0x3fe0ff, strength = 1) {
  const uniforms = {
    uColor: { value: new T.Color(color) },
    uTime: { value: 0 },
    uStrength: { value: strength },
  };
  root.traverse((m) => {
    if (!(m instanceof T.Mesh)) return;
    if (m.userData.ptHull) {
      m.visible = false;
      return;
    }
    const mat = new T.MeshPhongMaterial({
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      side: T.FrontSide,
    });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vWorldY;")
        .replace(
          "#include <worldpos_vertex>",
          "#include <worldpos_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;",
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform vec3 uColor; uniform float uTime; uniform float uStrength; varying float vWorldY;",
        )
        .replace(
          "#include <opaque_fragment>",
          `{
            vec3 vd = normalize(vViewPosition);
            float fr = pow(1.0 - clamp(abs(dot(normal, vd)), 0.0, 1.0), 1.6);
            float scan = 0.72 + 0.28 * sin(vWorldY * 180.0 - uTime * 6.0);
            float band = smoothstep(0.0, 0.06, fract(vWorldY * 1.4 - uTime * 0.35)) ;
            outgoingLight = uColor * (0.16 + fr * 1.35) * scan * mix(1.35, 1.0, band) * uStrength;
            diffuseColor.a = 1.0;
          }
          #include <opaque_fragment>`,
        );
    };
    mat.customProgramCacheKey = () => "pt-holo";
    m.material = mat;
    m.castShadow = false;
    m.renderOrder = 3;
  });
  return uniforms;
}
