/** Shared DOM controls for the retained Fruit simulation. */
export class CanvasControls {
  readonly root = document.createElement("div");
  private dialog = document.createElement("dialog");
  private stopped = false;
  constructor(
    private onPause: (v: boolean) => void,
    onRestart: () => void,
    onQuit: () => void,
  ) {
    this.root.className = "k-canvas-controls";
    this.root.innerHTML = '<button aria-label="Pause game"><span></span><span></span></button>';
    document.getElementById("app")!.appendChild(this.root);
    this.dialog.className = "k-canvas-pause pt-pause-dialog";
    this.dialog.setAttribute("aria-label", "Pause session");
    this.dialog.innerHTML =
      '<div class="pt-pause-card"><span class="pt-eyebrow">PAUSED</span><h2>Catch your breath.</h2><p>Step back into your play area when you are ready.</p><button class="pt-btn pt-btn-gold" data-resume>Resume</button><button class="pt-btn" data-restart>Restart session</button><button class="pt-btn pt-btn-ghost" data-quit>Back to game</button></div>';
    document.body.appendChild(this.dialog);
    this.root
      .querySelector("button")!
      .addEventListener("click", () => this.pause());
    this.dialog
      .querySelector("[data-resume]")!
      .addEventListener("click", () => this.resume());
    this.dialog
      .querySelector("[data-restart]")!
      .addEventListener("click", onRestart);
    this.dialog.querySelector("[data-quit]")!.addEventListener("click", onQuit);
    this.dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.resume();
    });
    window.addEventListener("keydown", this.key);
    document.addEventListener("visibilitychange", this.visibility);
  }
  private key = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !this.dialog.open) {
      e.preventDefault();
      this.pause();
    }
  };
  private visibility = () => {
    if (document.hidden) this.pause();
  };
  pause() {
    if (this.stopped || this.dialog.open) return;
    this.onPause(true);
    this.dialog.showModal();
  }
  resume() {
    if (this.stopped) return;
    this.dialog.close();
    this.onPause(false);
  }
  dispose() {
    this.stopped = true;
    window.removeEventListener("keydown", this.key);
    document.removeEventListener("visibilitychange", this.visibility);
    this.root.remove();
    this.dialog.remove();
  }
}
