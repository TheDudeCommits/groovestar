export type GameId =
  | "dance"
  | "fruit"
  | "blade"
  | "box"
  | "rush"
  | "tennis"
  | "bowl";
export interface GameDefinition {
  id: GameId;
  title: string;
  tag: string;
  verb: string;
  description: string;
  duration: string;
  movement: string;
  players: string;
  color: string;
  number: string;
  required: number[];
  mode: "rhythm" | "round" | "course";
  bundle: string;
}
const hands = [11, 12, 13, 14, 15, 16, 23, 24];
export const CATALOG: GameDefinition[] = [
  {
    id: "dance",
    title: "Dance",
    tag: "FIND YOUR FLOW",
    verb: "Own the floor.",
    description:
      "Your body. Your soundtrack. Follow the choreography or find a rhythm of your own.",
    duration: "Full song",
    movement: "Full body",
    players: "Solo · Friends",
    color: "#d7ef70",
    number: "01",
    required: hands,
    mode: "rhythm",
    bundle: "dance",
  },
  {
    id: "blade",
    title: "Beat Blade",
    tag: "RHYTHM / PRECISION",
    verb: "Cut through the noise.",
    description:
      "Two blades. One beat. Turn every drop into a full-body light show.",
    duration: "90 seconds",
    movement: "Arms · Reach",
    players: "Solo · Challenges",
    color: "#365ff5",
    number: "02",
    required: hands,
    mode: "rhythm",
    bundle: "blade",
  },
  {
    id: "box",
    title: "Boxing",
    tag: "FOCUS / POWER",
    verb: "Find your fighting rhythm.",
    description:
      "Meet your coach. Land the combination. Slip the counter. Come back stronger.",
    duration: "60 seconds",
    movement: "Punch · Slip",
    players: "Solo · Challenges",
    color: "#f35d42",
    number: "03",
    required: hands,
    mode: "round",
    bundle: "box",
  },
  {
    id: "rush",
    title: "Rush",
    tag: "SPEED / AGILITY",
    verb: "Take the scenic route.",
    description:
      "A city built for movement. Change lanes, clear the hurdles, and chase your own best.",
    duration: "90 seconds · Endless",
    movement: "Step · Rise · Duck",
    players: "Solo · Ghosts",
    color: "#bbcc9e",
    number: "04",
    required: [...hands, 25, 26, 27, 28],
    mode: "course",
    bundle: "rush",
  },
  {
    id: "fruit",
    title: "Fruit Slice",
    tag: "REACH / REACT",
    verb: "A fresh kind of energy.",
    description:
      "Slice through waves of fruit, build your fever, and take on the finale.",
    duration: "60 seconds",
    movement: "Arms · Sweep",
    players: "Solo · Live race",
    color: "#f4ad64",
    number: "05",
    required: hands,
    mode: "round",
    bundle: "fruit",
  },
  {
    id: "tennis",
    title: "Tennis",
    tag: "TIMING / REACH",
    verb: "Keep the rally alive.",
    description:
      "Read the ball and meet it with your racket. Precision beats power.",
    duration: "First to 5",
    movement: "Reach · Swing",
    players: "Solo",
    color: "#b8ceff",
    number: "06",
    required: hands,
    mode: "round",
    bundle: "tennis",
  },
  {
    id: "bowl",
    title: "Bowling",
    tag: "CONTROL / RELEASE",
    verb: "Make every roll count.",
    description:
      "Set your line, settle into your swing, and send it down the lane.",
    duration: "5 frames",
    movement: "Aim · Swing",
    players: "1–2 players",
    color: "#d5b7cd",
    number: "07",
    required: hands,
    mode: "round",
    bundle: "bowl",
  },
];
export const gameDef = (id: string) =>
  CATALOG.find((g) => g.id === id) ?? CATALOG[0];
