// Vector cover art for the Games row — one function per game, house style.

type Ctx = CanvasRenderingContext2D;

function sky(c: Ctx, w: number, h: number) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2a1a5e');
  g.addColorStop(1, '#3c1e63');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

export function coverFruit(cv: HTMLCanvasElement) {
  const c = cv.getContext('2d')!;
  const w = cv.width, h = cv.height;
  sky(c, w, h);
  c.save();
  c.translate(w * 0.38, h * 0.52);
  c.rotate(-0.3);
  c.fillStyle = '#ff5d73';
  c.beginPath(); c.arc(0, 0, h * 0.3, 0, Math.PI); c.closePath(); c.fill();
  c.lineWidth = h * 0.055; c.strokeStyle = '#39b356';
  c.beginPath(); c.arc(0, 0, h * 0.285, 0, Math.PI); c.stroke();
  c.fillStyle = '#28203a';
  for (let i = -2; i <= 2; i++) {
    c.beginPath(); c.ellipse(i * h * 0.09, h * 0.09, h * 0.016, h * 0.028, i * 0.4, 0, Math.PI * 2); c.fill();
  }
  c.restore();
  c.save();
  c.translate(w * 0.62, h * 0.34);
  c.fillStyle = '#ffa63e';
  c.beginPath(); c.arc(0, 0, h * 0.16, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#2f9e39';
  c.beginPath(); c.ellipse(h * 0.05, -h * 0.16, h * 0.07, h * 0.032, -0.5, 0, Math.PI * 2); c.fill();
  c.restore();
  blade(c, w, h);
}

function blade(c: Ctx, w: number, h: number) {
  c.strokeStyle = '#ffd23e';
  c.lineCap = 'round';
  c.lineWidth = h * 0.03;
  c.shadowColor = '#ffd23e';
  c.shadowBlur = 18;
  c.beginPath();
  c.moveTo(w * 0.16, h * 0.78);
  c.quadraticCurveTo(w * 0.5, h * 0.1, w * 0.86, h * 0.42);
  c.stroke();
  c.shadowBlur = 0;
}

export function coverBlade(cv: HTMLCanvasElement) {
  const c = cv.getContext('2d')!;
  const w = cv.width, h = cv.height;
  sky(c, w, h);
  // runway
  c.strokeStyle = 'rgba(255,255,255,0.2)';
  c.lineWidth = 2;
  for (const lx of [-1, 1]) {
    c.beginPath();
    c.moveTo(w / 2 + lx * w * 0.05, h * 0.2);
    c.lineTo(w / 2 + lx * w * 0.34, h);
    c.stroke();
  }
  // note blocks
  for (const [x, y, s, col] of [
    [0.36, 0.55, 0.14, '#6ee7ff'], [0.64, 0.4, 0.1, '#ffd23e'], [0.58, 0.68, 0.17, '#ffd23e'],
  ] as const) {
    c.fillStyle = col;
    c.beginPath();
    c.roundRect(w * x - h * s, h * y - h * s, h * s * 2, h * s * 2, h * s * 0.3);
    c.fill();
    c.fillStyle = 'rgba(20,14,40,0.7)';
    c.beginPath();
    c.moveTo(w * x, h * y - h * s * 0.45);
    c.lineTo(w * x - h * s * 0.4, h * y + h * s * 0.3);
    c.lineTo(w * x + h * s * 0.4, h * y + h * s * 0.3);
    c.closePath();
    c.fill();
  }
}

export function coverRush(cv: HTMLCanvasElement) {
  const c = cv.getContext('2d')!;
  const w = cv.width, h = cv.height;
  sky(c, w, h);
  // corridor
  c.fillStyle = '#241a4e';
  c.beginPath();
  c.moveTo(w * 0.1, h);
  c.lineTo(w * 0.42, h * 0.28);
  c.lineTo(w * 0.58, h * 0.28);
  c.lineTo(w * 0.9, h);
  c.closePath();
  c.fill();
  c.strokeStyle = 'rgba(255,210,62,0.6)';
  c.lineWidth = h * 0.014;
  c.beginPath(); c.moveTo(w * 0.1, h); c.lineTo(w * 0.42, h * 0.28); c.stroke();
  c.beginPath(); c.moveTo(w * 0.9, h); c.lineTo(w * 0.58, h * 0.28); c.stroke();
  // runner
  c.fillStyle = '#ffd23e';
  c.beginPath(); c.roundRect(w * 0.46, h * 0.52, w * 0.08, h * 0.22, w * 0.03); c.fill();
  c.fillStyle = '#fff7ee';
  c.beginPath(); c.arc(w * 0.5, h * 0.46, h * 0.07, 0, Math.PI * 2); c.fill();
  // block
  c.fillStyle = '#ff5d73';
  c.beginPath(); c.roundRect(w * 0.65, h * 0.42, w * 0.14, h * 0.3, w * 0.01); c.fill();
}

export function coverBowl(cv: HTMLCanvasElement) {
  const c = cv.getContext('2d')!;
  const w = cv.width, h = cv.height;
  sky(c, w, h);
  c.fillStyle = '#3a2a6e';
  c.beginPath();
  c.moveTo(w * 0.2, h); c.lineTo(w * 0.4, h * 0.2); c.lineTo(w * 0.6, h * 0.2); c.lineTo(w * 0.8, h);
  c.closePath(); c.fill();
  // pins
  for (const [x, y, s] of [[0.5, 0.3, 0.1], [0.44, 0.36, 0.11], [0.56, 0.36, 0.11]] as const) {
    c.fillStyle = '#fff7ee';
    c.beginPath(); c.ellipse(w * x, h * y, h * s * 0.32, h * s * 0.8, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#ff5d73';
    c.lineWidth = h * 0.018;
    c.beginPath(); c.moveTo(w * x - h * s * 0.26, h * y - h * s * 0.2); c.lineTo(w * x + h * s * 0.26, h * y - h * s * 0.2); c.stroke();
  }
  // ball
  const g = c.createRadialGradient(w * 0.47, h * 0.66, h * 0.03, w * 0.5, h * 0.7, h * 0.16);
  g.addColorStop(0, '#b39dff');
  g.addColorStop(1, '#5a3dd0');
  c.fillStyle = g;
  c.beginPath(); c.arc(w * 0.5, h * 0.7, h * 0.16, 0, Math.PI * 2); c.fill();
}

export function coverTennis(cv: HTMLCanvasElement) {
  const c = cv.getContext('2d')!;
  const w = cv.width, h = cv.height;
  sky(c, w, h);
  c.fillStyle = '#2a5e8a';
  c.beginPath();
  c.moveTo(w * 0.12, h); c.lineTo(w * 0.36, h * 0.24); c.lineTo(w * 0.64, h * 0.24); c.lineTo(w * 0.88, h);
  c.closePath(); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.7)';
  c.lineWidth = 2.5;
  c.beginPath(); c.moveTo(w * 0.24, h * 0.6); c.lineTo(w * 0.76, h * 0.6); c.stroke();
  // racket
  c.strokeStyle = '#ffd23e';
  c.lineWidth = h * 0.03;
  c.beginPath(); c.ellipse(w * 0.68, h * 0.5, h * 0.12, h * 0.17, -0.4, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.moveTo(w * 0.72, h * 0.64); c.lineTo(w * 0.78, h * 0.82); c.stroke();
  // ball
  c.fillStyle = '#d6f78e';
  c.beginPath(); c.arc(w * 0.42, h * 0.42, h * 0.07, 0, Math.PI * 2); c.fill();
}

export function coverBox(cv: HTMLCanvasElement) {
  const c = cv.getContext('2d')!;
  const w = cv.width, h = cv.height;
  sky(c, w, h);
  for (let i = 0; i < 3; i++) {
    const y = h * (0.3 + i * 0.16);
    c.strokeStyle = i === 1 ? 'rgba(255,93,115,0.8)' : 'rgba(255,255,255,0.3)';
    c.lineWidth = h * 0.02;
    c.beginPath(); c.moveTo(0, y); c.quadraticCurveTo(w / 2, y + h * 0.03, w, y); c.stroke();
  }
  // mitt
  c.fillStyle = '#ffd23e';
  c.beginPath(); c.arc(w * 0.62, h * 0.5, h * 0.2, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.beginPath(); c.arc(w * 0.62, h * 0.5, h * 0.125, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ffd23e';
  c.beginPath(); c.arc(w * 0.62, h * 0.5, h * 0.07, 0, Math.PI * 2); c.fill();
  // glove
  c.fillStyle = '#ff5d73';
  c.beginPath(); c.arc(w * 0.32, h * 0.58, h * 0.16, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.35)';
  c.beginPath(); c.arc(w * 0.27, h * 0.53, h * 0.05, 0, Math.PI * 2); c.fill();
}

export function coverDance(cv: HTMLCanvasElement) {
  const c = cv.getContext('2d')!;
  const w = cv.width, h = cv.height;
  sky(c, w, h);
  // spotlight cone
  const g = c.createRadialGradient(w * 0.5, h * 0.2, 0, w * 0.5, h * 0.2, h);
  g.addColorStop(0, 'rgba(255,106,193,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  // dancer silhouette: one arm skyward, hip out
  c.save();
  c.translate(w * 0.48, h * 0.58);
  c.fillStyle = '#fff7ee';
  c.beginPath(); c.arc(0, -h * 0.3, h * 0.085, 0, Math.PI * 2); c.fill();   // head
  c.lineCap = 'round';
  c.strokeStyle = '#fff7ee';
  c.lineWidth = h * 0.055;
  c.beginPath(); c.moveTo(0, -h * 0.2); c.lineTo(-h * 0.04, h * 0.05); c.stroke();  // torso
  c.beginPath(); c.moveTo(0, -h * 0.17); c.lineTo(h * 0.16, -h * 0.42); c.stroke(); // arm up
  c.beginPath(); c.moveTo(0, -h * 0.14); c.lineTo(-h * 0.18, -h * 0.05); c.stroke();// arm out
  c.beginPath(); c.moveTo(-h * 0.04, h * 0.05); c.lineTo(-h * 0.16, h * 0.3); c.stroke();
  c.beginPath(); c.moveTo(-h * 0.04, h * 0.05); c.lineTo(h * 0.1, h * 0.3); c.stroke();
  c.restore();
  // gold sweep + sparkles
  c.strokeStyle = '#ffd23e';
  c.lineWidth = h * 0.02;
  c.shadowColor = '#ffd23e';
  c.shadowBlur = 12;
  c.beginPath(); c.moveTo(w * 0.62, h * 0.2); c.quadraticCurveTo(w * 0.78, h * 0.36, w * 0.68, h * 0.6); c.stroke();
  c.shadowBlur = 0;
  c.fillStyle = '#ffd23e';
  for (const [sx, sy, sr] of [[0.7, 0.18, 0.02], [0.78, 0.3, 0.014], [0.72, 0.52, 0.016], [0.3, 0.22, 0.015]] as const) {
    c.beginPath(); c.arc(w * sx, h * sy, h * sr, 0, Math.PI * 2); c.fill();
  }
}
