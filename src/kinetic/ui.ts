import { earnedMedals, equippedSaber, nextReward } from "./core/equipment";
import { CATALOG, gameDef, type GameId } from "./core/catalog";
import { CAST_INFO, settings, setSettings, characterId } from "./core/settings";
import { ledger, challengeUrl, type RunRecord, dailySeed, movementStreak } from "./core/records";
import { TRACKS } from "./core/music";
import { totalMedals, SABER_STYLES, saberStyle, setSaberStyle } from "../games/progress";
interface Actions {
  open: (id: GameId) => void;
  play: (id: GameId, demo: boolean, track?: number, endless?: boolean) => void;
  phone: () => void;
  race: () => void;
  youtube: () => void;
  dance: () => void;
  home: () => void;
}

/** Neon edge colors per game card, taken from each game's key art. */
const CARD_COLORS: Record<GameId, [string, string]> = {
  dance: ["#ff3fb4", "#ffd23e"],
  blade: ["#3fe0ff", "#4f7bff"],
  box: ["#ff6a4d", "#ff3fb4"],
  rush: ["#ff9a3a", "#3fe0ff"],
  fruit: ["#ffd23e", "#ff6a4d"],
  tennis: ["#3fe0ff", "#b6ff5a"],
  bowl: ["#8d5cff", "#ff3fb4"],
};
const art = (id: GameId) => `/kinetic/pt/card-${id}.webp`;

let cleanup: (() => void) | null = null;
let previewEpoch = 0;
export function stopKineticPreview() {
  previewEpoch++;
  cleanup?.();
  cleanup = null;
}
/** The live 3D lobby behind a menu, or a still of the stage on low settings. */
function scene(host: HTMLElement, shot: "home" | "result" | "cast") {
  stopKineticPreview();
  const epoch = previewEpoch;
  const still = () => {
    const img = document.createElement("img");
    img.className = "pt-scene-still";
    img.src = "/kinetic/pt/plate-home.webp";
    img.alt = "";
    host.appendChild(img);
  };
  if (settings().renderer === "classic" || settings().quality === "low") {
    still();
    return;
  }
  import("./render/pt/lobby").then((m) => {
    if (!host.isConnected || epoch !== previewEpoch) return;
    try {
      cleanup = m.lobbyScene(host, shot);
    } catch {
      still();
    }
  });
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Player progression derived from the run ledger. */
export function profile() {
  const l = ledger();
  const xp = Math.round(l.runs.reduce((a, r) => a + 60 + Math.min(420, r.score / 12), 0) + l.activeSeconds * 2);
  const level = Math.floor(xp / 1000) + 1;
  return { xp, level, into: xp % 1000, stars: earnedMedals(), streak: movementStreak() };
}
/** 0 to 5 stars from accuracy and combo. */
export function starsFor(r: RunRecord) {
  const acc = r.hits / Math.max(1, r.hits + r.misses);
  return Math.max(0, Math.min(5, Math.floor(acc * 5 + Math.min(0.99, r.combo / 40))));
}
const RANKS = ["KEEP GROOVING", "WARMED UP", "NICE MOVES", "ON FIRE", "HEADLINER", "SUPERSTAR"];

function topBar(extra = "") {
  const p = profile();
  return `<header class="pt-top">${extra}<button class="pt-logo" data-home aria-label="GrooveStar home"><img src="/kinetic/pt/logo.webp" alt="GrooveStar"></button><nav class="pt-top-right" aria-label="Player"><button class="pt-level" data-progress aria-label="Your progress, level ${p.level}"><span class="pt-level-star">★</span><span class="pt-level-text"><b>LV ${p.level}</b><i style="--p:${(p.into / 1000).toFixed(3)}"></i></span></button><span class="pt-chip" title="Medals earned"><span class="pt-chip-star">★</span>${p.stars}</span><span class="pt-chip" title="Days in a row"><span class="pt-flame"></span>${p.streak} DAY STREAK</span><button class="pt-chip pt-chip-btn" data-cast>THE CREW</button><button class="pt-icon-btn" data-settings aria-label="Movement and display settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.4 4.9-.1-2.8 2-1.6-2-3.4-2.4.9-2.3-1.4L15 2.5h-4l-.6 2.6-2.3 1.4-2.4-.9-2 3.4 2 1.6-.1 2.8-2 1.6 2 3.4 2.4-.9 2.3 1.4.6 2.6h4l.6-2.6 2.3-1.4 2.4.9 2-3.4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button></nav></header>`;
}
function wireTop(menu: HTMLElement, a: Actions) {
  menu.querySelector("[data-home]")?.addEventListener("click", a.home);
  menu.querySelector("[data-settings]")?.addEventListener("click", () => openSettings());
  menu.querySelector("[data-cast]")?.addEventListener("click", () => openCast(a.home));
  menu.querySelector("[data-progress]")?.addEventListener("click", () => openProgress(a));
}
function shell(menu: HTMLElement, cls: string) {
  menu.classList.add("pt-shell", cls);
}

export function renderHome(menu: HTMLElement, a: Actions) {
  shell(menu, "pt-home");
  const name = esc(localStorage.getItem("gs-name") ?? "DANCER");
  menu.innerHTML = `<div class="pt-scene" id="k-preview" aria-hidden="true"></div><div class="pt-home-shade" aria-hidden="true"></div>${topBar()}<main class="pt-home-main"><section class="pt-carousel" id="k-games" aria-label="Choose a game"><div class="pt-cards" role="list">${CATALOG.map(
    (g, i) =>
      `<button class="pt-card" role="listitem" data-game="${g.id}" data-index="${i}" style="--c1:${CARD_COLORS[g.id][0]};--c2:${CARD_COLORS[g.id][1]}" aria-label="${g.title}. ${g.tag.toLowerCase()}. ${g.duration}"><span class="pt-card-art"><img src="${art(g.id)}" alt="" loading="${i < 4 ? "eager" : "lazy"}"></span><span class="pt-card-title">${g.title.toUpperCase().replace(" ", "<br>")}</span><span class="pt-card-meta">${g.duration} · ${g.movement}</span><span class="pt-card-play">PLAY</span></button>`,
  ).join("")}</div></section><section class="pt-home-copy"><h1 class="pt-tagline"><span>PLAY.</span> <span>MOVE.</span> <span>BE YOU.</span></h1><p>Seven games. Your body is the controller.</p><div class="pt-home-actions"><button class="pt-btn pt-btn-hot" data-session><span>4-MINUTE CIRCUIT</span></button><label class="pt-name"><span>PLAYER</span><input aria-label="Player name" maxlength="14" value="${name}"></label><button class="pt-btn pt-btn-ghost" data-phone><span>USE YOUR PHONE AS A CAMERA</span></button></div></section></main><footer class="pt-hints" aria-hidden="true"><span><i>◀ ▶</i> CHOOSE</span><span><i>ENTER</i> SELECT</span><span><i>ESC</i> MENU</span></footer>`;
  wireTop(menu, a);
  menu.querySelector("input")!.addEventListener("input", (e) =>
    localStorage.setItem("gs-name", (e.target as HTMLInputElement).value.slice(0, 14)),
  );
  menu.querySelector("[data-phone]")!.addEventListener("click", a.phone);
  menu.querySelector("[data-session]")!.addEventListener("click", () => {
    sessionStorage.setItem("gs-circuit", "blade,box,rush");
    a.open("blade");
  });
  const cards = [...menu.querySelectorAll<HTMLElement>(".pt-card")];
  let focus = Math.max(0, Number(sessionStorage.getItem("gs-home-focus") ?? 0)) % cards.length;
  const setFocus = (i: number, scroll = false) => {
    focus = (i + cards.length) % cards.length;
    sessionStorage.setItem("gs-home-focus", String(focus));
    cards.forEach((c, j) => c.classList.toggle("is-focus", j === focus));
    if (scroll) cards[focus].scrollIntoView({ block: "nearest", inline: "center", behavior: settings().reducedMotion ? "instant" : "smooth" });
  };
  setFocus(focus);
  cards.forEach((c, i) => {
    c.addEventListener("click", () => a.open(c.dataset.game as GameId));
    c.addEventListener("pointerenter", () => setFocus(i));
    c.addEventListener("focus", () => setFocus(i));
  });
  const key = (e: KeyboardEvent) => {
    if (!menu.isConnected) {
      window.removeEventListener("keydown", key);
      return;
    }
    if (document.querySelector("dialog[open]") || (e.target as HTMLElement)?.tagName === "INPUT") return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setFocus(focus + (e.key === "ArrowRight" ? 1 : -1), true);
      cards[focus].focus({ preventScroll: true });
    }
  };
  window.addEventListener("keydown", key);
  scene(menu.querySelector("#k-preview")!, "home");
}

export function renderGameHome(menu: HTMLElement, id: GameId, a: Actions) {
  shell(menu, "pt-detail-screen");
  const g = gameDef(id),
    s = settings();
  const best = Number(localStorage.getItem(`gs-${id}-best`) ?? 0),
    runs = ledger().runs.filter((r) => r.id === id);
  const [c1, c2] = CARD_COLORS[id];
  const medals = id === "blade" ? earnedMedals() : totalMedals();
  const equipped = (id === "blade" ? equippedSaber() : saberStyle()).id;
  const extras = [
    id === "blade" ? '<button class="pt-mode" data-youtube><b>ANY SONG</b><small>Play along to a YouTube song</small></button>' : "",
    id === "fruit" ? '<button class="pt-mode" data-race><b>RACE A FRIEND</b><small>Same fruit, live, head to head</small></button>' : "",
    id === "rush" ? '<button class="pt-mode" data-endless><b>ENDLESS RUN</b><small>Keep going until three knocks</small></button>' : "",
    id === "bowl" ? '<button class="pt-mode" data-two><b>2 PLAYERS</b><small>Pass and play, one camera</small></button>' : "",
    `<button class="pt-mode" data-daily><b>TODAY’S CHALLENGE</b><small>One seed, everyone, today</small></button>`,
  ].join("");
  menu.innerHTML = `<div class="pt-detail" style="--c1:${c1};--c2:${c2}"><div class="pt-detail-art" aria-hidden="true"><img src="${art(id)}" alt=""></div><div class="pt-detail-shade" aria-hidden="true"></div>${topBar('<button class="pt-back" data-back>← ALL GAMES</button>')}<main class="pt-detail-main"><section class="pt-detail-info"><span class="pt-eyebrow">${g.number} / 07 · ${g.tag}</span><h1 class="pt-title">${g.title.toUpperCase()}</h1><h2>${g.verb}</h2><p>${g.description}</p><div class="pt-specs"><span><small>SESSION</small>${g.duration}</span><span><small>MOVEMENT</small>${g.movement}</span><span><small>PLAYERS</small>${g.players}</span></div><div class="pt-pace" role="group" aria-label="Your pace"><span class="pt-eyebrow">YOUR PACE</span><div>${(["flow", "athlete", "expert"] as const)
    .map(
      (x) =>
        `<button data-level="${x}" aria-pressed="${s.difficulty === x}" class="${s.difficulty === x ? "selected" : ""}"><b>${x === "flow" ? "FLOW" : x === "athlete" ? "ATHLETE" : "EXPERT"}</b><small>${x === "flow" ? "Find your flow" : x === "athlete" ? "Break a sweat" : "Push the pace"}</small></button>`,
    )
    .join("")}</div></div><label class="pt-toggle"><input type="checkbox" data-impact ${s.lowImpact ? "checked" : ""}><span></span>LOW IMPACT · SAME GOOD ENERGY</label>${
    id === "blade"
      ? `<label class="pt-select"><span class="pt-eyebrow">SOUNDTRACK</span><select data-track>${TRACKS.map((t, i) => `<option value="${i}" ${Number(sessionStorage.getItem("gs-next-track") ?? 0) === i ? "selected" : ""}>${t.title} · ${t.bpm} BPM</option>`).join("")}</select></label>`
      : ""
  }<div class="pt-play-row"><button class="pt-btn pt-btn-gold pt-play" data-play><span>PLAY</span></button><button class="pt-btn" data-demo><span>WATCH DEMO</span></button></div></section><aside class="pt-detail-side"><div class="pt-records"><span class="pt-eyebrow">YOUR RECORD</span><div><strong>${best.toLocaleString()}<small>BEST SCORE</small></strong><strong>${runs.length}<small>SESSIONS</small></strong><strong>${Math.max(0, ...runs.map((r) => r.combo))}<small>BEST COMBO</small></strong></div></div><div class="pt-modes"><span class="pt-eyebrow">MORE WAYS TO PLAY</span>${extras}</div>${
    id === "fruit" || id === "blade"
      ? `<div class="pt-gear"><span class="pt-eyebrow">YOUR BLADE STYLE</span><div>${SABER_STYLES.map((st) => `<button data-saber="${st.id}" class="${st.id === equipped ? "selected" : ""}" ${medals < st.need ? "disabled" : ""}><b>${st.name}</b><small>${medals < st.need ? st.need + " medals to unlock" : st.id === equipped ? "EQUIPPED" : "READY"}</small></button>`).join("")}</div></div>`
      : ""
  }</aside></main></div>`;
  wireTop(menu, a);
  menu.querySelector("[data-back]")!.addEventListener("click", a.home);
  menu.querySelectorAll<HTMLElement>("[data-level]").forEach((b) =>
    b.addEventListener("click", () => {
      setSettings({ difficulty: b.dataset.level as typeof s.difficulty });
      menu.querySelectorAll("[data-level]").forEach((x) => {
        x.classList.toggle("selected", x === b);
        x.setAttribute("aria-pressed", String(x === b));
      });
    }),
  );
  menu.querySelector("[data-impact]")!.addEventListener("change", (e) => setSettings({ lowImpact: (e.target as HTMLInputElement).checked }));
  const track = () => Number((menu.querySelector("[data-track]") as HTMLSelectElement | null)?.value ?? 0);
  menu.querySelector("[data-play]")!.addEventListener("click", () => {
    if (id === "bowl") sessionStorage.setItem("gs-bowl-players", "1");
    a.play(id, false, track(), sessionStorage.getItem("gs-next-endless") === "1");
  });
  menu.querySelector("[data-demo]")!.addEventListener("click", () => a.play(id, true, track()));
  menu.querySelector("[data-youtube]")?.addEventListener("click", a.youtube);
  menu.querySelector("[data-race]")?.addEventListener("click", a.race);
  menu.querySelector("[data-two]")?.addEventListener("click", () => {
    sessionStorage.setItem("gs-bowl-players", "2");
    a.play(id, false);
  });
  menu.querySelector("[data-endless]")?.addEventListener("click", () => a.play(id, false, track(), true));
  menu.querySelector("[data-daily]")!.addEventListener("click", () => {
    sessionStorage.setItem("gs-next-seed", dailySeed(id));
    a.play(id, false, track(), sessionStorage.getItem("gs-next-endless") === "1");
  });
  menu.querySelectorAll<HTMLElement>("[data-saber]").forEach((b) =>
    b.addEventListener("click", () => {
      setSaberStyle(b.dataset.saber!);
      a.open(id);
    }),
  );
  (menu.querySelector("[data-play]") as HTMLElement).focus({ preventScroll: true });
  stopKineticPreview();
}

function dialog(title: string) {
  const shell = document.createElement("dialog");
  shell.className = "pt-dialog";
  shell.setAttribute("aria-label", title);
  document.body.appendChild(shell);
  shell.addEventListener("close", () => shell.remove());
  return shell;
}
export function openSettings() {
  const s = settings(),
    d = dialog("Movement and display settings");
  d.innerHTML = `<button data-close class="pt-dialog-close" aria-label="Close settings">×</button><span class="pt-eyebrow">SETTINGS</span><h2>Your pace. Your space.</h2><div class="pt-settings"><label>Intensity<select data-key="difficulty"><option value="flow">Flow</option><option value="athlete">Athlete</option><option value="expert">Expert</option></select></label><label>Graphics<select data-key="quality"><option value="auto">Automatic</option><option value="high">High</option><option value="low">Low</option></select></label><label>Rendering<select data-key="renderer"><option value="3d">Primetime 3D</option><option value="classic">Classic Canvas</option></select></label><label>Music volume<input data-key="volume" type="range" min="0" max="1" step=".05"></label><label class="pt-toggle"><input data-key="lowImpact" type="checkbox"><span></span>Low impact movement</label><label class="pt-toggle"><input data-key="reducedMotion" type="checkbox"><span></span>Reduce camera motion and effects</label><label class="pt-toggle"><input data-key="voice" type="checkbox"><span></span>Spoken coach cues</label><label class="pt-toggle"><input data-key="shareVideo" type="checkbox"><span></span>Share my camera in friend sessions</label></div><p class="pt-dialog-note">Changes apply to your next session.</p>`;
  for (const el of d.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-key]")) {
    const k = el.dataset.key as keyof typeof s;
    if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = !!s[k];
    else el.value = String(s[k]);
    el.addEventListener("change", () =>
      setSettings({
        [k]: el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : k === "volume" ? Number(el.value) : el.value,
      }),
    );
  }
  d.querySelector("[data-close]")!.addEventListener("click", () => d.close());
  d.showModal();
}
export function openCast(onDone: () => void) {
  const d = dialog("Choose your character");
  d.classList.add("pt-cast-dialog");
  const current = characterId();
  d.innerHTML = `<button data-close class="pt-dialog-close" aria-label="Close character selection">×</button><div class="pt-cast"><div class="pt-cast-stage" id="k-cast-stage"></div><div class="pt-cast-info"><span class="pt-eyebrow">THE CREW</span><h2>Meet <em>Nova.</em></h2><p>Dancer. Creative. Fearless. Nova headlines every venue while the rest of the crew gets ready for the stage.</p><div class="pt-cast-grid">${CAST_INFO.map(
    (c) =>
      c.id === "nova"
        ? `<button data-cast-id="nova" class="selected" aria-pressed="true"><img src="/kinetic/pt/nova-avatar.webp" alt="Nova, the GrooveStar dancer"><b>${c.name}</b><span>${c.role}</span></button>`
        : `<button data-cast-id="${c.id}" class="locked" disabled aria-label="${c.name}, arriving soon" style="--c:${c.color}"><span class="pt-silhouette" aria-hidden="true"></span><b>${c.name}</b><span>ARRIVING SOON</span></button>`,
  ).join("")}</div></div></div>`;
  d.querySelector('[data-cast-id="nova"]')!.addEventListener("click", () => {
    localStorage.setItem("gs-char", "nova");
    d.close();
    if (current !== "nova") onDone();
  });
  d.querySelector("[data-close]")!.addEventListener("click", () => d.close());
  d.addEventListener("close", () => castCleanup?.());
  let castCleanup: (() => void) | null = null;
  d.showModal();
  if (settings().quality !== "low")
    import("./render/pt/lobby").then((m) => {
      const host = d.querySelector<HTMLElement>("#k-cast-stage");
      if (host?.isConnected) castCleanup = m.lobbyScene(host, "cast");
    });
}
function openProgress(a: Actions) {
  const l = ledger(),
    p = profile(),
    d = dialog("Your movement progress");
  void a;
  d.innerHTML = `<button data-close class="pt-dialog-close" aria-label="Close progress">×</button><span class="pt-eyebrow">YOUR PROGRESS</span><h2>Level ${p.level}</h2><div class="pt-xp"><span>XP</span><div><i style="--p:${(p.into / 1000).toFixed(3)}"></i></div><b>${p.into} / 1000</b></div><div class="pt-progress-numbers"><strong>${Math.floor(l.activeSeconds / 60)}<small>ACTIVE MINUTES</small></strong><strong>${l.runs.length}<small>SESSIONS</small></strong><strong>${p.stars}<small>MEDALS</small></strong><strong>${p.streak}<small>DAY STREAK</small></strong></div><div class="pt-history">${
    l.runs
      .slice(-8)
      .reverse()
      .map((r) => `<div><img src="${art(r.id)}" alt=""><span>${gameDef(r.id).title}<small>${r.date.slice(0, 10)} · ${r.difficulty}</small></span><b>${r.score.toLocaleString()}</b></div>`)
      .join("") || "<p>Your first session starts a good habit.</p>"
  }</div>`;
  d.querySelector("[data-close]")!.addEventListener("click", () => d.close());
  d.showModal();
}
export function renderResult(menu: HTMLElement, r: RunRecord, a: Actions) {
  shell(menu, "pt-result-screen");
  const accuracy = Math.round((r.hits / Math.max(1, r.hits + r.misses)) * 100);
  const stars = starsFor(r);
  const p = profile();
  const gained = Math.round(60 + Math.min(420, r.score / 12) + (r.activeSeconds ?? r.seconds) * 2);
  const title = RANKS[stars];
  menu.innerHTML = `<div class="pt-scene" id="k-preview" aria-hidden="true"></div><div class="pt-result-shade" aria-hidden="true"></div>${topBar()}<main class="pt-result-main"><span class="pt-eyebrow">${gameDef(r.id).title.toUpperCase()} · ${r.camera ? "SESSION COMPLETE" : "DEMO COMPLETE · RECORDS DISABLED"}</span><h1 class="pt-result-title" data-text="${title}">${title}</h1><div class="pt-stars" aria-label="${stars} of 5 stars">${[0, 1, 2, 3, 4].map((i) => `<span class="${i < stars ? "on" : ""}" style="--i:${i}">★</span>`).join("")}</div><div class="pt-score-panel"><small>SCORE</small><strong data-count="${r.score}">${r.score.toLocaleString()}</strong></div><div class="pt-stat-tiles"><span><small>ACCURACY</small><b>${accuracy}%</b></span><span><small>BEST COMBO</small><b>${r.combo}</b></span><span><small>ACTIVE SEC</small><b>${Math.round(r.activeSeconds ?? r.seconds)}</b></span>${(r.details ?? []).map((d) => `<span><small>${esc(d.label)}</small><b>${esc(d.value)}</b></span>`).join("")}</div>${
    r.camera ? `<div class="pt-xp"><span>XP</span><div><i style="--p:${(p.into / 1000).toFixed(3)}"></i></div><b>+${gained} · LEVEL ${p.level}</b></div>` : ""
  }<div class="pt-result-buttons"><button class="pt-btn pt-btn-gold" data-replay><span>PLAY AGAIN</span></button>${sessionStorage.getItem("gs-circuit") ? '<button data-next class="pt-btn pt-btn-hot"><span>NEXT IN CIRCUIT</span></button>' : ""}<button class="pt-btn" data-back><span>BACK TO ${gameDef(r.id).title.toUpperCase()}</span></button>${r.camera && r.id !== "dance" ? '<button class="pt-btn pt-btn-ghost" data-share><span>CHALLENGE A FRIEND</span></button>' : ""}</div><p data-share-status class="pt-share-status" aria-live="polite">${accuracy >= 80 && r.camera ? "PRECISION MEDAL EARNED." : ""}</p><p class="pt-next-reward">${nextReward()}</p></main>`;
  wireTop(menu, a);
  const count = menu.querySelector<HTMLElement>("[data-count]")!;
  if (!settings().reducedMotion) {
    const t0 = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / 1400);
      count.textContent = Math.round(r.score * (1 - Math.pow(1 - k, 3))).toLocaleString();
      if (k < 1 && count.isConnected) requestAnimationFrame(tick);
    };
    tick();
  }
  scene(menu.querySelector("#k-preview")!, "result");
  menu.querySelector("[data-replay]")!.addEventListener("click", () => {
    sessionStorage.setItem("gs-next-seed", r.seed);
    if (r.id === "bowl") sessionStorage.setItem("gs-bowl-players", String(r.players ?? 1));
    setSettings({ difficulty: r.difficulty, lowImpact: r.lowImpact });
    a.play(r.id, !r.camera, r.track ?? 0, r.endless);
  });
  menu.querySelector("[data-back]")!.addEventListener("click", () => a.open(r.id));
  menu.querySelector("[data-share]")?.addEventListener("click", async () => {
    const url = challengeUrl(r);
    try {
      await navigator.clipboard.writeText(url);
      menu.querySelector("[data-share-status]")!.textContent = "CHALLENGE LINK COPIED · SEND IT TO A FRIEND.";
    } catch {
      menu.querySelector("[data-share-status]")!.textContent = url;
    }
  });
  menu.querySelector("[data-next]")?.addEventListener("click", () => {
    const ids = (sessionStorage.getItem("gs-circuit") ?? "").split(",");
    const next = ids[ids.indexOf(r.id) + 1] as GameId | undefined;
    if (next) a.open(next);
    else {
      sessionStorage.removeItem("gs-circuit");
      a.home();
    }
  });
  (menu.querySelector("[data-replay]") as HTMLElement).focus({ preventScroll: true });
}
export function decorateDanceHome(menu: HTMLElement, a: Actions, startOriginal: (demo: boolean) => void) {
  menu.classList.add("pt-shell", "pt-dance-home");
  menu.querySelector(".logo")?.remove();
  menu.querySelector("#home-back")?.closest(".menu-foot")?.remove();
  const [c1, c2] = CARD_COLORS.dance;
  const hero = document.createElement("section");
  hero.className = "pt-dance-hero";
  hero.style.setProperty("--c1", c1);
  hero.style.setProperty("--c2", c2);
  hero.innerHTML = `<div class="pt-dance-hero-art" aria-hidden="true"><img src="${art("dance")}" alt=""></div><div class="pt-dance-hero-copy"><span class="pt-eyebrow">01 / 07 · FIND YOUR FLOW</span><h1 class="pt-title">DANCE</h1><h2>Own the floor.</h2><p>Mirror the hologram coach, hit the moves on the cards and raise the hype until the stage goes Supernova.</p><div class="pt-play-row"><button class="pt-btn pt-btn-gold pt-play" data-original><span>PLAY AN ORIGINAL ROUTINE</span></button><button class="pt-btn" data-watch><span>WATCH DEMO</span></button></div></div>`;
  // The song search, dance-off and dancer options become glass cards under the hero.
  const panels = document.createElement("section");
  panels.className = "pt-dance-panels";
  panels.setAttribute("aria-label", "More ways to dance");
  for (const el of [...menu.querySelectorAll<HTMLElement>(":scope > .yt-panel, :scope > .menu-foot")]) panels.appendChild(el);
  const song = panels.querySelector(".yt-panel:not(.mp-panel) .yt-title");
  if (song) song.innerHTML = 'ANY SONG <small>Search YouTube or paste a link. Moves are generated to the beat.</small>';
  const off = panels.querySelector(".mp-panel .yt-title");
  if (off) off.innerHTML = 'DANCE-OFF <small>Up to four players on their own cameras.</small>';
  const foot = panels.querySelector(".menu-foot");
  if (foot) foot.insertAdjacentHTML("afterbegin", '<div class="yt-title">YOUR DANCER <small>Name, fitness tracking and camera.</small></div>');
  menu.prepend(hero);
  hero.after(panels);
  menu.insertAdjacentHTML("afterbegin", topBar('<button class="pt-back" data-back-home>← ALL GAMES</button>'));
  wireTop(menu, a);
  menu.querySelector("[data-back-home]")?.addEventListener("click", a.home);
  hero.querySelector("[data-original]")!.addEventListener("click", () => startOriginal(false));
  hero.querySelector("[data-watch]")!.addEventListener("click", () => startOriginal(true));
  stopKineticPreview();
}
