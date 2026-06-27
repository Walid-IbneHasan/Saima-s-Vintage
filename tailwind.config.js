/** @type {import('tailwindcss').Config} */

// ─────────────────────────────────────────────────────────────────────────────
// Saima's Vintage — "Heritage Atelier" premium design system.
//
// A warm-editorial luxury palette: espresso ink + warm ivory paper + a brass /
// antique-gold accent, tuned to feel like a high-end heritage-craft house
// (Lippan mirror art, Mughal Jharoka decor). Black-ink CTAs on ivory with gold
// filigree — the luxury-house language, kept warm and tactile.
//
// IMPORTANT: every semantic token NAME below is preserved from the previous
// "Heritage Red" export, so existing class names (bg-primary, text-on-surface,
// font-display-lg, text-headline-sm, …) re-skin the entire storefront at once.
// Values are what changed. A few additive tokens (accent/gold, extra shadows,
// easings) are layered on top and used in the redesigned templates.
// ─────────────────────────────────────────────────────────────────────────────
const atelier = {
  colors: {
    // ── Brand: red lacquer. `primary` fills CTAs (with on-primary text) and
    //    also reads as the price/logo/accent colour. (Headings use on-surface.)
    primary: '#a31621',
    'on-primary': '#ffffff',
    'primary-container': '#7a1019', // deep-red chips (sale chip, badges)
    'on-primary-container': '#f6ddc8', // warm light on deep red
    'primary-fixed': '#f7ddd6',
    'on-primary-fixed': '#3a0a0e',
    'primary-fixed-dim': '#e7b3ab',
    'on-primary-fixed-variant': '#7a1019', // CTA hover fill (deeper red)
    'inverse-primary': '#dcb978', // gold — link hover / focus on dark surfaces
    'surface-tint': '#b08d3f', // gold accent tint

    // ── Paper & surfaces (white / warm-white family). Body sits on white;
    //    sections alternate with warm-white "paper".
    background: '#ffffff',
    surface: '#ffffff',
    'surface-bright': '#ffffff',
    'surface-dim': '#f1ebe3',
    'surface-container-lowest': '#ffffff',
    'surface-container-low': '#faf7f3', // paper
    'surface-container': '#f6efe7',
    'surface-container-high': '#f0e7db',
    'surface-container-highest': '#e9ddcc',
    'surface-variant': '#f5eee6',
    'inverse-surface': '#3a0a0e', // wine
    'inverse-on-surface': '#f6ece0',

    // ── Ink & secondary text (warm).
    'on-surface': '#2a1410', // ink — headings/body on white (~13:1)
    'on-background': '#2a1410',
    'on-surface-variant': '#6f5a54', // secondary text — ~6:1 on white
    secondary: '#6f5a54',
    'on-secondary': '#ffffff',
    'secondary-container': '#f3e7df',
    'on-secondary-container': '#5a4a44',
    'secondary-fixed': '#f3e7df',
    'secondary-fixed-dim': '#ddccc0',
    'on-secondary-fixed': '#2a1410',
    'on-secondary-fixed-variant': '#5a4a44',

    // ── Borders / hairlines (warm, light).
    outline: '#ddcfbf',
    'outline-variant': '#ece2d6',

    // ── Tertiary: deep wine for the footer & dark sections.
    tertiary: '#3a0a0e',
    'on-tertiary': '#f6ece0',
    'tertiary-container': '#4a0d12',
    'on-tertiary-container': '#d8c2a8', // warm muted body — ~7:1 on wine
    'tertiary-fixed': '#f0d9c6',
    'tertiary-fixed-dim': '#d8b9a0',
    'on-tertiary-fixed': '#2a0a0c',
    'on-tertiary-fixed-variant': '#7a1019',

    // ── Feedback.
    error: '#b0241c',
    'on-error': '#ffffff',
    'error-container': '#f7ddd7',
    'on-error-container': '#5c130e',

    // ── Additive accent scale (champagne gold).
    accent: '#b08d3f',
    'accent-soft': '#cdab63',
    'accent-bright': '#dcb978',
    'accent-deep': '#8a6d2e', // ~4.8:1 on white — safe for small gold text
    gold: '#b08d3f',

    // ── "Maison Rouge" light-luxury brand palette (additive; new names only,
    //    so existing token classes are untouched). White ground, red accent,
    //    champagne gold detail. Used by the redesigned navbar, footer & home.
    'brand-red': '#a31621', // primary red — CTAs, accents (white text ≈6.5:1)
    'brand-red-deep': '#7a1019', // hover / footer ground
    'brand-red-soft': '#c4283b',
    'brand-wine': '#3a0a0e', // deepest warm red-black
    'brand-gold': '#b08d3f', // gold lines / decoration
    'brand-gold-soft': '#cdab63',
    'brand-gold-bright': '#dcb978',
    'brand-bronze': '#8a6d2e', // small gold text on white (≈4.8:1)
    'brand-ink': '#2a1410', // headings / body on white
    'brand-ink-soft': '#6f5a54', // secondary text on white (≈6:1)
    'brand-paper': '#faf7f3', // warm white section ground
    'brand-cream': '#f6ece0', // light text on red grounds
  },
  borderRadius: {
    DEFAULT: '0.25rem',
    sm: '0.25rem',
    lg: '0.5rem',
    xl: '0.875rem',
    '2xl': '1.25rem',
    '3xl': '1.75rem',
    full: '9999px',
  },
  spacing: {
    'margin-mobile': '20px',
    'margin-desktop': '64px',
    unit: '8px',
    'container-max': '1280px',
    gutter: '24px',
  },
  boxShadow: {
    // Soft, neutral, layered lifts — replace the old red-tinted shadow.
    luxe: '0 1px 2px rgba(36, 28, 20, 0.04), 0 12px 28px -16px rgba(36, 28, 20, 0.18)',
    'luxe-lg':
      '0 2px 6px rgba(36, 28, 20, 0.05), 0 30px 60px -28px rgba(36, 28, 20, 0.28)',
    'luxe-xl':
      '0 4px 10px rgba(36, 28, 20, 0.06), 0 50px 90px -40px rgba(36, 28, 20, 0.34)',
  },
  letterSpacing: {
    luxe: '0.2em',
    'luxe-wide': '0.32em',
  },
  transitionTimingFunction: {
    lux: 'cubic-bezier(0.22, 1, 0.36, 1)',
    'lux-in': 'cubic-bezier(0.64, 0, 0.78, 0)',
  },
};

// "Maison Rouge" brand faces (self-hosted): Bodoni Moda display + Hanken
// Grotesk UI. Swapping these here re-types the entire storefront at once.
const SERIF = ['"Bodoni Moda"', 'Georgia', 'Cambria', 'Times New Roman', 'serif'];
const SANS = [
  '"Hanken Grotesk"',
  'ui-sans-serif',
  'system-ui',
  '-apple-system',
  'Segoe UI',
  'Roboto',
  '"Inter"',
  'Helvetica Neue',
  'Arial',
  'sans-serif',
];

module.exports = {
  content: [
    './views/**/*.njk',
    './src/client/**/*.{ts,js}',
    './src/**/*.controller.ts',
  ],
  theme: {
    extend: {
      colors: atelier.colors,
      borderRadius: atelier.borderRadius,
      spacing: atelier.spacing,
      boxShadow: atelier.boxShadow,
      letterSpacing: atelier.letterSpacing,
      transitionTimingFunction: atelier.transitionTimingFunction,
      maxWidth: { 'container-max': '1280px' },
      fontFamily: {
        sans: SANS,
        serif: SERIF,
        // "Maison Rouge" brand faces — Bodoni Moda display + Hanken Grotesk UI.
        // Additive tokens used by the redesigned navbar/footer/home.
        'brand-serif': ['"Bodoni Moda"', 'Georgia', 'Cambria', 'serif'],
        'brand-sans': ['"Hanken Grotesk"', 'ui-sans-serif', 'system-ui', 'Inter', 'sans-serif'],
        'display-lg': SERIF,
        'display-lg-mobile': SERIF,
        'headline-lg': SERIF,
        'headline-lg-mobile': SERIF,
        'headline-md': SERIF,
        'headline-sm': SERIF,
        'body-lg': SANS,
        'body-md': SANS,
        'label-md': SANS,
        'label-sm': SANS,
      },
      fontSize: {
        // Heritage Atelier type scale — Libre Caslon Text display, Inter UI.
        // Refined tracking/leading for a more editorial, premium feel.
        'label-sm': ['12px', { lineHeight: '16px', letterSpacing: '0.1em', fontWeight: '500' }],
        'label-md': ['14px', { lineHeight: '18px', letterSpacing: '0.12em', fontWeight: '600' }],
        'headline-sm': ['22px', { lineHeight: '30px', letterSpacing: '-0.008em', fontWeight: '500' }],
        'headline-lg-mobile': ['32px', { lineHeight: '1.12', letterSpacing: '-0.012em', fontWeight: '500' }],
        'headline-md': ['30px', { lineHeight: '38px', letterSpacing: '-0.014em', fontWeight: '500' }],
        'display-lg-mobile': ['40px', { lineHeight: '1.04', letterSpacing: '-0.02em', fontWeight: '500' }],
        'display-lg': ['68px', { lineHeight: '1.0', letterSpacing: '-0.032em', fontWeight: '500' }],
        'headline-lg': ['42px', { lineHeight: '1.08', letterSpacing: '-0.02em', fontWeight: '500' }],
        'body-md': ['16px', { lineHeight: '26px', fontWeight: '400' }],
        'body-lg': ['18px', { lineHeight: '30px', fontWeight: '400' }],
      },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/typography')],
};
