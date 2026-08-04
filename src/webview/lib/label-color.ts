/**
 * Stable colours for labels.
 *
 * Labels are user-defined and unbounded, so a fixed palette would either run
 * out or reassign colours as the set changes. Hashing the label text instead
 * means `ui` is the same colour in every view, in every session, forever — and
 * two labels only collide by coincidence.
 */

/** FNV-1a: small, stable, and good enough to spread short strings over a circle. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/**
 * An `oklch` colour for a label.
 *
 * Chroma is fixed so every chip has the same weight; only the hue varies, and
 * the golden-angle step spreads adjacent hashes apart instead of clustering
 * them. Lightness comes from `--label-lightness`, which globals.css flips for a
 * light editor theme — 72% reads well on a dark background and fails 4.5:1 on a
 * white one.
 */
export function labelColor(label: string): string {
  const hue = (hash(label) * 137.508) % 360;
  return `oklch(var(--label-lightness, 72%) 0.13 ${hue.toFixed(1)})`;
}

/** Inline style for a `.label-chip`. */
export function labelChipStyle(label: string): Record<string, string> {
  return { '--label-color': labelColor(label) };
}
