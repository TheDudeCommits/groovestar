/** Graphic, quietly lit fruit court. The existing fruit simulation is unchanged. */
export class FruitArena {
  private time = 0;
  update(dt: number, _w: number, _h: number) {
    this.time += dt;
  }
  draw(
    c: CanvasRenderingContext2D,
    w: number,
    h: number,
    beat: number,
    fever: number,
  ) {
    c.fillStyle = "#192b24";
    c.fillRect(0, 0, w, h);
    const glow = c.createRadialGradient(
      w * 0.5,
      h * 0.42,
      0,
      w * 0.5,
      h * 0.42,
      h * 0.7,
    );
    glow.addColorStop(0, fever > 0.5 ? "#665031" : "#3a5038");
    glow.addColorStop(1, "#192b24");
    c.fillStyle = glow;
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#253b30";
    c.beginPath();
    c.moveTo(0, h * 0.73);
    c.lineTo(w * 0.35, h * 0.58);
    c.lineTo(w * 0.65, h * 0.58);
    c.lineTo(w, h * 0.73);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.fill();
    c.strokeStyle = "#66715b";
    c.lineWidth = Math.max(1, h * 0.0013);
    for (const x of [0.03, 0.08, 0.92, 0.97]) {
      c.beginPath();
      c.moveTo(w * (0.5 + (x - 0.5) * 0.33), h * 0.58);
      c.lineTo(w * x, h);
      c.stroke();
    }
    c.save();
    c.globalAlpha = 0.33;
    c.strokeStyle = "#eeeae1";
    c.beginPath();
    c.ellipse(w * 0.5, h * 0.9, w * 0.35, h * 0.11, 0, 0, Math.PI * 2);
    c.stroke();
    c.restore();
    c.fillStyle = "#f35d42";
    c.fillRect(w * 0.04, h * 0.17, w * 0.015, h * 0.45);
    c.fillRect(w * 0.945, h * 0.17, w * 0.015, h * 0.45);
    c.fillStyle = "#829071";
    c.textAlign = "center";
    c.font = `700 ${h * 0.062}px "Barlow Condensed"`;
    c.fillText("FRESH ENERGY", w * 0.5, h * 0.23);
    c.fillStyle = "#d7ef70";
    c.font = `500 ${h * 0.015}px "IBM Plex Mono"`;
    c.fillText("GROOVESTAR / MOVEMENT SERIES 05", w * 0.5, h * 0.27);
    const phrase = Math.floor(beat / 16) % 4;
    c.globalAlpha = 0.5;
    for (let i = 0; i < 4; i++) {
      c.fillStyle = i === phrase ? "#d7ef70" : "#566849";
      c.fillRect(w * (0.445 + i * 0.03), h * 0.32, w * 0.018, 3);
    }
    c.globalAlpha = 1;
  }
}
