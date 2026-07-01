import { pick } from "../lib/coordinates";
import type { CanvasStats, Critique } from "../types";

export function buildCritique(stats: CanvasStats, override?: string): Critique {
  const coveragePercent = `${Math.round(stats.coverage * 1000) / 10}%`;
  const empty = stats.coverage < 0.001;

  if (empty) {
    return {
      headline: "Pristine, suspiciously calm",
      body: "The blank space has excellent confidence. It is waiting for one decisive mark to ruin its perfect alibi.",
      coverage: "0%",
      composition: "centered",
      palette: "open",
    };
  }

  const seed = stats.centroid.x + stats.centroid.y + stats.coverage * 10000;
  const energyLine = {
    quiet: [
      "This is restraint with a raised eyebrow.",
      "The composition whispers, then checks whether everyone heard it.",
      "A tiny visual thesis has entered the room.",
    ],
    balanced: [
      "The marks have enough confidence to ask for better lighting.",
      "It is nicely paced: not timid, not trying to take over the building.",
      "There is a real sense of motion holding the page together.",
    ],
    maximal: [
      "The canvas came dressed for a dramatic opening night.",
      "This has the energy of a studio wall five minutes before the deadline.",
      "Every corner seems to have negotiated for speaking time.",
    ],
  }[stats.energy];

  const leanLine =
    stats.lean === "centered"
      ? "The weight sits near center, which gives the piece a composed spine."
      : `The image leans ${stats.lean}, which makes the empty space feel intentional.`;
  const verticalLine =
    stats.vertical === "centered"
      ? "The vertical balance is steady."
      : `The focus sits ${stats.vertical}, adding a useful bit of tension.`;

  return {
    headline: pick(
      ["Studio verdict: alive", "Promising chaos, curated", "A small thesis in color", "The wall label writes itself"],
      seed,
    ),
    body: override ?? `${pick(energyLine, seed)} ${leanLine} ${verticalLine}`,
    coverage: coveragePercent,
    composition: stats.lean,
    palette: stats.dominant,
  };
}
