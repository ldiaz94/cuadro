// Types for cuadro/theme, written by hand beside src/theme.js.

/** The themes that ship with cuadro. */
export type ThemeName = 'light' | 'bold' | 'dark';
/** A brand's accent colours, each #rrggbb. */
export interface Brand {
  accent?: string;
  accent2?: string;
}
/** CSS custom properties, such as '--bg', for a stage's style. */
export type Theme = Record<`--${string}`, string>;

/** Each theme's colours and fonts (the type scale and spacing are shared). */
export const themes: Record<ThemeName, Theme>;
/** The custom properties of theme `name` (default 'light'), with the brand's accents over it; loads the fonts. */
export function theme(name?: ThemeName, brand?: Brand): Theme;
