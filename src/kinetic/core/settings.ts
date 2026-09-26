export type Quality = "auto" | "high" | "low";
export type Difficulty = "flow" | "athlete" | "expert";
export interface Settings {
  lowImpact: boolean;
  reducedMotion: boolean;
  quality: Quality;
  difficulty: Difficulty;
  volume: number;
  voice: boolean;
  shareVideo: boolean;
  renderer: "3d" | "classic";
}
const base: Settings = {
  lowImpact: false,
  reducedMotion:
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches,
  quality: "auto",
  difficulty: "flow",
  volume: 0.65,
  voice: true,
  shareVideo: false,
  renderer: "3d",
};
export function settings(): Settings {
  const s = { ...base };
  try {
    const raw = JSON.parse(localStorage.getItem("gs-kinetic-settings") ?? "{}");
    if (!raw || typeof raw !== "object") return s;
    for (const key of [
      "lowImpact",
      "reducedMotion",
      "voice",
      "shareVideo",
    ] as const)
      if (typeof raw[key] === "boolean") s[key] = raw[key];
    if (["auto", "high", "low"].includes(raw.quality)) s.quality = raw.quality;
    if (["flow", "athlete", "expert"].includes(raw.difficulty))
      s.difficulty = raw.difficulty;
    if (["3d", "classic"].includes(raw.renderer)) s.renderer = raw.renderer;
    if (typeof raw.volume === "number" && Number.isFinite(raw.volume))
      s.volume = Math.max(0, Math.min(1, raw.volume));
  } catch {}
  return s;
}
export function setSettings(patch: Partial<Settings>) {
  const s = { ...settings(), ...patch };
  localStorage.setItem("gs-kinetic-settings", JSON.stringify(s));
  window.dispatchEvent(new CustomEvent("gs-settings", { detail: s }));
  return s;
}
export const CAST_INFO = [
  {
    id: "nova",
    name: "Nova",
    role: "Find your rhythm",
    color: "#f35d42",
    hair: "afro",
  },
  {
    id: "blaze",
    name: "Blaze",
    role: "Bring the heat",
    color: "#d86b41",
    hair: "crop",
  },
  {
    id: "luna",
    name: "Luna",
    role: "Move with intention",
    color: "#b5bad3",
    hair: "bob",
  },
  {
    id: "kiko",
    name: "Kiko",
    role: "Make your own rules",
    color: "#d7ef70",
    hair: "buns",
  },
  {
    id: "rex",
    name: "Rex",
    role: "Built for the long run",
    color: "#b5c6a1",
    hair: "cap",
  },
  {
    id: "velvet",
    name: "Velvet",
    role: "Style in every step",
    color: "#365ff5",
    hair: "tail",
  },
  {
    id: "midnight",
    name: "Midnight",
    role: "Quiet focus. Big moves.",
    color: "#616c7b",
    hair: "hood",
  },
  {
    id: "sol",
    name: "Sol",
    role: "A little more sunshine",
    color: "#d4b55d",
    hair: "sweep",
  },
] as const;
export function characterId() {
  const v = localStorage.getItem("gs-char");
  return CAST_INFO.some((c) => c.id === v) ? v! : "nova";
}
export function announce(text: string) {
  if (!settings().voice || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.06;
  u.volume = settings().volume * 0.65;
  speechSynthesis.speak(u);
}
