import {
  earnedMedals,
  equippedSaber,
  OUTFITS,
  outfit,
  nextReward,
} from "./core/equipment";
import { CATALOG, gameDef, type GameId } from "./core/catalog";
import { CAST_INFO, settings, setSettings, characterId } from "./core/settings";
import {
  ledger,
  challengeUrl,
  type RunRecord,
  dailySeed,
  movementStreak,
} from "./core/records";
import { TRACKS } from "./core/music";
import {
  fruitStats,
  totalMedals,
  SABER_STYLES,
  saberStyle,
  setSaberStyle,
} from "../games/progress";
interface Actions {
  open: (id: GameId) => void;
  play: (id: GameId, demo: boolean, track?: number, endless?: boolean) => void;
  phone: () => void;
  race: () => void;
  youtube: () => void;
  dance: () => void;
  home: () => void;
}
let cleanup: (() => void) | null = null;
let previewEpoch = 0;
export function stopKineticPreview() {
  previewEpoch++;
  cleanup?.();
  cleanup = null;
}
function preview(host: HTMLElement, kind: string, id?: string) {
  stopKineticPreview();
  const epoch = previewEpoch;
  const cover = kind === "celebrate" ? "dance" : kind;
  const fallback = () => {
    const img = document.createElement("img");
    img.className = "k-preview-fallback";
    img.src = `/kinetic/covers/${cover}.webp`;
    img.alt = "GrooveStar game scene";
    host.appendChild(img);
  };
  if (settings().renderer === "classic") {
    fallback();
    return;
  }
  import("./render/preview").then((m) => {
    if (!host.isConnected || epoch !== previewEpoch) return;
    try {
      cleanup = m.livePreview(host, kind, id);
    } catch {
      fallback();
    }
  });
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function header() {
  return `<header class="k-header"><button class="k-wordmark" data-home aria-label="GrooveStar home">GROOVE<span>STAR</span></button><div class="k-nav"><button data-games>THE GAMES</button><button data-cast>THE CREW</button><button data-progress>YOUR PROGRESS</button></div><button class="k-settings-button" data-settings aria-label="Movement and display settings">SETTINGS <span>↗</span></button></header>`;
}
function wireHeader(menu: HTMLElement, a: Actions) {
  menu.querySelector("[data-home]")?.addEventListener("click", a.home);
  menu.querySelector("[data-games]")?.addEventListener("click", () => {
    const row = menu.querySelector("#k-games");
    if (row)
      row.scrollIntoView({
        behavior: settings().reducedMotion ? "instant" : "smooth",
      });
    else a.home();
  });
  menu
    .querySelector("[data-settings]")
    ?.addEventListener("click", () => openSettings());
  menu
    .querySelector("[data-cast]")
    ?.addEventListener("click", () => openCast(a.home));
  menu
    .querySelector("[data-progress]")
    ?.addEventListener("click", () => openProgress(a));
}
function footer(a: Actions) {
  const f = document.createElement("footer");
  f.className = "k-footer";
  f.innerHTML = `<label>PLAYER <input aria-label="Player name" maxlength="14" value="${esc(localStorage.getItem("gs-name") ?? "DANCER")}"></label><span>BUILT FOR EVERY BODY.</span><button data-phone>USE YOUR PHONE AS A CAMERA ↗</button>`;
  f.querySelector("input")!.addEventListener("input", (e) =>
    localStorage.setItem(
      "gs-name",
      (e.target as HTMLInputElement).value.slice(0, 14),
    ),
  );
  f.querySelector("[data-phone]")!.addEventListener("click", a.phone);
  return f;
}
export function renderHome(menu: HTMLElement, a: Actions) {
  menu.classList.add("k-shell");
  const active = Math.round(ledger().activeSeconds / 60);
  menu.innerHTML = `${header()}<main><section class="k-hero"><div class="k-hero-copy"><div class="k-eyebrow"><span class="k-live-dot"></span> THE MOVEMENT ARCADE · VOL. 01</div><h1>LESS SCROLL.<br>MORE <em>SOUL.</em></h1><p>Seven ways to get out of your head.<br>One good reason to move.</p><div class="k-hero-actions"><button class="k-primary" data-feature>FIND YOUR GAME <span>↘</span></button><span>YOUR BODY IS<br>THE CONTROLLER.</span></div><div class="k-hero-index"><b>01 / 07</b><span>CAMERA ON.<br>WORLD OFF.</span></div></div><div class="k-hero-scene" id="k-preview"><div class="k-scene-label"><span>THE CREW / ${esc(characterId().toUpperCase())}</span><span>LIVE IN MOTION</span></div></div></section><div class="k-ticker"><span>DANCE</span><i>+</i><span>SLICE</span><i>+</i><span>BOX</span><i>+</i><span>RUN</span><i>+</i><span>PLAY IT YOUR WAY</span></div><section class="k-games-section" id="k-games"><div class="k-section-heading"><div><span class="k-eyebrow">PICK A FEELING. PRESS PLAY.</span><h2>Find your kind of <em>moving.</em></h2></div><span class="k-count">07 EXPERIENCES${active ? ` · ${active} ACTIVE MIN` : ""}</span></div><div class="k-game-grid">${CATALOG.map((g) => `<button class="k-game-tile" data-game="${g.id}" style="--game-color:${g.color}"><div class="k-tile-art"><img src="/kinetic/covers/${g.id}.webp" alt="" loading="lazy"><span class="k-tile-number">${g.number}</span><span class="k-tile-arrow">↗</span></div><div class="k-tile-meta"><span class="k-eyebrow">${g.tag}</span><h3>${g.title}</h3><p>${g.duration} <span>·</span> ${g.movement}</p></div></button>`).join("")}</div></section><section class="k-session-banner"><div><span class="k-eyebrow">A LITTLE OF EVERYTHING</span><h2>Your next<br><em>four good minutes.</em></h2></div><p>Rhythm. Focus. A change of pace.<br>Beat Blade → Boxing → Rush.</p><button class="k-primary" data-session>START A CIRCUIT ↗</button></section></main>`;
  menu.appendChild(footer(a));
  wireHeader(menu, a);
  menu.querySelector("[data-feature]")!.addEventListener("click", () =>
    menu.querySelector("#k-games")!.scrollIntoView({
      behavior: settings().reducedMotion ? "instant" : "smooth",
    }),
  );
  menu
    .querySelectorAll<HTMLElement>("[data-game]")
    .forEach((b) =>
      b.addEventListener("click", () => a.open(b.dataset.game as GameId)),
    );
  menu.querySelector("[data-session]")!.addEventListener("click", () => {
    sessionStorage.setItem("gs-circuit", "blade,box,rush");
    a.open("blade");
  });
  preview(menu.querySelector("#k-preview")!, "dance");
}
export function renderGameHome(menu: HTMLElement, id: GameId, a: Actions) {
  menu.classList.add("k-shell");
  const g = gameDef(id),
    s = settings();
  const best = Number(localStorage.getItem(`gs-${id}-best`) ?? 0),
    runs = ledger().runs.filter((r) => r.id === id);
  menu.innerHTML = `${header()}<main><div class="k-breadcrumb"><button data-back>← ALL GAMES</button><span>${g.number} / 07 · ${g.tag}</span></div><section class="k-detail"><div class="k-detail-copy"><span class="k-eyebrow">${g.tag}</span><h1>${g.title.toUpperCase().replace(" ", "<br>")}</h1><h2>${g.verb}</h2><p>${g.description}</p><div class="k-specs"><span><small>THE SESSION</small>${g.duration}</span><span><small>THE MOVEMENT</small>${g.movement}</span><span><small>THE COMPANY</small>${g.players}</span></div><div class="k-mode-selector"><span class="k-eyebrow">YOUR PACE</span><div>${(["flow", "athlete", "expert"] as const).map((x) => `<button data-level="${x}" aria-pressed="${s.difficulty === x}" class="${s.difficulty === x ? "selected" : ""}">${x === "flow" ? "Find your flow" : x === "athlete" ? "Break a sweat" : "Push the pace"}</button>`).join("")}</div></div><label class="k-check"><input type="checkbox" data-impact ${s.lowImpact ? "checked" : ""}> LOW IMPACT · SAME GOOD ENERGY</label>${id === "blade" ? `<label class="k-track-label">YOUR SOUNDTRACK<select data-track>${TRACKS.map((t, i) => `<option value="${i}" ${Number(sessionStorage.getItem("gs-next-track") ?? 0) === i ? "selected" : ""}>${t.title} · ${t.bpm} BPM</option>`).join("")}</select></label>` : ""}<div class="k-play-row"><button class="k-primary" data-play>LET’S MOVE <span>↗</span></button><button data-demo>WATCH DEMO →</button></div><div class="k-secondary-actions">${id === "blade" ? "<button data-youtube>Play any YouTube song ↗</button>" : ""}${id === "fruit" ? "<button data-race>Race a friend ↗</button>" : ""}${id === "rush" ? "<button data-endless>Run endlessly ↗</button>" : ""}${id === "bowl" ? "<button data-two>Two-player pass & play ↗</button>" : ""}<button data-daily>TODAY’S CHALLENGE ↗</button></div></div><div class="k-detail-scene" id="k-preview"><span class="k-detail-stamp">${g.number}<small>GROOVESTAR<br>MOVEMENT SERIES</small></span></div></section><section class="k-record-strip"><span class="k-eyebrow">YOUR RECORD</span><strong>${best.toLocaleString()}<small>BEST SCORE</small></strong><strong>${runs.length}<small>SESSIONS</small></strong><strong>${Math.max(0, ...runs.map((r) => r.combo))}<small>BEST COMBO</small></strong><p>Small steps.<br>Good momentum.</p></section>${id === "fruit" || id === "blade" ? `<section class="k-unlocks"><span class="k-eyebrow">THE EQUIPMENT ROOM</span><h2>Your signature cut.</h2><div>${SABER_STYLES.map((st) => `<button data-saber="${st.id}" class="${st.id === (id === "blade" ? equippedSaber() : saberStyle()).id ? "selected" : ""}" ${(id === "blade" ? earnedMedals() : totalMedals()) < st.need ? "disabled" : ""}>${st.name}<small>${(id === "blade" ? earnedMedals() : totalMedals()) < st.need ? st.need + " medals to unlock" : "READY TO EQUIP"}</small></button>`).join("")}</div></section>` : ""}</main>`;
  menu.appendChild(footer(a));
  wireHeader(menu, a);
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
  menu
    .querySelector("[data-impact]")!
    .addEventListener("change", (e) =>
      setSettings({ lowImpact: (e.target as HTMLInputElement).checked }),
    );
  const track = () =>
    Number(
      (menu.querySelector("[data-track]") as HTMLSelectElement | null)?.value ??
        0,
    );
  menu.querySelector("[data-play]")!.addEventListener("click", () => {
    if (id === "bowl") sessionStorage.setItem("gs-bowl-players", "1");
    a.play(
      id,
      false,
      track(),
      sessionStorage.getItem("gs-next-endless") === "1",
    );
  });
  menu
    .querySelector("[data-demo]")!
    .addEventListener("click", () => a.play(id, true, track()));
  menu.querySelector("[data-youtube]")?.addEventListener("click", a.youtube);
  menu.querySelector("[data-race]")?.addEventListener("click", a.race);
  menu.querySelector("[data-two]")?.addEventListener("click", () => {
    sessionStorage.setItem("gs-bowl-players", "2");
    a.play(id, false);
  });
  menu
    .querySelector("[data-endless]")
    ?.addEventListener("click", () => a.play(id, false, track(), true));
  menu.querySelector("[data-daily]")!.addEventListener("click", () => {
    sessionStorage.setItem("gs-next-seed", dailySeed(id));
    a.play(
      id,
      false,
      track(),
      sessionStorage.getItem("gs-next-endless") === "1",
    );
  });
  menu.querySelectorAll<HTMLElement>("[data-saber]").forEach((b) =>
    b.addEventListener("click", () => {
      setSaberStyle(b.dataset.saber!);
      a.open(id);
    }),
  );
  preview(menu.querySelector("#k-preview")!, id);
}
function dialog(title: string) {
  const shell = document.createElement("dialog");
  shell.className = "k-dialog";
  shell.setAttribute("aria-label", title);
  document.body.appendChild(shell);
  shell.addEventListener("close", () => shell.remove());
  return shell;
}
export function openSettings() {
  const s = settings(),
    d = dialog("Movement and display settings");
  d.innerHTML = `<button data-close class="k-dialog-close" aria-label="Close settings">×</button><span class="k-eyebrow">MAKE YOURSELF AT HOME</span><h2>Your pace.<br>Your space.</h2><label>Intensity<select data-key="difficulty"><option value="flow">Flow</option><option value="athlete">Athlete</option><option value="expert">Expert</option></select></label><label>Graphics<select data-key="quality"><option value="auto">Automatic</option><option value="high">High</option><option value="low">Low</option></select></label><label>Rendering<select data-key="renderer"><option value="3d">Kinetic 3D</option><option value="classic">Classic Canvas</option></select></label><label class="k-check"><input data-key="lowImpact" type="checkbox">Low impact movement</label><label class="k-check"><input data-key="reducedMotion" type="checkbox">Reduce camera motion and effects</label><label class="k-check"><input data-key="voice" type="checkbox">Spoken coach cues</label><label class="k-check"><input data-key="shareVideo" type="checkbox">Share my camera in friend sessions</label><label>Music volume<input data-key="volume" type="range" min="0" max="1" step=".05"></label><p>Changes apply to your next session.</p>`;
  for (const el of d.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    "[data-key]",
  )) {
    const k = el.dataset.key as keyof typeof s;
    if (el instanceof HTMLInputElement && el.type === "checkbox")
      el.checked = !!s[k];
    else el.value = String(s[k]);
    el.addEventListener("change", () =>
      setSettings({
        [k]:
          el instanceof HTMLInputElement && el.type === "checkbox"
            ? el.checked
            : k === "volume"
              ? Number(el.value)
              : el.value,
      }),
    );
  }
  d.querySelector("[data-close]")!.addEventListener("click", () => d.close());
  d.showModal();
}
export function openCast(onDone: () => void) {
  const d = dialog("Choose your character");
  d.classList.add("k-cast-dialog");
  d.innerHTML = `<button data-close class="k-dialog-close" aria-label="Close character selection">×</button><span class="k-eyebrow">MEET YOUR MOVEMENT CREW</span><h2>A little more <em>you.</em></h2><div class="k-cast-grid">${CAST_INFO.map((c) => `<button data-cast-id="${c.id}" class="${characterId() === c.id ? "selected" : ""}" aria-pressed="${characterId() === c.id}"><img src="/kinetic/cast/${c.id}.webp" alt="${c.name} in technical sportswear"><b>${c.name}</b><span>${c.role}</span></button>`).join("")}</div><div class="k-outfit-row">${OUTFITS.map((o) => `<button data-outfit="${o.id}" ${earnedMedals() < o.need ? "disabled" : ""} class="${outfit().id === o.id ? "selected" : ""}">${o.name}<small>${earnedMedals() < o.need ? o.need + " medals" : "READY TO WEAR"}</small></button>`).join("")}</div><button data-auto class="k-text-button">MY LOOK · USE MY SCANNED COLORS</button>`;
  d.querySelectorAll<HTMLElement>("[data-cast-id]").forEach((b) =>
    b.addEventListener("click", () => {
      localStorage.setItem("gs-char", b.dataset.castId!);
      d.close();
      onDone();
    }),
  );
  d.querySelectorAll<HTMLElement>("[data-outfit]").forEach((b) =>
    b.addEventListener("click", () => {
      localStorage.setItem("gs-kinetic-outfit", b.dataset.outfit!);
      d.close();
      onDone();
    }),
  );
  d.querySelector("[data-auto]")!.addEventListener("click", () => {
    localStorage.setItem("gs-char", "auto");
    d.close();
    onDone();
  });
  d.querySelector("[data-close]")!.addEventListener("click", () => d.close());
  d.showModal();
}
function openProgress(a: Actions) {
  const l = ledger(),
    d = dialog("Your movement progress");
  d.innerHTML = `<button data-close class="k-dialog-close" aria-label="Close progress">×</button><span class="k-eyebrow">EVERY MOVE COUNTS</span><h2>Look at you<br><em>go.</em></h2><p>${movementStreak()} DAY STREAK · ${totalMedals()} FRUIT MEDALS · YOUR EXISTING ACHIEVEMENTS STAY WITH YOU.</p><div class="k-progress-numbers"><strong>${Math.floor(l.activeSeconds / 60)}<small>ACTIVE MINUTES</small></strong><strong>${l.runs.length}<small>SESSIONS</small></strong><strong>${l.medals}<small>PRECISION MEDALS</small></strong></div><div class="k-history">${
    l.runs
      .slice(-8)
      .reverse()
      .map(
        (r) =>
          `<div><span>${gameDef(r.id).title}<small>${r.date.slice(0, 10)} · ${r.difficulty}</small></span><b>${r.score.toLocaleString()}</b></div>`,
      )
      .join("") || "<p>Your first session starts a good habit.</p>"
  }</div>`;
  d.querySelector("[data-close]")!.addEventListener("click", () => d.close());
  d.showModal();
}
export function renderResult(menu: HTMLElement, r: RunRecord, a: Actions) {
  menu.classList.add("k-shell", "k-result");
  const accuracy = Math.round((r.hits / Math.max(1, r.hits + r.misses)) * 100);
  menu.innerHTML = `${header()}<main><span class="k-eyebrow">${gameDef(r.id).title.toUpperCase()} · ${r.camera ? "SESSION COMPLETE" : "DEMO COMPLETE · RECORDS DISABLED"}</span><h1>THAT’S<br><em>YOUR ENERGY.</em></h1><div class="k-result-score">${r.score.toLocaleString()}<span>POINTS</span></div><div class="k-result-stats"><span><b>${accuracy}%</b>ACCURACY</span><span><b>${r.combo}</b>BEST COMBO</span><span><b>${Math.round(r.activeSeconds ?? r.seconds)}</b>ACTIVE SECONDS</span></div>${r.details?.length ? `<div class="k-result-stats">${r.details.map((d) => `<span><b>${esc(d.value)}</b>${esc(d.label)}</span>`).join("")}</div>` : ""}<div class="k-result-buttons"><button class="k-primary" data-replay>ONE MORE ROUND ↗</button><button data-back>BACK TO ${gameDef(r.id).title.toUpperCase()}</button>${r.camera && r.id !== "dance" ? "<button data-share>CHALLENGE A FRIEND ↗</button>" : ""}${sessionStorage.getItem("gs-circuit") ? '<button data-next class="k-primary">NEXT IN YOUR CIRCUIT ↗</button>' : ""}</div><p data-share-status aria-live="polite">${accuracy >= 80 && r.camera ? "PRECISION MEDAL · A LITTLE MOMENTUM GOES A LONG WAY." : "The next good move is yours."}</p><p class="k-next-reward">${nextReward()}</p></main>`;
  const scene = document.createElement("div");
  scene.className = "k-result-person";
  menu.querySelector("main")!.appendChild(scene);
  if (innerWidth > 850) preview(scene, "celebrate");
  wireHeader(menu, a);
  menu.querySelector("[data-replay]")!.addEventListener("click", () => {
    sessionStorage.setItem("gs-next-seed", r.seed);
    if (r.id === "bowl")
      sessionStorage.setItem("gs-bowl-players", String(r.players ?? 1));
    setSettings({ difficulty: r.difficulty, lowImpact: r.lowImpact });
    a.play(r.id, !r.camera, r.track ?? 0, r.endless);
  });
  menu
    .querySelector("[data-back]")!
    .addEventListener("click", () => a.open(r.id));
  menu.querySelector("[data-share]")?.addEventListener("click", async () => {
    const url = challengeUrl(r);
    try {
      await navigator.clipboard.writeText(url);
      menu.querySelector("[data-share-status]")!.textContent =
        "CHALLENGE LINK COPIED · SEND IT TO YOUR FRIEND.";
    } catch {
      menu.querySelector("[data-share-status]")!.textContent = url;
    }
  });
  menu.querySelector("[data-next]")?.addEventListener("click", () => {
    const ids = (sessionStorage.getItem("gs-circuit") ?? "").split(",");
    const next = ids[ids.indexOf(r.id) + 1] as GameId | undefined;
    if (next) {
      a.open(next);
    } else {
      sessionStorage.removeItem("gs-circuit");
      a.home();
    }
  });
}
export function decorateDanceHome(
  menu: HTMLElement,
  a: Actions,
  startOriginal: (demo: boolean) => void,
) {
  menu.classList.add("k-dance-home");
  menu.querySelector(".logo")?.remove();
  menu.querySelector("#home-back")?.closest(".menu-foot")?.remove();
  const hero = document.createElement("section");
  hero.className = "k-dance-intro";
  hero.innerHTML =
    '<div><span class="k-eyebrow">01 / 07 · FIND YOUR FLOW</span><h1>OWN THE<br><em>FLOOR.</em></h1><p>Your body. Your soundtrack.<br>Meet your new movement crew.</p><button class="k-primary" data-original>PLAY AN ORIGINAL ROUTINE ↗</button><button data-watch>WATCH DEMO →</button></div><div id="k-dance-preview"></div>';
  menu.prepend(hero);
  menu.insertAdjacentHTML("afterbegin", header());
  wireHeader(menu, a);
  hero
    .querySelector("[data-original]")!
    .addEventListener("click", () => startOriginal(false));
  hero
    .querySelector("[data-watch]")!
    .addEventListener("click", () => startOriginal(true));
  preview(hero.querySelector("#k-dance-preview")!, "dance");
}
