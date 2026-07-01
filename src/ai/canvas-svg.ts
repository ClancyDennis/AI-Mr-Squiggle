import { degreesToRadians, rectanglePoints, starPoints } from "../lib/geometry";
import type { CapturedStroke, CollaborationMark, Point } from "../types";

// Describe the canvas as compact SVG text in the same 0-1000 viewBox the model draws in.
// SVG is a format the model has strong priors for (far better than a bespoke coordinate
// list), and keeping it integer-coord + heavily decimated matters for tiny-context local
// models (e.g. Apple's on-device ~3B). This is the primary, vision-free feedback channel.

const round = (value: number) => Math.round(value);

// Perpendicular distance from p to the line through a-b (for Ramer-Douglas-Peucker).
function perpDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

// Ramer-Douglas-Peucker: drop points that don't change the shape beyond `epsilon`
// (in 0-1000 units). Keeps a squiggle recognizable with a handful of points.
function decimate(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;

  const first = points[0];
  const last = points[points.length - 1];
  let maxDistance = 0;
  let index = 0;

  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpDistance(points[i], first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }

  if (maxDistance > epsilon) {
    const left = decimate(points.slice(0, index + 1), epsilon);
    const right = decimate(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

function pathData(points: Point[]): string {
  if (!points.length) return "";
  const [first, ...rest] = points;
  let data = `M${round(first.x)} ${round(first.y)}`;
  if (rest.length) {
    data += " L" + rest.map((p) => `${round(p.x)} ${round(p.y)}`).join(" ");
  }
  return data;
}

function polygonPoints(points: Point[]): string {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
}

function strokeToSvg(stroke: CapturedStroke): string {
  const points = decimate(stroke.points, 6);
  if (points.length < 2) return "";
  return `<path d="${pathData(points)}" stroke="${stroke.color}" fill="none"/>`;
}

function boxFromCorners(a: Point, b: Point) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

// Compact SVG element for one AI mark. Reuses the same geometry helpers the renderer
// uses, so the text matches what actually gets drawn.
function markToSvg(mark: CollaborationMark): string {
  const points = mark.points;
  if (!points.length) return "";

  const fill = mark.fill ? mark.color : "none";
  const stroke = mark.color;
  const rotation = degreesToRadians(mark.rotation);

  switch (mark.kind) {
    case "dot": {
      const center = points[0];
      const edge = points[1];
      const radius = edge ? Math.hypot(edge.x - center.x, edge.y - center.y) : Math.max(6, mark.width * 2.6);
      return `<circle cx="${round(center.x)}" cy="${round(center.y)}" r="${round(radius)}" fill="${mark.color}"/>`;
    }
    case "star": {
      const center = points[0];
      const edge = points[1];
      const radius = edge ? Math.hypot(edge.x - center.x, edge.y - center.y) : Math.max(6, mark.width * 4);
      return `<polygon points="${polygonPoints(starPoints(center, radius, rotation))}" fill="${fill}" stroke="${stroke}"/>`;
    }
    case "ellipse": {
      if (!points[1]) return "";
      const box = boxFromCorners(points[0], points[1]);
      const cx = round(box.x + box.width / 2);
      const cy = round(box.y + box.height / 2);
      const transform = mark.rotation ? ` transform="rotate(${round(mark.rotation)} ${cx} ${cy})"` : "";
      return `<ellipse cx="${cx}" cy="${cy}" rx="${round(box.width / 2)}" ry="${round(box.height / 2)}" fill="${fill}" stroke="${stroke}"${transform}/>`;
    }
    case "rectangle":
    case "hatch": {
      if (!points[1]) return "";
      const box = boxFromCorners(points[0], points[1]);
      // Hatch is a textured fill region; show it as an outlined box so placement reads.
      const rectFill = mark.kind === "hatch" ? "none" : fill;
      if (mark.rotation) {
        return `<polygon points="${polygonPoints(rectanglePoints(box, rotation))}" fill="${rectFill}" stroke="${stroke}"/>`;
      }
      return `<rect x="${round(box.x)}" y="${round(box.y)}" width="${round(box.width)}" height="${round(box.height)}" fill="${rectFill}" stroke="${stroke}"/>`;
    }
    default: {
      // stroke, line, curve, highlight, smudge -> a path through the points.
      const path = mark.kind === "line" ? points.slice(0, 2) : points;
      return `<path d="${pathData(path)}" stroke="${stroke}" fill="none"/>`;
    }
  }
}

// Full canvas as SVG: the user's strokes plus every AI mark placed so far.
export function describeCanvasAsSvg(strokes: CapturedStroke[], marks: CollaborationMark[] = []): string {
  const strokeEls = strokes.map(strokeToSvg).filter(Boolean);
  const markEls = marks.map(markToSvg).filter(Boolean);

  const body = [
    strokeEls.length ? `<!-- your strokes -->\n${strokeEls.join("\n")}` : "<!-- (blank) -->",
    markEls.length ? `<!-- added so far -->\n${markEls.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `<svg viewBox="0 0 1000 1000">\n${body}\n</svg>`;
}
