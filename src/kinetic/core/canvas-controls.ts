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
    this.root.innerHTML = '<button aria-label="Pause game">Ⅱ</button>';
    document.getElementById("app")!.appendChild(this.root);
    this.dialog.className = "k-dialog k-canvas-pause";
    this.dialog.setAttribute("aria-label", "Pause session");
    this.dialog.innerHTML =
      '<span class="k-eyebrow">TAKE A BREATH</span><h2>In your own time.</h2><button class="k-primary" data-resume>Resume ↗</button><button data-restart>Restart session</button><button data-quit>Back to game</button>';
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
