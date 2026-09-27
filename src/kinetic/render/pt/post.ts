import * as T from "three";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

/**
 * Final grade for Primetime venues: a touch of lens aberration toward the
 * corners, a vignette, a beat-synced exposure kick and fine film grain.
 * Runs before OutputPass, so it works on linear HDR color.
 */
export function gradePass() {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uAberration: { value: 0.0014 },
      uVignette: { value: 0.5 },
      uKick: { value: 0 },
      uFlash: { value: 0 },
      uFlashColor: { value: new T.Color(1, 1, 1) },
      uGrain: { value: 0.035 },
      uLift: { value: new T.Color(0.012, 0.004, 0.03) },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uAberration; uniform float uVignette;
      uniform float uKick; uniform float uFlash; uniform vec3 uFlashColor; uniform float uGrain; uniform vec3 uLift;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 d = vUv - 0.5;
        float r2 = dot(d, d);
        vec2 off = d * uAberration * (1.0 + r2 * 6.0);
        vec4 center = texture2D(tDiffuse, vUv);
        float a = clamp(center.a, 0.0, 1.0);
        vec3 c;
        c.r = texture2D(tDiffuse, vUv + off).r;
        c.g = center.g;
        c.b = texture2D(tDiffuse, vUv - off).b;
        c *= 1.0 + uKick * 0.22;
        c += uFlashColor * uFlash * 0.35 * (1.0 - r2 * 1.6);
        c += uLift * a;
        c *= 1.0 - smoothstep(0.12, 0.72, r2) * uVignette;
        c += (hash(vUv * 1024.0 + fract(uTime)) - 0.5) * uGrain * (0.35 + dot(c, vec3(0.3))) * a;
        gl_FragColor = vec4(max(c, 0.0), a);
      }`,
  });
}
