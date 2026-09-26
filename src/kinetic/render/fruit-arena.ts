/**
 * Fruit Slice arena: a neon night market (generated plate) behind the play
 * field, darkened at the center so fruit reads, with drifting lantern bokeh
 * and beat-reactive washes. The fruit simulation itself is unchanged.
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
const HUES = ["255,63,180", "63,224,255", "255,210,62", "255,150,70", "141,92,255"];

export class FruitArena {
  private time = 0;
  private motes: Mote[] = [];
  update(dt: number, w: number, h: number) {
    this.time += dt;
    if (!this.motes.length)
      for (let i = 0; i < 26; i++)
        this.motes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: h * (0.008 + Math.random() * 0.03),
          v: h * (0.01 + Math.random() * 0.03),
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
    // Darken the play field so fruit and blades pop.
    const pulse = Math.pow(1 - (beat % 1), 3);
    const vg = c.createRadialGradient(w / 2, h * 0.52, h * 0.1, w / 2, h * 0.5, h * 0.95);
    vg.addColorStop(0, `rgba(10,4,26,${0.62 - pulse * 0.06})`);
    vg.addColorStop(0.6, "rgba(10,4,26,0.38)");
    vg.addColorStop(1, "rgba(6,2,16,0.72)");
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
    // Beat wash from the top and a fever tint.
    const top = c.createLinearGradient(0, 0, 0, h * 0.5);
    top.addColorStop(0, `rgba(255,63,180,${0.06 + pulse * 0.08 + fever * 0.12})`);
    top.addColorStop(1, "rgba(255,63,180,0)");
    c.fillStyle = top;
    c.fillRect(0, 0, w, h * 0.5);
    if (fever > 0.5) {
      c.fillStyle = `rgba(255,63,180,${(fever - 0.5) * 0.12})`;
      c.fillRect(0, 0, w, h);
    }
    c.save();
    c.globalCompositeOperation = "lighter";
    for (const m of this.motes) {
      const a = 0.12 + 0.1 * Math.sin(this.time * 1.3 + m.ph);
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
