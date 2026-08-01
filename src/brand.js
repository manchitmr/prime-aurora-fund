/**
 * Prime Aurora brand mark.
 *
 * These are the society's own artwork files, used unmodified — no recolouring,
 * no redrawing. `logo.png` is the full lockup (monogram over AURORA /
 * MATTEGODA), `logo-mark.png` is just the monogram for tight spaces. Both were
 * cropped to their artwork and are transparent, so they sit on the page
 * background rather than in a white box.
 *
 * The one accommodation is dark mode. The wordmark is navy, which all but
 * vanishes on a near-black background, and recolouring it is not an option —
 * so in dark mode only, the logo sits on a soft white tile. The artwork itself
 * is untouched; it simply gets a surface to sit on, the way it would on
 * letterhead.
 */

export const BRAND_CSS = `
  .brand { display: inline-flex; align-items: center; gap: 12px; }
  .brand img { display: block; height: auto; width: auto; }
  .brand-stack { flex-direction: column; gap: 10px; text-align: center; }

  /* inline-flex, not inline: padding on an inline box does not enclose the
     image, which renders the dark-mode plate as a bar beside the artwork. */
  .brand-plate { display: inline-flex; align-items: center; justify-content: center;
    border-radius: 10px; padding: 0; background: none; }

  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) .brand-plate {
      background: #ffffff;
      padding: 6px 9px;
      box-shadow: 0 1px 2px rgba(0,0,0,.35);
    }
    /* The login lockup is larger, so it earns more room on its tile. */
    :root:where(:not([data-theme="light"])) .brand-stack .brand-plate {
      padding: 14px 18px;
    }
  }
  :root[data-theme="dark"] .brand-plate {
    background: #ffffff;
    padding: 6px 9px;
    box-shadow: 0 1px 2px rgba(0,0,0,.35);
  }
  :root[data-theme="dark"] .brand-stack .brand-plate {
    padding: 14px 18px;
  }
`;

/**
 * `variant`:
 *   "mark" — the monogram alone, for a header beside existing text
 *   "full" — the complete lockup, for the login card
 *
 * `size` is the rendered height in CSS pixels for "mark", or the width for
 * "full". The files are exported at roughly 2x so they stay crisp.
 */
export function brandSvg(variant = "mark", size = 38) {
  if (variant === "mark") {
    return `<span class="brand-plate"><img src="/logo-mark.png" alt="Prime Aurora"
      style="height:${size}px" width="189" height="172"></span>`;
  }
  return `<span class="brand-plate"><img src="/logo.png" alt="Prime Aurora, Mattegoda"
    style="width:${size * 2.4}px" width="289" height="363"></span>`;
}
