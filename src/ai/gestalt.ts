import { MODEL_COORDINATE_MAX } from "../constants";
import type { CapturedStroke, Point } from "../types";

// Small on-device models can't spatially parse SVG path data, so the squiggle has to
// reach them as plain language. This module turns the captured strokes (normalized
// 0-1000 coords) into a short natural-language gestalt: where each line sits, which
// way it runs, and how wavy/loopy/closed it is. That description becomes the most
// concrete thing in the prompt — the model completes THIS shape instead of stamping
// its favorite stock object at (500,500).

const DESCRIBED_STROKE_LIMIT = 4;

type StrokeAnalysis = {
  length: number;
  start: Point;
  end: Point;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  closed: boolean;
  dotLike: boolean;
  totalTurn: number;
  signedTurn: number;
  zigzags: number;
  turnDensity: number;
};

export function describeSquiggleGestalt(strokes: CapturedStroke[]): string {
  const analyses = strokes
    .filter((stroke) => stroke.points.length >= 2)
    .map(analyzeStroke)
    .sort((a, b) => b.length - a.length);

  if (!analyses.length) return "The canvas is empty so far.";

  const overall = combineBounds(analyses.map((analysis) => analysis.bounds));
  const described = analyses.slice(0, DESCRIBED_STROKE_LIMIT);
  const extra = analyses.length - described.length;

  const header = [
    `The person drew ${analyses.length} stroke${analyses.length === 1 ? "" : "s"}`,
    `in the ${regionName(boundsCenter(overall))} of the canvas,`,
    `inside x ${roundCoord(overall.minX)}-${roundCoord(overall.maxX)}, y ${roundCoord(overall.minY)}-${roundCoord(overall.maxY)}.`,
  ].join(" ");

  const lines = described.map((analysis, index) => {
    const opener = analyses.length === 1 ? "It is" : index === 0 ? "The main stroke is" : "Another is";
    return `${opener} ${describeStroke(analysis)}.`;
  });

  if (extra > 0) {
    lines.push(`Plus ${extra} smaller mark${extra === 1 ? "" : "s"} nearby.`);
  }

  return [header, ...lines].join(" ");
}

function describeStroke(analysis: StrokeAnalysis): string {
  if (analysis.dotLike) {
    return `a small dot near (${roundCoord(analysis.start.x)},${roundCoord(analysis.start.y)})`;
  }

  const size = sizeWord(analysis);

  if (Math.abs(analysis.signedTurn) > Math.PI * 2.8) {
    const center = boundsCenter(analysis.bounds);
    const width = roundCoord(analysis.bounds.maxX - analysis.bounds.minX);
    const height = roundCoord(analysis.bounds.maxY - analysis.bounds.minY);
    return `a ${size} spiral wound around (${roundCoord(center.x)},${roundCoord(center.y)}), about ${width} wide and ${height} tall`;
  }

  if (analysis.closed) {
    const width = roundCoord(analysis.bounds.maxX - analysis.bounds.minX);
    const height = roundCoord(analysis.bounds.maxY - analysis.bounds.minY);
    const shape = analysis.turnDensity > 2.6 ? "closed squiggly blob" : `closed ${aspectWord(analysis)} loop`;
    const center = boundsCenter(analysis.bounds);
    return `a ${size} ${shape} centered near (${roundCoord(center.x)},${roundCoord(center.y)}), about ${width} wide and ${height} tall`;
  }

  const shape = openShapeWord(analysis);
  const from = `(${roundCoord(analysis.start.x)},${roundCoord(analysis.start.y)})`;
  const to = `(${roundCoord(analysis.end.x)},${roundCoord(analysis.end.y)})`;
  return `a ${size} ${shape} running ${directionPhrase(analysis.start, analysis.end)} from ${from} to ${to}`;
}

function openShapeWord(analysis: StrokeAnalysis): string {
  if (Math.abs(analysis.signedTurn) > Math.PI * 1.4) return "line that curls into a big open loop";
  if (analysis.zigzags >= 3) return "zigzag line";
  if (analysis.turnDensity < 0.45) return "nearly straight line";
  if (analysis.turnDensity < 1.4) return "gently curving line";
  if (analysis.turnDensity < 3) return "wavy line";
  return "very squiggly line";
}

function sizeWord(analysis: StrokeAnalysis): string {
  const diagonal = Math.hypot(
    analysis.bounds.maxX - analysis.bounds.minX,
    analysis.bounds.maxY - analysis.bounds.minY,
  );
  if (diagonal < 90) return "tiny";
  if (diagonal < 220) return "small";
  if (diagonal < 480) return "medium";
  return "large";
}

function aspectWord(analysis: StrokeAnalysis): string {
  const width = Math.max(1, analysis.bounds.maxX - analysis.bounds.minX);
  const height = Math.max(1, analysis.bounds.maxY - analysis.bounds.minY);
  const ratio = width / height;
  if (ratio > 1.6) return "wide";
  if (ratio < 0.62) return "tall";
  return "round";
}

function directionPhrase(start: Point, end: Point): string {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const horizontal = dx > 0 ? "to the right" : "to the left";
  const vertical = dy > 0 ? "downward" : "upward";

  if (Math.abs(dx) > Math.abs(dy) * 2) return horizontal;
  if (Math.abs(dy) > Math.abs(dx) * 2) return vertical;
  return `${vertical} ${horizontal}`;
}

function regionName(point: Point): string {
  const column = point.x < MODEL_COORDINATE_MAX * 0.34 ? "left" : point.x > MODEL_COORDINATE_MAX * 0.66 ? "right" : "middle";
  const row = point.y < MODEL_COORDINATE_MAX * 0.34 ? "upper" : point.y > MODEL_COORDINATE_MAX * 0.66 ? "lower" : "middle";

  if (row === "middle" && column === "middle") return "center";
  if (row === "middle") return `middle ${column}`;
  if (column === "middle") return `${row} middle`;
  return `${row} ${column}`;
}

function analyzeStroke(stroke: CapturedStroke): StrokeAnalysis {
  const points = stroke.points;
  const length = pathLength(points);
  const bounds = combineBounds([
    points.reduce(
      (box, point) => ({
        minX: Math.min(box.minX, point.x),
        minY: Math.min(box.minY, point.y),
        maxX: Math.max(box.maxX, point.x),
        maxY: Math.max(box.maxY, point.y),
      }),
      { minX: points[0].x, minY: points[0].y, maxX: points[0].x, maxY: points[0].y },
    ),
  ]);

  const start = points[0];
  const end = points[points.length - 1];
  const endGap = Math.hypot(end.x - start.x, end.y - start.y);
  const dotLike = length < 36;

  // Turning is measured on a distance-resampled copy so pointer-rate jitter
  // doesn't read as waviness. Zigzag corners must turn sharply within a single
  // sample; smooth waves turn gradually and stay under the corner threshold.
  const resampled = resamplePolyline(points, 48);
  let totalTurn = 0;
  let signedTurn = 0;
  let zigzags = 0;
  let lastSignificantSign = 0;

  for (let index = 1; index < resampled.length - 1; index += 1) {
    const turn = turnAngle(resampled[index - 1], resampled[index], resampled[index + 1]);
    totalTurn += Math.abs(turn);
    signedTurn += turn;

    if (Math.abs(turn) > 0.9) {
      const sign = Math.sign(turn);
      if (lastSignificantSign !== 0 && sign !== lastSignificantSign) zigzags += 1;
      lastSignificantSign = sign;
    }
  }

  // A shape that winds well past one full revolution is a spiral, not a closed
  // loop, even when its endpoints happen to land near each other.
  const closed =
    !dotLike && endGap < Math.max(45, length * 0.14) && Math.abs(signedTurn) < Math.PI * 2.5;

  // Radians of turning per 200 normalized units of travel.
  const turnDensity = length > 0 ? totalTurn / (length / 200) : 0;

  return { length, start, end, bounds, closed, dotLike, totalTurn, signedTurn, zigzags, turnDensity };
}

function pathLength(points: Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

function resamplePolyline(points: Point[], targetCount: number): Point[] {
  if (points.length <= 2) return points;

  const total = pathLength(points);
  if (total <= 0) return [points[0], points[points.length - 1]];

  const step = total / (targetCount - 1);
  const resampled: Point[] = [points[0]];
  let carried = 0;

  for (let index = 1; index < points.length; index += 1) {
    let previous = points[index - 1];
    const current = points[index];
    let segment = Math.hypot(current.x - previous.x, current.y - previous.y);

    while (carried + segment >= step && segment > 0) {
      const t = (step - carried) / segment;
      const sample = {
        x: previous.x + (current.x - previous.x) * t,
        y: previous.y + (current.y - previous.y) * t,
      };
      resampled.push(sample);
      carried = 0;
      segment = Math.hypot(current.x - sample.x, current.y - sample.y);
      previous = sample;
    }

    carried += segment;
  }

  const last = points[points.length - 1];
  const tail = resampled[resampled.length - 1];
  if (tail.x !== last.x || tail.y !== last.y) resampled.push(last);

  return resampled;
}

function turnAngle(a: Point, b: Point, c: Point): number {
  const angleIn = Math.atan2(b.y - a.y, b.x - a.x);
  const angleOut = Math.atan2(c.y - b.y, c.x - b.x);
  let turn = angleOut - angleIn;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  return turn;
}

function combineBounds(list: Array<{ minX: number; minY: number; maxX: number; maxY: number }>) {
  return list.reduce((combined, bounds) => ({
    minX: Math.min(combined.minX, bounds.minX),
    minY: Math.min(combined.minY, bounds.minY),
    maxX: Math.max(combined.maxX, bounds.maxX),
    maxY: Math.max(combined.maxY, bounds.maxY),
  }));
}

function boundsCenter(bounds: { minX: number; minY: number; maxX: number; maxY: number }): Point {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

function roundCoord(value: number): number {
  return Math.round(value / 10) * 10;
}
