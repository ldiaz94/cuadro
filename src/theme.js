// cuadro theme: the look shared by every scene, as CSS custom properties.
// theme(name, brand) returns the properties as a style object for a
// stage element; scenes (and code scenes) read them with var(--name).
//
//   colours  --bg --ink --muted --surface --line --accent --accent2 --on-accent
//   fonts    --font-display --font-body --display-weight --tracking
//   type     --t-small --t-body --t-3 --t-2 --t-1 --t-hero --t-mega
//   space    --pad-x --pad-y --gap --radius
//
// Sizes are in container units (cqmin, cqw, cqh) of the stage, so a scene
// scales with the video: --t-small is 28.8 px on a 1280x720 frame.
// The fonts, Inter and Space Grotesk, ship with cuadro (fonts/, under the
// SIL Open Font License), so text looks the same on every machine; they
// are loaded the first time theme() runs in a page, and cuadro's
// setFrame waits for them.
// Depends on nothing. Leaves out easing (motion is computed in JS from the
// frame, see scenes.js, so CSS never animates), logos (a logo is an <img>,
// which cuadro waits for, so it is a prop of the scene that shows it),
// and fonts beyond the Latin subset.

/** The fonts that ship with cuadro, as [family, file, weight range]. */
const Fonts = [
  ['Inter', 'fonts/inter.woff2', '100 900'],
  ['Space Grotesk', 'fonts/space-grotesk.woff2', '300 700'],
];

/** Type scale and spacing, the same in every theme. */
const Scale = {
  '--t-small': '4cqmin', '--t-body': '4.8cqmin', '--t-3': '6.2cqmin', '--t-2': '8cqmin',
  '--t-1': '11cqmin', '--t-hero': '15cqmin', '--t-mega': '26cqmin',
  '--pad-x': '8cqw', '--pad-y': '10cqh', '--gap': '3.2cqmin', '--radius': '2.4cqmin',
};

/** The themes: light and clean, bold, and dark. */
export const themes = {
  light: {
    '--bg': '#f6f4ef', '--ink': '#15161a', '--muted': '#15161a8c', '--surface': '#ffffff', '--line': '#15161a1a',
    '--accent': '#3554f5', '--accent2': '#ff7a59', '--on-accent': '#ffffff',
    '--font-display': "'Inter', sans-serif", '--font-body': "'Inter', sans-serif", '--display-weight': '750', '--tracking': '-0.035em',
  },
  bold: {
    '--bg': '#2236f0', '--ink': '#ffffff', '--muted': '#ffffffb3', '--surface': '#ffffff1f', '--line': '#ffffff33',
    '--accent': '#ffe14a', '--accent2': '#ff6b9a', '--on-accent': '#141414',
    '--font-display': "'Space Grotesk', sans-serif", '--font-body': "'Inter', sans-serif", '--display-weight': '700', '--tracking': '-0.03em',
  },
  dark: {
    '--bg': '#0c0e14', '--ink': '#f2f4f8', '--muted': '#f2f4f88c', '--surface': '#ffffff0d', '--line': '#ffffff1f',
    '--accent': '#8b97ff', '--accent2': '#3fe0bd', '--on-accent': '#0c0e14',
    '--font-display': "'Inter', sans-serif", '--font-body': "'Inter', sans-serif", '--display-weight': '700', '--tracking': '-0.035em',
  },
};

/** Returns the custom properties of theme `name`, with a brand's accent colours (#rrggbb) over it. */
export function theme(name = 'light', { accent, accent2 } = {}) {
  if (!(name in themes)) throw new Error(`theme: no theme named ${name}; try ${Object.keys(themes).join(', ')}`);
  for (const c of [accent, accent2]) {
    if (c !== undefined && !/^#[0-9a-f]{6}$/i.test(c)) throw new Error(`theme: ${c} is not a #rrggbb colour`);
  }
  if (typeof document !== 'undefined') loadFonts();
  const props = { ...Scale, ...themes[name] };
  if (accent) Object.assign(props, { '--accent': accent, '--on-accent': readableOn(accent) });
  if (accent2) props['--accent2'] = accent2;
  return props;
}

/** Near-black or white, whichever reads better on the colour hex. */
function readableOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.19 ? '#141414' : '#ffffff'; // 0.19: where the two contrasts are equal
}

/** Whether the fonts were added to this page yet. */
let loaded = false;

/** Adds the bundled fonts to the page and starts loading them, so document.fonts.ready waits for them. */
function loadFonts() {
  if (loaded) return;
  loaded = true;
  for (const [family, file, weight] of Fonts) {
    const face = new FontFace(family, `url(${new URL(file, import.meta.url)})`, { weight });
    document.fonts.add(face);
    face.load();
  }
}
