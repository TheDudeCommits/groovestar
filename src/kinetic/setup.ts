import { gameDef, type GameId } from "./core/catalog";
import { settings, announce } from "./core/settings";
import { MotionInput } from "./core/input";
import type { TrackerLike } from "../games/shared";
import { saveBodyScale } from "../pose/rig";
/** Framing and game-specific movement practice. No timeout grants a scored start. */
export async function prepareSession(
  id: GameId,
  demo: boolean,
  init: () => Promise<boolean>,
  tracker: () => TrackerLike & { video: HTMLVideoElement },
): Promise<boolean | null> {
  if (demo) return false;
  const config = settings();
  const practice =
    id === "rush"
      ? [
          "Step to each side",
          config.lowImpact
            ? "Raise a knee or reach upward"
            : "Rise to clear a hurdle",
          "Make a comfortable duck",
        ]
      : id === "box"
        ? [
            "Bring both hands to guard",
            "Punch left toward the camera",
            "Return to guard",
            "Punch right toward the camera",
          ]
        : id === "bowl"
          ? ["Lower your bowling hand", "Swing forward and upward"]
          : id === "blade"
            ? [
                "Reach both hands apart",
                "Sweep a hand sideways",
                "Sweep a hand downward",
              ]
            : ["Reach both hands comfortably apart"];
  const labels = [
    "Find your standing position",
    "Raise your left hand",
    "Raise your right hand",
    ...practice,
  ];
  const panel = document.createElement("div");
  panel.className = "overlay k-setup";
  panel.innerHTML = `<button data-back>← BACK TO ${gameDef(id).title.toUpperCase()}</button><div class="k-setup-layout"><div><span class="k-eyebrow">MAKE ROOM FOR YOURSELF</span><h1>Let’s find<br><em>your frame.</em></h1><p>Place your camera at about chest height.<br>Keep your movement comfortable and your ${id === "rush" ? "whole body" : "hips and hands"} in view.</p><ol>${labels.map((label, i) => `<li data-step="${i}">${label}</li>`).join("")}</ol><p data-status aria-live="polite">Connecting your camera…</p><div data-fail hidden><button data-demo class="k-primary">WATCH DEMO ↗</button><p>Camera access is needed to track your movement.</p></div></div><div class="k-camera-frame"><canvas width="640" height="480"></canvas><div class="k-framing-outline"></div><span>YOUR CAMERA · YOUR MOVEMENT</span></div></div>`;
  document.getElementById("app")!.appendChild(panel);
  const status = panel.querySelector("[data-status]")!;
  let alive = true,
    raf = 0,
    resolve!: (v: boolean | null) => void;
  const result = new Promise<boolean | null>((r) => (resolve = r));
  const done = (v: boolean | null) => {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(raf);
    panel.remove();
    resolve(v);
  };
  panel
    .querySelector("[data-back]")!
    .addEventListener("click", () => done(null));
  panel
    .querySelector("[data-demo]")!
    .addEventListener("click", () => done(false));
  let ok = false;
  try {
    ok = await init();
  } catch {}
  if (!alive) return result;
  if (!ok) {
    status.textContent = "We could not start the camera.";
    (panel.querySelector("[data-fail]") as HTMLElement).hidden = false;
    return result;
  }
  const tr = tracker(),
    motion = new MotionInput(tr, config.lowImpact),
    rig = motion.rig,
    cv = panel.querySelector("canvas")!,
    ctx = cv.getContext("2d")!;
  let step = 0,
    held = 0,
    last = performance.now(),
    seenL = false,
    seenR = false;
  let center: number | null = null;
  const advance = () => {
    step++;
    held = 0;
    if (step < labels.length) {
      announce(labels[step]);
      return;
    }
    saveBodyScale({ shoulderW: rig.shoulderW, torso: rig.torso });
    cancelAnimationFrame(raf);
    status.textContent = "READY. 3";
    announce("Ready. Three, two, one.");
    let count = 3;
    const timer = setInterval(() => {
      if (!alive) {
        clearInterval(timer);
        return;
      }
      count--;
      status.textContent = count ? `READY. ${count}` : "LET’S MOVE";
      if (!count) {
        clearInterval(timer);
        done(true);
      }
    }, 700);
  };
  const loop = () => {
    if (!alive) return;
    if (!panel.isConnected) {
      done(null);
      return;
    }
    raf = requestAnimationFrame(loop);
    const now = performance.now(),
      dt = Math.min(80, now - last);
    last = now;
    const state = motion.update(now),
      lms = tr.latestLandmarks;
    const cw = 640,
      ch = Math.round(640 / (tr.aspect ?? 4 / 3));
    if (cv.height !== ch) cv.height = ch;
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(cw, 0);
    ctx.scale(-1, 1);
    try {
      ctx.drawImage(tr.video, 0, 0, cw, ch);
    } catch {}
    ctx.restore();
    if (lms) {
      ctx.strokeStyle = "#d7ef70";
      ctx.lineWidth = 3;
      for (const [a, b] of [
        [11, 13],
        [13, 15],
        [12, 14],
        [14, 16],
        [11, 12],
        [11, 23],
        [12, 24],
        [23, 24],
        [23, 25],
        [25, 27],
        [24, 26],
        [26, 28],
      ]) {
        if ((lms[a]?.visibility ?? 0) < 0.5 || (lms[b]?.visibility ?? 0) < 0.5)
          continue;
        ctx.beginPath();
        ctx.moveTo((1 - lms[a].x) * cw, lms[a].y * ch);
        ctx.lineTo((1 - lms[b].x) * cw, lms[b].y * ch);
        ctx.stroke();
      }
    }
    const visible =
      state.tracked &&
      !!lms &&
      gameDef(id).required.every(
        (i) =>
          (lms[i]?.visibility ?? 0) > 0.5 &&
          lms[i].x > 0.025 &&
          lms[i].x < 0.975 &&
          lms[i].y > 0.01 &&
          lms[i].y < 0.98,
      );
    if (!visible) {
      status.textContent = `Step back so your ${id === "rush" ? "feet, hips and hands" : "hips and hands"} are in frame.`;
      held = 0;
      return;
    }
    if (!state.fresh) return;
    const hip = rig.hips()!,
      l = rig.hand("L")!,
      r = rig.hand("R")!,
      sl = rig.joint("shL")!,
      sr = rig.joint("shR")!;
    center ??= hip.x;
    const raisedL = l.y < sl.y - rig.torso * 0.28,
      raisedR = r.y < sr.y - rig.torso * 0.28,
      spread =
        Math.abs(l.x - r.x) * (tr.aspect ?? 4 / 3) > rig.shoulderW * 1.65;
    const displacement =
      ((hip.x - center) * (tr.aspect ?? 4 / 3)) / Math.max(0.06, rig.shoulderW);
    seenL ||= displacement < -0.28;
    seenR ||= displacement > 0.28;
    const guard =
      l.y < hip.y - rig.torso * 0.25 &&
      r.y < hip.y - rig.torso * 0.25 &&
      l.rel < 1 &&
      r.rel < 1;
    const punch = (h: typeof l) =>
      h.zVel !== null ? h.zVel > 0.25 : h.rel > 1.6;
    let valid =
        step === 0 ? true : step === 1 ? raisedL : step === 2 ? raisedR : false,
      instant = false;
    if (step >= 3) {
      const index = step - 3;
      if (id === "rush") {
        valid =
          index === 0 ? seenL && seenR : index === 1 ? state.rise : state.duck;
        instant = index === 1;
      } else if (id === "box") {
        valid = index === 0 || index === 2 ? guard : punch(index === 1 ? l : r);
        instant = index === 1 || index === 3;
      } else if (id === "bowl") {
        valid =
          index === 0
            ? l.y > hip.y || r.y > hip.y
            : [l, r].some((h) => h.vy < -0.06 && h.rel > 1.2);
        instant = index === 1;
      } else if (id === "blade") {
        valid =
          index === 0
            ? spread
            : index === 1
              ? [l, r].some(
                  (h) => Math.abs(h.vx) > Math.abs(h.vy) && h.rel > 1.2,
                )
              : [l, r].some((h) => h.vy > Math.abs(h.vx) * 0.5 && h.rel > 1.2);
        instant = index > 0;
      } else valid = spread;
    }
    status.textContent = labels[step] + ".";
    panel.querySelectorAll("[data-step]").forEach((el, i) => {
      el.classList.toggle("done", i < step);
      el.classList.toggle("active", i === step);
    });
    held = valid ? held + Math.max(dt, 25) : 0;
    if (valid && (instant || held > 500)) advance();
  };
  loop();
  return result;
}
