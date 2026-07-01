export function nameAverageColor({ r, g, b }: { r: number; g: number; b: number }) {
  if (r > 220 && g > 220 && b > 220) return "white";
  if (r < 50 && g < 50 && b < 55) return "ink";
  if (g > r + 30 && g > b + 10) return b > r ? "teal" : "green";
  if (b > r + 25 && b > g + 5) return r > 125 ? "violet" : "blue";
  if (r > 190 && g > 120 && b < 95) return "amber";
  if (r > 180 && b > 120) return "rose";
  if (r > 180 && g < 120) return "coral";
  return "mixed";
}

export function getGridColors(backgroundColor: string) {
  const light = getHexLuminance(backgroundColor) > 0.5;

  return {
    minor: light ? "rgba(18, 17, 15, 0.13)" : "rgba(248, 245, 239, 0.16)",
    major: light ? "rgba(20, 119, 108, 0.34)" : "rgba(100, 216, 200, 0.42)",
    label: light ? "rgba(18, 17, 15, 0.82)" : "rgba(248, 245, 239, 0.9)",
    labelBackground: light ? "rgba(255, 255, 255, 0.76)" : "rgba(18, 17, 15, 0.72)",
  };
}

export function getHexLuminance(color: string) {
  const match = color.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return 1;

  const value = match[1];
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
