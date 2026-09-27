import * as T from "three";

/**
 * A blade swoosh: a ribbon between the blade's base and tip over the last few
 * frames, fading with age and brightest at the tip. When the blade teleports
 * (a tracking jump) the ribbon restarts instead of stretching across the scene.
 */
export class RibbonTrail {
  readonly mesh: T.Mesh;
  private base: T.Vector3[] = [];
  private tip: T.Vector3[] = [];
  private readonly positions: Float32Array;
  private readonly fades: Float32Array;
  constructor(
    color: T.ColorRepresentation,
    private readonly length = 14,
    private readonly maxStep = 0.9,
  ) {
    this.positions = new Float32Array(length * 2 * 3);
    this.fades = new Float32Array(length * 2 * 2);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    geometry.setAttribute(
      "fade",
      new T.BufferAttribute(this.fades, 2).setUsage(T.DynamicDrawUsage),
    );
    const index: number[] = [];
    for (let i = 0; i < length - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(index);
    const material = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      side: T.DoubleSide,
      uniforms: { uColor: { value: new T.Color(color) } },
      vertexShader: `attribute vec2 fade; varying vec2 vFade;
        void main(){ vFade = fade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying vec2 vFade;
        void main(){
          float a = pow(clamp(vFade.x, 0.0, 1.0), 1.6) * mix(0.12, 1.0, vFade.y * vFade.y);
          gl_FragColor = vec4(uColor * a * 0.9, 1.0);
        }`,
    });
    this.mesh = new T.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }
  push(base: T.Vector3, tip: T.Vector3) {
    const last = this.tip[0];
    if (last && last.distanceTo(tip) > this.maxStep) this.clear();
    this.base.unshift(base.clone());
    this.tip.unshift(tip.clone());
    if (this.base.length > this.length) {
      this.base.length = this.length;
      this.tip.length = this.length;
    }
    this.write();
  }
  clear() {
    this.base = [];
    this.tip = [];
    this.write();
  }
  private write() {
    const count = this.base.length;
    for (let i = 0; i < this.length; i++) {
      const j = Math.min(i, Math.max(0, count - 1));
      const b = this.base[j],
        t = this.tip[j];
      if (b && t) {
        this.positions.set([b.x, b.y, b.z, t.x, t.y, t.z], i * 6);
      }
      const age = count > 1 && i < count ? 1 - i / (count - 1) : 0;
      this.fades.set([age, 0, age, 1], i * 4);
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.fade.needsUpdate = true;
  }
}
