/**
 * Fruit Slice arena: a lantern-lit night dojo (a 3D render, see
 * groovestar-primetime/keyart/dojo.py) behind the play field, softly
 * vignetted, with drifting embers and a warm beat wash. Juice splats land on
 * the wall on top of this.
 */
const plate = new Image();
plate.decoding = "async";
plate.src = "/kinetic/pt/plate-fruit.webp";

interface Mote {
  x: number;
  y: number;
  r: number;
  v: number;
  hue: string;
  ph: number;
}
const HUES = ["255,190,110", "255,150,70", "255,220,160", "255,120,60"];

export class FruitArena {
  private time = 0;
  private motes: Mote[] = [];
  update(dt: number, w: number, h: number) {
    this.time += dt;
    if (!this.motes.length)
      for (let i = 0; i < 34; i++)
        this.motes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: h * (0.004 + Math.random() * 0.01),
          v: h * (0.015 + Math.random() * 0.04),
          hue: HUES[i % HUES.length],
          ph: Math.random() * 6.28,
        });
    for (const m of this.motes) {
      m.y -= m.v * dt;
      m.x += Math.sin(this.time * 0.5 + m.ph) * dt * h * 0.01;
      if (m.y < -m.r * 2) {
        m.y = h + m.r * 2;
        m.x = Math.random() * w;
      }
    }
  }
  draw(c: CanvasRenderingContext2D, w: number, h: number, beat: number, fever: number) {
    c.fillStyle = "#0a0618";
    c.fillRect(0, 0, w, h);
    if (plate.complete && plate.naturalWidth) {
      const s = Math.max(w / plate.naturalWidth, h / plate.naturalHeight) * 1.04;
      const pw = plate.naturalWidth * s,
        ph = plate.naturalHeight * s;
      const drift = Math.sin(this.time * 0.08) * w * 0.01;
      c.drawImage(plate, (w - pw) / 2 + drift, (h - ph) / 2, pw, ph);
    }
    // Soft vignette keeps the eye on the play field; the beat breathes warm.
    const pulse = Math.pow(1 - (beat % 1), 3);
    const vg = c.createRadialGradient(w / 2, h * 0.5, h * 0.25, w / 2, h * 0.5, h * 1.0);
    vg.addColorStop(0, "rgba(12,5,2,0.12)");
    vg.addColorStop(0.7, "rgba(12,5,2,0.35)");
    vg.addColorStop(1, "rgba(6,2,1,0.7)");
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
    const top = c.createLinearGradient(0, 0, 0, h * 0.55);
    top.addColorStop(0, `rgba(255,170,80,${0.04 + pulse * 0.07 + fever * 0.1})`);
    top.addColorStop(1, "rgba(255,170,80,0)");
    c.fillStyle = top;
    c.fillRect(0, 0, w, h * 0.55);
    if (fever > 0.5) {
      c.fillStyle = `rgba(255,120,40,${(fever - 0.5) * 0.14})`;
      c.fillRect(0, 0, w, h);
    }
    c.save();
    c.globalCompositeOperation = "lighter";
    for (const m of this.motes) {
      const a = 0.35 + 0.3 * Math.sin(this.time * 2.1 + m.ph);
      const g = c.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
      g.addColorStop(0, `rgba(${m.hue},${a})`);
      g.addColorStop(1, `rgba(${m.hue},0)`);
      c.fillStyle = g;
      c.beginPath();
      c.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }
}
