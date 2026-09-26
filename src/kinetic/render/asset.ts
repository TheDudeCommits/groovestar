import { livePreview } from "./preview";
/** Deterministic in-engine artwork capture; no separate pretend gameplay art. */
export async function renderAsset(kind: string, id: string) {
  await document.fonts.ready;
  document.getElementById("app")!.innerHTML = "";
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;";
  document.body.appendChild(host);
  const cleanup = livePreview(host, kind, id);
  window.addEventListener("pagehide", cleanup, { once: true });
}
