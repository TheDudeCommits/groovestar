import { Stage, COLORS } from "./stage";
import { Character } from "./character";
import { HandRig } from "../../pose/rig";
import { characterId } from "../core/settings";
import type { Pose } from "../../moves";
import type { TrackerLike } from "../../games/shared";
import type { StyleProfile } from "../../appearance";

/** Presentation adapter. Dance's clock, choreography and scorer stay authoritative. */
export class DancePresentation {
  readonly host = document.createElement("div");
  readonly stage: Stage;
  private player = new Character();
  private coach = new Character();
  private rig = new HandRig();
  private alive = true;
  private last = performance.now();
  ready = false;
  constructor(parent: HTMLElement, style: StyleProfile | null) {
    this.host.className = "kinetic-dance-layer";
    parent.appendChild(this.host);
    this.stage = new Stage(this.host, { alpha: true });
    this.stage.camera.position.set(0, 1.16, 6);
    this.stage.camera.lookAt(0, 1.16, 0);
    this.stage.camera.userData.referenceFov = 31.64;
    this.stage.camera.fov = 31.64;
    this.stage.camera.updateProjectionMatrix();
    this.stage.scene.add(this.player.group, this.coach.group);
    this.coach.group.scale.setScalar(0.375);
    void Promise.all([
      this.player.load(characterId()),
      this.coach.load("luna"),
    ]).then(() => {
      if (!this.alive) return;
      if (style && localStorage.getItem("gs-char") === "auto")
        this.player.applyLook(style);
      this.ready = true;
    });
  }
  update(tracker: TrackerLike, pose: Pose, camera: boolean) {
    if (!this.ready) return;
    const now = performance.now(),
      dt = Math.min(0.06, (now - this.last) / 1000);
    this.last = now;
    this.rig.update(
      tracker.latestLandmarks,
      tracker.latestWorld ?? null,
      now,
      tracker.aspect ?? 4 / 3,
    );
    this.player.group.visible = !camera || this.rig.hasPose;
    if (camera) this.player.tracked(this.rig);
    else this.player.choreo(pose);
    this.coach.group.visible = camera;
    this.coach.group.position.copy(this.stage.unproject(0.865, 0.65, 0));
    this.coach.groundY = this.coach.group.position.y;
    this.coach.choreo(pose);
    this.stage.render();
  }
  dispose() {
    this.alive = false;
    this.player.dispose();
    this.coach.dispose();
    this.stage.dispose();
    this.host.remove();
  }
}

export function broadcastFloor(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  beat: number,
) {
  ctx.fillStyle = "#eeeae1";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#365ff5";
  ctx.fillRect(w * 0.17, 0, w * 0.66, h * 0.52);
  ctx.fillStyle = "#171917";
  ctx.font = `800 ${h * 0.16}px "Barlow Condensed"`;
  ctx.textAlign = "left";
  ctx.fillText("01", w * 0.035, h * 0.44);
  ctx.fillStyle = "#eeeae1";
  ctx.font = `700 ${h * 0.08}px "Barlow Condensed"`;
  ctx.textAlign = "center";
  ctx.fillText("MAKE YOUR MOVE", w * 0.5, h * 0.12);
  ctx.fillStyle = "#dbd8ce";
  ctx.fillRect(0, h * 0.52, w, h * 0.48);
  ctx.strokeStyle = "#171917";
  ctx.lineWidth = Math.max(1, h * 0.002);
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.84, w * 0.245, h * 0.075, 0, 0, Math.PI * 2);
  ctx.stroke();
  for (const x of [0.12, 0.15, 0.85, 0.88]) {
    ctx.beginPath();
    ctx.moveTo(w * (0.5 + (x - 0.5) * 0.4), h * 0.52);
    ctx.lineTo(w * x, h);
    ctx.stroke();
  }
  ctx.fillStyle = "#f35d42";
  ctx.fillRect(w * 0.03, h * 0.52, w * 0.94, Math.max(2, h * 0.004));
}
