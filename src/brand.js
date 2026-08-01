/**
 * Prime Aurora brand mark, drawn as inline SVG so it recolours with the theme
 * instead of shipping two raster files that would each be wrong in one mode.
 *
 * The navy of the printed logo is near-black on a dark background, so the dark
 * theme lifts it to a pale slate rather than inverting the whole mark. The
 * crimson is brightened slightly for the same reason. Both are driven by CSS
 * custom properties, so the swap happens in one place.
 */

export const BRAND_CSS = `
  :root {
    --brand-navy:   #1c2e4e;
    --brand-red:    #a81e2d;
    --brand-green:  #1b5e3a;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      --brand-navy:  #cfd8e8;
      --brand-red:   #e0475a;
      --brand-green: #34a06a;
    }
  }
  :root[data-theme="dark"] {
    --brand-navy:  #cfd8e8;
    --brand-red:   #e0475a;
    --brand-green: #34a06a;
  }
  .brand { display: inline-flex; align-items: center; gap: 12px; }
  .brand svg { display: block; height: auto; }
  .brand-stack { flex-direction: column; gap: 10px; text-align: center; }
`;

/**
 * `variant`:
 *   "mark"  — the monogram alone, for a header beside existing text
 *   "full"  — monogram over the AURORA / MATTEGODA wordmark, for the login card
 */
export function brandSvg(variant = "mark", size = 40) {
  /* The mark is a bowl and a stem forming a lowercase "a": a thick crimson ring
     that warms into navy on its right, with the navy stem sitting flush against
     it (drawn second, so it overlaps rather than floats). The stem's slanted top
     is what stops the whole thing reading as a plain "o" beside a bar. */
  const uid = "pa-" + variant;
  const mark = `
    <g>
      <defs>
        <linearGradient id="${uid}" x1="0" y1="0.2" x2="1" y2="0.4">
          <stop offset="0%"   stop-color="var(--brand-red)"/>
          <stop offset="55%"  stop-color="var(--brand-red)"/>
          <stop offset="100%" stop-color="var(--brand-navy)"/>
        </linearGradient>
      </defs>
      <path fill="url(#${uid})" fill-rule="evenodd" d="
        M44 12
        a42 42 0 1 0 0 84
        a42 42 0 1 0 0-84
        Z
        M44 39
        a15 15 0 1 1 0 30
        a15 15 0 1 1 0-30
        Z"/>
      <path fill="var(--brand-navy)" d="M64 12 L88 6 L88 96 L64 96 Z"/>
    </g>`;

  if (variant === "mark") {
    return `<svg viewBox="0 0 92 102" width="${size}" height="${Math.round(size * 102 / 92)}"
      role="img" aria-label="Prime Aurora">${mark}</svg>`;
  }

  return `<svg viewBox="0 0 300 212" width="${size * 3}" role="img" aria-label="Prime Aurora, Mattegoda">
    <g transform="translate(104 0)">${mark}</g>
    <text x="150" y="152" text-anchor="middle" fill="var(--brand-navy)"
      font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"
      font-size="52" font-weight="800" letter-spacing="1">AURORA</text>
    <text x="150" y="182" text-anchor="middle" fill="var(--brand-red)"
      font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"
      font-size="24" font-weight="700" letter-spacing="6">MATTEGODA</text>
    <rect x="138" y="194" width="24" height="7" rx="1.5" fill="var(--brand-green)"/>
  </svg>`;
}
