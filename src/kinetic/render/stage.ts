import * as T from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { settings } from "../core/settings";
export const COLORS = {
  paper: 0xeeeae1,
  ink: 0x171917,
  coral: 0xf35d42,
  blue: 0x365ff5,
  lime: 0xd7ef70,
};
export const material = (color: number, roughness = 0.7, metalness = 0) =>
  new T.MeshStandardMaterial({ color, roughness, metalness });
export function mesh(
  g: T.BufferGeometry,
  m: T.Material,
  parent: T.Object3D,
  x = 0,
  y = 0,
  z = 0,
) {
  const o = new T.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}
export function block(
  parent: T.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  m: T.Material,
) {
  return mesh(new T.BoxGeometry(w, h, d), m, parent, x, y, z);
}
export function textPlane(text: string, color = "#eeeae1", size = 1) {
  const cv = document.createElement("canvas");
  cv.width = 1024;
  cv.height = 256;
  const c = cv.getContext("2d")!;
  c.fillStyle = color;
  c.font = '800 170px "Barlow Condensed", sans-serif';
  c.textAlign = "center";
  c.textBaseline = "middle";
  {
    let px = 170;
    while (c.measureText(text).width > 970 && px > 40) {
      px -= 4;
      c.font = `800 ${px}px "Barlow Condensed", sans-serif`;
    }
    c.fillText(text, 512, 132);
  }
  const tex = new T.CanvasTexture(cv);
  tex.colorSpace = T.SRGBColorSpace;
  const m = new T.MeshBasicMaterial({
    map: tex,
    transparent: true,
    side: T.DoubleSide,
    depthWrite: false,
  });
  return new T.Mesh(new T.PlaneGeometry(size * 4, size), m);
}
export class Stage {
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(40, 1, 0.05, 250);
  readonly renderer: T.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private composer?: EffectComposer;
  private bloom?: UnrealBloomPass;
  private resizeObserver: ResizeObserver;
  private disposed = false;
  private width = 0;
  private height = 0;
  frames = 0;
  frameMs = 0;
  contextLost = false;
  constructor(
    readonly host: HTMLElement,
    opts: { dark?: boolean; alpha?: boolean; bloom?: boolean } = {},
  ) {
    this.renderer = new T.WebGLRenderer({
      antialias: settings().quality !== "low",
      alpha: !!opts.alpha,
      powerPreference: "high-performance",
    });
    this.canvas = this.renderer.domElement;
    this.canvas.className = "kinetic-canvas";
    this.canvas.setAttribute("aria-label", "GrooveStar live game scene");
    host.appendChild(this.canvas);
    this.renderer.info.autoReset = false;
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, settings().quality === "low" ? 1 : 1.5),
    );
    this.renderer.shadowMap.enabled = settings().quality !== "low";
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    if (!opts.alpha) {
      this.scene.background = new T.Color(opts.dark ? 0x090d17 : 0xe5e1d7);
      this.scene.fog = new T.Fog(opts.dark ? 0x090d17 : 0xe5e1d7, 25, 100);
    }
    const hemi = new T.HemisphereLight(
      opts.dark ? 0x7890bf : 0xf9f2df,
      0x343d36,
      opts.dark ? 2.2 : 1.65,
    );
    this.scene.add(hemi);
    const sun = new T.DirectionalLight(0xffead7, opts.dark ? 3.5 : 3);
    sun.position.set(-4, 8, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    const rim = new T.DirectionalLight(opts.dark ? 0x557cff : 0xcbd5ff, 2.4);
    rim.position.set(4, 4, -4);
    this.scene.add(rim);
    this.camera.position.set(0, 1.6, 6);
    this.camera.lookAt(0, 1, 0);
    if (opts.bloom && settings().quality !== "low") {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(
        new T.Vector2(640, 360),
        settings().reducedMotion ? 0.25 : 0.8,
        0.65,
        0.85,
      );
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.contextLost = true;
      host.dispatchEvent(new CustomEvent("gs-context", { detail: "lost" }));
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.contextLost = false;
      host.dispatchEvent(new CustomEvent("gs-context", { detail: "restored" }));
    });
  }
  resize() {
    const w = Math.max(1, this.host.clientWidth),
      h = Math.max(1, this.host.clientHeight);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const fov = this.camera.userData.referenceFov ?? 40;
    this.camera.fov = T.MathUtils.radToDeg(
      2 *
        Math.atan(
          Math.tan(T.MathUtils.degToRad(fov / 2)) * Math.max(1, 1.4 / (w / h)),
        ),
    );
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
  }
  floor(size = 80, color = COLORS.paper) {
    const p = mesh(
      new T.PlaneGeometry(size, size),
      material(color, 0.85),
      this.scene,
    );
    p.rotation.x = -Math.PI / 2;
    return p;
  }
  render() {
    if (this.disposed || this.contextLost) return;
    const t = performance.now();
    this.renderer.info.reset();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.frameMs = this.frameMs * 0.95 + (performance.now() - t) * 0.05;
    this.frames++;
    if (
      this.frames === 180 &&
      settings().quality === "auto" &&
      this.frameMs > 15
    ) {
      this.renderer.setPixelRatio(1);
      this.composer?.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
      this.resize();
    }
  }
  project(v: T.Vector3) {
    const q = v.clone().project(this.camera);
    return { x: (q.x + 1) / 2, y: (1 - q.y) / 2 };
  }
  unproject(x: number, y: number, z = 0) {
    const q = new T.Vector3(x * 2 - 1, 1 - y * 2, 0.5).unproject(this.camera);
    const d = q.sub(this.camera.position).normalize();
    return this.camera.position
      .clone()
      .add(d.multiplyScalar((z - this.camera.position.z) / d.z));
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.scene.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          Object.values(m).forEach((v) => {
            if (v instanceof T.Texture) v.dispose();
          });
          m.dispose();
        });
      }
    });
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
