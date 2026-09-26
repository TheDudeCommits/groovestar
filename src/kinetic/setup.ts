import { gameDef, type GameId } from "./core/catalog";
import { settings, announce } from "./core/settings";
import { MotionInput } from "./core/input";
import type { TrackerLike } from "../games/shared";
import { saveBodyScale } from "../pose/rig";
import { poseEngine } from "../pose/engine";
import { bodyInFrame, starPose } from "./core/setup-pose";

const TIPS: Record<GameId, string> = {
  dance: "Mirror the dancer on stage. Big, confident moves score best.",
  blade: "Swing through each block in the direction of its arrow. Left hand blue, right hand coral.",
  box: "Keep your guard up. Punch toward the camera when a pad lights, then return to guard.",
  rush: "Step left and right to change lanes, rise to clear hurdles and duck under bars.",
  fruit: "Slice the fruit with fast hand sweeps. Leave the bombs alone.",
  tennis: "Swing a hand through the ball as it reaches you.",
  bowl: "Lower your bowling hand, then swing forward and up to release.",
};

/**
 * Camera framing and one calibration pose: step into the frame, raise both
 * hands. MotionInput recalibrates lanes, rise and duck on the first tracked
 * frame of every round, so nothing else needs practice here. Only the
 * player's explicit "Start anyway" skips the pose; no timeout starts a round.
 */
export async function prepareSession(
  id: GameId,
  demo: boolean,
  init: () => Promise<boolean>,
  tracker: () => TrackerLike & { video: HTMLVideoElement },
): Promise<boolean | null> {
  if (demo) return false;
  const config = settings();
  const tip =
    id === "rush" && config.lowImpact
      ? "Step left and right to change lanes, raise a knee or reach up to clear hurdles, dip slightly under bars."
      : TIPS[id];
  const panel = document.createElement("div");
  panel.className = "overlay k-setup";
  panel.innerHTML = `<button data-back>← BACK TO ${gameDef(id).title.toUpperCase()}</button><div class="k-setup-layout"><div><span class="k-eyebrow">MAKE ROOM FOR YOURSELF</span><h1>Strike your<br><em>star pose.</em></h1><p>Place your camera at about chest height. Step back until your ${id === "rush" ? "whole body fits" : "hips and hands fit"} the frame, then raise both hands above your head.</p><ol><li data-step="0">Step into the frame</li><li data-step="1">Raise both hands</li></ol><p class="k-setup-tip"><b>HOW TO PLAY</b>${tip}</p><p data-status aria-live="polite">Loading motion tracking…</p><div class="k-setup-progress" data-progress><i></i></div><div class="k-setup-actions"><button data-anyway class="k-secondary" hidden>START ANYWAY ↗</button></div><div data-fail hidden><button data-demo class="k-primary">WATCH DEMO ↗</button><p>Camera access is needed to track your movement.</p></div></div><div class="k-camera-frame"><canvas width="640" height="480"></canvas><div class="k-framing-outline"></div><span>YOUR CAMERA · YOUR MOVEMENT</span></div></div>`;
  document.getElementById("app")!.appendChild(panel);
  const status = panel.querySelector("[data-status]")!;
  const progress = panel.querySelector<HTMLElement>("[data-progress]")!;
  const anyway = panel.querySelector<HTMLButtonElement>("[data-anyway]")!;
  let alive = true,
    raf = 0,
    counting = false,
    resolve!: (v: boolean | null) => void;
  const result = new Promise<boolean | null>((r) => (resolve = r));
  const unsubscribe = poseEngine.subscribe((s) => {
    if (!alive || counting) return;
    if (s.stage === "download") {
      status.textContent = `Loading motion tracking · ${Math.round(s.progress * 100)}%`;
      progress.style.setProperty("--p", String(s.progress));
    } else if (s.stage === "compile") {
      status.textContent = "Preparing motion tracking…";
      progress.style.setProperty("--p", "1");
    }
  });
  const done = (v: boolean | null) => {
    if (!alive) return;
    alive = false;
    unsubscribe();
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
  progress.hidden = true;
  if (!ok) {
    status.textContent = "We could not start the camera.";
    (panel.querySelector("[data-fail]") as HTMLElement).hidden = false;
    return result;
  }
  status.textContent = "Step into the frame.";
  announce("Step into the frame, then raise both hands.");
  const tr = tracker(),
    motion = new MotionInput(tr, config.lowImpact),
    rig = motion.rig,
    cv = panel.querySelector("canvas")!,
    ctx = cv.getContext("2d")!;
  const cameraReady = performance.now();
  let step = 0,
    held = 0,
    last = performance.now();
  const setStep = (n: number) => {
    step = n;
    held = 0;
    panel.querySelectorAll("[data-step]").forEach((el, i) => {
      el.classList.toggle("done", i < step);
      el.classList.toggle("active", i === step);
    });
  };
  setStep(0);
  const begin = () => {
    if (counting || !alive) return;
    counting = true;
    anyway.hidden = true;
    if (rig.shoulderW > 0 && rig.torso > 0)
      saveBodyScale({ shoulderW: rig.shoulderW, torso: rig.torso });
    cancelAnimationFrame(raf);
    setStep(2);
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
  anyway.addEventListener("click", begin);
  const loop = () => {
    if (!alive || counting) return;
    if (!panel.isConnected) {
      done(null);
      return;
    }
    raf = requestAnimationFrame(loop);
    const now = performance.now(),
      dt = Math.min(80, now - last);
    last = now;
    if (now - cameraReady > 5000) anyway.hidden = false;
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
    if (!state.tracked || !lms) {
      status.textContent = "Step into the frame.";
      held = 0;
      return;
    }
    const visible = bodyInFrame(lms, gameDef(id).required);
    if (!visible) {
      status.textContent = `Step back so your ${id === "rush" ? "feet, hips and hands" : "hips and hands"} are in frame.`;
      held = 0;
      return;
    }
    if (!state.fresh) return;
    if (step === 0) {
      held += Math.max(dt, 25);
      status.textContent = "Step into the frame.";
      if (held > 300) {
        setStep(1);
        announce("Raise both hands.");
      }
      return;
    }
    const pose = starPose(lms);
    status.textContent = pose ? "Hold it…" : "Raise both hands above your head.";
    held = pose ? held + Math.max(dt, 25) : 0;
    if (held > 350) begin();
  };
  loop();
  return result;
}
