import { gameDef, type GameId } from "./core/catalog";
import { settings, announce } from "./core/settings";
import { MotionInput } from "./core/input";
import type { TrackerLike } from "../games/shared";
import { saveBodyScale } from "../pose/rig";
import { poseEngine } from "../pose/engine";
import { bodyInFrame, starPose } from "./core/setup-pose";

const TIPS: Record<GameId, string> = {
  dance: "MIRROR NOVA",
  blade: "SLICE WITH THE ARROWS",
  box: "PUNCH · BLOCK · SLIP",
  rush: "STEP · JUMP · DUCK",
  fruit: "SLICE FRUIT · SKIP BOMBS",
  tennis: "SWING THROUGH THE BALL",
  bowl: "SWING BACK · SWING THROUGH",
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
  const panel = document.createElement("div");
  const title = gameDef(id).title;
  panel.className = "overlay pt-setup";
  panel.innerHTML = `<div class="pt-setup-bg" aria-hidden="true"><img src="/kinetic/pt/card-${id}.webp" alt=""></div><button data-back class="pt-back" aria-label="Back to ${title}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="pt-setup-layout"><div class="pt-setup-copy"><h1 class="pt-title">RAISE<br>BOTH HANDS</h1><p class="pt-setup-tip">${TIPS[id]}</p><ol class="pt-steps"><li data-step="0"><b>1</b><span>STEP IN</span></li><li data-step="1"><b>2</b><span>HANDS UP</span></li></ol><p data-status class="pt-setup-status" aria-live="polite">…</p><div class="pt-progress" data-progress><i></i></div><div class="pt-setup-actions"><button data-anyway class="pt-btn" hidden><span>START ANYWAY</span></button></div><div data-fail class="pt-setup-fail" hidden><button data-demo class="pt-btn pt-btn-gold"><span>WATCH DEMO</span></button><p>Camera access is needed to track your movement.</p></div></div><div class="pt-camera"><canvas width="640" height="480"></canvas><div class="pt-camera-guide" aria-hidden="true"></div></div></div>`;
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
      status.textContent = `${Math.round(s.progress * 100)}%`;
      progress.style.setProperty("--p", String(s.progress));
    } else if (s.stage === "compile") {
      status.textContent = "…";
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
  status.textContent = "STEP IN";
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
      ctx.strokeStyle = "#3fe0ff";
      ctx.shadowColor = "#3fe0ff";
      ctx.shadowBlur = 12;
      ctx.lineCap = "round";
      ctx.lineWidth = 5;
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
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ff3fb4";
      for (const i of [15, 16]) {
        if ((lms[i]?.visibility ?? 0) < 0.5) continue;
        ctx.beginPath();
        ctx.arc((1 - lms[i].x) * cw, lms[i].y * ch, 9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (!state.tracked || !lms) {
      status.textContent = "STEP IN";
      held = 0;
      return;
    }
    const visible = bodyInFrame(lms, gameDef(id).required);
    if (!visible) {
      status.textContent = "STEP BACK";
      held = 0;
      return;
    }
    if (!state.fresh) return;
    if (step === 0) {
      held += Math.max(dt, 25);
      status.textContent = "STEP IN";
      if (held > 300) {
        setStep(1);
        announce("Raise both hands.");
      }
      return;
    }
    const pose = starPose(lms);
    status.textContent = pose ? "HOLD IT" : "HANDS UP";
    panel.classList.toggle("is-posing", pose);
    held = pose ? held + Math.max(dt, 25) : 0;
    if (held > 350) begin();
  };
  loop();
  return result;
}
