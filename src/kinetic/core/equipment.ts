import { ledger } from "./records";
import { SABER_STYLES, totalMedals } from "../../games/progress";
export const earnedMedals = () => ledger().medals + totalMedals();
export function equippedSaber() {
  const id = localStorage.getItem("gs-saber") ?? "classic";
  return (
    SABER_STYLES.find((s) => s.id === id && s.need <= earnedMedals()) ??
    SABER_STYLES[0]
  );
}
export const OUTFITS = [
  { id: "studio", name: "Studio kit", need: 0, color: "#eeeae1" },
  { id: "night", name: "Night shift", need: 5, color: "#303833" },
  { id: "team", name: "Track team", need: 10, color: "#d7ef70" },
];
export function outfit() {
  return (
    OUTFITS.find(
      (o) =>
        o.id === localStorage.getItem("gs-kinetic-outfit") &&
        o.need <= earnedMedals(),
    ) ?? OUTFITS[0]
  );
}
export function nextReward() {
  const n = earnedMedals(),
    next = [...OUTFITS, ...SABER_STYLES]
      .filter((x) => x.need > n)
      .sort((a, b) => a.need - b.need)[0];
  return next
    ? `${next.need - n} MORE MEDALS TO ${next.name.toUpperCase()}`
    : "YOUR EQUIPMENT ROOM IS COMPLETE";
}
