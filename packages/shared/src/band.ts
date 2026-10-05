// Family colour band, see DESIGN.md. Stages 1 to 7: glow for gradient surfaces
// and dark backgrounds, deep for text and thin lines on light backgrounds. The
// mobile app keeps a copy in lib/core/brand.dart.
export const GLOW = ['#F2545B', '#FB8C45', '#F2C14E', '#6CCF8E', '#46BFE0', '#8E92F8', '#C39BF2'];
export const DEEP = ['#B3262D', '#A8461A', '#876008', '#1D6A44', '#156A88', '#3B3EA8', '#6A33A0'];

export type Band = { from: number; to: number };

// Colour at a position from 1 to 7, linear in sRGB between neighbouring stages
export function bandColor(position: number, tones: string[]): string {
  const p = Math.min(7, Math.max(1, position));
  const i = Math.min(5, Math.floor(p - 1));
  const t = p - 1 - i;
  let hex = '#';
  for (const k of [1, 3, 5]) {
    const a = Number.parseInt(tones[i]!.slice(k, k + 2), 16);
    const b = Number.parseInt(tones[i + 1]!.slice(k, k + 2), 16);
    hex += Math.round(a + (b - a) * t)
      .toString(16)
      .padStart(2, '0');
  }
  return hex.toUpperCase();
}

// Runs from bottom left to top right, through the middle of the section
export function bandGradient(band: Band, tones: string[]): string {
  const stops = [band.from, (band.from + band.to) / 2, band.to].map((p) => bandColor(p, tones));
  return `linear-gradient(45deg, ${stops.join(', ')})`;
}
